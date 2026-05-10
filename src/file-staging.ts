/**
 * @input:    IM 下载的文件, binding.cwd
 * @output:   stageFile(), consumeStaged(), ensureInbox(), classifyFile(), needsLegacyUpgrade(), runInboxCleanup() — 文件暂存与 inbox 管理
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import path from 'node:path'
import { log } from './logger.js'

// --- 类型定义 ---

export type FileCategory = 'image' | 'text' | 'office' | 'unsupported'

export interface StagedFile {
  filePath: string
  originalName: string
  category: FileCategory
  messageId: string
  stagedAt: string
  /** office 类专用：旧格式 soffice 升格成功后的产物路径 */
  upgradedPath?: string
  /** office 类专用：旧格式升格失败时的原因短语（inline 进 prompt） */
  upgradeError?: string
}

// --- 扩展名白名单 ---

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'js', 'ts', 'py', 'log', 'csv',
  'yaml', 'yml', 'xml', 'html', 'css', 'sh',
  'go', 'rs', 'java', 'c', 'cpp', 'h', 'rb', 'php',
  'swift', 'kt', 'sql', 'toml', 'ini', 'cfg', 'conf',
  'env', 'dockerfile', 'makefile',
])

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp',
])

const OFFICE_EXTENSIONS = new Set([
  'pdf', 'docx', 'xlsx', 'pptx',  // 新格式
  'doc', 'xls', 'ppt',             // 旧格式（需 soffice 升格）
])

// --- 暂存队列（内存） ---

const staged = new Map<string, StagedFile[]>()

/** 将文件加入某个群的暂存队列 */
export function stageFile(chatId: string, file: StagedFile): void {
  const list = staged.get(chatId) ?? []
  list.push(file)
  staged.set(chatId, list)
}

/** 取出并清空某个群的所有暂存文件，无暂存则返回 null */
export function consumeStaged(chatId: string): StagedFile[] | null {
  const list = staged.get(chatId)
  if (!list || list.length === 0) return null
  staged.delete(chatId)
  return list
}

/** 确保 inbox 目录存在，返回绝对路径 */
export function ensureInbox(cwd: string): string {
  const inbox = path.join(cwd, '.im2cc-inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const gitignore = path.join(inbox, '.gitignore')
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, '*\n')
  }
  return fs.realpathSync(inbox)
}

/** 根据文件扩展名分类：text / image / office / unsupported */
export function classifyFile(fileName: string): FileCategory {
  // 特殊无扩展名文件（Dockerfile/Makefile）必须前置检测，否则会被 !ext 早返回遮蔽
  const baseName = path.basename(fileName).toLowerCase()
  if (baseName === 'dockerfile' || baseName === 'makefile') return 'text'
  const ext = path.extname(fileName).slice(1).toLowerCase()
  if (!ext) return 'unsupported'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (OFFICE_EXTENSIONS.has(ext)) return 'office'
  return 'unsupported'
}

/** 旧格式 office 文件需要升格到新格式；返回目标扩展名或 false */
export function needsLegacyUpgrade(fileName: string): false | 'docx' | 'xlsx' | 'pptx' {
  const ext = path.extname(fileName).slice(1).toLowerCase()
  switch (ext) {
    case 'doc': return 'docx'
    case 'xls': return 'xlsx'
    case 'ppt': return 'pptx'
    default: return false
  }
}

/** 清理过期 inbox 文件；接受 cwd 数组以避免循环依赖 */
export function runInboxCleanup(cwds: string[], ttlMinutes: number): void {
  const now = Date.now()
  const maxAge = ttlMinutes * 60 * 1000
  for (const cwd of cwds) {
    const inbox = path.join(cwd, '.im2cc-inbox')
    if (!fs.existsSync(inbox)) continue
    try {
      const files = fs.readdirSync(inbox)
      for (const f of files) {
        if (f === '.gitignore') continue
        const fp = path.join(inbox, f)
        try {
          const stat = fs.statSync(fp)
          if (!stat.isFile()) continue
          if (now - stat.mtimeMs > maxAge) {
            fs.unlinkSync(fp)
            log(`[inbox] 清理过期文件: ${fp}`)
          }
        } catch { /* skip individual file errors */ }
      }
    } catch { /* skip inbox read errors */ }
  }
}
