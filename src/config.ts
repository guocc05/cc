/**
 * @input:    ~/.cc/config.json (飞书凭证、用户白名单、默认参数、imDefaultClaudeProfile、askUserTimeoutMinutes、modelCatalogs), ~/.cc/wechat-account.json
 * @output:   loadConfig(), saveConfig(), getDataDir(), getDaemonLockDir(), getMessageDedupDir(), getAntiPomodoroFile(), getAskUserSocketPath(), getAskUserTimeoutMinutes(), getSessionDir(), getSessionsRootDir(), loadWeChatAccount(), saveWeChatAccount() — 配置读写和数据目录管理
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface CcConfig {
  feishu: {
    appId: string
    appSecret: string
  }
  claudeLauncher: string       // 可选：本地 Claude 启动器路径；为空时直接调用 claude
  /**
   * 可选：IM 端创建 Claude 对话时使用的默认 profile 名。
   * 仅在配置了 claudeLauncher 时生效 — 告诉 launcher 非交互启动（IM 端没有 TTY 无法弹菜单）。
   * 留空 = IM 端拒绝创建 Claude 对话（保留保守行为，与旧版一致）。
   */
  imDefaultClaudeProfile: string
  allowedUserIds: string[]    // 空数组 = 允许所有人（不推荐）
  defaultPermissionMode: string // 旧字段，保留兼容：YOLO | default | auto-edit
  defaultModes: Record<string, string> // per-tool 默认模式 { claude: 'bypassPermissions', codex: 'bypass', ... }
  recapBudget: number           // /fc 时上下文回顾的字符预算，0 = 禁用
  maxFileSizeMB: number         // 文件传输最大体积，默认 30（office 文档常较大）
  inboxTtlMinutes: number       // inbox 文件过期时间，默认 60
  pollIntervalMs: number        // REST 轮询间隔（毫秒），默认 5000
  askUserTimeoutMinutes: number // AI AskUserQuestion 反向提问超时（分钟），默认 8，范围 1-9（受 Claude command hook 600s 硬上限约束）
  /**
   * IM 端工具调用进度可视化（@20260512-im-tool-call-progress, ARCHITECTURE §4.9）。
   * 缺省时使用 DEFAULT_AGGREGATOR_CONFIG (1500/5000ms)。
   */
  toolCallStatus?: {
    textDebounceMs?: number     // 默认 1500
    statusThresholdMs?: number  // 默认 5000
  }
  /**
   * 可选：覆盖内置的 /model 候选模型清单（per-tool 完全替换）。
   * 缺失或字段为非数组时 fallback 到内置默认（详见 src/model-catalog.ts）。
   * 用户在 ~/.cc/config.json 这样写：
   *   "modelCatalogs": {
   *     "claude": [
   *       { "shortName": "opus-5", "fullName": "claude-opus-5", "description": "Opus 5" }
   *     ],
   *     "codex": [...]
   *   }
   * 让用户不升级 cc 也能用新模型 / 自定义偏好子集。
   */
  modelCatalogs?: {
    claude?: Array<{ shortName: string; fullName: string; description: string }>
    codex?: Array<{ shortName: string; fullName: string; description: string }>
  }
}

const CONFIG_DIR = path.join(os.homedir(), '.cc')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const DATA_DIR = path.join(CONFIG_DIR, 'data')
const LOG_DIR = path.join(CONFIG_DIR, 'logs')
const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid')
const DAEMON_LOCK_DIR = path.join(CONFIG_DIR, 'daemon.lock')
const INFLIGHT_DIR = path.join(DATA_DIR, 'inflight')
const PENDING_FILE = path.join(DATA_DIR, 'pending.json')
const MESSAGE_DEDUP_DIR = path.join(DATA_DIR, 'message-dedup')
const ANTI_POMODORO_FILE = path.join(DATA_DIR, 'anti-pomodoro.json')
const SOCKETS_DIR = path.join(CONFIG_DIR, 'sockets')
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions')

const DEFAULT_CONFIG: CcConfig = {
  feishu: { appId: '', appSecret: '' },
  claudeLauncher: '',
  imDefaultClaudeProfile: '',
  allowedUserIds: [],
  defaultPermissionMode: 'default',
  defaultModes: {},  // 空 = 使用 mode-policy 内置默认
  recapBudget: 2000,
  maxFileSizeMB: 30,
  inboxTtlMinutes: 60,
  pollIntervalMs: 5000,
  askUserTimeoutMinutes: 8,
}

const ASKUSER_TIMEOUT_MIN = 1
const ASKUSER_TIMEOUT_MAX = 9

function ensureDirs(): void {
  for (const dir of [CONFIG_DIR, DATA_DIR, LOG_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}

export function loadConfig(): CcConfig {
  ensureDirs()
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG }
  }
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
  const parsed = JSON.parse(raw) as Partial<CcConfig>
  const merged: CcConfig = {
    ...DEFAULT_CONFIG,
    ...parsed,
    feishu: {
      ...DEFAULT_CONFIG.feishu,
      ...parsed.feishu,
    },
  }
  return merged
}

export function saveConfig(config: CcConfig): void {
  ensureDirs()
  const tmpFile = CONFIG_FILE + '.tmp'
  fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2), { mode: 0o600 })
  fs.renameSync(tmpFile, CONFIG_FILE)
}

export function configExists(): boolean {
  const wa = loadWeChatAccount()
  if (wa !== null && wa.botToken !== '') return true
  if (!fs.existsSync(CONFIG_FILE)) return false
  const c = loadConfig()
  if (c.feishu.appId !== '') return true
  return false
}

export function getDataDir(): string { ensureDirs(); return DATA_DIR }
export function getLogDir(): string { ensureDirs(); return LOG_DIR }
export function getPidFile(): string { ensureDirs(); return PID_FILE }
export function getDaemonLockDir(): string { ensureDirs(); return DAEMON_LOCK_DIR }
export function getConfigDir(): string { ensureDirs(); return CONFIG_DIR }
export function getInflightDir(): string {
  if (!fs.existsSync(INFLIGHT_DIR)) fs.mkdirSync(INFLIGHT_DIR, { recursive: true })
  return INFLIGHT_DIR
}
export function getPendingFile(): string { ensureDirs(); return PENDING_FILE }
export function getMessageDedupDir(): string {
  ensureDirs()
  if (!fs.existsSync(MESSAGE_DEDUP_DIR)) fs.mkdirSync(MESSAGE_DEDUP_DIR, { recursive: true })
  return MESSAGE_DEDUP_DIR
}
export function getAntiPomodoroFile(): string { ensureDirs(); return ANTI_POMODORO_FILE }

/**
 * 获取 AskUserQuestion 桥接 unix socket 路径。
 * 目录权限 0700（仅当前用户可访问）。
 */
export function getAskUserSocketPath(): string {
  ensureDirs()
  if (!fs.existsSync(SOCKETS_DIR)) fs.mkdirSync(SOCKETS_DIR, { recursive: true, mode: 0o700 })
  return path.join(SOCKETS_DIR, 'askuser.sock')
}

/**
 * 获取某 session 的临时配置目录（用于写入 PreToolUse hook 的 settings.json）。
 * 目录权限 0700。
 */
export function getSessionDir(sessionId: string): string {
  ensureDirs()
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 })
  const dir = path.join(SESSIONS_DIR, sessionId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

export function getSessionsRootDir(): string {
  ensureDirs()
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 })
  return SESSIONS_DIR
}

// --- 默认模式 ---

import { getBuiltinDefault, migrateLegacyMode, isValidMode } from './mode-policy.js'
import type { ToolId } from './tool-driver.js'

/** 获取工具的默认模式（优先 per-tool 配置，否则迁移旧配置，最后用内置默认） */
export function getDefaultMode(tool: ToolId, config?: CcConfig): string {
  const cfg = config ?? loadConfig()

  // 1. per-tool 配置
  if (cfg.defaultModes?.[tool] && isValidMode(tool, cfg.defaultModes[tool])) {
    return cfg.defaultModes[tool]
  }

  // 2. 旧 defaultPermissionMode 迁移
  if (cfg.defaultPermissionMode && cfg.defaultPermissionMode !== 'default') {
    return migrateLegacyMode(cfg.defaultPermissionMode, tool)
  }

  // 3. 内置默认
  return getBuiltinDefault(tool)
}

/**
 * 读取 AskUserQuestion 超时（分钟），夹紧到 [1, 9]。
 * 越界时写日志告警（AC-9）。
 */
export function getAskUserTimeoutMinutes(config?: CcConfig): number {
  const cfg = config ?? loadConfig()
  const raw = cfg.askUserTimeoutMinutes ?? DEFAULT_CONFIG.askUserTimeoutMinutes
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    console.warn(`[config] askUserTimeoutMinutes 非数字 (${String(raw)})，使用默认 ${DEFAULT_CONFIG.askUserTimeoutMinutes} 分钟`)
    return DEFAULT_CONFIG.askUserTimeoutMinutes
  }
  const rounded = Math.round(raw)
  if (rounded < ASKUSER_TIMEOUT_MIN) {
    console.warn(`[config] askUserTimeoutMinutes=${raw} 低于下限 ${ASKUSER_TIMEOUT_MIN}，已夹紧`)
    return ASKUSER_TIMEOUT_MIN
  }
  if (rounded > ASKUSER_TIMEOUT_MAX) {
    console.warn(`[config] askUserTimeoutMinutes=${raw} 高于上限 ${ASKUSER_TIMEOUT_MAX}（受 Claude hook 600s 硬限制约束），已夹紧`)
    return ASKUSER_TIMEOUT_MAX
  }
  return rounded
}

/** 设置工具的默认模式 */
export function setDefaultMode(tool: ToolId, modeId: string): void {
  const config = loadConfig()
  if (!config.defaultModes) config.defaultModes = {}
  config.defaultModes[tool] = modeId
  saveConfig(config)
}

// --- 微信账号配置 ---

const WECHAT_ACCOUNT_FILE = path.join(CONFIG_DIR, 'wechat-account.json')

export interface WeChatAccount {
  botToken: string
  baseUrl: string
  ilinkBotId: string
  ilinkUserId: string
  savedAt: string
  lastOkAt: string
  syncBuf: string  // getupdates cursor
}

export function getWeChatAccountFile(): string { return WECHAT_ACCOUNT_FILE }

export function loadWeChatAccount(): WeChatAccount | null {
  if (!fs.existsSync(WECHAT_ACCOUNT_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(WECHAT_ACCOUNT_FILE, 'utf-8')) as WeChatAccount
  } catch { return null }
}

export function saveWeChatAccount(account: WeChatAccount): void {
  ensureDirs()
  const tmp = WECHAT_ACCOUNT_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(account, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, WECHAT_ACCOUNT_FILE)
}
