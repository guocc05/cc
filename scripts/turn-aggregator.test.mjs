/**
 * turn-aggregator 状态机单测
 * 覆盖 AC: AC-1 (无空白冒号) / AC-2 (长调用反馈) / AC-3 (整轮 ≤ 1 状态)
 *        AC-7 (短调用透明) / AC-8 (跳过 AskUserQuestion) / AC-9 (/stop flush)
 *
 * @20260512-im-tool-call-progress
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const modulePath = pathToFileURL(path.join(rootDir, 'dist', 'src', 'turn-aggregator.js')).href

/** 模拟同步 setTimeout: 立即记录但不执行,手动 advance */
function makeFakeTimers() {
  let nextHandle = 1
  const scheduled = new Map() // handle -> { fn, delay }
  let now = 0

  const setTimeoutFn = (fn, delay) => {
    const handle = nextHandle++
    scheduled.set(handle, { fn, delay, fireAt: now + delay })
    return handle
  }
  const clearTimeoutFn = (handle) => {
    scheduled.delete(handle)
  }

  function advanceBy(ms) {
    now += ms
    // 找出所有应该 fire 的,按 fireAt 排序触发
    const due = [...scheduled.entries()]
      .filter(([, t]) => t.fireAt <= now)
      .sort((a, b) => a[1].fireAt - b[1].fireAt)
    for (const [handle, timer] of due) {
      scheduled.delete(handle)
      timer.fn()
    }
  }

  return { setTimeoutFn, clearTimeoutFn, advanceBy, pending: () => scheduled.size }
}

test('AC-1: 收到 text + tool_use 后,debounce 内 text 不立即发出', async () => {
  const { createTurnAggregator } = await import(modulePath)
  const timers = makeFakeTimers()
  const asyncActions = []
  const agg = createTurnAggregator({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onAsyncAction: (actions) => asyncActions.push(...actions),
  })

  // 模拟 "让我立即排查:" text → tool_use,这条 text 不应被立即发出
  const r1 = agg.consume({ kind: 'text', text: '让我立即排查:' })
  assert.deepEqual(r1, [], 'text 不应同步派出动作 (debounce 内)')
  assert.equal(asyncActions.length, 0, 'debounce 未触发')

  const r2 = agg.consume({ kind: 'tool_start', toolUseId: 't1', name: 'Bash' })
  assert.deepEqual(r2, [], 'tool_start 不派出动作')

  // 推进 2s,文本仍不应单独 flush (有 active tool)
  timers.advanceBy(2000)
  assert.equal(asyncActions.length, 0, 'active tool 期间 debounce 不 flush')
})

test('AC-2: 长 tool 调用 ≥10s 触发状态消息', async () => {
  const { createTurnAggregator } = await import(modulePath)
  const timers = makeFakeTimers()
  const asyncActions = []
  const agg = createTurnAggregator({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onAsyncAction: (actions) => asyncActions.push(...actions),
  })

  agg.consume({ kind: 'text', text: '让我查 X:' })
  agg.consume({ kind: 'tool_start', toolUseId: 't1', name: 'Bash' })

  timers.advanceBy(10000)
  assert.equal(asyncActions.length, 2, '应派出 send_text (flush 缓冲) + send_tool_status 两条')
  assert.equal(asyncActions[0].kind, 'send_text')
  assert.equal(asyncActions[0].text, '让我查 X:')
  assert.equal(asyncActions[1].kind, 'send_tool_status')
  assert.deepEqual(asyncActions[1].toolNames, ['Bash'])
  assert.equal(asyncActions[1].toolCount, 1)
})

test('AC-3: 整轮内连续 5 个 tool 调用,只发 1 条聚合状态消息', async () => {
  const { createTurnAggregator } = await import(modulePath)
  const timers = makeFakeTimers()
  const asyncActions = []
  const agg = createTurnAggregator({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onAsyncAction: (actions) => asyncActions.push(...actions),
  })

  // 5 个 tool 连续触发,持续超过 10s
  agg.consume({ kind: 'tool_start', toolUseId: 't1', name: 'Bash' })
  agg.consume({ kind: 'tool_start', toolUseId: 't2', name: 'Read' })
  agg.consume({ kind: 'tool_start', toolUseId: 't3', name: 'Grep' })
  agg.consume({ kind: 'tool_start', toolUseId: 't4', name: 'Edit' })
  agg.consume({ kind: 'tool_start', toolUseId: 't5', name: 'Bash' }) // 重复名

  timers.advanceBy(10000)
  const statusActions = asyncActions.filter(a => a.kind === 'send_tool_status')
  assert.equal(statusActions.length, 1, '整轮只发 1 条状态消息')
  assert.deepEqual(statusActions[0].toolNames, ['Bash', 'Read', 'Grep', 'Edit'])
  assert.equal(statusActions[0].toolCount, 5)

  // 再 advance,不应触发新状态
  timers.advanceBy(10000)
  const statusAfter = asyncActions.filter(a => a.kind === 'send_tool_status')
  assert.equal(statusAfter.length, 1, '后续不再发')
})

test('AC-7: 短 tool 调用 (<10s) 透明合并,无状态消息', async () => {
  const { createTurnAggregator } = await import(modulePath)
  const timers = makeFakeTimers()
  const asyncActions = []
  const agg = createTurnAggregator({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onAsyncAction: (actions) => asyncActions.push(...actions),
  })

  agg.consume({ kind: 'text', text: '让我查 X:' })
  agg.consume({ kind: 'tool_start', toolUseId: 't1', name: 'Bash' })
  timers.advanceBy(3000)   // 3s,不触发状态(阈值 10s)
  agg.consume({ kind: 'tool_end', toolUseId: 't1', success: true })
  agg.consume({ kind: 'text', text: '\n\n发现关键问题:Y' })
  const r = agg.consume({ kind: 'turn_end' })

  // 应该 flush 合并后的完整文本,无 status
  assert.ok(r.length >= 1, 'turn_end 至少派出一条')
  const textActions = r.filter(a => a.kind === 'send_text')
  const statusActions = [...asyncActions, ...r].filter(a => a.kind === 'send_tool_status')
  assert.equal(statusActions.length, 0, '短调用不发状态消息')
  assert.ok(textActions.length >= 1, 'flush 出合并文本')
  // 合并后文本应包含前后两段
  const merged = textActions.map(a => a.text).join('')
  assert.ok(merged.includes('让我查 X:'), '合并文本含前段')
  assert.ok(merged.includes('发现关键问题:Y'), '合并文本含后段')
})

test('AC-8: AskUserQuestion 不进 aggregator,无 status 触发', async () => {
  const { createTurnAggregator } = await import(modulePath)
  const timers = makeFakeTimers()
  const asyncActions = []
  const agg = createTurnAggregator({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onAsyncAction: (actions) => asyncActions.push(...actions),
  })

  agg.consume({ kind: 'tool_start', toolUseId: 'a1', name: 'AskUserQuestion' })
  timers.advanceBy(10000)
  assert.equal(asyncActions.length, 0, 'AskUserQuestion 期间无任何动作')
})

test('AC-9: flush() 强制派出缓冲(模拟 /stop)', async () => {
  const { createTurnAggregator } = await import(modulePath)
  const timers = makeFakeTimers()
  const agg = createTurnAggregator({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })

  agg.consume({ kind: 'text', text: '正在工作:' })
  agg.consume({ kind: 'tool_start', toolUseId: 't1', name: 'Bash' })
  const r = agg.flush()
  const textActions = r.filter(a => a.kind === 'send_text')
  assert.equal(textActions.length, 1, 'flush 派出缓冲文本')
  assert.equal(textActions[0].text, '正在工作:')
  assert.equal(agg.isTurnEnded(), true, 'flush 标记 turn 结束')
})

test('合并多段 text: 收到多个 text 连续累积,turn_end 时一次性 flush', async () => {
  const { createTurnAggregator } = await import(modulePath)
  const timers = makeFakeTimers()
  const agg = createTurnAggregator({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  })

  agg.consume({ kind: 'text', text: 'A' })
  agg.consume({ kind: 'text', text: 'B' })
  agg.consume({ kind: 'text', text: 'C' })
  const r = agg.consume({ kind: 'turn_end' })
  const textActions = r.filter(a => a.kind === 'send_text')
  assert.equal(textActions.length, 1)
  assert.equal(textActions[0].text, 'ABC')
})

test('debounce: 无 active tool 时,debounce 过期 flush', async () => {
  const { createTurnAggregator } = await import(modulePath)
  const timers = makeFakeTimers()
  const asyncActions = []
  const agg = createTurnAggregator({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onAsyncAction: (actions) => asyncActions.push(...actions),
  })

  agg.consume({ kind: 'text', text: 'hello' })
  timers.advanceBy(1500)
  assert.equal(asyncActions.length, 1)
  assert.equal(asyncActions[0].kind, 'send_text')
  assert.equal(asyncActions[0].text, 'hello')
})

test('abort() 清空所有缓冲不发送', async () => {
  const { createTurnAggregator } = await import(modulePath)
  const timers = makeFakeTimers()
  const asyncActions = []
  const agg = createTurnAggregator({
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onAsyncAction: (actions) => asyncActions.push(...actions),
  })

  agg.consume({ kind: 'text', text: '应该被丢弃' })
  agg.consume({ kind: 'tool_start', toolUseId: 't1', name: 'Bash' })
  agg.abort()
  timers.advanceBy(10000)
  assert.equal(asyncActions.length, 0, 'abort 后无任何派出')
  assert.equal(agg.isTurnEnded(), true)
})
