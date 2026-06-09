/**
 * @input:    无（纯 Node.js API）
 * @output:   findProcess(), listProcesses(), killProcess(), isProcessRunning() — 跨平台进程管理
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import { execFileSync, exec as execCallback, type ExecOptions } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execCallback)

export interface ProcessInfo {
  pid: number
  name: string
  cmd: string
}

/**
 * 检查进程是否存在且正在运行
 */
export function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 跨平台查找进程
 * - macOS/Linux: 使用 pgrep
 * - Windows: 使用 wmic 或 tasklist
 */
export async function findProcesses(pattern: string): Promise<ProcessInfo[]> {
  if (process.platform === 'win32') {
    return findProcessesWindows(pattern)
  }
  return findProcessesUnix(pattern)
}

async function findProcessesUnix(pattern: string): Promise<ProcessInfo[]> {
  try {
    // 使用 pgrep -f 匹配完整命令行
    const { stdout } = await exec(`pgrep -f "${pattern}"`, { timeout: 5000 })
    const lines = stdout.trim().split('\n').filter(Boolean)
    const results: ProcessInfo[] = []

    for (const line of lines) {
      const pid = parseInt(line.trim(), 10)
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        const info = await getProcessInfoUnix(pid)
        if (info) results.push(info)
      }
    }

    return results
  } catch {
    return []
  }
}

async function findProcessesWindows(pattern: string): Promise<ProcessInfo[]> {
  try {
    // 使用 wmic 获取进程信息（比 tasklist 更详细）
    const { stdout } = await exec(
      `wmic process where "commandline like '%${pattern}%'" get processid,commandline /format:list`,
      { timeout: 10000 }
    )

    const results: ProcessInfo[] = []
    const blocks = stdout.split(/\r?\n\r?\n/)

    for (const block of blocks) {
      const cmdMatch = block.match(/CommandLine=(.+)/i)
      const pidMatch = block.match(/ProcessId=(\d+)/i)

      if (cmdMatch && pidMatch) {
        const pid = parseInt(pidMatch[1], 10)
        const cmd = cmdMatch[1].trim()
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
          // 提取进程名（可执行文件名）
          const nameMatch = cmd.match(/"([^"]+)"/) || cmd.match(/^(\S+)/)
          const name = nameMatch ? nameMatch[1].split(/[\\/]/).pop() || 'unknown' : 'unknown'
          results.push({ pid, name, cmd })
        }
      }
    }

    return results
  } catch {
    // wmic 失败时尝试 tasklist（信息较少但更稳定）
    return findProcessesWindowsFallback(pattern)
  }
}

async function findProcessesWindowsFallback(pattern: string): Promise<ProcessInfo[]> {
  try {
    const { stdout } = await exec('tasklist /fo csv /v', { timeout: 10000 })
    const lines = stdout.trim().split('\n').slice(1) // 跳过标题行
    const results: ProcessInfo[] = []

    for (const line of lines) {
      // CSV 格式："name","pid","session","mem","user","cpu time","window title"
      const parts = line.match(/"([^"]*)"/g)?.map(s => s.slice(1, -1)) || []
      if (parts.length >= 2) {
        const name = parts[0]
        const pid = parseInt(parts[1], 10)
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
          // tasklist 没有完整命令行，用 name 做 pattern 匹配
          if (name.toLowerCase().includes(pattern.toLowerCase())) {
            results.push({ pid, name, cmd: name })
          }
        }
      }
    }

    return results
  } catch {
    return []
  }
}

/**
 * 获取单个进程的详细信息（Unix）
 */
async function getProcessInfoUnix(pid: number): Promise<ProcessInfo | null> {
  if (!isProcessRunning(pid)) return null

  try {
    const { stdout } = await exec(`ps -p ${pid} -o comm=,command=`, { timeout: 3000 })
    const lines = stdout.trim().split('\n')
    if (lines.length === 0) return null

    const [comm, ...cmdParts] = lines[0].trim().split(/\s+/)
    return {
      pid,
      name: comm || 'unknown',
      cmd: cmdParts.join(' ') || comm || 'unknown',
    }
  } catch {
    return null
  }
}

/**
 * 获取单个进程的详细信息（跨平台）
 */
export async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  if (!isProcessRunning(pid)) return null

  if (process.platform === 'win32') {
    return getProcessInfoWindows(pid)
  }
  return getProcessInfoUnix(pid)
}

async function getProcessInfoWindows(pid: number): Promise<ProcessInfo | null> {
  try {
    const { stdout } = await exec(
      `wmic process where processid=${pid} get name,commandline /format:list`,
      { timeout: 5000 }
    )

    const cmdMatch = stdout.match(/CommandLine=(.+)/i)
    const nameMatch = stdout.match(/Name=(.+)/i)

    if (nameMatch) {
      return {
        pid,
        name: nameMatch[1].trim(),
        cmd: cmdMatch?.[1]?.trim() || nameMatch[1].trim(),
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 列出所有匹配名称的进程
 */
export async function listProcessesByName(name: string): Promise<ProcessInfo[]> {
  if (process.platform === 'win32') {
    return findProcessesWindows(name)
  }

  try {
    const { stdout } = await exec(`pgrep -x "${name}"`, { timeout: 5000 })
    const lines = stdout.trim().split('\n').filter(Boolean)
    const results: ProcessInfo[] = []

    for (const line of lines) {
      const pid = parseInt(line.trim(), 10)
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
        const info = await getProcessInfoUnix(pid)
        if (info) results.push(info)
      }
    }

    return results
  } catch {
    return []
  }
}

/**
 * 终止进程（跨平台）
 * 依次尝试 SIGTERM、SIGKILL
 */
export async function killProcess(pid: number, timeoutMs: number = 5000): Promise<boolean> {
  if (!isProcessRunning(pid)) return true

  // Windows 不支持信号，直接用 taskkill
  if (process.platform === 'win32') {
    return killProcessWindows(pid, timeoutMs)
  }

  // Unix: 先 SIGTERM
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }

  // 等待进程退出
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  // 超时后 SIGKILL
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // 忽略
  }

  // 再等待一下
  await new Promise(resolve => setTimeout(resolve, 500))
  return !isProcessRunning(pid)
}

async function killProcessWindows(pid: number, timeoutMs: number): Promise<boolean> {
  try {
    // 先尝试优雅终止
    await exec(`taskkill /pid ${pid}`, { timeout: timeoutMs })
  } catch {
    // 忽略错误
  }

  // 等待进程退出
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  // 强制终止
  try {
    await exec(`taskkill /f /pid ${pid}`, { timeout: 5000 })
  } catch {
    // 忽略错误
  }

  await new Promise(resolve => setTimeout(resolve, 500))
  return !isProcessRunning(pid)
}

/**
 * 终止进程组（Unix）或进程树（Windows）
 */
export async function killProcessGroup(pid: number, timeoutMs: number = 5000): Promise<boolean> {
  if (process.platform === 'win32') {
    // Windows: 使用 taskkill /t 终止进程树
    try {
      await exec(`taskkill /f /t /pid ${pid}`, { timeout: timeoutMs })
      return true
    } catch {
      return killProcess(pid, timeoutMs)
    }
  }

  // Unix: 向进程组发送信号
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return killProcess(pid, timeoutMs)
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // 忽略
  }

  await new Promise(resolve => setTimeout(resolve, 500))
  return !isProcessRunning(pid)
}

/**
 * 检查命令是否存在（跨平台）
 */
export function commandExists(cmd: string): boolean {
  try {
    const locator = process.platform === 'win32' ? 'where' : 'which'
    execFileSync(locator, [cmd], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * 检查 tmux 是否可用
 */
export function isTmuxAvailable(): boolean {
  if (process.platform === 'win32') return false
  return commandExists('tmux')
}

/**
 * 检查是否在 Windows 终端中运行（支持会话管理）
 * Windows Terminal 支持类似 tmux 的标签页管理
 */
export function isWindowsTerminal(): boolean {
  if (process.platform !== 'win32') return false
  return !!process.env.WT_SESSION || !!process.env.WT_PROFILE_ID
}
