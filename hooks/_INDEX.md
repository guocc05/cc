# hooks
> **重要**：本目录结构或子文件职责变化时，必须更新此文件。

## 职责
本地 AI 工具（Claude / Codex / Gemini）CLI 的 hook 脚本——由 daemon 注入到工具的 settings.json 中，在 AI 调用特定工具时介入并桥接到 IM 端。

## 文件清单
- askuser-hook.mjs：Claude PreToolUse hook，拦截 AskUserQuestion 调用 → 通过 unix socket 与 daemon 通信 → 渲染为飞书卡片 / 微信文本，等待用户在 IM 上回答 → 把答案以 `hookSpecificOutput.permissionDecision: "allow" + updatedInput.answers` 注入回 Claude，让 AI 继续推进
