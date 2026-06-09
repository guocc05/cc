#!/usr/bin/env node
/**
 * Claude Code SessionStart hook（跨平台版）
 *
 * 输入：stdin JSON（session_id, cwd, transcript_path, source）
 * 输出：必要时更新 ~/.cc/data/registry.json 中的 Claude sessionId
 *
 * 选择目标会话名策略：
 * 1) 若在 tmux 且是 cc-* 命名，按 tmux 名精确映射（macOS 主路径）
 * 2) 否则按 payload.cwd 在 registry 中匹配唯一 Claude 会话（Windows 兜底）
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const logPath = path.join(os.homedir(), '.cc', 'logs', 'session-sync.log')
const registryPath = path.join(os.homedir(), '.cc', 'data', 'registry.json')

function log(message) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // hook 不应影响主流程
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8')
  } catch {
    return ''
  }
}

function normalizePath(p) {
  if (!p || typeof p !== 'string') return ''
  try {
    return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase()
  } catch {
    return p.replace(/[\\/]+$/, '').toLowerCase()
  }
}

function parseCcNameFromTmux() {
  if (!process.env.TMUX) return null
  const out = spawnSync('tmux', ['display-message', '-p', '#{session_name}'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (out.status !== 0) return null
  const tmuxName = (out.stdout || '').trim()
  if (!tmuxName.startsWith('cc-')) return null
  let name = tmuxName.slice('cc-'.length)
  if (name.startsWith('claude-') || name.startsWith('codex-') || name.startsWith('gemini-')) {
    name = name.slice(name.indexOf('-') + 1)
  }
  return name || null
}

function findNameByCwd(registry, hookCwd) {
  const normHook = normalizePath(hookCwd)
  if (!normHook) return null
  const candidates = Object.entries(registry)
    .filter(([, item]) => (item?.tool ?? 'claude') === 'claude')
    .filter(([, item]) => normalizePath(item?.cwd ?? '') === normHook)
    .map(([name]) => name)
  if (candidates.length !== 1) return null
  return candidates[0]
}

function main() {
  const raw = readStdin()
  let payload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch (err) {
    log(`ERROR: bad payload json: ${String(err)} raw=${raw.slice(0, 200)}`)
    return
  }

  const newSessionId = typeof payload.session_id === 'string' ? payload.session_id : ''
  const hookCwd = typeof payload.cwd === 'string' ? payload.cwd : ''
  const source = typeof payload.source === 'string' ? payload.source : ''
  if (!newSessionId) {
    log('SKIP: empty session_id')
    return
  }
  if (!fs.existsSync(registryPath)) {
    log(`SKIP: registry not found at ${registryPath}`)
    return
  }

  let registry = {}
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
  } catch (err) {
    log(`ERROR: bad registry json: ${String(err)}`)
    return
  }

  const fromTmux = parseCcNameFromTmux()
  const targetName = fromTmux || findNameByCwd(registry, hookCwd)
  if (!targetName) {
    log(`SKIP: cannot resolve session name (tmux=${fromTmux ?? 'none'}, cwd=${hookCwd || '(empty)'})`)
    return
  }

  const target = registry[targetName]
  if (!target) {
    log(`SKIP: name "${targetName}" not in registry`)
    return
  }
  const tool = target.tool ?? 'claude'
  if (tool !== 'claude') {
    log(`SKIP: "${targetName}" is ${tool}, not claude`)
    return
  }

  const currentSessionId = typeof target.sessionId === 'string' ? target.sessionId : ''
  if (!currentSessionId) {
    log(`SKIP: "${targetName}" has empty sessionId`)
    return
  }
  if (currentSessionId === newSessionId) {
    log(`SKIP: unchanged ${targetName} ${newSessionId.slice(0, 8)}`)
    return
  }

  for (const [otherName, other] of Object.entries(registry)) {
    if (otherName === targetName) continue
    if (other && typeof other === 'object' && other.sessionId === newSessionId) {
      log(`SKIP: ${newSessionId.slice(0, 8)} already owned by ${otherName}`)
      return
    }
  }

  target.sessionId = newSessionId
  target.lastUsedAt = new Date().toISOString()

  try {
    const tmp = `${registryPath}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(registry, null, 2))
    fs.renameSync(tmp, registryPath)
    log(`SUCCESS: ${targetName} ${currentSessionId.slice(0, 8)} -> ${newSessionId.slice(0, 8)} source=${source || 'unknown'}`)
  } catch (err) {
    log(`ERROR: write registry failed: ${String(err)}`)
  }
}

main()
