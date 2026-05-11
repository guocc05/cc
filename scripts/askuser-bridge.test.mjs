import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// 用临时 HOME 隔离 ~/.im2cc 配置和 socket
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'askuser-bridge-test-'))
process.env.HOME = tmpHome
process.env.IM2CC_LOG_QUIET = '1' // 测试期不刷日志

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bridge = await import(path.join(rootDir, 'dist', 'src', 'askuser-bridge.js'))
const cfg = await import(path.join(rootDir, 'dist', 'src', 'config.js'))

const SOCKET_PATH = cfg.getAskUserSocketPath()

// 模拟 hook 客户端：连 socket，发 ask，等响应
function createMockHook() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH)
    const responses = []
    let buffer = ''
    socket.on('connect', () => resolve({
      socket,
      responses,
      sendAsk(toolUseId, opts = {}) {
        socket.write(JSON.stringify({
          type: 'ask',
          toolUseId,
          sessionId: opts.sessionId ?? 'sess-1',
          conversationId: opts.conversationId ?? 'conv-1',
          question: opts.question ?? 'q?',
          options: opts.options ?? [{ label: 'A' }, { label: 'B' }],
          multiSelect: false,
        }) + '\n')
      },
      waitForResponse(toolUseId, timeoutMs = 2000) {
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`timeout waiting for response for ${toolUseId}`)), timeoutMs)
          const check = () => {
            const found = responses.find(r => r.toolUseId === toolUseId)
            if (found) {
              clearTimeout(timer)
              res(found)
              return true
            }
            return false
          }
          if (check()) return
          const onResp = () => { if (check()) socket.off('_resp', onResp) }
          socket.on('_resp', onResp)
        })
      },
      close() { try { socket.end() } catch {} },
    }))
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8')
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          responses.push(msg)
          socket.emit('_resp', msg)
        } catch {}
      }
    })
    socket.on('error', reject)
  })
}

test('startAskUserBridge listens on socket and accepts hook connections', async () => {
  await bridge.startAskUserBridge()
  assert.ok(fs.existsSync(SOCKET_PATH), 'socket file should be created')
  bridge.stopAskUserBridge()
  assert.ok(!fs.existsSync(SOCKET_PATH), 'socket file should be removed after stop')
})

test('ask -> submitAnswer round-trip injects answer into hook', async () => {
  await bridge.startAskUserBridge()
  try {
    let asked = null
    const off = bridge.onAsk((ask) => { asked = ask })

    const hook = await createMockHook()
    hook.sendAsk('tu-1', { question: 'pick' })

    // 等 daemon 收到 ask
    for (let i = 0; i < 50 && !asked; i++) await new Promise(r => setTimeout(r, 10))
    assert.ok(asked, 'onAsk handler should fire')
    assert.equal(asked.toolUseId, 'tu-1')
    assert.equal(asked.sessionId, 'sess-1')
    assert.equal(asked.conversationId, 'conv-1')
    assert.equal(asked.options.length, 2)

    // 通过 cardId 注入答案
    const ok = bridge.submitAnswerByCardId(asked.cardId, '用户的回答')
    assert.equal(ok, true)

    const resp = await hook.waitForResponse('tu-1')
    assert.equal(resp.type, 'answer')
    assert.equal(resp.answer, '用户的回答')

    off()
    hook.close()
  } finally {
    bridge.stopAskUserBridge()
  }
})

test('cancelBySessionId injects cancelled into pending hooks', async () => {
  await bridge.startAskUserBridge()
  try {
    const hook = await createMockHook()
    hook.sendAsk('tu-2', { sessionId: 'sess-2' })
    await new Promise(r => setTimeout(r, 50))

    const count = bridge.cancelBySessionId('sess-2', 'user /stop')
    assert.equal(count, 1)

    const resp = await hook.waitForResponse('tu-2')
    assert.equal(resp.type, 'cancelled')
    assert.equal(resp.reason, 'user /stop')

    hook.close()
  } finally {
    bridge.stopAskUserBridge()
  }
})

test('submitAnswerByCardId returns false for unknown cardId', async () => {
  await bridge.startAskUserBridge()
  try {
    const ok = bridge.submitAnswerByCardId('nonexistent-card', 'x')
    assert.equal(ok, false)
  } finally {
    bridge.stopAskUserBridge()
  }
})

test('listPending exposes current pending asks', async () => {
  await bridge.startAskUserBridge()
  try {
    const hook = await createMockHook()
    hook.sendAsk('tu-3', { sessionId: 'sess-3', question: 'Q3' })
    await new Promise(r => setTimeout(r, 50))

    const pending = bridge.listPending()
    assert.equal(pending.length, 1)
    assert.equal(pending[0].sessionId, 'sess-3')
    assert.equal(pending[0].question, 'Q3')

    bridge.cancelBySessionId('sess-3')
    hook.close()
  } finally {
    bridge.stopAskUserBridge()
  }
})

test('hook disconnect without answer marks pending as cancelled', async () => {
  await bridge.startAskUserBridge()
  try {
    let cancelled = null
    const off = bridge.onCancelled((ev) => { cancelled = ev })

    const hook = await createMockHook()
    hook.sendAsk('tu-4', { sessionId: 'sess-4' })
    await new Promise(r => setTimeout(r, 50))

    hook.close()
    await new Promise(r => setTimeout(r, 100))

    assert.ok(cancelled, 'cancelled event should fire when hook disconnects')
    assert.equal(cancelled.toolUseId, 'tu-4')

    off()
  } finally {
    bridge.stopAskUserBridge()
  }
})

test('getAskUserTimeoutMinutes clamps to [1, 9]', async () => {
  // 默认值 8
  assert.equal(cfg.getAskUserTimeoutMinutes({ askUserTimeoutMinutes: 8 }), 8)
  // 范围内
  assert.equal(cfg.getAskUserTimeoutMinutes({ askUserTimeoutMinutes: 5 }), 5)
  assert.equal(cfg.getAskUserTimeoutMinutes({ askUserTimeoutMinutes: 1 }), 1)
  assert.equal(cfg.getAskUserTimeoutMinutes({ askUserTimeoutMinutes: 9 }), 9)
  // 越下限
  assert.equal(cfg.getAskUserTimeoutMinutes({ askUserTimeoutMinutes: 0 }), 1)
  assert.equal(cfg.getAskUserTimeoutMinutes({ askUserTimeoutMinutes: -3 }), 1)
  // 越上限
  assert.equal(cfg.getAskUserTimeoutMinutes({ askUserTimeoutMinutes: 10 }), 9)
  assert.equal(cfg.getAskUserTimeoutMinutes({ askUserTimeoutMinutes: 30 }), 9)
  // 异常
  assert.equal(cfg.getAskUserTimeoutMinutes({ askUserTimeoutMinutes: NaN }), 8)
})
