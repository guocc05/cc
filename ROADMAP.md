# Product Roadmap

> Feature 的 state / version 事实源是各 feature 的 frontmatter。
> 本文件是人工可读的索引视图，由 /go（append）和 /go review（reorder）同步维护。
> 不允许本文件单方面覆盖 feature frontmatter。

## Unscheduled

- [x] IM 端 office 文档（PDF/Word/Excel/PPT）传输与解析 — `@20260510-office-doc-relay`
- [x] fix — classifyFile 无扩展名早返回，遮蔽 Dockerfile/Makefile 分类 — `@20260510-fix-classify-no-ext-shadow`
- [ ] IM 端透传 AI 工具内置斜杠命令 — `@20260510-im-slash-passthrough`
- [x] IM 端处理 AI 工具反向提问（AskUserQuestion 桥接） — `@20260510-im-askuserquestion-bridge`

## Archive

<!-- abandoned features -->

## Revision log

| Date | Role | Action |
|---|---|---|
| 2026-05-10 | go | bootstrap ROADMAP；登记 @20260510-office-doc-relay (Unscheduled) |
| 2026-05-10 | pm | @20260510-office-doc-relay consolidate 完成 → spec_ready；handoff /cto |
| 2026-05-10 | cto | @20260510-office-doc-relay §Plan 终稿；bootstrap ARCHITECTURE.md；handoff /builder |
| 2026-05-10 | builder | @20260510-office-doc-relay 进入 building；阶段一代码完成（V0+V1）；登记衍生 fix @20260510-fix-classify-no-ext-shadow（spec_ready 待用户单 session 修复）|
| 2026-05-10 | builder | @20260510-office-doc-relay → iterating；spec 缩范围（V1 去掉微信，且不承诺 V1.1）；handoff /pm REVISION |
| 2026-05-10 | builder | @20260510-fix-classify-no-ext-shadow → done；classifyFile baseName 检测前置；新增 4 大小写断言 + 2 边界断言；23 个 mjs 测试套件全过 |
| 2026-05-10 | pm | @20260510-office-doc-relay REVISION：V1 范围去微信、不承诺时间；spec v2 → building；handoff /builder 同步代码 |
| 2026-05-10 | builder | @20260510-office-doc-relay 阶段二：fixture 自生成 + LibreOffice 装好 + 代码层 V1.1 字样清理；4 测试套件全过（10/10 office-upgrader）；保持 building 待用户跑 V4-V11 端到端 AC |
| 2026-05-10 | builder | @20260510-office-doc-relay → done；用户口头确认 AC-1..AC-7 全部端到端通过；commit_range pending 待用户 commit |
| 2026-05-10 | cto | @20260510-office-doc-relay REVISE：清理 §Plan 中 6 处过时措辞（V1.1 / V2 时间承诺、AC 重编号、删过时风险行）；state 仍 done |
| 2026-05-10 | go | 登记 @20260510-im-slash-passthrough (Unscheduled, M, draft)；用户主动选择走 /pm intake |
| 2026-05-10 | go | 登记 @20260510-im-askuserquestion-bridge (Unscheduled, L, draft)；用户主动选择走 /pm intake；arch_risk=high 后续需 /cto triage |
| 2026-05-10 | pm | @20260510-im-askuserquestion-bridge intake：§Spec 骨架完成（8 AC + 边界 + 12 待确认项）；handoff /go reclassify |
| 2026-05-10 | go | @20260510-im-askuserquestion-bridge reclassify → spec_ready；路径 /cto → /designer → /pm consolidate → /builder；handoff /cto |
| 2026-05-10 | cto | @20260510-im-askuserquestion-bridge §Plan 完成；Spike 验证 Claude hooks 路径；范围调整：Codex 移出 / 超时 30→8 分钟 / Gemini 进入维护模式；ARCHITECTURE 加 §4.7/§4.8/§5.3；handoff /designer |
| 2026-05-10 | designer | @20260510-im-askuserquestion-bridge §Design 完成；bootstrap DESIGN_SYSTEM.md（项目首次创建）；新增 🤔 ✏️ ⏱ 保留 emoji；handoff /pm consolidate |
| 2026-05-10 | pm | @20260510-im-askuserquestion-bridge consolidate：§Spec 修订完成（10 AC + 边界 8 行异常 + Codex/Gemini 列入不做 + 待确认项清空）；handoff /builder |
| 2026-05-10 | builder | @20260510-im-askuserquestion-bridge → building；preflight 通过；§Tasks 4 phase 共 32 任务 + 10 AC 验证骨架；待 BLOCKING：Spike 跑法 + 是否建 ExecPlan |
| 2026-05-10 | builder | @20260510-im-askuserquestion-bridge Phase 0 spike 通过（5/5 观察点）；ExecPlan 已建（heavy）；信心 75→95%+；准备进 Phase 1 |
| 2026-05-10 | builder | @20260510-im-askuserquestion-bridge Phase 1 完成（IPC socket + hook + transport 接口 + 配置 + claude-launcher 注入 + queue cancel 广播）；新增 7 个单测；147 全套测试零回归 |
| 2026-05-11 | builder | @20260510-im-askuserquestion-bridge Phase 2+3 完成（spec 修订：调研后飞书 interactive 卡片撤销，改文本编号格式；信息架构跨 transport 一致；保留 InteractiveCardMessage 类型供 V1.x 升级）；ARCHITECTURE/DESIGN_SYSTEM 同步；151 全套测试零回归 |
| 2026-05-11 | builder | @20260510-im-askuserquestion-bridge → done；端到端飞书+微信单/多 question 全过；commit 47bd061；AC-5/6/7/9 deferred；AC-10 not_applicable；ExecPlan → completed |

---

## 状态标记
- `[ ]` = draft / spec_ready
- `[~]` = building / iterating
- `[x]` = done
- abandoned → 移到 Archive 段
