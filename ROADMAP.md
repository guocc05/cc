# Product Roadmap

> Feature 的 state / version 事实源是各 feature 的 frontmatter。
> 本文件是人工可读的索引视图，由 /go（append）和 /go review（reorder）同步维护。
> 不允许本文件单方面覆盖 feature frontmatter。

## Unscheduled

- [x] IM 端 office 文档（PDF/Word/Excel/PPT）传输与解析 — `@20260510-office-doc-relay`
- [x] fix — classifyFile 无扩展名早返回，遮蔽 Dockerfile/Makefile 分类 — `@20260510-fix-classify-no-ext-shadow`

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

---

## 状态标记
- `[ ]` = draft / spec_ready
- `[~]` = building / iterating
- `[x]` = done
- abandoned → 移到 Archive 段
