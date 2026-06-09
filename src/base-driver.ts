/**
 * @input:    ToolDriver 接口
 * @output:   BaseToolDriver — 所有工具 driver 的通用基类（tmux 管理、进程中断、流式输出解析）
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import type { ToolDriver, ToolId, ToolCapabilities, CreateSessionOptions, CreateSessionResult, SendMessageOptions, SessionFileStatus } from './tool-driver.js'
import type { RecapTurn } from './recap.js'
import { tmuxExactTarget } from './tmux-util.js'
import { findProcesses, killProcess, killProcessGroup, isTmuxAvailable } from './process-utils.js'

/**
 * 细粒度 turn 事件：driver 把 stream-json 拆解后通知 daemon（@20260512-im-tool-call-progress）
 * - text: 一段 AI 输出文本
 * - tool_start: AI 开始调用一个工具
 * - tool_end: 工具调用结束
 * - turn_end: 整个 turn (一次 sendMessage) 结束
 */
export type TurnEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_start'; toolUseId: string; name: string }
  | { kind: 'tool_end'; toolUseId: string; success: boolean }
  | { kind: 'turn_end' }

/** runTool 的选项 */
export interface RunToolOptions {
  message: string
  args: string[]         // CLI 完整参数（不含命令名）
  cmd: string            // CLI 命令名
  cwd: string
  env?: NodeJS.ProcessEnv
  onSpawn?: (child: ChildProcess) => void
  outputFile?: string
  /** @deprecated 优先用 onTurnEvent;onTurnText 仅做向后兼容（Codex/Gemini driver 暂保留） */
  onTurnText?: (text: string) => void
  /** 细粒度 turn 事件流（@20260512-im-tool-call-progress） */
  onTurnEvent?: (event: TurnEvent) => void
  onEvent?: (event: Record<string, unknown>) => void
  /** 从 NDJSON 事件中提取 assistant 文本的函数 */
  extractText?: (event: Record<string, unknown>) => string
  /** 从 NDJSON 事件中提取 result 文本的函数 */
  extractResult?: (event: Record<string, unknown>) => string
  /** 从 NDJSON 事件中提取 tool_use blocks 的函数（@20260512-im-tool-call-progress） */
  extractToolStarts?: (event: Record<string, unknown>) => Array<{ toolUseId: string; name: string }>
  /** 从 NDJSON 事件中提取 tool_result blocks 的函数（@20260512-im-tool-call-progress） */
  extractToolEnds?: (event: Record<string, unknown>) => Array<{ toolUseId: string; success: boolean }>
}

interface ToolFailureInfo {
  userMessage: string
  rawMessage: string
}

/**
 * 所有工具 driver 的通用基类。
 * 提供 killLocalSession、interrupt、runTool 的通用实现。
 */
export abstract class BaseToolDriver implements ToolDriver {
  abstract readonly id: ToolId
  abstract readonly capabilities: ToolCapabilities

  abstract getVersion(): string
  abstract isAvailable(): boolean
  abstract createSession(cwd: string, permissionMode: string, name?: string, opts?: CreateSessionOptions): Promise<CreateSessionResult>
  abstract sendMessage(sessionId: string, message: string, cwd: string, permissionMode: string, opts?: SendMessageOptions): Promise<string>

  /** 默认：不支持 session 文件检查（子类可覆盖） */
  checkSessionFile(_sessionId: string, _cwd: string): SessionFileStatus {
    return 'missing'
  }

  /** 默认：不支持 recap（子类可覆盖） */
  buildRecapTurn(_sessionId: string, _cwd: string, _budget: number): RecapTurn | null {
    return null
  }

  /** 通用：杀掉本地 session（跨平台） */
  killLocalSession(sessionName: string, tool?: ToolId): boolean {
    const t = tool ?? this.id

    // Unix: 先尝试 tmux
    if (isTmuxAvailable()) {
      const tmuxNames = [`cc-${t}-${sessionName}`, `cc-${sessionName}`]
      for (const tmuxSession of tmuxNames) {
        try {
          execFileSync('tmux', ['has-session', '-t', tmuxExactTarget(tmuxSession)], { stdio: 'ignore' })
          execFileSync('tmux', ['kill-session', '-t', tmuxExactTarget(tmuxSession)], { stdio: 'ignore' })
          return true
        } catch { /* 不存在 */ }
      }
    }

    // 跨平台 fallback：通过进程模式匹配
    // 同步版本用于快速检查
    if (process.platform === 'win32') {
      return this.killLocalSessionWindows(sessionName, t)
    }

    // Unix pgrep fallback
    try {
      const result = execFileSync('pgrep', ['-f', `${t}.*${sessionName}`], { encoding: 'utf-8' }).trim()
      if (!result) return false
      const pids = result.split('\n').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n !== process.pid)
      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM') } catch {}
      }
      return pids.length > 0
    } catch { return false }
  }

  /** Windows 特定的进程终止 */
  private killLocalSessionWindows(sessionName: string, tool: ToolId): boolean {
    // Windows 下使用 wmic 查找并终止进程
    try {
      const pattern = `${tool}.*${sessionName}`
      const output = execFileSync(
        'wmic',
        ['process', 'where', `commandline like '%${pattern}%'`, 'get', 'processid'],
        { encoding: 'utf-8', timeout: 10000 }
      ).trim()

      const lines = output.split('\n').slice(1) // 跳过标题
      const pids: number[] = []

      for (const line of lines) {
        const pid = parseInt(line.trim(), 10)
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
          pids.push(pid)
        }
      }

      for (const pid of pids) {
        try {
          execFileSync('taskkill', ['/f', '/pid', String(pid)], { stdio: 'ignore' })
        } catch {
          // 忽略错误
        }
      }

      return pids.length > 0
    } catch {
      return false
    }
  }

  /** 通用：中断进程（跨平台） */
  async interrupt(child: ChildProcess): Promise<void> {
    if (!child.pid || child.exitCode !== null) return
    const pid = child.pid

    // Windows 不支持进程组和信号
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/f', '/t', '/pid', String(pid)], { stdio: 'ignore' })
      } catch {
        // 忽略错误
      }
      await waitOrTimeout(child, 2000)
      return
    }

    // Unix: SIGINT → SIGTERM → SIGKILL
    const killGroup = (signal: NodeJS.Signals) => {
      try { process.kill(-pid, signal) } catch {}
    }
    killGroup('SIGINT')
    await waitOrTimeout(child, 5000)
    if (child.exitCode !== null) return
    killGroup('SIGTERM')
    await waitOrTimeout(child, 5000)
    if (child.exitCode !== null) return
    killGroup('SIGKILL')
  }

  /** 通用：生成 session UUID */
  protected generateSessionId(): string {
    return crypto.randomUUID()
  }

  /** 通用：检查工具是否安装 */
  protected checkInstalled(cmd: string): boolean {
    try {
      const locator = process.platform === 'win32' ? 'where' : 'which'
      execFileSync(locator, [cmd], { stdio: 'ignore' })
      return true
    } catch { return false }
  }

  /** 通用：获取工具版本 */
  protected getToolVersion(cmd: string, args: string[] = ['--version']): string {
    try {
      return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000 }).trim()
    } catch { return 'unknown' }
  }

  /**
   * 通用：spawn 工具并解析 NDJSON 流式输出。
   * 每个 driver 只需提供 CLI 命令/参数和事件解析函数。
   */
  protected runTool(opts: RunToolOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(opts.cmd, opts.args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        shell: process.platform === 'win32',
      })

      opts.onSpawn?.(child)

      let stdout = ''
      let rawStdout = ''
      let stderr = ''
      const turnTexts: string[] = []
      const resultParts: string[] = []
      let detectedFailure: ToolFailureInfo | null = null

      // 默认文本提取：尝试常见的 NDJSON 格式
      const extractText = opts.extractText ?? defaultExtractText
      const extractResult = opts.extractResult ?? defaultExtractResult
      const extractToolStarts = opts.extractToolStarts ?? defaultExtractToolStarts
      const extractToolEnds = opts.extractToolEnds ?? defaultExtractToolEnds

      function handleEvent(event: Record<string, unknown>): void {
        opts.onEvent?.(event)
        const text = extractText(event).trim()
        const result = extractResult(event).trim()
        const failure = detectToolFailure(opts.cmd, event, [text, result].filter(Boolean))
        if (failure) {
          detectedFailure = failure
          return
        }

        if (text) {
          turnTexts.push(text)
          opts.onTurnText?.(text)
          opts.onTurnEvent?.({ kind: 'text', text })
        }
        // tool_use 派生 tool_start 事件（仅在有 onTurnEvent 时触发）
        if (opts.onTurnEvent) {
          for (const t of extractToolStarts(event)) {
            opts.onTurnEvent({ kind: 'tool_start', toolUseId: t.toolUseId, name: t.name })
          }
          for (const t of extractToolEnds(event)) {
            opts.onTurnEvent({ kind: 'tool_end', toolUseId: t.toolUseId, success: t.success })
          }
        }
        if (result) resultParts.push(result)

        // 输出落盘
        const allText = turnTexts.length > 0 ? turnTexts.join('\n\n---\n\n') : resultParts.join('\n\n---\n\n')
        if (opts.outputFile && allText) {
          try { fs.writeFileSync(opts.outputFile, allText) } catch {}
        }
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        const chunkText = chunk.toString()
        rawStdout += chunkText
        stdout += chunkText
        const lines = stdout.split('\n')
        stdout = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try { handleEvent(JSON.parse(line) as Record<string, unknown>) } catch {}
        }
      })

      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.on('error', reject)

      child.on('close', (code) => {
        // 处理残留 stdout
        if (stdout.trim()) {
          try { handleEvent(JSON.parse(stdout) as Record<string, unknown>) } catch {
            // 非 JSON 输出，作为纯文本结果
            if (stdout.trim() && resultParts.length === 0 && turnTexts.length === 0) {
              resultParts.push(stdout.trim())
            }
          }
        }

        // 派 turn_end 事件（@20260512-im-tool-call-progress）
        opts.onTurnEvent?.({ kind: 'turn_end' })

        const resultText = turnTexts.length > 0
          ? turnTexts.join('\n\n---\n\n')
          : resultParts.join('\n\n---\n\n')
        const recoveredResult = !resultText
          ? recoverResultFromRawStdout(rawStdout, extractText, extractResult)
          : ''
        const finalResultText = resultText || recoveredResult
        const stderrText = stderr.trim()
        const trailingFailure = detectedFailure
          ?? detectToolFailure(opts.cmd, null, [stderrText, finalResultText].filter(Boolean))

        if (trailingFailure) {
          reject(new Error(trailingFailure.userMessage))
        } else if (code === 0) {
          resolve(finalResultText || '(无输出)')
        } else {
          const detail = (stderrText || finalResultText).slice(0, 500)
          reject(new Error(detail ? `${opts.cmd} 退出码 ${code}: ${detail}` : `${opts.cmd} 退出码 ${code}`))
        }
      })
    })
  }
}

function recoverResultFromRawStdout(
  rawStdout: string,
  extractText: (event: Record<string, unknown>) => string,
  extractResult: (event: Record<string, unknown>) => string,
): string {
  if (!rawStdout.trim()) return ''
  const recoveredTexts: string[] = []
  const recoveredResults: string[] = []
  for (const line of rawStdout.split('\n')) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as Record<string, unknown>
      const text = extractText(event).trim()
      const result = extractResult(event).trim()
      if (text) recoveredTexts.push(text)
      if (result) recoveredResults.push(result)
    } catch {
      // ignore malformed line
    }
  }
  if (recoveredTexts.length > 0) return recoveredTexts.join('\n\n---\n\n')
  if (recoveredResults.length > 0) return recoveredResults.join('\n\n---\n\n')
  return ''
}

// --- 通用辅助函数 ---

function waitOrTimeout(child: ChildProcess, ms: number): Promise<void> {
  return new Promise(resolve => {
    if (child.exitCode !== null) return resolve()
    const onClose = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      // 超时时主动卸载 listener，避免 interrupt() 连续 3 次调用 waitOrTimeout 累积 close 监听器
      child.removeListener('close', onClose)
      resolve()
    }, ms)
    child.once('close', onClose)
  })
}

/** 默认文本提取：从 assistant 事件中提取 text */
function defaultExtractText(event: Record<string, unknown>): string {
  if (event.type === 'assistant') {
    const msg = event.message as Record<string, unknown> | undefined
    if (!msg) return ''
    const content = msg.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    const texts: string[] = []
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text)
        continue
      }
      if (typeof block.text === 'string') {
        texts.push(block.text)
      }
    }
    return texts.join('')
  }
  return ''
}

/** 默认 result 提取 */
function defaultExtractResult(event: Record<string, unknown>): string {
  if (event.type === 'result' && typeof event.result === 'string') return event.result
  return ''
}

/**
 * 默认 tool_use 提取：从 assistant event 的 content[type='tool_use'] block 派生 tool_start。
 * （@20260512-im-tool-call-progress, 实证 Claude stream-json 行为）
 */
function defaultExtractToolStarts(event: Record<string, unknown>): Array<{ toolUseId: string; name: string }> {
  if (event.type !== 'assistant') return []
  const msg = event.message as Record<string, unknown> | undefined
  if (!msg || !Array.isArray(msg.content)) return []
  const out: Array<{ toolUseId: string; name: string }> = []
  for (const block of msg.content as Array<Record<string, unknown>>) {
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      out.push({ toolUseId: block.id, name: block.name })
    }
  }
  return out
}

/**
 * 默认 tool_result 提取：从 user event 的 content[type='tool_result'] block 派生 tool_end。
 * （@20260512-im-tool-call-progress, 实证 Claude stream-json 行为）
 */
function defaultExtractToolEnds(event: Record<string, unknown>): Array<{ toolUseId: string; success: boolean }> {
  if (event.type !== 'user') return []
  const msg = event.message as Record<string, unknown> | undefined
  if (!msg || !Array.isArray(msg.content)) return []
  const out: Array<{ toolUseId: string; success: boolean }> = []
  for (const block of msg.content as Array<Record<string, unknown>>) {
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      const success = block.is_error !== true
      out.push({ toolUseId: block.tool_use_id, success })
    }
  }
  return out
}

function detectToolFailure(
  cmd: string,
  event: Record<string, unknown> | null,
  messages: string[],
): ToolFailureInfo | null {
  const rawMessage = messages.map(m => m.trim()).find(Boolean) ?? ''
  const eventError = typeof event?.error === 'string' ? event.error : ''
  const isApiError = event?.isApiErrorMessage === true || !!eventError

  if (isApiError && rawMessage) {
    return buildToolFailure(cmd, rawMessage, eventError)
  }

  if (rawMessage && looksLikeSyntheticToolError(rawMessage)) {
    return buildToolFailure(cmd, rawMessage, eventError)
  }

  return null
}

function looksLikeSyntheticToolError(message: string): boolean {
  return [
    /^you['’]ve hit your limit\b/i,
    /^api error:\s*rate limit reached\b/i,
    /\ballocationquota\./i,
    /\bfree tier\b.*\bexhausted\b/i,
  ].some(pattern => pattern.test(message))
}

function buildToolFailure(cmd: string, rawMessage: string, eventError: string): ToolFailureInfo {
  const toolName = cmd.toLowerCase() === 'claude' ? 'Claude Code' : cmd
  const normalized = rawMessage.replace(/\s+/g, ' ').trim()
  const resetMatch = normalized.match(/resets?\s+(.+)$/i)

  if (eventError === 'rate_limit' || /^you['’]ve hit your limit\b/i.test(normalized) || /\brate limit\b/i.test(normalized)) {
    const resetText = resetMatch ? `，${resetMatch[0]}` : ''
    return {
      userMessage: `${toolName} 已触发额度限制${resetText}。请稍后重试，或先切换到其他工具。`,
      rawMessage,
    }
  }

  if (/\ballocationquota\./i.test(normalized) || /\bfree tier\b.*\bexhausted\b/i.test(normalized)) {
    return {
      userMessage: `${toolName} 当前额度已耗尽。请补充额度或切换到其他工具后重试。`,
      rawMessage,
    }
  }

  return {
    userMessage: `${toolName} 执行失败: ${normalized}`,
    rawMessage,
  }
}
