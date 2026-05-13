// 回归测试：syncDriftedSession 只对 Codex 生效
// 历史 bug (2026-04-16)：Claude 分支基于 mtime 启发式会把 SparkChat fork 的 jsonl 当成漂移目标，替换 registry 中的主对话 session ID
// 方案 G (2026-04-17)：Claude 分支下线，漂移同步全权交给 SessionStart hook

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'im2cc-sync-drift-home-'))
process.env.HOME = testHome
process.on('exit', () => {
  fs.rmSync(testHome, { recursive: true, force: true })
})

const { syncDriftedSession } = await import('../dist/src/discover.js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function mkTempClaudeSlug() {
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'im2cc-sync-drift-'))
  const slug = '-' + tmpCwd.replace(/^\//, '').replaceAll('/', '-')
  const slugDir = path.join(os.homedir(), '.claude', 'projects', slug)
  fs.mkdirSync(slugDir, { recursive: true })
  return { tmpCwd, slugDir }
}

function cleanup({ tmpCwd, slugDir }) {
  fs.rmSync(slugDir, { recursive: true, force: true })
  fs.rmSync(tmpCwd, { recursive: true, force: true })
}

// Case 1: fork 的 jsonl mtime 比 registry 记录的 session 新 → claude 分支不再漂移
{
  const { tmpCwd, slugDir } = mkTempClaudeSlug()
  const mainSid = '11111111-1111-1111-1111-111111111111'
  const forkSid = '22222222-2222-2222-2222-222222222222'
  try {
    fs.writeFileSync(path.join(slugDir, `${mainSid}.jsonl`), '{"type":"user"}\n')
    fs.writeFileSync(path.join(slugDir, `${forkSid}.jsonl`), '{"type":"user"}\n')
    const now = Date.now()
    fs.utimesSync(path.join(slugDir, `${mainSid}.jsonl`), new Date(now - 60_000), new Date(now - 60_000))
    fs.utimesSync(path.join(slugDir, `${forkSid}.jsonl`), new Date(now), new Date(now))

    const activeNames = [{ name: 'test', sessionId: mainSid, cwd: tmpCwd, tool: 'claude' }]
    const result = syncDriftedSession('test', mainSid, tmpCwd, activeNames, 'claude')
    if (result !== null) throw new Error(`expected null, got ${result}`)
    console.log('PASS: claude 分支对 fork 干扰返回 null')
  } finally { cleanup({ tmpCwd, slugDir }) }
}

// Case 2: claude slug 目录不存在也不抛错
{
  const activeNames = []
  const result = syncDriftedSession('ghost', 'deadbeef-dead-beef-dead-beefdeadbeef', '/tmp/non-existent-' + Date.now(), activeNames, 'claude')
  if (result !== null) throw new Error(`expected null for missing slug, got ${result}`)
  console.log('PASS: claude 分支对不存在的 slug 返回 null')
}

// Case 3: codex 分支仍然存在且对不存在的 session 目录返回 null（不抛异常）
{
  const result = syncDriftedSession('ghost', '019d0000-0000-0000-0000-000000000000', '/tmp/non-existent-codex-' + Date.now(), [], 'codex')
  if (result !== null) throw new Error(`expected null for codex non-existent, got ${result}`)
  console.log('PASS: codex 分支对不存在的 session 返回 null')
}

console.log('')
console.log('✅ sync-drift 回归测试通过')
