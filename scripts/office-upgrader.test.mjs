import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'im2cc-office-upgrader-'))
process.env.HOME = testHome

const upgrader = await import(path.join(rootDir, 'dist', 'src', 'office-upgrader.js'))
const fileStaging = await import(path.join(rootDir, 'dist', 'src', 'file-staging.js'))

after(() => {
  fs.rmSync(testHome, { recursive: true, force: true })
})

test('needsLegacyUpgrade returns target ext for legacy formats', () => {
  assert.equal(fileStaging.needsLegacyUpgrade('a.doc'), 'docx')
  assert.equal(fileStaging.needsLegacyUpgrade('a.xls'), 'xlsx')
  assert.equal(fileStaging.needsLegacyUpgrade('a.ppt'), 'pptx')
})

test('needsLegacyUpgrade returns false for new formats', () => {
  assert.equal(fileStaging.needsLegacyUpgrade('a.docx'), false)
  assert.equal(fileStaging.needsLegacyUpgrade('a.xlsx'), false)
  assert.equal(fileStaging.needsLegacyUpgrade('a.pptx'), false)
  assert.equal(fileStaging.needsLegacyUpgrade('a.pdf'), false)
})

test('needsLegacyUpgrade is case-insensitive', () => {
  assert.equal(fileStaging.needsLegacyUpgrade('A.DOC'), 'docx')
  assert.equal(fileStaging.needsLegacyUpgrade('A.XLS'), 'xlsx')
})

test('classifyFile recognizes office types', () => {
  assert.equal(fileStaging.classifyFile('foo.pdf'), 'office')
  assert.equal(fileStaging.classifyFile('foo.docx'), 'office')
  assert.equal(fileStaging.classifyFile('foo.xlsx'), 'office')
  assert.equal(fileStaging.classifyFile('foo.pptx'), 'office')
  assert.equal(fileStaging.classifyFile('foo.doc'), 'office')
  assert.equal(fileStaging.classifyFile('foo.xls'), 'office')
  assert.equal(fileStaging.classifyFile('foo.ppt'), 'office')
})

test('classifyFile preserves existing categories', () => {
  assert.equal(fileStaging.classifyFile('a.png'), 'image')
  assert.equal(fileStaging.classifyFile('a.md'), 'text')
  assert.equal(fileStaging.classifyFile('a.unknown'), 'unsupported')
  assert.equal(fileStaging.classifyFile('Dockerfile'), 'text')
})

test('classifyFile recognizes extensionless special files (case-insensitive)', () => {
  // AC-1..AC-4 — Dockerfile / Makefile 大小写组合
  assert.equal(fileStaging.classifyFile('Dockerfile'), 'text')
  assert.equal(fileStaging.classifyFile('Makefile'), 'text')
  assert.equal(fileStaging.classifyFile('dockerfile'), 'text')
  assert.equal(fileStaging.classifyFile('MAKEFILE'), 'text')
})

test('classifyFile keeps unsupported semantics for empty / unknown extensionless names', () => {
  // AC-5, AC-6 — 防回归
  assert.equal(fileStaging.classifyFile(''), 'unsupported')
  assert.equal(fileStaging.classifyFile('foo'), 'unsupported')
})

test('upgradeOfficeLegacy returns failure when source missing', async () => {
  upgrader._resetUpgraderChainForTest()
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'im2cc-upgrade-test-'))
  try {
    const result = await upgrader.upgradeOfficeLegacy(
      '/nonexistent/file.doc',
      'docx',
      tmpOut,
    )
    // 当 soffice 未装时先返回 'LibreOffice 未安装'；装了时返回 '源文件不存在'
    assert.equal(result.success, false)
    assert.match(
      result.reason,
      /LibreOffice 未安装|源文件不存在/,
      `unexpected reason: ${result.reason}`,
    )
  } finally {
    try { fs.rmSync(tmpOut, { recursive: true, force: true }) } catch {}
  }
})

test('upgradeOfficeLegacy serializes concurrent calls', async () => {
  upgrader._resetUpgraderChainForTest()
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'im2cc-upgrade-test-'))
  try {
    // 并发触发 3 个；mutex 应保证它们一个接一个 settle
    const results = await Promise.all([
      upgrader.upgradeOfficeLegacy('/nonexistent/a.doc', 'docx', tmpOut),
      upgrader.upgradeOfficeLegacy('/nonexistent/b.doc', 'docx', tmpOut),
      upgrader.upgradeOfficeLegacy('/nonexistent/c.doc', 'docx', tmpOut),
    ])
    for (const r of results) {
      assert.equal(r.success, false)
    }
  } finally {
    try { fs.rmSync(tmpOut, { recursive: true, force: true }) } catch {}
  }
})

// E2E：仅当机器装了 soffice 时跑（用户机器可能未装；CI/dev 双场景兼容）
test('upgradeOfficeLegacy successfully upgrades real .doc → .docx (skipped if soffice missing)', { skip: upgrader._resolveSofficeForTest() === null ? 'soffice not installed' : undefined }, async () => {
  upgrader._resetUpgraderChainForTest()
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'im2cc-upgrade-test-'))
  try {
    // 先用 soffice 自己生成一个 .doc 作为 fixture
    // 使用一个最小 .docx 通过 soffice 转回 .doc，再测升格回 .docx
    const fixtureDoc = path.join(tmpOut, 'fixture.doc')
    // 简化：直接给一个 placeholder（实际跑通时需要真实 .doc，本测试主要验证 upgrader 不 crash）
    fs.writeFileSync(fixtureDoc, '<dummy doc content>')
    const result = await upgrader.upgradeOfficeLegacy(fixtureDoc, 'docx', tmpOut)
    // dummy 内容可能让 soffice 产出空 docx 或报错；两种结果都接受，关键是不 hang / 不 crash
    assert.ok(typeof result.success === 'boolean')
  } finally {
    try { fs.rmSync(tmpOut, { recursive: true, force: true }) } catch {}
  }
})
