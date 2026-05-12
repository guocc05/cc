/**
 * @input:    tmux session 名（im2cc-${tool}-${name} 格式）
 * @output:   tmuxExactTarget(name) — 返回 `=${name}` 强制精确匹配的 -t 参数
 * @rule:     如本文件 @input 或 @output 发生变化，必须更新本注释并检查 _INDEX.md
 */

/**
 * 构造 tmux `-t` 精确匹配的 target-session 参数。
 *
 * tmux 的 `-t target-session` 默认采用 prefix match（前缀模糊匹配），
 * 当 session 名互为前缀时（如 `im2cc-claude-im2cc` 与 `im2cc-claude-im2cc01`），
 * 会导致 has-session / kill-session / attach 等命令误中其他 session。
 *
 * 参考 man tmux: "If a target is prefixed with '=', a fuzzy match isn't used".
 *
 * **所有 `tmux ... -t <name>` 调用都必须经此函数包装**，参见
 * ARCHITECTURE.md §4.2 红线（@20260512-fc-tmux-client-preempt 引入）。
 */
export function tmuxExactTarget(name: string): string {
  return `=${name}`
}
