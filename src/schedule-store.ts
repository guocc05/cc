/**
 * @input:    ~/.cc/data/schedules.json, Schedule 数据结构
 * @output:   listSchedules(), getScheduleByName(), upsertSchedule(), removeScheduleByName(), updateNextFireAt() — 定时消息持久化（每 session 限一条，name 主键）
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getDataDir } from './config.js'
import type { TransportType } from './transport.js'

export type ScheduleKind = 'at' | 'in' | 'cron'

export interface Schedule {
  id: string
  /** 注册表 session name —— 同一 name 仅允许一条 */
  name: string
  /** 创建时所在 IM 通道 */
  transport: TransportType
  /** 创建时的 IM 会话 id，用于发回执 */
  conversationId: string
  kind: ScheduleKind
  /** 规范化的原始表达式（at 的 HH:MM、in 的 1h30m、cron 的 5 段） */
  spec: string
  /** 触发时投递给 AI 的消息文本 */
  message: string
  /** 触发的绝对时间戳（ms epoch） */
  nextFireAt: number
  createdAt: string
  lastFiredAt?: string
}

interface ScheduleFile {
  schedules: Schedule[]
}

function scheduleFile(): string {
  return path.join(getDataDir(), 'schedules.json')
}

function readFile(): ScheduleFile {
  const f = scheduleFile()
  if (!fs.existsSync(f)) return { schedules: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf-8')) as Partial<ScheduleFile>
    if (!raw || !Array.isArray(raw.schedules)) return { schedules: [] }
    return { schedules: raw.schedules.filter(isValidSchedule) }
  } catch {
    return { schedules: [] }
  }
}

function writeFile(data: ScheduleFile): void {
  const f = scheduleFile()
  const tmp = f + '.tmp.' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, f)
}

function isValidSchedule(s: unknown): s is Schedule {
  if (!s || typeof s !== 'object') return false
  const r = s as Record<string, unknown>
  return typeof r.id === 'string'
    && typeof r.name === 'string'
    && typeof r.transport === 'string'
    && typeof r.conversationId === 'string'
    && (r.kind === 'at' || r.kind === 'in' || r.kind === 'cron')
    && typeof r.spec === 'string'
    && typeof r.message === 'string'
    && typeof r.nextFireAt === 'number'
    && typeof r.createdAt === 'string'
}

export function listSchedules(): Schedule[] {
  return readFile().schedules
}

export function getScheduleByName(name: string): Schedule | null {
  return readFile().schedules.find(s => s.name === name) ?? null
}

export function getScheduleById(id: string): Schedule | null {
  return readFile().schedules.find(s => s.id === id) ?? null
}

export interface UpsertInput {
  name: string
  transport: TransportType
  conversationId: string
  kind: ScheduleKind
  spec: string
  message: string
  nextFireAt: number
}

/** 按 name 唯一约束 upsert：返回 { schedule, replaced } */
export function upsertSchedule(input: UpsertInput): { schedule: Schedule; replaced: Schedule | null } {
  const data = readFile()
  const idx = data.schedules.findIndex(s => s.name === input.name)
  const replaced = idx === -1 ? null : data.schedules[idx]

  const schedule: Schedule = {
    id: replaced?.id ?? crypto.randomUUID(),
    name: input.name,
    transport: input.transport,
    conversationId: input.conversationId,
    kind: input.kind,
    spec: input.spec,
    message: input.message,
    nextFireAt: input.nextFireAt,
    createdAt: replaced?.createdAt ?? new Date().toISOString(),
  }

  if (idx === -1) data.schedules.push(schedule)
  else data.schedules[idx] = schedule

  writeFile(data)
  return { schedule, replaced }
}

export function removeScheduleByName(name: string): Schedule | null {
  const data = readFile()
  const idx = data.schedules.findIndex(s => s.name === name)
  if (idx === -1) return null
  const [removed] = data.schedules.splice(idx, 1)
  writeFile(data)
  return removed
}

export function removeScheduleById(id: string): Schedule | null {
  const data = readFile()
  const idx = data.schedules.findIndex(s => s.id === id)
  if (idx === -1) return null
  const [removed] = data.schedules.splice(idx, 1)
  writeFile(data)
  return removed
}

/** cron 触发后更新下一次时间（同时记录 lastFiredAt） */
export function updateAfterFire(id: string, nextFireAt: number): void {
  const data = readFile()
  const idx = data.schedules.findIndex(s => s.id === id)
  if (idx === -1) return
  data.schedules[idx] = {
    ...data.schedules[idx],
    nextFireAt,
    lastFiredAt: new Date().toISOString(),
  }
  writeFile(data)
}
