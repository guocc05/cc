/**
 * @input:    registry.json 中的已注册对话
 * @output:   listProjectIndex(), resolveProjectHint() — 从 registry 派生项目索引，用于 IM 端 /ls 与 /fn 短名称解析
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import path from 'node:path'
import os from 'node:os'
import { listRegistered } from './registry.js'

export interface ProjectIndexEntry {
  /** 展示名 — 通常是 basename，basename 重名时带上父目录做区分 */
  label: string
  /** 真实绝对路径 */
  cwd: string
  /** 最近一次使用时间（取该 cwd 下所有 session 的最大 lastUsedAt） */
  lastUsedAt: string
}

/** 将绝对路径折回 ~ 形式展示 */
export function prettyPath(p: string): string {
  const home = os.homedir()
  if (p === home) return '~'
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length)
  return p
}

/**
 * 从 registry 派生项目索引：
 *   - 对所有已注册 session 的 cwd 去重
 *   - label = basename；同名冲突时降级为 `<parent>/<basename>` 直到唯一
 *   - 按 lastUsedAt 降序排列（最近用过的排在最前）
 */
export function listProjectIndex(): ProjectIndexEntry[] {
  const sessions = listRegistered()
  if (sessions.length === 0) return []

  const byCwd = new Map<string, { cwd: string; lastUsedAt: string }>()
  for (const s of sessions) {
    const prev = byCwd.get(s.cwd)
    if (!prev || new Date(s.lastUsedAt).getTime() > new Date(prev.lastUsedAt).getTime()) {
      byCwd.set(s.cwd, { cwd: s.cwd, lastUsedAt: s.lastUsedAt })
    }
  }

  const entries = Array.from(byCwd.values())
  const labels = disambiguateLabels(entries.map(e => e.cwd))

  return entries
    .map((e, i) => ({ label: labels[i], cwd: e.cwd, lastUsedAt: e.lastUsedAt }))
    .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())
}

/**
 * 给一组 cwd 生成展示 label：
 *   - 默认用 basename
 *   - basename 重复时，给每个冲突项加上一层父目录，直到全部唯一
 */
function disambiguateLabels(cwds: string[]): string[] {
  const labels = cwds.map(c => path.basename(c))
  const depth = new Array<number>(cwds.length).fill(1)

  const hasDup = () => {
    const seen = new Map<string, number>()
    for (const l of labels) seen.set(l, (seen.get(l) ?? 0) + 1)
    return Array.from(seen.values()).some(n => n > 1)
  }

  let safety = 0
  while (hasDup() && safety++ < 8) {
    const counts = new Map<string, number>()
    for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1)

    for (let i = 0; i < cwds.length; i++) {
      if ((counts.get(labels[i]) ?? 0) > 1) {
        depth[i] += 1
        labels[i] = labelAtDepth(cwds[i], depth[i])
      }
    }
  }

  return labels
}

function labelAtDepth(cwd: string, depth: number): string {
  const parts = cwd.split(path.sep).filter(Boolean)
  const take = Math.min(depth, parts.length)
  return parts.slice(parts.length - take).join('/')
}

export interface ResolveHintOutcome {
  kind: 'ok' | 'not_found' | 'ambiguous'
  cwd?: string
  matches?: ProjectIndexEntry[]
}

/**
 * 解析 IM 端 /fn 的"项目目录"参数。
 *   - 绝对路径 / ~ 开头：原样返回（兜底，用于全新项目）
 *   - 短名称：在项目索引里匹配 label（精确优先、大小写不敏感、前缀匹配作为降级）
 */
export function resolveProjectHint(hint: string): ResolveHintOutcome {
  if (hint.startsWith('/') || hint.startsWith('~')) {
    return { kind: 'ok', cwd: hint }
  }

  const index = listProjectIndex()
  if (index.length === 0) return { kind: 'not_found' }

  const lower = hint.toLowerCase()

  // 精确匹配 label
  const exact = index.filter(e => e.label.toLowerCase() === lower)
  if (exact.length === 1) return { kind: 'ok', cwd: exact[0].cwd }
  if (exact.length > 1) return { kind: 'ambiguous', matches: exact }

  // 匹配任何层级 basename（处理用户输入 basename 但 label 已加了父目录的场景）
  const basenameExact = index.filter(e => path.basename(e.cwd).toLowerCase() === lower)
  if (basenameExact.length === 1) return { kind: 'ok', cwd: basenameExact[0].cwd }
  if (basenameExact.length > 1) return { kind: 'ambiguous', matches: basenameExact }

  // 前缀匹配（唯一时才用）
  const prefix = index.filter(e => e.label.toLowerCase().startsWith(lower))
  if (prefix.length === 1) return { kind: 'ok', cwd: prefix[0].cwd }

  return { kind: 'not_found' }
}

/** Levenshtein 距离，用于项目名模糊匹配建议 */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

/** 给找不到的 hint 返回相近的 label，至多 max 个 */
export function suggestProjectLabels(hint: string, max = 3): string[] {
  const index = listProjectIndex()
  const q = hint.toLowerCase()
  return index
    .map(e => ({ label: e.label, dist: levenshtein(q, e.label.toLowerCase()) }))
    .filter(({ label, dist }) => dist <= Math.max(2, Math.floor(label.length / 2)))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, max)
    .map(({ label }) => label)
}
