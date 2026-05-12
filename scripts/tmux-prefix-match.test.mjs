/**
 * tmuxExactTarget + tmux -t '=<name>' 精确匹配端到端验证
 * 覆盖 @20260512-fc-tmux-client-preempt 修复:
 *   tmux -t 默认 prefix match → 用 -t '=<name>' 禁用 prefix match
 *
 * 测试条件: 本机有 tmux 可用 (CI 不一定有)。无 tmux 时单测自动 skip。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const tmuxUtilPath = path.join(rootDir, 'dist', 'src', 'tmux-util.js')

function tmuxAvailable() {
  const r = spawnSync('tmux', ['-V'], { stdio: 'ignore' })
  return r.status === 0
}

function killSessionIfExists(name) {
  // 用 -t '=name' 安全删, 避免修复前的 prefix match 误杀
  try {
    execFileSync('tmux', ['kill-session', '-t', `=${name}`], { stdio: 'ignore' })
  } catch {}
}

test('tmuxExactTarget 返回 =<name> 形式', async () => {
  const { tmuxExactTarget } = await import(tmuxUtilPath)
  assert.equal(tmuxExactTarget('foo'), '=foo')
  assert.equal(tmuxExactTarget('im2cc-claude-im2cc'), '=im2cc-claude-im2cc')
  assert.equal(tmuxExactTarget(''), '=')
})

test('tmux -t <prefix> 默认 prefix match 行为存证 (修复前的 bug)', { skip: !tmuxAvailable() }, () => {
  // 测试场景: 创建 longName, 不创建 shortName (前者 = 后者 + '01')
  // shortName 是 longName 的前缀, has-session 不带 = 会 prefix match 命中 longName
  const pid = process.pid
  const shortName = `im2cc-test-prefix-foo-${pid}`
  const longName = `${shortName}01`

  try {
    // 创建 longName
    execFileSync('tmux', ['new-session', '-d', '-s', longName, 'sleep', '60'], { stdio: 'ignore' })

    // 现在 shortName 在 tmux 中不存在, 但 has-session -t shortName 不带 = 会 prefix match 命中 longName
    const r1 = spawnSync('tmux', ['has-session', '-t', shortName], { stdio: 'ignore' })
    assert.equal(r1.status, 0, 'prefix match: has-session -t shortName 应命中 longName (rc=0)')

    // 加 = 前缀精确匹配, shortName 不存在 → 应返回 not found
    const r2 = spawnSync('tmux', ['has-session', '-t', `=${shortName}`], { stdio: 'ignore' })
    assert.notEqual(r2.status, 0, 'exact match: has-session -t =shortName 应不存在 (rc!=0)')
  } finally {
    killSessionIfExists(longName)
  }
})

test('Bug A 防回归: kill-session -t =<不存在的前缀> 不会误杀前缀重合的 session', { skip: !tmuxAvailable() }, () => {
  const longName = `im2cc-test-killbug-foo01-${process.pid}`
  const shortName = `im2cc-test-killbug-foo-${process.pid}`

  try {
    execFileSync('tmux', ['new-session', '-d', '-s', longName, 'sleep', '60'], { stdio: 'ignore' })

    // 试图 kill 不存在的 shortName 应该 no-op, 不影响 longName
    spawnSync('tmux', ['kill-session', '-t', `=${shortName}`], { stdio: 'ignore' })

    // longName 必须仍然存在
    const stillAlive = spawnSync('tmux', ['has-session', '-t', `=${longName}`], { stdio: 'ignore' })
    assert.equal(stillAlive.status, 0, 'longName 不应被误杀')
  } finally {
    killSessionIfExists(longName)
  }
})

test('Bug B 防回归: has-session -t =<不存在的前缀> 返回不存在,即使有前缀重合的 session', { skip: !tmuxAvailable() }, () => {
  const longName = `im2cc-test-hasbug-foo01-${process.pid}`
  const shortName = `im2cc-test-hasbug-foo-${process.pid}`

  try {
    execFileSync('tmux', ['new-session', '-d', '-s', longName, 'sleep', '60'], { stdio: 'ignore' })

    // has-session shortName (精确语法) 应返回 not found
    const r = spawnSync('tmux', ['has-session', '-t', `=${shortName}`], { stdio: 'ignore' })
    assert.notEqual(r.status, 0, 'shortName 不存在时 exact match 应正确返回 not found')
  } finally {
    killSessionIfExists(longName)
  }
})
