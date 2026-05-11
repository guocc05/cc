/**
 * @input:    结构化出站消息或系统回复文本
 * @output:   消息结构推断与 transport 渲染（飞书 post / 纯文本降级）
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import type { InteractiveCardMessage, MessageSection, OutgoingMessage, PanelMessage } from './transport.js'

const PANEL_MAX_CHARS = 12_000
const PANEL_MAX_LINES = 120
const SECTION_BREAK_RE = /^[─-]{3,}$/

export function textMessage(text: string): OutgoingMessage {
  return { kind: 'text', text }
}

export function panelMessage(title: string, sections: MessageSection[]): PanelMessage {
  return {
    kind: 'panel',
    title: title.trim(),
    sections: sections
      .map(section => ({
        title: section.title?.trim() || undefined,
        lines: section.lines.map(line => line.trimEnd()).filter(Boolean),
      }))
      .filter(section => section.lines.length > 0),
  }
}

function splitSections(lines: string[]): string[][] {
  const sections: string[][] = []
  let current: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line.trim() || SECTION_BREAK_RE.test(line.trim())) {
      if (current.length > 0) {
        sections.push(current)
        current = []
      }
      continue
    }
    current.push(line)
  }

  if (current.length > 0) sections.push(current)
  return sections
}

export function structureSystemReply(text: string): OutgoingMessage {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return textMessage('')
  if (normalized.length > PANEL_MAX_CHARS) return textMessage(normalized)

  const lines = normalized.split('\n')
  if (lines.length < 2 || lines.length > PANEL_MAX_LINES) return textMessage(normalized)

  const title = lines[0].trim()
  if (!title) return textMessage(normalized)

  const sections = splitSections(lines.slice(1)).map(section => {
    const [first, ...rest] = section
    if (rest.length > 0 && first.trim().endsWith('：')) {
      return { title: first.trim().slice(0, -1), lines: rest }
    }
    return { lines: section }
  })

  if (sections.length === 0) return textMessage(normalized)
  return panelMessage(title, sections)
}

/**
 * 渲染 AI 反向提问为文本（飞书 + 微信共用 — 跨 transport 信息架构一致）。
 *
 * 五要素：
 *   1) 标识：首行 🤔 Claude 想问你（可选 ❌ 卡片渲染失败标识）
 *   2) 问题：question 主体
 *   3) 选项：1) 2) 3) 编号列表
 *   4) Other 入口：✏️ 直接回复编号或你的自定义答案（仅 allowFreeText=true）
 *   5) 超时提示：⏱ N 分钟内未回复将自动继续
 *
 * 设计依据见 DESIGN_SYSTEM.md §2 跨 transport 一致性规范、ARCHITECTURE.md §5.3。
 */
export function buildAskUserText(message: InteractiveCardMessage): string {
  const headerSuffix = message.degradedNote ? '（卡片渲染失败，已降级）' : ''
  const lines: string[] = [`🤔 Claude 想问你${headerSuffix}`, '', message.question]

  if (message.options.length > 0) {
    lines.push('')
    message.options.forEach((o, i) => lines.push(`  ${i + 1}) ${o.label}`))
  }

  const tail: string[] = []
  if (message.allowFreeText) tail.push('✏️ 直接回复编号或你的自定义答案')
  if (message.timeoutHint) tail.push(`⏱ ${message.timeoutHint}内未回复将自动继续`)
  if (tail.length > 0) {
    lines.push('')
    lines.push(...tail)
  }

  return lines.join('\n').trim()
}

export function renderOutgoingMessageAsText(message: OutgoingMessage): string {
  if (message.kind === 'text') return message.text
  if (message.kind === 'interactive_card') return buildAskUserText(message)

  const lines = [message.title]
  for (const section of message.sections) {
    if (section.title || section.lines.length > 0) lines.push('')
    if (section.title) lines.push(`${section.title}：`)
    lines.push(...section.lines)
  }
  return lines.join('\n').trim()
}

// 注：原实现字符类 `[*_~`\\[\\]()>#+|]` 中 `\\]` 被解析为「转义反斜杠 + `]` 关闭类」，
// 导致 `( ) > # + |` 实际落在类外，不会被转义。用正确的 `\[` `\]` 转义 + 单次 replace。
function escapeFeishuMd(text: string): string {
  return text.replace(/[\\*_~`\[\]()>#+|]/g, '\\$&')
}

function escapeInlineCode(text: string): string {
  return text.replace(/`/g, '\\`')
}

function formatLineForFeishuMd(line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return ''

  const commandMatch = trimmed.match(/^(.+?)\s+—\s+(.+)$/)
  if (commandMatch) {
    return `- \`${escapeInlineCode(commandMatch[1].trim())}\` — ${escapeFeishuMd(commandMatch[2].trim())}`
  }

  const keyValueMatch = trimmed.match(/^([^：]{1,24})：\s*(.+)$/)
  if (keyValueMatch) {
    return `- **${escapeFeishuMd(keyValueMatch[1].trim())}：** ${escapeFeishuMd(keyValueMatch[2].trim())}`
  }

  return `- ${escapeFeishuMd(trimmed)}`
}

export function buildFeishuMessage(message: OutgoingMessage): { msgType: 'text' | 'post', content: string } {
  if (message.kind === 'text') {
    return {
      msgType: 'text',
      content: JSON.stringify({ text: message.text }),
    }
  }

  // interactive_card 不在此函数处理范围 — Phase 2 中由 feishu.ts 直接走 msg_type=interactive 路径。
  // 调用方应在 sendMessage 入口分流；走到这里说明发生了未预期的降级，给出可见 fallback 文本。
  if (message.kind === 'interactive_card') {
    return {
      msgType: 'text',
      content: JSON.stringify({ text: renderOutgoingMessageAsText(message) }),
    }
  }

  const content = message.sections.map(section => {
    const lines: string[] = []
    if (section.title) lines.push(`**${escapeFeishuMd(section.title)}**`)
    lines.push(...section.lines.map(formatLineForFeishuMd).filter(Boolean))
    return [{ tag: 'md', text: lines.join('\n') }]
  })

  return {
    msgType: 'post',
    content: JSON.stringify({
      zh_cn: {
        title: message.title,
        content,
      },
    }),
  }
}
