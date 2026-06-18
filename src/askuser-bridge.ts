/**
 * @input:    Claude PreToolUse hook 进程（hooks/askuser-hook.mjs），daemon 主流程（answer / cancel 注入）
 * @output:   startAskUserBridge(), stopAskUserBridge(), onAsk(), submitAnswer(), cancelBySessionId(), getPendingByCardId() — daemon 侧 unix socket IPC 中转，桥接 AI AskUserQuestion 调用与 IM 端用户回复
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import net from 'node:net'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { getAskUserSocketPath, getAskUserTimeoutMinutes } from './config.js'
import { log, error } from './logger.js'

/** 一条挂起的 AskUserQuestion 提问（hook 已发 ask，等待 daemon 注入 answer） */
export interface PendingAsk {
  toolUseId: string
  cardId: string
  sessionId: string
  conversationId: string
  question: string
  options: Array<{ label: string; header?: string }>
  multiSelect: boolean
  createdAt: number
  timeoutAt: number
}

/** Hook → daemon 协议（NDJSON over unix socket） */
type HookToDaemonMsg =
  | {
      type: 'ask'
      toolUseId: string
      sessionId: string
      conversationId: string
      question: string
      options: Array<{ label: string; header?: string }>
      multiSelect: boolean
    }
  | { type: 'heartbeat'; toolUseId: string }

/** Daemon → hook 协议（NDJSON over unix socket） */
type DaemonToHookMsg =
  | { type: 'answer'; toolUseId: string; answer: string }
  | { type: 'timeout'; toolUseId: string; reason: string }
  | { type: 'cancelled'; toolUseId: string; reason: string }

interface PendingState extends PendingAsk {
  hookSocket: net.Socket
  timer: NodeJS.Timeout
  resolved: boolean
}

const emitter = new EventEmitter()
const pendingByToolUseId = new Map<string, PendingState>()
const pendingByCardId = new Map<string, string>() // cardId → toolUseId

let server: net.Server | null = null

/** 启动 unix socket server（daemon 启动时调一次） */
export async function startAskUserBridge(): Promise<void> {
  if (server) return
  const socketPath = getAskUserSocketPath()

  // 清理上一次残留 socket（daemon 单实例已保证不会有活的对端在用）
  if (fs.existsSync(socketPath)) {
    try { fs.unlinkSync(socketPath) } catch (err) { log(`[askuser-bridge] 清理残留 socket 失败 (忽略): ${err instanceof Error ? err.message : String(err)}`) }
  }

  server = net.createServer((socket) => handleHookConnection(socket))
  server.on('error', (err) => error(`[askuser-bridge] socket server 错误: ${err.message}`))

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(socketPath, () => {
      server!.off('error', reject)
      try { fs.chmodSync(socketPath, 0o600) } catch (err) { log(`[askuser-bridge] chmod socket 失败 (忽略): ${err instanceof Error ? err.message : String(err)}`) }
      log(`[askuser-bridge] listening on ${socketPath}`)
      resolve()
    })
  })
}

/** 停止 server，取消所有 pending（daemon 退出时调用） */
export function stopAskUserBridge(): void {
  for (const state of pendingByToolUseId.values()) {
    sendToHook(state.hookSocket, { type: 'cancelled', toolUseId: state.toolUseId, reason: 'daemon shutting down' })
    clearTimeout(state.timer)
    try { state.hookSocket.end() } catch (err) { log(`[askuser-bridge] 关闭 hook socket 失败 (忽略): ${err instanceof Error ? err.message : String(err)}`) }
  }
  pendingByToolUseId.clear()
  pendingByCardId.clear()
  if (server) {
    try { server.close() } catch (err) { log(`[askuser-bridge] 关闭 server 失败 (忽略): ${err instanceof Error ? err.message : String(err)}`) }
    server = null
  }
  const sockPath = getAskUserSocketPath()
  if (fs.existsSync(sockPath)) {
    try { fs.unlinkSync(sockPath) } catch (err) { log(`[askuser-bridge] 删除 socket 文件 失败 (忽略): ${err instanceof Error ? err.message : String(err)}`) }
  }
}

function handleHookConnection(socket: net.Socket): void {
  let buffer = ''
  let registeredToolUseId: string | null = null

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf-8')
    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      let msg: HookToDaemonMsg
      try { msg = JSON.parse(line) as HookToDaemonMsg } catch { continue }
      if (msg.type === 'ask') {
        registeredToolUseId = msg.toolUseId
        registerPending(msg, socket)
      }
      // heartbeat 暂未使用，保留扩展位
    }
  })

  socket.on('close', () => {
    // hook 进程断开（被 kill / 自然结束）。如果对应 pending 还在，标记取消。
    if (registeredToolUseId) {
      const state = pendingByToolUseId.get(registeredToolUseId)
      if (state && !state.resolved) {
        log(`[askuser-bridge] hook 断开但 pending 未解决，清理 ${registeredToolUseId}`)
        finalize(state, 'cancelled', 'hook disconnected')
      }
    }
  })

  socket.on('error', (err) => {
    log(`[askuser-bridge] hook socket 错误: ${err.message}`)
  })
}

function registerPending(
  msg: Extract<HookToDaemonMsg, { type: 'ask' }>,
  hookSocket: net.Socket,
): void {
  const cardId = crypto.randomUUID()
  const timeoutMs = getAskUserTimeoutMinutes() * 60 * 1000
  const now = Date.now()

  const state: PendingState = {
    toolUseId: msg.toolUseId,
    cardId,
    sessionId: msg.sessionId,
    conversationId: msg.conversationId,
    question: msg.question,
    options: msg.options,
    multiSelect: msg.multiSelect,
    createdAt: now,
    timeoutAt: now + timeoutMs,
    hookSocket,
    resolved: false,
    timer: setTimeout(() => onTimeout(msg.toolUseId), timeoutMs),
  }

  // 同 toolUseId 重入：旧的视为 cancelled
  const existing = pendingByToolUseId.get(msg.toolUseId)
  if (existing) finalize(existing, 'cancelled', 'duplicate ask')

  pendingByToolUseId.set(msg.toolUseId, state)
  pendingByCardId.set(cardId, msg.toolUseId)

  log(`[askuser-bridge] ask received: tool_use_id=${msg.toolUseId} session=${msg.sessionId} options=${msg.options.length} timeout=${timeoutMs}ms`)
  emitter.emit('ask', toPendingAsk(state))
}

function toPendingAsk(state: PendingState): PendingAsk {
  return {
    toolUseId: state.toolUseId,
    cardId: state.cardId,
    sessionId: state.sessionId,
    conversationId: state.conversationId,
    question: state.question,
    options: state.options,
    multiSelect: state.multiSelect,
    createdAt: state.createdAt,
    timeoutAt: state.timeoutAt,
  }
}

function onTimeout(toolUseId: string): void {
  const state = pendingByToolUseId.get(toolUseId)
  if (!state || state.resolved) return
  log(`[askuser-bridge] timeout: tool_use_id=${toolUseId}`)
  finalize(state, 'timeout', '[已超时] 用户未回复，请基于现有信息做合理假设并标注')
}

function finalize(state: PendingState, kind: 'answer' | 'timeout' | 'cancelled', payload: string): void {
  if (state.resolved) return
  state.resolved = true
  clearTimeout(state.timer)
  pendingByToolUseId.delete(state.toolUseId)
  pendingByCardId.delete(state.cardId)

  if (kind === 'answer') {
    sendToHook(state.hookSocket, { type: 'answer', toolUseId: state.toolUseId, answer: payload })
    emitter.emit('answered', { ...toPendingAsk(state), answer: payload })
  } else if (kind === 'timeout') {
    sendToHook(state.hookSocket, { type: 'timeout', toolUseId: state.toolUseId, reason: payload })
    emitter.emit('timeout', { ...toPendingAsk(state), reason: payload })
  } else {
    sendToHook(state.hookSocket, { type: 'cancelled', toolUseId: state.toolUseId, reason: payload })
    emitter.emit('cancelled', { ...toPendingAsk(state), reason: payload })
  }
}

function sendToHook(socket: net.Socket, msg: DaemonToHookMsg): void {
  try {
    if (!socket.destroyed) {
      socket.write(JSON.stringify(msg) + '\n')
    }
  } catch (err) {
    log(`[askuser-bridge] write to hook 失败: ${(err as Error).message}`)
  }
}

// --- 对外 API ---

export interface AnsweredEvent extends PendingAsk { answer: string }
export interface TimeoutEvent extends PendingAsk { reason: string }
export interface CancelledEvent extends PendingAsk { reason: string }

/** 订阅 ask 事件：当 hook 拦截到 AskUserQuestion 时触发，daemon 应渲染卡片发到 IM */
export function onAsk(handler: (ask: PendingAsk) => void): () => void {
  emitter.on('ask', handler)
  return () => emitter.off('ask', handler)
}

/** 订阅 answered 事件（用于卡片更新为"已收到"态、日志） */
export function onAnswered(handler: (ev: AnsweredEvent) => void): () => void {
  emitter.on('answered', handler)
  return () => emitter.off('answered', handler)
}

/** 订阅 timeout 事件（用于推 ⏰ 回执） */
export function onTimeoutEvent(handler: (ev: TimeoutEvent) => void): () => void {
  emitter.on('timeout', handler)
  return () => emitter.off('timeout', handler)
}

/** 订阅 cancelled 事件（/stop / daemon 重启） */
export function onCancelled(handler: (ev: CancelledEvent) => void): () => void {
  emitter.on('cancelled', handler)
  return () => emitter.off('cancelled', handler)
}

/** 用户在 IM 上回答了：根据 cardId 注入答案并解除挂起 */
export function submitAnswerByCardId(cardId: string, answer: string): boolean {
  const toolUseId = pendingByCardId.get(cardId)
  if (!toolUseId) return false
  return submitAnswerByToolUseId(toolUseId, answer)
}

export function submitAnswerByToolUseId(toolUseId: string, answer: string): boolean {
  const state = pendingByToolUseId.get(toolUseId)
  if (!state || state.resolved) return false
  finalize(state, 'answer', answer)
  return true
}

/** 通过 cardId 查 pending（用于 IM 端反查问题原文 / 选项 label） */
export function getPendingByCardId(cardId: string): PendingAsk | null {
  const toolUseId = pendingByCardId.get(cardId)
  if (!toolUseId) return null
  const state = pendingByToolUseId.get(toolUseId)
  return state ? toPendingAsk(state) : null
}

/** 取消某 session 下所有 pending（/stop / 切换 transport / daemon 关闭时） */
export function cancelBySessionId(sessionId: string, reason = 'session interrupted'): number {
  let count = 0
  for (const state of [...pendingByToolUseId.values()]) {
    if (state.sessionId !== sessionId) continue
    finalize(state, 'cancelled', reason)
    count += 1
  }
  return count
}

/** 当前所有 pending 的快照（用于诊断 / status 面板） */
export function listPending(): PendingAsk[] {
  return [...pendingByToolUseId.values()].map(toPendingAsk)
}
