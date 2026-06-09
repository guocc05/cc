import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 隔离 ~/.cc：每次测试用独立 HOME
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-store-test-'))
process.env.HOME = tmpHome
fs.mkdirSync(path.join(tmpHome, '.cc', 'data'), { recursive: true })

const store = await import(path.join(rootDir, 'dist', 'src', 'schedule-store.js'))

test('upsertSchedule inserts new schedule', () => {
  const r = store.upsertSchedule({
    name: 'auth',
    transport: 'feishu',
    conversationId: 'oc_xx',
    kind: 'at',
    spec: '14:30',
    message: '继续 OAuth',
    nextFireAt: Date.now() + 3600_000,
  })
  assert.equal(r.replaced, null)
  assert.ok(r.schedule.id)
  assert.equal(r.schedule.name, 'auth')
})

test('upsertSchedule replaces by name (same id reused)', () => {
  const first = store.upsertSchedule({
    name: 'exp',
    transport: 'feishu',
    conversationId: 'oc_xx',
    kind: 'in',
    spec: '2h',
    message: 'first',
    nextFireAt: Date.now() + 7200_000,
  })
  const second = store.upsertSchedule({
    name: 'exp',
    transport: 'feishu',
    conversationId: 'oc_yy',
    kind: 'cron',
    spec: '0 9 * * *',
    message: 'second',
    nextFireAt: Date.now() + 86400_000,
  })
  assert.ok(second.replaced)
  assert.equal(second.replaced.message, 'first')
  assert.equal(second.schedule.id, first.schedule.id, 'id should be reused on replace')
  assert.equal(second.schedule.kind, 'cron')
})

test('listSchedules returns all', () => {
  const all = store.listSchedules()
  const names = all.map(s => s.name).sort()
  assert.deepEqual(names, ['auth', 'exp'])
})

test('removeScheduleByName removes one', () => {
  const removed = store.removeScheduleByName('auth')
  assert.ok(removed)
  assert.equal(removed.name, 'auth')
  assert.equal(store.listSchedules().length, 1)
})

test('removeScheduleByName non-existent returns null', () => {
  const removed = store.removeScheduleByName('nope')
  assert.equal(removed, null)
})

test('updateAfterFire bumps nextFireAt + sets lastFiredAt', () => {
  const before = store.getScheduleByName('exp')
  const newNext = before.nextFireAt + 3600_000
  store.updateAfterFire(before.id, newNext)
  const after = store.getScheduleByName('exp')
  assert.equal(after.nextFireAt, newNext)
  assert.ok(after.lastFiredAt)
})

test('corrupt file falls back to empty', () => {
  // Corrupt the JSON file
  const file = path.join(tmpHome, '.cc', 'data', 'schedules.json')
  fs.writeFileSync(file, 'not json garbage')
  const all = store.listSchedules()
  assert.deepEqual(all, [])
})
