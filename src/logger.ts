/**
 * @input:    日志消息
 * @output:   log(), error(), setTraceId(), getTraceId(), sanitize() — 写入 ~/.cc/logs/daemon.log，支持 trace ID，敏感信息脱敏
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import path from 'node:path'
import { getLogDir } from './config.js'

const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB

/** 当前请求的 trace ID（用于追踪跨请求的问题） */
let currentTraceId: string | null = null

function getLogFile(): string {
  return path.join(getLogDir(), 'daemon.log')
}

function rotateIfNeeded(): void {
  const logFile = getLogFile()
  try {
    const stat = fs.statSync(logFile)
    if (stat.size > MAX_LOG_SIZE) {
      fs.renameSync(logFile, logFile + '.old')
    }
  } catch { /* 文件不存在，无需轮转 */ }
}

/**
 * 脱敏处理：隐藏敏感信息
 */
export function sanitize(msg: string): string {
  // 脱敏飞书 appId/appSecret
  msg = msg.replace(/"appId"\s*:\s*"[^"]+"/g, '"appId":"***"')
  msg = msg.replace(/"appSecret"\s*:\s*"[^"]+"/g, '"appSecret":"***"')
  // 脱敏 token
  msg = msg.replace(/"token"\s*:\s*"[^"]+"/g, '"token":"***"')
  msg = msg.replace(/"botToken"\s*:\s*"[^"]+"/g, '"botToken":"***"')
  // 脱敏 Authorization header
  msg = msg.replace(/Authorization\s*:\s*Bearer\s+\S+/gi, 'Authorization: Bearer ***')
  // 脱敏可能的密码
  msg = msg.replace(/"password"\s*:\s*"[^"]+"/g, '"password":"***"')
  return msg
}

function write(level: string, msg: string): void {
  rotateIfNeeded()
  const timestamp = new Date().toISOString()
  const tracePrefix = currentTraceId ? `[${currentTraceId}] ` : ''
  const sanitizedMsg = sanitize(msg)
  const line = `[${timestamp}] [${level}] ${tracePrefix}${sanitizedMsg}\n`
  fs.appendFileSync(getLogFile(), line)
  if (level === 'ERROR') {
    process.stderr.write(line)
  }
}

/** 设置当前请求的 trace ID */
export function setTraceId(traceId: string | null): void {
  currentTraceId = traceId
}

/** 获取当前 trace ID */
export function getTraceId(): string | null {
  return currentTraceId
}

/** 生成新的 trace ID */
export function generateTraceId(): string {
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function log(msg: string): void { write('INFO', msg) }
export function error(msg: string): void { write('ERROR', msg) }

/** 带上下文的日志记录 */
export function logWithContext(context: Record<string, unknown>, msg: string): void {
  const contextStr = Object.entries(context)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
  log(`[${contextStr}] ${msg}`)
}

/** 带上下文的错误记录 */
export function errorWithContext(context: Record<string, unknown>, msg: string): void {
  const contextStr = Object.entries(context)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
  error(`[${contextStr}] ${msg}`)
}
