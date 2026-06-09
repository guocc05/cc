#!/usr/bin/env node
/**
 * @input:    Claude PreToolUse hook event JSON (via stdin), env IM2CC_SESSION_ID / IM2CC_CONVERSATION_ID / IM2CC_ASKUSER_SOCKET / IM2CC_ASKUSER_TIMEOUT_MS
 * @output:   stdout 输出 hookSpecificOutput JSON（permissionDecision: "allow" + updatedInput.answers），让 Claude 用注入的"用户答案"继续推进
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新 hooks/_INDEX.md
 *
 * 工作机制：
 *   1. 读 stdin → 解析 hook event；非 AskUserQuestion 直接放行
 *   2. 连 ~/.cc/sockets/askuser.sock，串行处理每个 question：发 ask → 等 answer/timeout/cancelled
 *   3. 把所有 answers 合并成 updatedInput.answers，输出 hookSpecificOutput JSON
 *   4. 任意 socket 错误 / daemon 不在 → 兜底 allow + answer = "[守护进程不可达]..."（避免 AI 卡死）
 *
 * Claude command hook 默认 600 秒硬超时；我们让 IM 端默认 8 分钟即可，daemon 侧严格夹紧到 1-9。
 */

import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { stdin } from 'node:process'

const FALLBACK_ANSWER_DAEMON_DOWN = '[守护进程不可达] 用户未能收到提问，请基于现有信息做合理假设并标注'
const FALLBACK_ANSWER_TIMEOUT = '[已超时] 用户未回复，请基于现有信息做合理假设并标注'
const FALLBACK_ANSWER_CANCELLED = '[用户已中断] 当前任务已被用户中断，请停止当前推进'

const SOCKET_PATH = process.env.IM2CC_ASKUSER_SOCKET
  ?? path.join(os.homedir(), '.cc', 'sockets', 'askuser.sock')
const SESSION_ID = process.env.IM2CC_SESSION_ID ?? ''
const CONVERSATION_ID = process.env.IM2CC_CONVERSATION_ID ?? ''

// hook 自身硬超时（兜底）。daemon 侧已有 1-9 分钟夹紧；这里多 30 秒 buffer。
const HOOK_HARD_TIMEOUT_MS = Number(process.env.IM2CC_ASKUSER_TIMEOUT_MS ?? 9 * 60 * 1000) + 30_000

// 调试日志（可关）
const DEBUG_LOG = process.env.IM2CC_ASKUSER_HOOK_LOG ?? ''
function debug(label, data) {
  if (!DEBUG_LOG) return
  try {
    const line = `[${new Date().toISOString()}] ${label}: ${typeof data === 'string' ? data : JSON.stringify(data)}\n`
    fs.appendFileSync(DEBUG_LOG, line)
  } catch {}
}

async function readStdin() {
  let raw = ''
  for await (const chunk of stdin) raw += chunk
  return raw
}

function emitOutput(answers, questions) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: {
        questions,
        answers,
      },
    },
  }
  debug('HOOK_OUTPUT', output)
  process.stdout.write(JSON.stringify(output))
  process.exit(0)
}

function emitPassThrough() {
  // 非 AskUserQuestion 工具：什么都不输出，让 Claude 走默认路径
  process.exit(0)
}

/**
 * 串行问一个 question，返回 daemon 注入的 answer 字符串。
 * - daemon 不可达：返回 fallback 字符串（不卡死 AI）
 * - timeout / cancelled：daemon 会给我们正确的 answer payload，直接转交
 */
function askOne(toolUseId, q) {
  return new Promise((resolve) => {
    let resolved = false
    const finish = (answer) => {
      if (resolved) return
      resolved = true
      try { socket.end() } catch {}
      resolve(answer)
    }

    const socket = net.createConnection(SOCKET_PATH)
    let buffer = ''

    const hardTimer = setTimeout(() => {
      debug('HOOK_HARD_TIMEOUT', { toolUseId })
      finish(FALLBACK_ANSWER_TIMEOUT)
    }, HOOK_HARD_TIMEOUT_MS)

    socket.on('connect', () => {
      const askMsg = {
        type: 'ask',
        toolUseId,
        sessionId: SESSION_ID,
        conversationId: CONVERSATION_ID,
        question: q.question ?? '',
        options: Array.isArray(q.options) ? q.options.map((o) => ({
          label: typeof o === 'string' ? o : (o.label ?? ''),
          header: typeof o === 'object' && o ? o.header : undefined,
        })) : [],
        multiSelect: Boolean(q.multiSelect),
      }
      debug('SEND_ASK', askMsg)
      socket.write(JSON.stringify(askMsg) + '\n')
    })

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8')
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        debug('RECV', msg)
        if (msg.type === 'answer' && msg.toolUseId === toolUseId) {
          clearTimeout(hardTimer)
          finish(String(msg.answer ?? ''))
          return
        }
        if (msg.type === 'timeout' && msg.toolUseId === toolUseId) {
          clearTimeout(hardTimer)
          finish(String(msg.reason ?? FALLBACK_ANSWER_TIMEOUT))
          return
        }
        if (msg.type === 'cancelled' && msg.toolUseId === toolUseId) {
          clearTimeout(hardTimer)
          finish(String(msg.reason ?? FALLBACK_ANSWER_CANCELLED))
          return
        }
      }
    })

    socket.on('error', (err) => {
      clearTimeout(hardTimer)
      debug('SOCKET_ERROR', String(err?.message ?? err))
      finish(FALLBACK_ANSWER_DAEMON_DOWN)
    })

    socket.on('close', () => {
      // 如果还没拿到 answer，且 hardTimer 没触发，对端主动断开 → 视为 daemon 失联
      if (!resolved) {
        clearTimeout(hardTimer)
        finish(FALLBACK_ANSWER_DAEMON_DOWN)
      }
    })
  })
}

async function main() {
  const raw = await readStdin()
  debug('STDIN_RAW', raw)

  let hookInput
  try {
    hookInput = JSON.parse(raw)
  } catch (e) {
    debug('PARSE_ERROR', String(e))
    emitPassThrough()
    return
  }

  if (hookInput.tool_name !== 'AskUserQuestion') {
    emitPassThrough()
    return
  }

  const questions = Array.isArray(hookInput.tool_input?.questions)
    ? hookInput.tool_input.questions
    : []

  if (questions.length === 0) {
    emitOutput({}, questions)
    return
  }

  const answers = {}
  for (const q of questions) {
    // 每个 question 一个独立 toolUseId 后缀（同一个 hook 调用复用 hook event 的 tool_use_id 主键 + 序号）
    const baseId = hookInput.tool_use_id ?? crypto.randomUUID()
    const idx = questions.indexOf(q)
    const toolUseId = questions.length === 1 ? baseId : `${baseId}#${idx}`
    const ans = await askOne(toolUseId, q)
    answers[q.question ?? ''] = ans
  }

  emitOutput(answers, questions)
}

main().catch((err) => {
  debug('FATAL', String(err?.stack ?? err))
  // 兜底放行，避免 AI 卡死
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { questions: [], answers: {} },
    },
  }))
  process.exit(0)
})
