/**
 * @input:    ~/.cc/daemon.pid, ~/.cc/daemon.lock/, pgrep/ps 系统命令 或 Windows wmic/tasklist
 * @output:   守护进程识别（listDaemonProcessPids, isCcDaemonProcess）、清理（killAllDaemonProcesses）、PID/锁元数据读写
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { getPidFile, getDaemonLockDir } from './config.js'
import { findProcesses, isProcessRunning, killProcess, type ProcessInfo } from './process-utils.js'
import { log } from './logger.js'

export const DAEMON_MARKER = 'cc-daemon'
export const DAEMON_PROCESS_TITLE = 'cc-daemon'
export const DAEMON_LOCK_STARTUP_GRACE_MS = 30_000

const LEGACY_DAEMON_ENTRY_SHORT_PATH = 'cc/dist/src/index.js'

export interface DaemonPidRecord {
  pid: number | null
  present: boolean
}

export interface DaemonProcessIdentity {
  command: string | null
  comm: string | null
}

export function daemonMainModulePath(): string {
  return path.resolve(import.meta.dirname, 'index.js')
}

export function daemonLockMetaFile(): string {
  return path.join(getDaemonLockDir(), 'owner.json')
}

function normalizeProcessCommand(command: string): string {
  return command.replace(/\\/g, '/')
}

function parsePositivePid(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/**
 * 跨平台列出匹配 pattern 的进程 PID
 */
async function listPidsFromPattern(pattern: string): Promise<number[]> {
  const processes = await findProcesses(pattern)
  return processes.map(p => p.pid).filter(pid => pid !== process.pid)
}

export function inspectProcess(pid: number): 'running' | 'missing' {
  return isProcessRunning(pid) ? 'running' : 'missing'
}

/**
 * 检查进程命令行是否看起来像 cc daemon
 */
function processInfoLooksLikeCcDaemon(info: ProcessInfo, entryPath: string): boolean {
  if (info.name === DAEMON_PROCESS_TITLE) return true

  const normalizedCmd = normalizeProcessCommand(info.cmd)
  const normalizedEntryPath = normalizeProcessCommand(entryPath)

  return normalizedCmd.includes(DAEMON_MARKER)
    || normalizedCmd.includes(normalizedEntryPath)
    || normalizedCmd.includes(LEGACY_DAEMON_ENTRY_SHORT_PATH)
    || normalizedCmd.includes('cc/dist/src/index.js')
}

/**
 * 同步版本的进程检查（用于启动时快速判断）
 * 仅检查 PID 文件中记录的进程是否仍在运行
 */
export function isCcDaemonProcessSync(pid: number, entryPath: string = daemonMainModulePath()): boolean {
  if (!isProcessRunning(pid)) return false

  // Windows 下对已知 PID 做保守识别：进程存活即认为是 daemon
  // 因为 Windows 下获取进程命令行需要异步操作，启动时性能优先
  if (process.platform === 'win32') return true

  // Unix 下尝试读取进程信息
  try {
    const comm = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf-8', timeout: 3000 }).trim()
    if (comm === DAEMON_PROCESS_TITLE) return true

    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf-8', timeout: 3000 }).trim()
    const normalizedCmd = normalizeProcessCommand(command)
    const normalizedEntryPath = normalizeProcessCommand(entryPath)

    return normalizedCmd.includes(DAEMON_MARKER)
      || normalizedCmd.includes(normalizedEntryPath)
      || normalizedCmd.includes(LEGACY_DAEMON_ENTRY_SHORT_PATH)
  } catch {
    return false
  }
}

/**
 * 异步版本的 daemon 进程检查（更准确）
 */
export async function isCcDaemonProcessAsync(pid: number, entryPath: string = daemonMainModulePath()): Promise<boolean> {
  if (!isProcessRunning(pid)) return false

  const processes = await findProcesses(`pid:${pid}`)
  if (processes.length === 0) {
    // Windows 下 findProcesses 可能找不到精确 pid 匹配，保守返回 true
    return process.platform === 'win32'
  }

  return processInfoLooksLikeCcDaemon(processes[0], entryPath)
}

/**
 * 兼容旧 API 的同步版本（已废弃，建议使用异步版本）
 * @deprecated 使用 isCcDaemonProcessSync 或 isCcDaemonProcessAsync
 */
export function isCcDaemonProcess(pid: number, entryPath: string = daemonMainModulePath()): boolean {
  return isCcDaemonProcessSync(pid, entryPath)
}

export function commandLooksLikeCcDaemon(identity: DaemonProcessIdentity, entryPath: string = daemonMainModulePath()): boolean {
  if (identity.comm === DAEMON_PROCESS_TITLE) return true
  if (!identity.command) return false

  const normalizedCommand = normalizeProcessCommand(identity.command)
  const normalizedEntryPath = normalizeProcessCommand(entryPath)

  return normalizedCommand.includes(DAEMON_MARKER)
    || normalizedCommand.includes(normalizedEntryPath)
    || normalizedCommand.includes(LEGACY_DAEMON_ENTRY_SHORT_PATH)
}

/**
 * 同步列出 daemon 进程 PID（快速但可能不完整）
 * 用于启动时的快速检查
 */
export function listDaemonProcessPidsSync(entryPath: string = daemonMainModulePath(), excludePid: number = process.pid): number[] {
  const candidates = new Set<number>()

  // 从 PID 文件和 lock 元数据中读取已知 PID
  const recordedPid = readDaemonPidRecord().pid
  if (recordedPid !== null && recordedPid !== excludePid) {
    if (isCcDaemonProcessSync(recordedPid, entryPath)) {
      candidates.add(recordedPid)
    }
  }

  // Unix 下使用 pgrep 补充
  if (process.platform !== 'win32') {
    const patterns = [DAEMON_PROCESS_TITLE, DAEMON_MARKER, entryPath, LEGACY_DAEMON_ENTRY_SHORT_PATH]
    for (const pattern of patterns) {
      try {
        const output = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf-8', timeout: 3000 }).trim()
        for (const line of output.split('\n')) {
          const pid = parseInt(line.trim(), 10)
          if (Number.isInteger(pid) && pid > 0 && pid !== excludePid) {
            if (isCcDaemonProcessSync(pid, entryPath)) {
              candidates.add(pid)
            }
          }
        }
      } catch {
        // pgrep 失败，忽略
      }
    }
  }

  return [...candidates]
}

/**
 * 异步列出所有 daemon 进程 PID（完整但较慢）
 */
export async function listDaemonProcessPidsAsync(entryPath: string = daemonMainModulePath(), excludePid: number = process.pid): Promise<number[]> {
  const candidates = new Set<number>()

  // 从 PID 文件和 lock 元数据中读取已知 PID
  const recordedPid = readDaemonPidRecord().pid
  if (recordedPid !== null && recordedPid !== excludePid) {
    candidates.add(recordedPid)
  }

  // 通过进程模式搜索
  const patterns = [DAEMON_PROCESS_TITLE, DAEMON_MARKER]
  for (const pattern of patterns) {
    const processes = await findProcesses(pattern)
    for (const proc of processes) {
      if (proc.pid !== excludePid && processInfoLooksLikeCcDaemon(proc, entryPath)) {
        candidates.add(proc.pid)
      }
    }
  }

  // 搜索入口文件路径
  const entryProcesses = await findProcesses(entryPath)
  for (const proc of entryProcesses) {
    if (proc.pid !== excludePid) {
      candidates.add(proc.pid)
    }
  }

  const legacyProcesses = await findProcesses(LEGACY_DAEMON_ENTRY_SHORT_PATH)
  for (const proc of legacyProcesses) {
    if (proc.pid !== excludePid) {
      candidates.add(proc.pid)
    }
  }

  return [...candidates].filter(pid => isProcessRunning(pid))
}

/**
 * 兼容旧 API 的同步版本
 * @deprecated 使用 listDaemonProcessPidsSync 或 listDaemonProcessPidsAsync
 */
export function listDaemonProcessPids(entryPath: string = daemonMainModulePath(), excludePid: number = process.pid): number[] {
  return listDaemonProcessPidsSync(entryPath, excludePid)
}

/**
 * 异步杀死所有检测到的 cc 守护进程（跨平台）
 * 返回被杀死的 PID 列表。
 */
export async function killAllDaemonProcessesAsync(
  entryPath: string = daemonMainModulePath(),
  excludePid: number = process.pid,
  gracePeriodMs: number = 3000,
): Promise<number[]> {
  const pids = await listDaemonProcessPidsAsync(entryPath, excludePid)
  if (pids.length === 0) return []

  // 终止所有进程
  const killed: number[] = []
  for (const pid of pids) {
    const success = await killProcess(pid, gracePeriodMs)
    if (success) killed.push(pid)
  }

  return killed
}

/**
 * 同步杀死所有检测到的 cc 守护进程（兼容旧 API）
 * 返回被杀死的 PID 列表。
 */
export function killAllDaemonProcesses(
  entryPath: string = daemonMainModulePath(),
  excludePid: number = process.pid,
  gracePeriodMs: number = 3000,
): number[] {
  const pids = listDaemonProcessPidsSync(entryPath, excludePid)
  if (pids.length === 0) return []

  // Windows 下无法同步等待，直接发终止信号
  if (process.platform === 'win32') {
    for (const pid of pids) {
      try {
        execFileSync('taskkill', ['/f', '/pid', String(pid)], { stdio: 'ignore', timeout: 5000 })
      } catch {
        // 忽略错误
      }
    }
    return pids
  }

  // Unix: Phase 1: SIGTERM
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM') } catch (err) { log(`[daemon-process] SIGTERM pid ${pid} 失败 (忽略): ${err instanceof Error ? err.message : String(err)}`) }
  }

  // Phase 2: wait and verify
  const deadline = Date.now() + gracePeriodMs
  const survivors: number[] = []
  while (Date.now() < deadline) {
    survivors.length = 0
    for (const pid of pids) {
      if (isProcessRunning(pid)) survivors.push(pid)
    }
    if (survivors.length === 0) break
    // busy-wait with short sleep (synchronous, acceptable during startup)
    try { execFileSync('sleep', ['0.2'], { stdio: 'ignore' }) } catch (err) { /* sleep 失败不影响流程 */ }
  }

  // Phase 3: SIGKILL for survivors
  for (const pid of survivors) {
    try { process.kill(pid, 'SIGKILL') } catch (err) { log(`[daemon-process] SIGKILL pid ${pid} 失败 (忽略): ${err instanceof Error ? err.message : String(err)}`) }
  }

  return pids
}

export function readDaemonPidRecord(): DaemonPidRecord {
  let present = false

  const lockMetaFile = daemonLockMetaFile()
  if (fs.existsSync(lockMetaFile)) {
    present = true
    try {
      const raw = JSON.parse(fs.readFileSync(lockMetaFile, 'utf-8')) as Record<string, unknown>
      const pid = parsePositivePid(raw.pid)
      if (pid !== null) return { pid, present: true }
    } catch (err) { log(`[daemon-process] 读取 lock meta 失败 (忽略): ${err instanceof Error ? err.message : String(err)}`) }
  }

  const pidFile = getPidFile()
  if (fs.existsSync(pidFile)) {
    present = true
    const parsed = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
    if (Number.isInteger(parsed) && parsed > 0) {
      return { pid: parsed, present: true }
    }
  }

  return { pid: null, present }
}

export function prepareDaemonProcessIdentity(): void {
  try {
    process.title = DAEMON_PROCESS_TITLE
  } catch (err) { log(`[daemon-process] 设置 process.title 失败 (忽略): ${err instanceof Error ? err.message : String(err)}`) }
}

export function isDaemonEntrypointInvocation(argv: string[], entryPath: string = daemonMainModulePath()): boolean {
  return argv[1] === entryPath || argv.includes(DAEMON_MARKER)
}
