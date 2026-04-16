import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'im2cc-project-index-'))
process.env.HOME = testHome

const registry = await import(path.join(rootDir, 'dist', 'src', 'registry.js'))
const projectIndex = await import(path.join(rootDir, 'dist', 'src', 'project-index.js'))

function resetState() {
  fs.rmSync(path.join(testHome, '.im2cc'), { recursive: true, force: true })
}

test('listProjectIndex derives unique project list from registry cwds', () => {
  resetState()

  // 多个 session 共享同一 cwd → 项目只应出现一次
  registry.register('auth', 'auth-session', '/Users/dev/Code/im2cc', 'claude')
  registry.register('bug', 'bug-session', '/Users/dev/Code/im2cc', 'claude')
  registry.register('exp', 'exp-session', '/Users/dev/Code/portal', 'codex')

  const entries = projectIndex.listProjectIndex()
  assert.equal(entries.length, 2, 'same cwd should be deduped')
  const labels = entries.map(e => e.label).sort()
  assert.deepEqual(labels, ['im2cc', 'portal'])
})

test('listProjectIndex disambiguates same-basename cwds with parent path', () => {
  resetState()

  // 两个不同的父目录下都有 "01-im2cc" → label 应降级为带父目录
  registry.register('a', 'a-session', '/Users/dev/Code/16-remote/01-im2cc', 'claude')
  registry.register('b', 'b-session', '/Users/dev/Code/17-other/01-im2cc', 'claude')

  const entries = projectIndex.listProjectIndex()
  assert.equal(entries.length, 2)
  const labels = entries.map(e => e.label).sort()
  assert.deepEqual(labels, ['16-remote/01-im2cc', '17-other/01-im2cc'])
})

test('listProjectIndex sorts by lastUsedAt desc (most recent first)', async () => {
  resetState()

  registry.register('old', 'old-session', '/Users/dev/Code/old', 'claude')
  // 确保 lastUsedAt 不同
  await new Promise(r => setTimeout(r, 10))
  registry.register('new', 'new-session', '/Users/dev/Code/new', 'claude')

  const entries = projectIndex.listProjectIndex()
  assert.equal(entries[0].label, 'new')
  assert.equal(entries[1].label, 'old')
})

test('resolveProjectHint matches unique short name (exact basename)', () => {
  resetState()
  registry.register('a', 'a-session', '/Users/dev/Code/im2cc', 'claude')
  registry.register('b', 'b-session', '/Users/dev/Code/portal', 'claude')

  const ok = projectIndex.resolveProjectHint('im2cc')
  assert.equal(ok.kind, 'ok')
  assert.equal(ok.cwd, '/Users/dev/Code/im2cc')
})

test('resolveProjectHint is case-insensitive', () => {
  resetState()
  registry.register('a', 'a-session', '/Users/dev/Code/im2cc', 'claude')

  const ok = projectIndex.resolveProjectHint('IM2CC')
  assert.equal(ok.kind, 'ok')
  assert.equal(ok.cwd, '/Users/dev/Code/im2cc')
})

test('resolveProjectHint matches unique prefix', () => {
  resetState()
  registry.register('a', 'a-session', '/Users/dev/Code/im2cc-core', 'claude')
  registry.register('b', 'b-session', '/Users/dev/Code/portal', 'claude')

  const ok = projectIndex.resolveProjectHint('im2')
  assert.equal(ok.kind, 'ok')
  assert.equal(ok.cwd, '/Users/dev/Code/im2cc-core')
})

test('resolveProjectHint returns ambiguous when basename matches multiple cwds', () => {
  resetState()
  registry.register('a', 'a-session', '/Users/dev/Code/16-remote/im2cc', 'claude')
  registry.register('b', 'b-session', '/Users/dev/Code/17-other/im2cc', 'claude')

  const outcome = projectIndex.resolveProjectHint('im2cc')
  assert.equal(outcome.kind, 'ambiguous')
  assert.equal(outcome.matches?.length, 2)
})

test('resolveProjectHint passes absolute and ~-paths through as-is (full-path escape hatch)', () => {
  resetState()

  const abs = projectIndex.resolveProjectHint('/Users/dev/Downloads/new-repo')
  assert.equal(abs.kind, 'ok')
  assert.equal(abs.cwd, '/Users/dev/Downloads/new-repo')

  const tilde = projectIndex.resolveProjectHint('~/Downloads/new-repo')
  assert.equal(tilde.kind, 'ok')
  assert.equal(tilde.cwd, '~/Downloads/new-repo')
})

test('resolveProjectHint returns not_found when registry is empty or name is unknown', () => {
  resetState()

  const empty = projectIndex.resolveProjectHint('anything')
  assert.equal(empty.kind, 'not_found')

  registry.register('a', 'a-session', '/Users/dev/Code/im2cc', 'claude')
  const miss = projectIndex.resolveProjectHint('unknown-project')
  assert.equal(miss.kind, 'not_found')
})

test('suggestProjectLabels returns fuzzy matches from registry', () => {
  resetState()
  registry.register('a', 'a-session', '/Users/dev/Code/im2cc', 'claude')
  registry.register('b', 'b-session', '/Users/dev/Code/aicam', 'claude')

  const suggestions = projectIndex.suggestProjectLabels('im2ccx')
  assert.ok(suggestions.includes('im2cc'))
})

test('prettyPath folds $HOME back to ~', () => {
  const home = os.homedir()
  assert.equal(projectIndex.prettyPath(home), '~')
  assert.equal(projectIndex.prettyPath(path.join(home, 'Code', 'foo')), '~/Code/foo')
  assert.equal(projectIndex.prettyPath('/tmp/elsewhere'), '/tmp/elsewhere')
})
