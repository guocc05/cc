import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sp = await import(path.join(rootDir, 'dist', 'src', 'schedule-parser.js'))

// ── /at ────────────────────────────────────────────────────────────────

test('parseAt: HH:MM in the future today', () => {
  const now = new Date(2026, 3, 17, 9, 0)  // 2026-04-17 09:00 local
  const r = sp.parseAt('14:30 继续做 xx', now)
  assert.equal(r.ok, true)
  const target = new Date(r.nextFireAt)
  assert.equal(target.getFullYear(), 2026)
  assert.equal(target.getMonth(), 3)
  assert.equal(target.getDate(), 17)
  assert.equal(target.getHours(), 14)
  assert.equal(target.getMinutes(), 30)
  assert.equal(r.message, '继续做 xx')
  assert.equal(r.spec, '14:30')
})

test('parseAt: HH:MM already past → tomorrow', () => {
  const now = new Date(2026, 3, 17, 15, 0)  // 2026-04-17 15:00
  const r = sp.parseAt('09:00 早会', now)
  assert.equal(r.ok, true)
  const target = new Date(r.nextFireAt)
  assert.equal(target.getDate(), 18)
  assert.equal(target.getHours(), 9)
})

test('parseAt: YYYY-MM-DD HH:MM future', () => {
  const now = new Date(2026, 3, 17, 9, 0)
  const r = sp.parseAt('2026-04-20 08:00 继续', now)
  assert.equal(r.ok, true)
  const target = new Date(r.nextFireAt)
  assert.equal(target.getDate(), 20)
  assert.equal(target.getHours(), 8)
  assert.equal(r.spec, '2026-04-20 08:00')
})

test('parseAt: YYYY-MM-DD HH:MM in the past → error', () => {
  const now = new Date(2026, 3, 17, 9, 0)
  const r = sp.parseAt('2026-04-10 08:00 继续', now)
  assert.equal(r.ok, false)
  assert.match(r.error, /已过去/)
})

test('parseAt: missing message', () => {
  const r = sp.parseAt('14:30', new Date(2026, 3, 17, 9, 0))
  assert.equal(r.ok, false)
  assert.match(r.error, /缺少消息/)
})

test('parseAt: invalid hour', () => {
  const r = sp.parseAt('25:00 hi', new Date(2026, 3, 17, 9, 0))
  assert.equal(r.ok, false)
})

// ── /in ────────────────────────────────────────────────────────────────

test('parseIn: simple 30s', () => {
  const now = new Date(2026, 3, 17, 9, 0, 0)
  const r = sp.parseIn('30s 继续', now)
  assert.equal(r.ok, true)
  assert.equal(r.nextFireAt, now.getTime() + 30_000)
  assert.equal(r.spec, '30s')
})

test('parseIn: 2h', () => {
  const now = new Date(2026, 3, 17, 9, 0, 0)
  const r = sp.parseIn('2h 继续', now)
  assert.equal(r.ok, true)
  assert.equal(r.nextFireAt, now.getTime() + 2 * 3600_000)
})

test('parseIn: combined 1h30m', () => {
  const now = new Date(2026, 3, 17, 9, 0, 0)
  const r = sp.parseIn('1h30m 继续', now)
  assert.equal(r.ok, true)
  assert.equal(r.nextFireAt, now.getTime() + (3600 + 1800) * 1000)
})

test('parseIn: invalid suffix', () => {
  const r = sp.parseIn('30y hi', new Date())
  assert.equal(r.ok, false)
})

test('parseIn: missing message', () => {
  const r = sp.parseIn('30m', new Date())
  assert.equal(r.ok, false)
})

// ── /cron ──────────────────────────────────────────────────────────────

test('parseCron: 5 fields parse', () => {
  const r = sp.parseCron('0 9 * * * 早晨开工', new Date(2026, 3, 17, 8, 30))
  assert.equal(r.ok, true)
  assert.equal(r.spec, '0 9 * * *')
  assert.equal(r.message, '早晨开工')
  const next = new Date(r.nextFireAt)
  assert.equal(next.getDate(), 17)
  assert.equal(next.getHours(), 9)
  assert.equal(next.getMinutes(), 0)
})

test('parseCron: 0 9 * * * past today → tomorrow', () => {
  const r = sp.parseCron('0 9 * * * 早晨', new Date(2026, 3, 17, 10, 0))
  assert.equal(r.ok, true)
  const next = new Date(r.nextFireAt)
  assert.equal(next.getDate(), 18)
  assert.equal(next.getHours(), 9)
})

test('parseCron: */15 * * * * fires every 15 min', () => {
  const now = new Date(2026, 3, 17, 9, 7, 0)
  const r = sp.parseCron('*/15 * * * * tick', now)
  assert.equal(r.ok, true)
  const next = new Date(r.nextFireAt)
  assert.equal(next.getMinutes(), 15)
})

test('parseCron: range 1-5 in dow (Mon-Fri)', () => {
  // 2026-04-17 is Friday (dow=5). Next Mon-Fri 0 9 * * 1-5 from Friday 10:00 → Monday 04-20 09:00
  const r = sp.parseCron('0 9 * * 1-5 工作日', new Date(2026, 3, 17, 10, 0))
  assert.equal(r.ok, true)
  const next = new Date(r.nextFireAt)
  assert.equal(next.getDate(), 20)
  assert.equal(next.getDay(), 1)
})

test('parseCron: less than 6 tokens fails', () => {
  const r = sp.parseCron('0 9 * * *', new Date())
  assert.equal(r.ok, false)
})

test('parseCron: bad field rejected', () => {
  const r = sp.parseCron('99 9 * * * hi', new Date())
  assert.equal(r.ok, false)
  assert.match(r.error, /越界/)
})

test('parseCron: dow 7 normalized to 0 (Sunday)', () => {
  // 2026-04-17 Friday, next Sunday at 09:00 = 2026-04-19 09:00
  const r = sp.parseCron('0 9 * * 7 周日', new Date(2026, 3, 17, 10, 0))
  assert.equal(r.ok, true)
  const next = new Date(r.nextFireAt)
  assert.equal(next.getDate(), 19)
  assert.equal(next.getDay(), 0)
})

// ── nextCronFire 单独覆盖 ─────────────────────────────────────────────

test('nextCronFire: monthly 0 0 1 * *', () => {
  const now = new Date(2026, 3, 17, 10, 0)  // 2026-04-17
  const next = sp.nextCronFire('0 0 1 * *', now)
  assert.equal(next.getFullYear(), 2026)
  assert.equal(next.getMonth(), 4)  // May
  assert.equal(next.getDate(), 1)
  assert.equal(next.getHours(), 0)
  assert.equal(next.getMinutes(), 0)
})

test('nextCronFire: leap-year-safe Feb', () => {
  // 0 0 29 2 * 仅闰年触发；2028 是闰年
  const now = new Date(2026, 3, 17)
  const next = sp.nextCronFire('0 0 29 2 *', now)
  assert.equal(next.getFullYear(), 2028)
  assert.equal(next.getMonth(), 1)
  assert.equal(next.getDate(), 29)
})
