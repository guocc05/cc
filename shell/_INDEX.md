# shell
> **重要** 本目录结构或子文件职责变化时，必须更新此文件。

## 职责
Claude Code SessionStart hook 脚本。用户侧 fn/fc/fl 等 shell 函数现在直接由 `cc install-shell` 子命令写入 `~/.zshrc` / `~/.bashrc`，不再依赖文件分发。

## 文件清单
- cc-session-sync.sh：Claude Code SessionStart hook，覆盖 /clear、compact、resume 场景的 session 漂移同步，带结构化日志。Plan 模式在当前 Claude 版本已不再漂移（2026-04-17 实测验证），不需要额外兜底。由 `cc install-hook` 注册到 `~/.claude/settings.json`
