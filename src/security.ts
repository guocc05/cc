/**
 * @input:    CcConfig (allowedUserIds)
 * @output:   isUserAllowed(), isValidSessionName(), expandPath(), validatePath() — 用户身份校验、session 名称校验、路径展开与存在性校验
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { CcConfig } from './config.js'

export function isUserAllowed(userId: string, config: CcConfig): boolean {
  // 安全默认：空数组表示拒绝所有人（必须显式配置用户 ID）
  if (config.allowedUserIds.length === 0) {
    console.warn('[security] allowedUserIds 为空，拒绝所有用户访问。请显式配置允许的用户 ID。')
    return false
  }
  return config.allowedUserIds.includes(userId)
}

/** session 名称合法性校验（防注入：只允许字母、数字、连字符、下划线） */
const SAFE_SESSION_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

export function isValidSessionName(name: string): boolean {
  return SAFE_SESSION_NAME.test(name)
}

/** 展开 ~ 并解析为绝对路径 */
export function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1))
  }
  return path.resolve(p)
}

export interface PathValidationResult {
  valid: boolean
  resolvedPath: string
  error?: string
}

/**
 * 验证路径：展开、解析 symlink、确认存在且是目录。
 * 安全增强：可选检查路径是否在允许的工作目录范围内。
 * 访问范围由 AI 工具自身的 permission mode 决定，
 * 而非由路径前缀决定（见 PROJECT.md 安全模型）。
 */
export function validatePath(rawPath: string, allowedBasePaths?: string[]): PathValidationResult {
  const expanded = expandPath(rawPath)

  let resolved: string
  try {
    resolved = fs.realpathSync(expanded)
  } catch {
    return { valid: false, resolvedPath: expanded, error: `路径不存在: ${expanded}` }
  }

  try {
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) {
      return { valid: false, resolvedPath: resolved, error: `不是目录: ${resolved}` }
    }
  } catch {
    return { valid: false, resolvedPath: resolved, error: `无法访问: ${resolved}` }
  }

  // 安全增强：如果提供了白名单，检查路径是否在允许范围内
  if (allowedBasePaths && allowedBasePaths.length > 0) {
    const normalizedResolved = resolved.endsWith(path.sep) ? resolved : resolved + path.sep
    const isAllowed = allowedBasePaths.some(allowed => {
      const normalizedAllowed = allowed.endsWith(path.sep) ? allowed : allowed + path.sep
      return normalizedResolved.startsWith(normalizedAllowed)
    })
    if (!isAllowed) {
      return {
        valid: false,
        resolvedPath: resolved,
        error: `路径不在允许的工作目录范围内: ${resolved}`,
      }
    }
  }

  return { valid: true, resolvedPath: resolved }
}
