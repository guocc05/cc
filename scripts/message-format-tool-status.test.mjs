/**
 * tool_status 文案 4 档模板单测 (DESIGN_SYSTEM §2.1)
 * 引入: @20260512-im-tool-call-progress
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const modulePath = path.join(rootDir, 'dist', 'src', 'message-format.js')

test('档 1: 单 tool 单次 → "⚙️ 正在执行 <name>"', async () => {
  const { buildToolStatusText } = await import(modulePath)
  const text = buildToolStatusText({ kind: 'tool_status', toolNames: ['Bash'], toolCount: 1 })
  assert.equal(text, '⚙️ 正在执行 Bash')
})

test('档 2: 单 tool 多次 → "⚙️ 正在执行 <name> (共 N 次)"', async () => {
  const { buildToolStatusText } = await import(modulePath)
  const text = buildToolStatusText({ kind: 'tool_status', toolNames: ['Bash'], toolCount: 3 })
  assert.equal(text, '⚙️ 正在执行 Bash (共 3 次)')
})

test('档 3: 2-3 个 unique tool → "⚙️ 正在执行 A, B, C"', async () => {
  const { buildToolStatusText } = await import(modulePath)
  const t2 = buildToolStatusText({ kind: 'tool_status', toolNames: ['Bash', 'Read'], toolCount: 2 })
  assert.equal(t2, '⚙️ 正在执行 Bash, Read')

  const t3 = buildToolStatusText({ kind: 'tool_status', toolNames: ['Bash', 'Read', 'Grep'], toolCount: 3 })
  assert.equal(t3, '⚙️ 正在执行 Bash, Read, Grep')
})

test('档 4: > 3 个 unique tool → "⚙️ 正在执行 A, B, C 等 N 项"', async () => {
  const { buildToolStatusText } = await import(modulePath)
  const text = buildToolStatusText({
    kind: 'tool_status',
    toolNames: ['Bash', 'Read', 'Grep', 'Edit', 'Glob'],
    toolCount: 8,
  })
  assert.equal(text, '⚙️ 正在执行 Bash, Read, Grep 等 8 项')
})

test('renderOutgoingMessageAsText 路由 tool_status 到 buildToolStatusText', async () => {
  const { renderOutgoingMessageAsText } = await import(modulePath)
  const text = renderOutgoingMessageAsText({
    kind: 'tool_status',
    toolNames: ['Bash'],
    toolCount: 1,
  })
  assert.equal(text, '⚙️ 正在执行 Bash')
})

test('buildFeishuMessage 对 tool_status 走 text msg_type', async () => {
  const { buildFeishuMessage } = await import(modulePath)
  const payload = buildFeishuMessage({
    kind: 'tool_status',
    toolNames: ['Bash', 'Read'],
    toolCount: 2,
  })
  assert.equal(payload.msgType, 'text')
  const content = JSON.parse(payload.content)
  assert.equal(content.text, '⚙️ 正在执行 Bash, Read')
})
