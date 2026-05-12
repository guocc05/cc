/**
 * @input:    tmux server 的 list-sessions 输出 + registry + listActiveBindings + listInflightTasksForSession
 * @output:   ~/.im2cc/logs/tmux-watch.log — 每 10 秒 diff 出消失的 tmux session,记录上下文证据
 * @rule:     如本文件 @input 或 @output 发生变化,必须更新本注释并检查 _INDEX.md
 *
 * 诊断仪表 B (@20260512-fc-tmux-client-preempt v1.1):纯旁观,无副作用。
 * 配合 bin/im2cc.ts:fcTraceLog 互补 — fc-trace 拿调用现场,tmux-watch 拿 idle 销毁现场。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { getLogDir } from './config.js'
import { listRegistered } from './registry.js'
import { listActiveBindings } from './session.js'
import { listInflightTasksForSession } from './queue.js'

const POLL_INTERVAL_MS = 10_000

let timer: NodeJS.Timeout | null = null
let lastKnown: Set<string> = new Set()

function listTmuxSessionNames(): Set<string> {
  try {
    const out = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return new Set(out.split('\n').map(s => s.trim()).filter(Boolean))
  } catch {
    // tmux server 不在跑也是有效信号
    return new Set()
  }
}

function appendLog(line: string): void {
  try {
    const logPath = path.join(getLogDir(), 'tmux-watch.log')
    fs.appendFileSync(logPath, `${line}\n`)
  } catch {
    // 仪表自身不应影响主流程
  }
}

function recordVanished(name: string): void {
  const ts = new Date().toISOString()
  // 仅观察 im2cc-* 前缀,其他 session 是用户私事不记录
  if (!name.startsWith('im2cc-')) {
    appendLog(`[${ts}] vanished session=${JSON.stringify(name)} kind=non-im2cc (ignored detail)`)
    return
  }

  // im2cc-<tool>-<sessionName> 或 im2cc-<sessionName>(旧格式)
  // 试解析出 sessionName,从 registry/bindings/inflight 找上下文
  let sessionName: string | null = null
  const newFormat = /^im2cc-(claude|codex|gemini)-(.+)$/.exec(name)
  if (newFormat) {
    sessionName = newFormat[2]
  } else {
    const old = /^im2cc-(.+)$/.exec(name)
    sessionName = old?.[1] ?? null
  }

  const fields: Record<string, unknown> = {
    session: name,
    parsedName: sessionName,
  }

  if (sessionName) {
    const registered = listRegistered().find(r => r.name === sessionName)
    if (registered) {
      fields.sessionId = registered.sessionId
      fields.cwd = registered.cwd
      fields.tool = registered.tool
      fields.lastUsedAt = registered.lastUsedAt
      const inflightCount = listInflightTasksForSession(registered.sessionId).length
      fields.inflightAtVanish = inflightCount
    } else {
      fields.registry = 'miss'
    }
  }

  const bindings = listActiveBindings()
  fields.activeBindingsCount = bindings.length
  const boundToThis = sessionName ? bindings.find(b => {
    const reg = listRegistered().find(r => r.sessionId === b.sessionId)
    return reg?.name === sessionName
  }) : null
  if (boundToThis) {
    fields.boundTransport = boundToThis.transport ?? null
    fields.boundConversation = boundToThis.conversationId
  }

  const flat = Object.entries(fields)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ')
  appendLog(`[${ts}] vanished ${flat}`)
}

function tick(): void {
  const now = listTmuxSessionNames()

  if (lastKnown.size === 0 && now.size > 0) {
    // 首次 tick,仅记录基线,不报 added/removed
    const ts = new Date().toISOString()
    const im2ccSessions = [...now].filter(s => s.startsWith('im2cc-'))
    appendLog(`[${ts}] baseline im2cc_sessions=${JSON.stringify(im2ccSessions)} total=${now.size}`)
    lastKnown = now
    return
  }

  const removed = [...lastKnown].filter(s => !now.has(s))
  const added = [...now].filter(s => !lastKnown.has(s))

  for (const name of removed) {
    recordVanished(name)
  }

  // added 只对 im2cc-* 简单记录,作为时间轴参考
  for (const name of added) {
    if (name.startsWith('im2cc-')) {
      const ts = new Date().toISOString()
      appendLog(`[${ts}] appeared session=${JSON.stringify(name)}`)
    }
  }

  lastKnown = now
}

export function startTmuxWatcher(): void {
  if (timer) return
  // 第一次 tick 立刻跑一次,建立基线
  tick()
  timer = setInterval(tick, POLL_INTERVAL_MS)
}

export function stopTmuxWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
