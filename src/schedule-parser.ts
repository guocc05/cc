/**
 * @input:    用户在 IM 输入的 /at /in /cron 参数字符串
 * @output:   parseAt(), parseIn(), parseCron(), nextCronFire() — 三种定时表达式 → 绝对时间戳；cron 仅支持 5 段（分 时 日 月 周），不到秒
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

export interface ParseSuccess {
  ok: true
  /** 触发的绝对时间戳（ms epoch） */
  nextFireAt: number
  /** 留给消息体的剩余文本（去掉时间表达式之后的部分） */
  message: string
  /** 规范化后的原始表达式，写入 schedules.json 用于展示与重算 */
  spec: string
}

export interface ParseFailure {
  ok: false
  error: string
}

export type ParseResult = ParseSuccess | ParseFailure

const HHMM_RE = /^(\d{1,2}):(\d{2})$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})$/
const DURATION_PART_RE = /(\d+)([smhd])/g

function tokenize(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean)
}

function makeLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function isValidHHMM(h: number, m: number): boolean {
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h < 24 && m >= 0 && m < 60
}

/**
 * /at HH:MM <消息>             — 今天该时刻；若已过则推到明天
 * /at YYYY-MM-DD HH:MM <消息>  — 绝对时刻；过去则报错
 * /at YYYY-MM-DDTHH:MM <消息>  — ISO 形式同上
 */
export function parseAt(args: string, now: Date = new Date()): ParseResult {
  const tokens = tokenize(args)
  if (tokens.length === 0) {
    return { ok: false, error: '用法: /at HH:MM <消息> 或 /at YYYY-MM-DD HH:MM <消息>' }
  }

  // 形式 1：ISO 紧凑 — `/at 2026-04-17T14:30 ...`
  const isoMatch = tokens[0].match(ISO_RE)
  if (isoMatch) {
    const [, y, mo, d, h, mi] = isoMatch.map(Number) as unknown as number[]
    if (!isValidHHMM(h, mi)) return { ok: false, error: `非法时间: ${tokens[0]}` }
    const target = makeLocal(y, mo, d, h, mi)
    if (Number.isNaN(target.getTime())) return { ok: false, error: `非法日期: ${tokens[0]}` }
    if (target.getTime() <= now.getTime()) return { ok: false, error: '指定时刻已过去' }
    const message = tokens.slice(1).join(' ').trim()
    if (!message) return { ok: false, error: '缺少消息内容' }
    return { ok: true, nextFireAt: target.getTime(), message, spec: tokens[0] }
  }

  // 形式 2：日期 + 时间 — `/at 2026-04-17 14:30 ...`
  const dateMatch = tokens[0].match(DATE_RE)
  if (dateMatch) {
    if (tokens.length < 2) return { ok: false, error: '缺少时间，例: /at 2026-04-17 14:30 <消息>' }
    const timeMatch = tokens[1].match(HHMM_RE)
    if (!timeMatch) return { ok: false, error: `非法时间格式: ${tokens[1]}（需 HH:MM）` }
    const y = Number(dateMatch[1]), mo = Number(dateMatch[2]), d = Number(dateMatch[3])
    const h = Number(timeMatch[1]), mi = Number(timeMatch[2])
    if (!isValidHHMM(h, mi)) return { ok: false, error: `非法时间: ${tokens[1]}` }
    const target = makeLocal(y, mo, d, h, mi)
    if (Number.isNaN(target.getTime()) || target.getMonth() !== mo - 1 || target.getDate() !== d) {
      return { ok: false, error: `非法日期: ${tokens[0]}` }
    }
    if (target.getTime() <= now.getTime()) return { ok: false, error: '指定时刻已过去' }
    const message = tokens.slice(2).join(' ').trim()
    if (!message) return { ok: false, error: '缺少消息内容' }
    return { ok: true, nextFireAt: target.getTime(), message, spec: `${tokens[0]} ${tokens[1]}` }
  }

  // 形式 3：仅时间 — `/at 14:30 ...`，已过则推明天
  const timeMatch = tokens[0].match(HHMM_RE)
  if (timeMatch) {
    const h = Number(timeMatch[1]), mi = Number(timeMatch[2])
    if (!isValidHHMM(h, mi)) return { ok: false, error: `非法时间: ${tokens[0]}` }
    const today = makeLocal(now.getFullYear(), now.getMonth() + 1, now.getDate(), h, mi)
    let target = today
    if (target.getTime() <= now.getTime()) {
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
      target = makeLocal(tomorrow.getFullYear(), tomorrow.getMonth() + 1, tomorrow.getDate(), h, mi)
    }
    const message = tokens.slice(1).join(' ').trim()
    if (!message) return { ok: false, error: '缺少消息内容' }
    return { ok: true, nextFireAt: target.getTime(), message, spec: tokens[0] }
  }

  return { ok: false, error: `无法识别时间表达式: ${tokens[0]}` }
}

/**
 * /in <时长> <消息>
 * 时长支持 s / m / h / d 组合：30s | 5m | 2h | 1d | 1h30m | 90m
 */
export function parseIn(args: string, now: Date = new Date()): ParseResult {
  const tokens = tokenize(args)
  if (tokens.length < 2) return { ok: false, error: '用法: /in <时长> <消息>，例: /in 2h 继续' }

  const spec = tokens[0]
  const ms = parseDurationMs(spec)
  if (ms === null) return { ok: false, error: `非法时长: ${spec}（支持 30s/5m/2h/1d，可组合 1h30m）` }
  if (ms < 1000) return { ok: false, error: '时长太短（至少 1 秒）' }

  const message = tokens.slice(1).join(' ').trim()
  if (!message) return { ok: false, error: '缺少消息内容' }

  return { ok: true, nextFireAt: now.getTime() + ms, message, spec }
}

function parseDurationMs(spec: string): number | null {
  if (!spec) return null
  // 必须是连续的 (\d+)(s|m|h|d) 拼接，不允许其它字符
  const stripped = spec.replace(/(\d+)([smhd])/g, '')
  if (stripped !== '') return null

  let total = 0
  let matched = false
  DURATION_PART_RE.lastIndex = 0
  let part: RegExpExecArray | null
  while ((part = DURATION_PART_RE.exec(spec)) !== null) {
    matched = true
    const n = Number(part[1])
    if (!Number.isFinite(n) || n < 0) return null
    switch (part[2]) {
      case 's': total += n * 1000; break
      case 'm': total += n * 60_000; break
      case 'h': total += n * 3_600_000; break
      case 'd': total += n * 86_400_000; break
      default: return null
    }
  }
  return matched ? total : null
}

/**
 * /cron <分> <时> <日> <月> <周> <消息>
 * 字段语法：* | n | a,b,c | a-b | * /n | a-b/n（不支持 # L W ?）
 * dom 与 dow 同时具体时按 OR 组合（标准 cron 语义）。
 */
export function parseCron(args: string, now: Date = new Date()): ParseResult {
  const tokens = tokenize(args)
  if (tokens.length < 6) {
    return { ok: false, error: '用法: /cron <分> <时> <日> <月> <周> <消息>，例: /cron 0 9 * * * 早晨开工' }
  }
  const expr = tokens.slice(0, 5).join(' ')
  const message = tokens.slice(5).join(' ').trim()
  if (!message) return { ok: false, error: '缺少消息内容' }

  const fields = parseCronFields(expr)
  if (!fields.ok) return { ok: false, error: fields.error }

  const next = nextCronFire(expr, now)
  if (next === null) return { ok: false, error: `cron 表达式永不触发: ${expr}` }

  return { ok: true, nextFireAt: next.getTime(), message, spec: expr }
}

interface CronFields {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domStar: boolean
  dowStar: boolean
}

type CronFieldResult = { ok: true, fields: CronFields } | { ok: false, error: string }

function expandField(token: string, min: number, max: number, fieldName: string): Set<number> | string {
  const result = new Set<number>()
  for (const part of token.split(',')) {
    if (!part) return `${fieldName} 段为空`
    let stepRaw: string | undefined
    let rangeRaw = part
    const slashIdx = part.indexOf('/')
    if (slashIdx !== -1) {
      rangeRaw = part.slice(0, slashIdx)
      stepRaw = part.slice(slashIdx + 1)
    }
    let from: number, to: number
    if (rangeRaw === '*') {
      from = min; to = max
    } else if (rangeRaw.includes('-')) {
      const [a, b] = rangeRaw.split('-')
      from = Number(a); to = Number(b)
    } else {
      from = Number(rangeRaw); to = from
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to || from < min || to > max) {
      return `${fieldName} 段越界: ${part}（合法范围 ${min}-${max}）`
    }
    let step = 1
    if (stepRaw !== undefined) {
      step = Number(stepRaw)
      if (!Number.isInteger(step) || step <= 0) return `${fieldName} 段步长非法: ${part}`
    }
    for (let i = from; i <= to; i += step) result.add(i)
  }
  return result
}

export function parseCronFields(expr: string): CronFieldResult {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { ok: false, error: `cron 必须是 5 段（分 时 日 月 周），收到 ${parts.length} 段` }
  const minute = expandField(parts[0], 0, 59, '分')
  if (typeof minute === 'string') return { ok: false, error: minute }
  const hour = expandField(parts[1], 0, 23, '时')
  if (typeof hour === 'string') return { ok: false, error: hour }
  const dom = expandField(parts[2], 1, 31, '日')
  if (typeof dom === 'string') return { ok: false, error: dom }
  const month = expandField(parts[3], 1, 12, '月')
  if (typeof month === 'string') return { ok: false, error: month }
  // 周 0 和 7 都表示周日
  const dowRaw = expandField(parts[4].replace(/\b7\b/g, '0'), 0, 6, '周')
  if (typeof dowRaw === 'string') return { ok: false, error: dowRaw }
  return {
    ok: true,
    fields: {
      minute, hour, dom, month, dow: dowRaw,
      domStar: parts[2] === '*',
      dowStar: parts[4] === '*',
    },
  }
}

/** 计算下一次匹配 cron 的本地时间，after 之后的最近匹配。无解返回 null。 */
export function nextCronFire(expr: string, after: Date): Date | null {
  const parsed = parseCronFields(expr)
  if (!parsed.ok) return null
  const f = parsed.fields

  // 从 after + 1 分钟开始（精度到分钟）
  const start = new Date(after.getTime() + 60_000 - (after.getSeconds() * 1000 + after.getMilliseconds()))
  start.setSeconds(0, 0)

  // 限制 4 年内寻找，防止永不触发的表达式无限循环
  const maxIter = 4 * 366 * 24 * 60
  const cursor = new Date(start)
  for (let i = 0; i < maxIter; i++) {
    if (!f.month.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    // 标准 cron 语义：dom 和 dow 都不是 * 时，OR；否则 AND
    const domOk = f.dom.has(cursor.getDate())
    const dowOk = f.dow.has(cursor.getDay())
    const dayOk = (f.domStar || f.dowStar) ? (domOk && dowOk) : (domOk || dowOk)
    if (!dayOk) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!f.hour.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!f.minute.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
      continue
    }
    return cursor
  }
  return null
}
