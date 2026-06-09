// @20260510-im-slash-passthrough 单测：/clear /compact /model 入口路径
// 覆盖：parseCommand 识别、错误前置（缺 binding / 工具不支持 / inflight）、handleModel 的成功路径。
// handleClear / handleCompact 的 driver 成功路径（调 createSession / sendMessage）由端到端实测覆盖。
// 注：/status 在 2026-05-12 移除（与 /fs 重叠，统一用 /fs）。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-slash-'))
process.env.HOME = testHome

const commands = await import(path.join(rootDir, 'dist', 'src', 'commands.js'))
const configMod = await import(path.join(rootDir, 'dist', 'src', 'config.js'))
const registry = await import(path.join(rootDir, 'dist', 'src', 'registry.js'))
const session = await import(path.join(rootDir, 'dist', 'src', 'session.js'))
const modelPending = await import(path.join(rootDir, 'dist', 'src', 'model-pending.js'))
const modelCatalog = await import(path.join(rootDir, 'dist', 'src', 'model-catalog.js'))
// 触发 driver 自动注册（commands.handleCommand 路由分支需 hasDriver）
await import(path.join(rootDir, 'dist', 'src', 'claude-driver.js'))
await import(path.join(rootDir, 'dist', 'src', 'codex-driver.js'))
await import(path.join(rootDir, 'dist', 'src', 'gemini-driver.js'))

function resetState() {
  fs.rmSync(path.join(testHome, '.cc'), { recursive: true, force: true })
  fs.rmSync(path.join(testHome, 'Code'), { recursive: true, force: true })
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

test('parseCommand 识别新增的 /clear /compact /model（/status 已移除）', () => {
  resetState()
  for (const raw of ['/clear', '/compact', '/model']) {
    const parsed = commands.parseCommand(raw)
    assert.ok(parsed, `${raw} 应被识别`)
    assert.equal(parsed.command, raw.slice(1))
  }
  // 带参数
  const m = commands.parseCommand('/model claude-opus-4-7')
  assert.ok(m)
  assert.equal(m.command, 'model')
  assert.equal(m.args, 'claude-opus-4-7')

  // /clear 带多余参数应被解析但 args 不影响识别
  const c = commands.parseCommand('/clear extra args')
  assert.ok(c)
  assert.equal(c.command, 'clear')
  assert.equal(c.args, 'extra args')

  // /status 已移除：当作普通 prompt 走 AI（parseCommand 返回 null）
  assert.equal(commands.parseCommand('/status'), null)
})

test('parseCommand 不识别非白名单的 / 开头消息（保持现状走 AI）', () => {
  resetState()
  for (const raw of ['/init', '/memory', '/hooks', '/mcp', '/agents', '/foobar']) {
    assert.equal(commands.parseCommand(raw), null, `${raw} 不应被识别`)
  }
})

test('parseCommand 大小写不敏感（沿用现有 parseCommand 行为）', () => {
  resetState()
  // 现有 parseCommand 用 .toLowerCase() 匹配；新命令沿用同套规则
  const lower = commands.parseCommand('/Clear')
  assert.ok(lower)
  assert.equal(lower.command, 'clear')

  const upper = commands.parseCommand('/CLEAR')
  assert.ok(upper)
  assert.equal(upper.command, 'clear')
})

test('handleClear / handleCompact / handleModel 无活跃 binding 时统一报错', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)

  for (const cmd of ['/clear', '/compact', '/model']) {
    const parsed = commands.parseCommand(cmd)
    const out = await commands.handleCommand(parsed, 'conv-empty', config)
    assert.match(out, /❌ 当前会话未连接对话/, `${cmd} 无 binding 应报错`)
  }
})

test('handleCompact 在 Codex binding 下报错（仅 Claude 支持）', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('codex-alpha', 'proj-codex', 'codex', 'conv-codex')

  const parsed = commands.parseCommand('/compact')
  const out = await commands.handleCommand(parsed, 'conv-codex', config)
  assert.match(out, /❌ \/compact 仅 Claude 支持/)
  assert.match(out, /当前工具: Codex/)
})

test('handleModel 在 Gemini binding 下报错', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('gem-alpha', 'proj-gem', 'gemini', 'conv-gem')

  const parsed = commands.parseCommand('/model gpt-5')
  const out = await commands.handleCommand(parsed, 'conv-gem', config)
  assert.match(out, /❌ Gemini 暂不支持 \/model/)
})

test('/model 无参 (claude) 展示候选列表 + 设 pending state', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('alpha', 'proj', 'claude', 'conv-mod')

  const parsed = commands.parseCommand('/model')
  const out = await commands.handleCommand(parsed, 'conv-mod', config)
  assert.match(out, /🤖 Claude 可选模型/)
  assert.match(out, /当前: 使用工具默认/)
  assert.match(out, /1\) opus-4\.7/)
  assert.match(out, /2\) sonnet-4\.6/)
  assert.match(out, /3\) haiku-4\.5/)
  assert.match(out, /回复编号切换 \(60s 内有效\)/)
  assert.match(out, /\/model default 重置为工具默认/)
  assert.equal(modelPending.hasPendingModelSelection('conv-mod'), true)
})

test('/model 无参 (codex 含 4 个候选) 展示列表 + 当前 ★ 标记', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('codex-alpha', 'proj-codex', 'codex', 'conv-codex-mod')
  session.updateBinding('conv-codex-mod', { modelOverride: 'gpt-5-mini' })

  const parsed = commands.parseCommand('/model')
  const out = await commands.handleCommand(parsed, 'conv-codex-mod', config)
  assert.match(out, /🤖 Codex 可选模型/)
  assert.match(out, /当前: gpt-5-mini ★/)
  assert.match(out, /1\) gpt-5\.5/)
  assert.match(out, /2\) gpt-5\s/)
  assert.match(out, /3\) gpt-5-mini.*★ 当前/)
  assert.match(out, /4\) gpt-5-codex/)
  assert.equal(modelPending.hasPendingModelSelection('conv-codex-mod'), true)
})

test('/model <编号> 直接切换（无 pending 依赖）', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('alpha', 'proj', 'claude', 'conv-num')

  const parsed = commands.parseCommand('/model 2')
  const out = await commands.handleCommand(parsed, 'conv-num', config)
  assert.match(out, /✅ 已切换到模型 "sonnet-4\.6"/)
  assert.equal(session.getBinding('conv-num')?.modelOverride, 'claude-sonnet-4-6')
})

test('/model <短名> 命中清单 → 写入完整名 + 回执用短名', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('alpha', 'proj', 'claude', 'conv-short')

  const parsed = commands.parseCommand('/model opus-4.7')
  const out = await commands.handleCommand(parsed, 'conv-short', config)
  assert.match(out, /✅ 已切换到模型 "opus-4\.7"/)
  assert.equal(session.getBinding('conv-short')?.modelOverride, 'claude-opus-4-7')
})

test('/model <完整名> 命中清单 → 回执也用短名（便于复述）', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('alpha', 'proj', 'claude', 'conv-full')

  const parsed = commands.parseCommand('/model claude-haiku-4-5-20251001')
  const out = await commands.handleCommand(parsed, 'conv-full', config)
  assert.match(out, /✅ 已切换到模型 "haiku-4\.5"/)
  assert.equal(session.getBinding('conv-full')?.modelOverride, 'claude-haiku-4-5-20251001')
})

test('/model <任意字符串> 不在清单 → 原样写入 + 回执显示原文', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('alpha', 'proj', 'claude', 'conv-free')

  const parsed = commands.parseCommand('/model my-future-experimental-model')
  const out = await commands.handleCommand(parsed, 'conv-free', config)
  assert.match(out, /✅ 已切换到模型 "my-future-experimental-model"/)
  assert.equal(session.getBinding('conv-free')?.modelOverride, 'my-future-experimental-model')
})

test('/model 列表 headline ★ 标记只在当前选择真命中清单时显示', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('alpha', 'proj', 'claude', 'conv-star-in')
  // 1) 清单内：headline 与列表行都带 ★
  session.updateBinding('conv-star-in', { modelOverride: 'claude-opus-4-7' })
  const outIn = await commands.handleCommand(commands.parseCommand('/model'), 'conv-star-in', config)
  assert.match(outIn, /当前: opus-4\.7 ★/)
  assert.match(outIn, /1\) opus-4\.7.*★ 当前/)

  // 2) 自由输入非清单值：headline 不带 ★（与列表无 ★ 对齐，避免视觉不一致）
  registerSession('beta', 'proj2', 'claude', 'conv-star-free')
  session.updateBinding('conv-star-free', { modelOverride: 'my-custom-experimental' })
  const outFree = await commands.handleCommand(commands.parseCommand('/model'), 'conv-star-free', config)
  assert.match(outFree, /当前: my-custom-experimental[^★]/)
  // 也不应有任何 ★ 标记出现在列表行（因为没条目命中）
  assert.equal(/★/.test(outFree), false)

  // 3) 未设置 modelOverride：显示"使用工具默认" 无 ★
  registerSession('gamma', 'proj3', 'claude', 'conv-star-none')
  const outNone = await commands.handleCommand(commands.parseCommand('/model'), 'conv-star-none', config)
  assert.match(outNone, /当前: 使用工具默认/)
  assert.equal(/★/.test(outNone), false)
})

test('/model default 重置 + 清除 pending state', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('alpha', 'proj', 'claude', 'conv-reset')
  session.updateBinding('conv-reset', { modelOverride: 'claude-sonnet-4-6' })
  // 先设个 pending
  modelPending.setPendingModelSelection('conv-reset', modelCatalog.getModelCatalog('claude'))
  assert.equal(modelPending.hasPendingModelSelection('conv-reset'), true)

  const parsed = commands.parseCommand('/model default')
  const out = await commands.handleCommand(parsed, 'conv-reset', config)
  assert.match(out, /✅ 已重置为工具默认模型/)
  assert.equal(session.getBinding('conv-reset')?.modelOverride, undefined)
  assert.equal(modelPending.hasPendingModelSelection('conv-reset'), false)
})

test('model-pending: consumePendingModelSelection 命中纯数字 + 自动清除', () => {
  resetState()
  const options = modelCatalog.getModelCatalog('claude')
  modelPending.setPendingModelSelection('conv-cp', options)

  const hit = modelPending.consumePendingModelSelection('conv-cp', '2')
  assert.ok(hit)
  assert.equal(hit.shortName, 'sonnet-4.6')
  assert.equal(modelPending.hasPendingModelSelection('conv-cp'), false)
})

test('model-pending: 非纯数字消息命中失败 + 清除 pending（一次性消耗）', () => {
  resetState()
  const options = modelCatalog.getModelCatalog('claude')
  modelPending.setPendingModelSelection('conv-clear', options)

  const hit1 = modelPending.consumePendingModelSelection('conv-clear', 'hello world')
  assert.equal(hit1, null)
  assert.equal(modelPending.hasPendingModelSelection('conv-clear'), false)
})

test('model-pending: 数字超出列表长度命中失败 + 清除', () => {
  resetState()
  const options = modelCatalog.getModelCatalog('claude') // 3 项
  modelPending.setPendingModelSelection('conv-oob', options)

  const hit = modelPending.consumePendingModelSelection('conv-oob', '9')
  assert.equal(hit, null)
  assert.equal(modelPending.hasPendingModelSelection('conv-oob'), false)
})

test('model-pending: 无 pending 时返回 null', () => {
  resetState()
  const hit = modelPending.consumePendingModelSelection('conv-none', '2')
  assert.equal(hit, null)
})

test('model-catalog: config.modelCatalogs.claude 覆盖内置清单', async () => {
  resetState()
  const config = configForTests()
  config.modelCatalogs = {
    claude: [
      { shortName: 'opus-5', fullName: 'claude-opus-5', description: 'Opus 5（用户自定义）' },
      { shortName: 'sonnet-5', fullName: 'claude-sonnet-5', description: 'Sonnet 5' },
    ],
  }
  configMod.saveConfig(config)

  const cat = modelCatalog.getModelCatalog('claude')
  assert.equal(cat.length, 2)
  assert.equal(cat[0].shortName, 'opus-5')
  assert.equal(cat[0].fullName, 'claude-opus-5')
  assert.equal(cat[1].shortName, 'sonnet-5')

  // 内置默认完全替换，原 opus-4.7 不在
  assert.equal(cat.find(o => o.shortName === 'opus-4.7'), undefined)
})

test('model-catalog: config.modelCatalogs.claude 全部条目无效时 fallback 到内置', () => {
  resetState()
  const config = configForTests()
  config.modelCatalogs = {
    // 全部缺字段
    claude: [{ shortName: 'incomplete' }, { random: 'garbage' }],
  }
  configMod.saveConfig(config)

  const cat = modelCatalog.getModelCatalog('claude')
  // fallback 到 BUILTIN
  assert.equal(cat.length, modelCatalog.BUILTIN_MODEL_CATALOG.claude.length)
  assert.equal(cat[0].shortName, 'opus-4.7')
})

test('model-catalog: config.modelCatalogs 缺失或 null → 用内置默认', () => {
  resetState()
  const config = configForTests()
  // 不设 modelCatalogs
  configMod.saveConfig(config)

  const claudeCat = modelCatalog.getModelCatalog('claude')
  assert.deepEqual(claudeCat, modelCatalog.BUILTIN_MODEL_CATALOG.claude)

  const codexCat = modelCatalog.getModelCatalog('codex')
  assert.deepEqual(codexCat, modelCatalog.BUILTIN_MODEL_CATALOG.codex)
})

test('model-catalog: gemini 始终返回空数组（与 §4.8 维护模式一致）', () => {
  resetState()
  assert.deepEqual(modelCatalog.getModelCatalog('gemini'), [])
})

test('model-catalog: resolveModelInput 三轨', () => {
  // 短名命中
  const a = modelCatalog.resolveModelInput('claude', 'opus-4.7')
  assert.equal(a.fullName, 'claude-opus-4-7')
  assert.equal(a.shortName, 'opus-4.7')
  assert.equal(a.matched, true)

  // 完整名命中
  const b = modelCatalog.resolveModelInput('codex', 'gpt-5.5')
  assert.equal(b.fullName, 'gpt-5.5')
  assert.equal(b.shortName, 'gpt-5.5')
  assert.equal(b.matched, true)

  // 自由输入
  const c = modelCatalog.resolveModelInput('claude', 'custom-experimental')
  assert.equal(c.fullName, 'custom-experimental')
  assert.equal(c.shortName, undefined)
  assert.equal(c.matched, false)

  // 未支持工具
  const d = modelCatalog.resolveModelInput('gemini', 'x')
  assert.equal(d.matched, false)
})

test('handleClear 在 Gemini binding 下报错（不调 driver）', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)
  registerSession('gem-alpha', 'proj-gem', 'gemini', 'conv-clear-gem')

  const parsed = commands.parseCommand('/clear')
  const out = await commands.handleCommand(parsed, 'conv-clear-gem', config)
  assert.match(out, /❌ Gemini 暂不支持 \/clear/)
})
