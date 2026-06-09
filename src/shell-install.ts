/**
 * @input:    shell rc 文件路径、已有内容
 * @output:   SHELL_MARKER_START/END、IM2CC_SHELL_FUNCTIONS、stripLegacyCcLines()、renderShellBlock()、writeShellHelpersToRc()
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

import fs from 'node:fs'

export const SHELL_MARKER_START = '# >>> cc shell helpers >>>'
export const SHELL_MARKER_END = '# <<< cc shell helpers <<<'

export const IM2CC_SHELL_FUNCTIONS = [
  'fn()       { cc new "$@"; }',
  'fn-codex() { cc new --tool codex "$@"; }',
  'fn-gemini(){ cc new --tool gemini "$@"; }',
  'fhelp()    { cc help; }',
  'fc()       { cc connect "$@"; }',
  'fl()       { cc list; }',
  'fk()       { cc delete "$@"; }',
  'fd()       { cc detach; }',
  'fs()       { cc show "$@"; }',
  'fqon()     { cc fqon "$@"; }',
  'fqoff()    { cc fqoff "$@"; }',
  'fqs()      { cc fqs "$@"; }',
].join('\n')

/** 清理历史安装留下的 cc 相关行（不依赖 marker 对的老格式）。*/
export function stripLegacyCcLines(content: string): string {
  const legacyPatterns: RegExp[] = [
    /^[ \t]*#[ \t]*cc[^\n]*\n?/gim,
    /^[ \t]*#[ \t]*(cc)?\s*—\s*终端命令[^\n]*\n?/gim,
    /^[ \t]*source[^\n]*cc-shell-functions[^\n]*\n?/gim,
    /^[ \t]*fn\s*\(\s*\)[ \t]*\{[^\n]*cc new[^\n]*\n?/gim,
    /^[ \t]*fn-[a-z]+\s*\(\s*\)[ \t]*\{[^\n]*cc[^\n]*\n?/gim,
    /^[ \t]*fhelp\s*\(\s*\)[ \t]*\{[^\n]*cc[^\n]*\n?/gim,
    /^[ \t]*fc\s*\(\s*\)[ \t]*\{[^\n]*cc connect[^\n]*\n?/gim,
    /^[ \t]*fl\s*\(\s*\)[ \t]*\{[^\n]*cc list[^\n]*\n?/gim,
    /^[ \t]*fk\s*\(\s*\)[ \t]*\{[^\n]*cc delete[^\n]*\n?/gim,
    /^[ \t]*fd\s*\(\s*\)[ \t]*\{[^\n]*cc detach[^\n]*\n?/gim,
    /^[ \t]*fs\s*\(\s*\)[ \t]*\{[^\n]*cc show[^\n]*\n?/gim,
    /^[ \t]*fq(on|off|s)\s*\(\s*\)[ \t]*\{[^\n]*cc[^\n]*\n?/gim,
  ]
  let out = content
  for (const p of legacyPatterns) out = out.replace(p, '')
  return out.replace(/\n{3,}/g, '\n\n')
}

/** 生成要注入的完整 block（含首尾 marker）。*/
export function renderShellBlock(): string {
  return [SHELL_MARKER_START, IM2CC_SHELL_FUNCTIONS, SHELL_MARKER_END].join('\n')
}

/** 计算新 rc 文件内容（纯函数，便于测试）。*/
export function computeUpdatedRcContent(existing: string): { content: string; action: 'created' | 'updated' | 'unchanged' } {
  const block = renderShellBlock()
  const blockRegex = new RegExp(`${SHELL_MARKER_START}[\\s\\S]*?${SHELL_MARKER_END}\\n?`, 'g')

  if (blockRegex.test(existing)) {
    const replaced = existing.replace(blockRegex, block + '\n')
    if (replaced === existing) return { content: existing, action: 'unchanged' }
    return { content: replaced, action: 'updated' }
  }

  let cleaned = stripLegacyCcLines(existing).trimEnd()
  if (cleaned.length > 0) cleaned += '\n'
  return { content: cleaned + '\n' + block + '\n', action: existing.length === 0 ? 'created' : 'updated' }
}

/** 写入 rc 文件，返回动作。*/
export function writeShellHelpersToRc(rc: string): 'created' | 'updated' | 'unchanged' {
  const existing = fs.existsSync(rc) ? fs.readFileSync(rc, 'utf-8') : ''
  const { content, action } = computeUpdatedRcContent(existing)
  if (action !== 'unchanged') {
    fs.writeFileSync(rc, content)
  }
  return action
}
