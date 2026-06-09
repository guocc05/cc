/**
 * @input:    CcConfig.claudeLauncher, Claude session/profile 上下文, askUserQuestion 桥接信息（sessionId/conversationId）
 * @output:   Claude 启动器解析、profile 选择 + injectAskUserHookSettings (PreToolUse hook 配置注入)
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  loadConfig,
  getAskUserSocketPath,
  getAskUserTimeoutMinutes,
  getSessionDir,
  type CcConfig,
} from './config.js'
import { log } from './logger.js'

export interface ClaudeLauncherContext {
  phase: 'select' | 'create' | 'send' | 'resume' | 'compat' | 'version'
  sessionId?: string
  sessionName?: string
  profile?: string
}

function resolveConfig(config?: CcConfig): CcConfig {
  return config ?? loadConfig()
}

function envLauncherOverride(): string | null {
  const raw = process.env.IM2CC_CLAUDE_LAUNCHER?.trim()
  return raw ? raw : null
}

function expandHome(rawPath: string): string {
  if (!rawPath.startsWith('~')) return rawPath
  if (rawPath === '~') return os.homedir()
  if (rawPath.startsWith('~/')) return path.join(os.homedir(), rawPath.slice(2))
  return rawPath
}

export function getClaudeLauncher(config?: CcConfig): string {
  const custom = envLauncherOverride() ?? resolveConfig(config).claudeLauncher?.trim()
  if (!custom || custom === 'claude') return 'claude'
  return path.resolve(expandHome(custom))
}

export function hasCustomClaudeLauncher(config?: CcConfig): boolean {
  return getClaudeLauncher(config) !== 'claude'
}

export function assertClaudeLauncherAvailable(config?: CcConfig): void {
  if (!hasCustomClaudeLauncher(config)) return
  const launcher = getClaudeLauncher(config)
  if (!fs.existsSync(launcher)) {
    throw new Error(`Claude launcher 不存在: ${launcher}`)
  }
  fs.accessSync(launcher, fs.constants.X_OK)
}

export function buildClaudeLauncherEnv(
  context: ClaudeLauncherContext,
  config?: CcConfig,
): NodeJS.ProcessEnv | undefined {
  if (!hasCustomClaudeLauncher(config)) return undefined

  const env: NodeJS.ProcessEnv = { ...process.env }
  env.IM2CC_CLAUDE_PHASE = context.phase
  if (context.sessionId) env.IM2CC_CLAUDE_SESSION_ID = context.sessionId
  if (context.sessionName) env.IM2CC_CLAUDE_SESSION_NAME = context.sessionName
  if (context.profile) env.IM2CC_CLAUDE_PROFILE = context.profile
  return env
}

export function buildClaudeInteractiveCommand(
  args: string[],
  context: ClaudeLauncherContext,
  config?: CcConfig,
): string[] {
  const launcher = getClaudeLauncher(config)
  if (!hasCustomClaudeLauncher(config)) return [launcher, ...args]

  const launcherEnv = buildClaudeLauncherEnv(context, config) ?? {}
  const envPairs = [
    launcherEnv.IM2CC_CLAUDE_PHASE,
    launcherEnv.IM2CC_CLAUDE_SESSION_ID && `IM2CC_CLAUDE_SESSION_ID=${launcherEnv.IM2CC_CLAUDE_SESSION_ID}`,
    launcherEnv.IM2CC_CLAUDE_SESSION_NAME && `IM2CC_CLAUDE_SESSION_NAME=${launcherEnv.IM2CC_CLAUDE_SESSION_NAME}`,
    launcherEnv.IM2CC_CLAUDE_PROFILE && `IM2CC_CLAUDE_PROFILE=${launcherEnv.IM2CC_CLAUDE_PROFILE}`,
  ].filter((value): value is string => Boolean(value))

  envPairs[0] = `IM2CC_CLAUDE_PHASE=${launcherEnv.IM2CC_CLAUDE_PHASE}`

  return ['env', ...envPairs, launcher, ...args]
}

/**
 * 解析 hooks/askuser-hook.mjs 的绝对路径。
 * dist/src/claude-launcher.js → ../../hooks/askuser-hook.mjs（npm 安装后 hooks/ 与 dist/ 同级）。
 */
export function resolveAskUserHookScript(): string {
  return path.resolve(import.meta.dirname, '../../hooks/askuser-hook.mjs')
}

export interface AskUserHookInjection {
  /** Claude `--settings <path>` 用 */
  settingsPath: string
  /** 注入到 Claude 子进程的环境变量（hook 读这些找 socket / 路由 IM） */
  env: NodeJS.ProcessEnv
}

/**
 * 在 ~/.cc/sessions/<sessionId>/settings.json 写入临时配置：
 * - PreToolUse hook 拦截 AskUserQuestion 调用
 * - 通过 unix socket 与 daemon askuser-bridge 通信
 *
 * 返回 settingsPath（给 Claude `--settings`）+ env（IM2CC_*）。
 * 调用方负责把 env 合入 Claude 子进程的 env，并把 `--settings <path>` 加入 args。
 *
 * 若 hook 脚本不存在（例如安装不完整），返回 null —— 调用方应跳过 settings 注入，AI 会按默认行为
 * 走（AskUserQuestion 在非交互 -p 模式下会失败，但至少不破坏现有流程）。
 */
export function injectAskUserHookSettings(opts: {
  sessionId: string
  conversationId: string
}): AskUserHookInjection | null {
  const hookScript = resolveAskUserHookScript()
  if (!fs.existsSync(hookScript)) {
    log(`[claude-launcher] askuser hook 脚本不存在，跳过注入: ${hookScript}`)
    return null
  }

  // hook 脚本为 .mjs，无需 chmod；用 `node <script>` 调用
  const sessionDir = getSessionDir(opts.sessionId)
  const settingsPath = path.join(sessionDir, 'settings.json')

  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'AskUserQuestion',
          hooks: [
            {
              type: 'command',
              command: `node ${JSON.stringify(hookScript).slice(1, -1)}`,
            },
          ],
        },
      ],
    },
  }

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 })
  } catch (err) {
    log(`[claude-launcher] 写入 settings.json 失败: ${(err as Error).message}`)
    return null
  }

  const timeoutMs = getAskUserTimeoutMinutes() * 60 * 1000

  const env: NodeJS.ProcessEnv = {
    IM2CC_SESSION_ID: opts.sessionId,
    IM2CC_CONVERSATION_ID: opts.conversationId,
    IM2CC_ASKUSER_SOCKET: getAskUserSocketPath(),
    IM2CC_ASKUSER_TIMEOUT_MS: String(timeoutMs),
  }

  return { settingsPath, env }
}

export function selectClaudeProfile(
  cwd: string,
  sessionName: string,
  config?: CcConfig,
): string | undefined {
  if (!hasCustomClaudeLauncher(config)) return undefined

  assertClaudeLauncherAvailable(config)
  const launcher = getClaudeLauncher(config)

  const stdout = execFileSync(launcher, ['--cc-select-profile'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'inherit'],
    env: buildClaudeLauncherEnv({ phase: 'select', sessionName }, config),
  }).trim()

  const profile = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).at(-1)
  if (!profile) {
    throw new Error('Claude launcher 未返回有效 profile')
  }
  return profile
}
