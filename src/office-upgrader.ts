/**
 * @input:    旧格式 office 文件路径 (.doc/.xls/.ppt), 目标新格式扩展名, 输出目录
 * @output:   upgradeOfficeLegacy() — 用 LibreOffice 升格到新格式 (.docx/.xlsx/.pptx)
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawnSync } from 'node:child_process'
import { log } from './logger.js'

export type LegacyTargetExt = 'docx' | 'xlsx' | 'pptx'

export type UpgradeResult =
  | { success: true; outPath: string }
  | { success: false; reason: string }

const SOFFICE_TIMEOUT_MS = 30_000

const SOFFICE_CANDIDATES = [
  'soffice',
  'libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
]

/** 串行化 soffice 调用：同一 user-profile 不能并发，否则会冲突 */
let chain: Promise<unknown> = Promise.resolve()

export async function upgradeOfficeLegacy(
  srcPath: string,
  targetExt: LegacyTargetExt,
  outDir: string,
): Promise<UpgradeResult> {
  const job = chain.then(() => runUpgradeOnce(srcPath, targetExt, outDir))
  // 把当前 job 接到 chain 末尾（无论成功失败都让下一个继续）
  chain = job.catch(() => undefined)
  return job
}

async function runUpgradeOnce(
  srcPath: string,
  targetExt: LegacyTargetExt,
  outDir: string,
): Promise<UpgradeResult> {
  const soffice = resolveSoffice()
  if (!soffice) {
    return { success: false, reason: 'LibreOffice 未安装（缺 soffice 命令）' }
  }

  if (!fs.existsSync(srcPath)) {
    return { success: false, reason: `源文件不存在: ${srcPath}` }
  }

  fs.mkdirSync(outDir, { recursive: true })

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-soffice-'))
  const profileUri = 'file://' + profileDir

  const args = [
    '--headless',
    `-env:UserInstallation=${profileUri}`,
    '--convert-to', targetExt,
    '--outdir', outDir,
    srcPath,
  ]

  log(`[office-upgrader] ${path.basename(srcPath)} → .${targetExt}`)

  try {
    const { stderr } = await execFilePromise(soffice, args, SOFFICE_TIMEOUT_MS)

    const expectedName = path.basename(srcPath, path.extname(srcPath)) + '.' + targetExt
    const expectedPath = path.join(outDir, expectedName)
    if (!fs.existsSync(expectedPath)) {
      const tail = (stderr || '').split('\n').filter(l => l.trim()).pop() || '未知错误'
      return { success: false, reason: `soffice 未产出预期文件: ${tail.slice(0, 200)}` }
    }

    return { success: true, outPath: expectedPath }
  } catch (err) {
    return { success: false, reason: formatExecError(err) }
  } finally {
    try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

function resolveSoffice(): string | null {
  for (const candidate of SOFFICE_CANDIDATES) {
    if (candidate.startsWith('/')) {
      if (fs.existsSync(candidate)) return candidate
    } else {
      // 通过 spawn 探测能否找到（PATH 解析）
      try {
        const res = spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 5000 })
        if (res.status === 0) return candidate
      } catch { /* try next */ }
    }
  }
  return null
}

function execFilePromise(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
        if (e.killed && e.signal === 'SIGTERM') {
          reject(new Error(`升格超时 (${timeoutMs}ms)`))
          return
        }
        reject(Object.assign(err, { stderr: String(stderr || '') }))
        return
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

function formatExecError(err: unknown): string {
  if (err instanceof Error) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    if (e.code === 'ENOENT') return 'LibreOffice 未安装（soffice ENOENT）'
    if (e.message.includes('升格超时')) return e.message
    const tail = (e.stderr || '').split('\n').filter(l => l.trim()).pop() || e.message
    return `soffice 失败: ${tail.slice(0, 200)}`
  }
  return `soffice 失败: ${String(err).slice(0, 200)}`
}

/** 仅供测试使用 — 重置串行 chain（避免单测之间互相污染） */
export function _resetUpgraderChainForTest(): void {
  chain = Promise.resolve()
}

/** 仅供测试使用 — 探测 soffice 是否在系统中可用 */
export function _resolveSofficeForTest(): string | null {
  return resolveSoffice()
}
