/**
 * @input:    conversationId、ModelOption 列表
 * @output:   setPendingModelSelection(), consumePendingModelSelection(), clearPendingModelSelection() — per-binding 60s TTL pending state for /model 列表交互
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import type { ModelOption } from './model-catalog.js'

interface PendingEntry {
  options: ModelOption[]
  expiresAt: number  // epoch ms
}

const PENDING_TTL_MS = 60 * 1000

// per-conversationId in-memory map；daemon 重启清空（V1 不做持久化）
const pending = new Map<string, PendingEntry>()

/**
 * 注册 conversationId 的 pending 状态。60s 后自动失效。
 * 若已有 pending，覆盖（用户重新发 /model 显示新列表 = 重新计时）。
 */
export function setPendingModelSelection(conversationId: string, options: ModelOption[]): void {
  pending.set(conversationId, {
    options,
    expiresAt: Date.now() + PENDING_TTL_MS,
  })
}

/**
 * 尝试用 input 命中 pending 状态。
 *   - input 必须是纯 1-9 数字字符串
 *   - pending 必须存在且未过期
 *   - 数字必须在 [1, options.length] 范围
 *
 * 命中：返回对应 ModelOption + 自动清除 pending
 * 未命中（任何原因）：返回 null + 自动清除 pending（"任意非数字消息也清除"语义）
 *
 * @param input 用户消息文本（已 trim）
 * @returns 命中的 ModelOption 或 null
 */
export function consumePendingModelSelection(conversationId: string, input: string): ModelOption | null {
  const entry = pending.get(conversationId)
  if (!entry) return null

  // 任何对 consumePending 的调用都意味着用户发了新消息，pending 必须清除
  pending.delete(conversationId)

  if (Date.now() > entry.expiresAt) return null

  const trimmed = input.trim()
  if (!/^[1-9]$/.test(trimmed)) return null

  const idx = Number.parseInt(trimmed, 10) - 1
  if (idx < 0 || idx >= entry.options.length) return null

  return entry.options[idx]
}

/** 显式清除（命令路径触发；不返回命中信息） */
export function clearPendingModelSelection(conversationId: string): void {
  pending.delete(conversationId)
}

/** 仅供测试 / debug：查询是否有 pending（不影响状态） */
export function hasPendingModelSelection(conversationId: string): boolean {
  const entry = pending.get(conversationId)
  if (!entry) return false
  if (Date.now() > entry.expiresAt) {
    pending.delete(conversationId)
    return false
  }
  return true
}
