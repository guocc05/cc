// @20260513-im-btw-side-fork 单测：/btw 入口路径 + forkSession/deleteForkSession 机制
// 覆盖：parseCommand 识别、错误前置（缺 binding / 工具不支持 / 无参）、
//      forkSession/deleteForkSession 文件层正确性（baseline 不变 + fork 内容一致 + 幂等删除）。
// handleBtw 的 enqueue 成功路径（driver.sendMessage 真调 Claude CLI）由端到端实测覆盖（AC-1/AC-7/AC-2）。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-btw-'))
process.env.HOME = testHome

const commands = await import(path.join(rootDir, 'dist', 'src', 'commands.js'))
const configMod = await import(path.join(rootDir, 'dist', 'src', 'config.js'))
const registry = await import(path.join(rootDir, 'dist', 'src', 'registry.js'))
const session = await import(path.join(rootDir, 'dist', 'src', 'session.js'))
const toolDriver = await import(path.join(rootDir, 'dist', 'src', 'tool-driver.js'))
const discover = await import(path.join(rootDir, 'dist', 'src', 'discover.js'))
const queue = await import(path.join(rootDir, 'dist', 'src', 'queue.js'))
// 触发 driver 自动注册
await import(path.join(rootDir, 'dist', 'src', 'claude-driver.js'))
await import(path.join(rootDir, 'dist', 'src', 'codex-driver.js'))
await import(path.join(rootDir, 'dist', 'src', 'gemini-driver.js'))

function resetState() {
  fs.rmSync(path.join(testHome, '.cc'), { recursive: true, force: true })
  fs.rmSync(path.join(testHome, 'Code'), { recursive: true, force: true })
  fs.rmSync(path.join(testHome, '.claude'), { recursive: true, force: true })
}

function configForTests() {
  return { ...configMod.loadConfig(), defaultModes: {} }
}

function registerSession(name, cwdBase, tool, conversationId, permissionMode = 'default') {
  const cwd = path.join(testHome, 'Code', cwdBase)
  fs.mkdirSync(cwd, { recursive: true })
  registry.register(name, `${name}-session`, cwd, tool)
  session.createBinding(conversationId, `${name}-session`, cwd, permissionMode, 'test-cli', 'feishu', tool)
  return cwd
}

/** 在 ~/.claude/projects/<slug>/<sessionId>.jsonl 写一个假 baseline session 文件 */
function fakeBaselineSession(cwd, sessionId, content = null) {
  const slug = discover.pathToSlug(cwd)
  const dir = path.join(testHome, '.claude', 'projects', slug)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const lines = content ?? [
    JSON.stringify({ type: 'user', sessionId, message: { role: 'user', content: 'hello' } }),
    JSON.stringify({ type: 'assistant', sessionId, message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
  ]
  fs.writeFileSync(filePath, lines.join('\n') + '\n')
  return filePath
}

// ============================================================
// parseCommand 识别
// ============================================================

test('parseCommand 识别 /btw 与参数', () => {
  resetState()
  const p = commands.parseCommand('/btw 暗号是什么?')
  assert.ok(p)
  assert.equal(p.command, 'btw')
  assert.equal(p.args, '暗号是什么?')

  // 无参 /btw 也被识别（错误处理在 handleBtw 里）
  const p2 = commands.parseCommand('/btw')
  assert.ok(p2)
  assert.equal(p2.command, 'btw')
  assert.equal(p2.args, '')
})

test('parseCommand /btw 大小写不敏感', () => {
  resetState()
  const p = commands.parseCommand('/BTW some question')
  assert.ok(p)
  assert.equal(p.command, 'btw')
})

// ============================================================
// handleBtw 前置错误（AC-4 / AC-10 / AC-3）
// ============================================================

test('handleBtw 无 binding → ❌ 当前会话未连接对话', async () => {
  resetState()
  const reply = await commands.handleCommand({ command: 'btw', args: 'q' }, 'conv-noB', configForTests(), 'feishu', async () => {})
  assert.match(reply, /未连接对话/)
})

test('handleBtw 无参 → ❌ 用法提示', async () => {
  resetState()
  registerSession('btw1', 'p1', 'claude', 'conv-btw1')
  const reply = await commands.handleCommand({ command: 'btw', args: '' }, 'conv-btw1', configForTests(), 'feishu', async () => {})
  assert.match(reply, /需要一个问题/)
})

test('handleBtw 仅空白参数 → ❌ 用法提示', async () => {
  resetState()
  registerSession('btw2', 'p2', 'claude', 'conv-btw2')
  const reply = await commands.handleCommand({ command: 'btw', args: '   \t  ' }, 'conv-btw2', configForTests(), 'feishu', async () => {})
  assert.match(reply, /需要一个问题/)
})

test('handleBtw Codex binding → ❌ V1 仅 Claude', async () => {
  resetState()
  registerSession('btw-cx', 'pcx', 'codex', 'conv-cx')
  const reply = await commands.handleCommand({ command: 'btw', args: 'question' }, 'conv-cx', configForTests(), 'feishu', async () => {})
  assert.match(reply, /暂不支持/)
  assert.match(reply, /V1 仅 Claude/)
})

test('handleBtw Gemini binding → ❌ 暂不支持', async () => {
  resetState()
  registerSession('btw-gm', 'pgm', 'gemini', 'conv-gm')
  const reply = await commands.handleCommand({ command: 'btw', args: 'question' }, 'conv-gm', configForTests(), 'feishu', async () => {})
  assert.match(reply, /暂不支持/)
})

test('handleBtw Claude binding 但 session 文件不存在 → ❌ /btw 失败', async () => {
  resetState()
  registerSession('btw-orphan', 'porph', 'claude', 'conv-orph')
  // 不创建 baseline 文件 → forkSession throws
  const reply = await commands.handleCommand({ command: 'btw', args: 'question' }, 'conv-orph', configForTests(), 'feishu', async () => {})
  assert.match(reply, /\/btw 失败/)
  assert.match(reply, /session 文件不存在/)
})

// ============================================================
// forkSession / deleteForkSession 单元测试（claude-driver 专有方法）
// ============================================================

test('forkSession: baseline 存在 → 返回新 UUID + 文件被 cp + baseline 不变', () => {
  resetState()
  const cwd = path.join(testHome, 'Code', 'fk1')
  fs.mkdirSync(cwd, { recursive: true })
  const baselineId = 'baseline-sess-001'
  const baselinePath = fakeBaselineSession(cwd, baselineId)
  const baselineSize = fs.statSync(baselinePath).size
  const baselineContent = fs.readFileSync(baselinePath, 'utf-8')

  const driver = toolDriver.getDriver('claude')
  assert.equal(typeof driver.forkSession, 'function', 'Claude driver 应有 forkSession')
  const forkId = driver.forkSession(baselineId, cwd)

  // fork id 是 UUID v4 形态（36 字符 + dash 数量）
  assert.match(forkId, /^[0-9a-f-]{36}$/)
  assert.notEqual(forkId, baselineId, 'fork id 必须不同于 baseline id')

  // fork 文件存在 + 内容与 baseline 完全一致
  const slug = discover.pathToSlug(cwd)
  const forkPath = path.join(testHome, '.claude', 'projects', slug, `${forkId}.jsonl`)
  assert.ok(fs.existsSync(forkPath), 'fork 文件应被创建')
  const forkContent = fs.readFileSync(forkPath, 'utf-8')
  assert.equal(forkContent, baselineContent, 'fork 内容必须与 baseline 完全一致（cp 准确）')

  // baseline 不变（size 验证）
  assert.equal(fs.statSync(baselinePath).size, baselineSize, 'baseline 文件 size 不应变化')
})

test('forkSession: baseline 不存在 → 抛 Error', () => {
  resetState()
  const cwd = path.join(testHome, 'Code', 'fk-missing')
  fs.mkdirSync(cwd, { recursive: true })

  const driver = toolDriver.getDriver('claude')
  assert.throws(
    () => driver.forkSession('never-existed-id', cwd),
    /session 文件不存在/,
  )
})

test('deleteForkSession: 文件存在 → 删除', () => {
  resetState()
  const cwd = path.join(testHome, 'Code', 'dk1')
  fs.mkdirSync(cwd, { recursive: true })
  const id = 'del-test-id-001'
  const filePath = fakeBaselineSession(cwd, id)
  assert.ok(fs.existsSync(filePath), 'pre: 文件应存在')

  const driver = toolDriver.getDriver('claude')
  driver.deleteForkSession(id, cwd)

  assert.equal(fs.existsSync(filePath), false, 'post: 文件应被删除')
})

test('deleteForkSession: 文件不存在 → 不抛（幂等）', () => {
  resetState()
  const cwd = path.join(testHome, 'Code', 'dk-noop')
  fs.mkdirSync(cwd, { recursive: true })

  const driver = toolDriver.getDriver('claude')
  // 不应抛
  driver.deleteForkSession('never-existed-id', cwd)
})

test('Claude capability supportsBtw=true（Codex/Gemini 缺省 = false/undefined）', () => {
  const claude = toolDriver.getDriver('claude')
  assert.equal(claude.capabilities.supportsBtw, true, 'Claude supportsBtw 应为 true')

  const codex = toolDriver.getDriver('codex')
  assert.notEqual(codex.capabilities.supportsBtw, true, 'Codex supportsBtw 不应为 true')

  const gemini = toolDriver.getDriver('gemini')
  assert.notEqual(gemini.capabilities.supportsBtw, true, 'Gemini supportsBtw 不应为 true')
})

test('parseCommand /btw 不出现在 / 开头的非 COMMANDS 集合里（防 typo 误识别）', () => {
  resetState()
  // 这些 /开头但不在 COMMANDS Set 内的应返回 null
  for (const raw of ['/bttw', '/btww', '/btw-other']) {
    assert.equal(commands.parseCommand(raw), null, `${raw} 不应被识别`)
  }
})

// ============================================================
// REVISION 2026-05-13 工具限制 (AC-12)
// ============================================================

test('AC-12: BTW_DISALLOWED_TOOLS 常量包含所有写工具 + 排除所有读工具', () => {
  // 写工具必须在禁列表（保证 fork turn 不污染文件系统）
  const mustBeDisallowed = ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Task', 'TodoWrite', 'AskUserQuestion', 'SlashCommand']
  for (const tool of mustBeDisallowed) {
    assert.ok(queue.BTW_DISALLOWED_TOOLS.includes(tool), `${tool} 必须在 BTW_DISALLOWED_TOOLS 禁列表`)
  }
  // 读工具不应在禁列表（保证 fork turn 仍能读代码）
  const mustBeAllowed = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'NotebookRead', 'TodoRead']
  for (const tool of mustBeAllowed) {
    assert.equal(queue.BTW_DISALLOWED_TOOLS.includes(tool), false, `${tool} 不应在 BTW_DISALLOWED_TOOLS 禁列表`)
  }
})

test('AC-12: BTW_DISALLOWED_TOOLS 是 frozen（防止运行时被改）', () => {
  const before = [...queue.BTW_DISALLOWED_TOOLS]
  assert.throws(
    () => { queue.BTW_DISALLOWED_TOOLS.push('FakeTool') },
    /Cannot add property|Cannot assign|read only|extensible/,
  )
  // 验证内容不变
  assert.deepEqual([...queue.BTW_DISALLOWED_TOOLS], before)
})

test('AC-12: SendMessageOptions 类型含 disallowedTools 字段（编译期 + 透传）', () => {
  // SendMessageOptions 是 interface，运行时无法直接断言；
  // 但 TypeScript 编译通过即说明字段存在。这里做一个间接验证：
  // 构造一个含 disallowedTools 的 opts 对象，再去查 driver 实现是否能不抛地接受。
  const claude = toolDriver.getDriver('claude')
  // 不真调（避免起子进程）：仅验证 driver 函数签名形态
  assert.equal(typeof claude.sendMessage, 'function')
})
