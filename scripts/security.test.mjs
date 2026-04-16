import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliPath = path.join(rootDir, 'dist', 'bin', 'im2cc.js')
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'im2cc-security-'))
process.env.HOME = testHome

const security = await import(path.join(rootDir, 'dist', 'src', 'security.js'))
const discover = await import(path.join(rootDir, 'dist', 'src', 'discover.js'))
const commands = await import(path.join(rootDir, 'dist', 'src', 'commands.js'))
const configMod = await import(path.join(rootDir, 'dist', 'src', 'config.js'))
const registry = await import(path.join(rootDir, 'dist', 'src', 'registry.js'))

function resetState() {
  fs.rmSync(path.join(testHome, '.im2cc'), { recursive: true, force: true })
  fs.rmSync(path.join(testHome, '.claude'), { recursive: true, force: true })
  fs.rmSync(path.join(testHome, 'Code'), { recursive: true, force: true })
  fs.rmSync(path.join(testHome, 'Elsewhere'), { recursive: true, force: true })
}

function configForTests() {
  return {
    ...configMod.loadConfig(),
    allowedUserIds: [],
    defaultModes: {},
  }
}

function writeDiscoveredClaudeSession(projectPath, sessionId, firstMessage = 'hello') {
  const slug = discover.pathToSlug(projectPath)
  const sessionDir = path.join(testHome, '.claude', 'projects', slug)
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(path.join(sessionDir, `${sessionId}.jsonl`), `${JSON.stringify({
    type: 'user',
    message: { content: firstMessage },
  })}\n`)
}

test('isUserAllowed respects allow-all and explicit whitelist', () => {
  resetState()
  const config = configForTests()

  assert.equal(security.isUserAllowed('user-a', config), true)

  config.allowedUserIds = ['user-a', 'user-b']
  assert.equal(security.isUserAllowed('user-a', config), true)
  assert.equal(security.isUserAllowed('user-c', config), false)
})

test('validatePath accepts any existing directory (no path-whitelist enforcement)', () => {
  resetState()

  const root = path.join(testHome, 'Code')
  const child = path.join(root, 'project-a')
  const outside = path.join(testHome, 'Elsewhere', 'secret')

  fs.mkdirSync(child, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })

  // 以前在白名单外会被拦；现在只要存在且是目录就放行。
  // 访问范围由 AI 工具自身的 permission mode 决定，不在 im2cc 层面限制路径。
  assert.equal(security.validatePath(root).valid, true)
  assert.equal(security.validatePath(child).valid, true)
  assert.equal(security.validatePath(outside).valid, true)
})

test('validatePath still rejects non-existent or non-directory targets', () => {
  resetState()
  const root = path.join(testHome, 'Code')
  const filePath = path.join(root, 'README.md')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(filePath, 'hello')

  const missing = security.validatePath(path.join(root, 'missing-dir'))
  assert.equal(missing.valid, false)
  assert.match(missing.error ?? '', /路径不存在/)

  const notDir = security.validatePath(filePath)
  assert.equal(notDir.valid, false)
  assert.match(notDir.error ?? '', /不是目录/)
})

test('/fc rejects registered sessions whose cwd has been removed (clear error, no whitelist mention)', async () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)

  // registry 里登记一个实际不存在的 cwd，模拟目录被手动删除
  const gone = path.join(testHome, 'Elsewhere', 'gone')
  registry.register('ghost', 'ghost-session', gone, 'claude')

  const cmd = commands.parseCommand('/fc ghost')
  assert.ok(cmd)
  const output = await commands.handleCommand(cmd, 'conv-ghost', config)
  assert.match(output, /路径不存在|无法访问/)
  assert.match(output, /项目目录可能已被移动或删除/)
  assert.doesNotMatch(output, /已接入/)
  assert.doesNotMatch(output, /路径不在白名单内/)
})

test('im2cc connect to a session outside old whitelist no longer shows whitelist error', () => {
  resetState()
  const config = configForTests()
  configMod.saveConfig(config)

  const outside = path.join(testHome, 'Elsewhere', 'secret')
  fs.mkdirSync(outside, { recursive: true })
  registry.register('beta', 'beta-session', outside, 'claude')

  const stdout = execFileSync('node', [cliPath, 'connect', 'beta'], {
    cwd: rootDir,
    env: { ...process.env, HOME: testHome },
    encoding: 'utf-8',
  })

  // 核心断言：不再出现"路径不在白名单内"和"调整工作区"这种旧文案
  assert.doesNotMatch(stdout, /路径不在白名单内/)
  assert.doesNotMatch(stdout, /调整工作区/)
})

// 保留 writeDiscoveredClaudeSession 以避免 lint 警告（discover 模块依赖）
void writeDiscoveredClaudeSession
