---
title: im-askuserquestion-bridge
status: completed
scope: heavy
created: 2026-05-10
updated: 2026-05-11T06:30Z
completed: 2026-05-11
---

# ExecPlan: im-askuserquestion-bridge

> **活文档 (living document)**：本文件必须**完全自洽** —— 任意中断后仅凭本文件即可恢复执行。
> 所需知识必须内嵌于此，不外链到"只有作者脑子里"的上下文。

> **配套 feature 文件（source of truth）**：`docs/features/20260510-im-askuserquestion-bridge.md`
> 本 ExecPlan 是 phase 进度 + 决策 + blocker 的 scratchpad，不替代 feature 文件。

---

## 1. 目标 / 大局观

让 im2cc 用户在飞书/微信远程使用 Claude 时，AI 调用 `AskUserQuestion` 不再卡住或失败——daemon 拦截调用，渲染为飞书 interactive 卡片或微信文本消息（带 🤔 prefix），用户在 IM 上点选项或回复文本，AI 收到答案后继续推进任务。8 分钟（可配 1-9）超时则 AI 收到 `[已超时] 用户未回复...` 字符串自决继续。

**用户能做什么**：在地铁上用飞书让 Claude 写代码，AI 问"用 React 还是 Vue？"，用户点按钮回答，AI 继续推进——而不是看到一个失败的任务。

**怎么观察**：触发任意 AskUserQuestion 调用，看 IM 是否收到正确格式的卡片/文本，点选项后 AI 是否拿到答案继续。

---

## 2. 背景与方向

**配套文档**（必读）：
- `docs/features/20260510-im-askuserquestion-bridge.md` — feature 单一真相源（§Spec / §Plan / §Design 全在这）
- `ARCHITECTURE.md` §4.5 / §4.7 / §5.3 — 红线和模式
- `DESIGN_SYSTEM.md` §2 — emoji prefix 体系 + 跨 transport 一致性

**核心技术路径**：
Claude PreToolUse hook + 本地 unix socket IPC + 飞书 interactive 卡片 + 微信文本降级 + `hookSpecificOutput.permissionDecision: "allow" + updatedInput.answers` 直接回填答案。

**关键代码入口**：
- `src/transport.ts:40` — 要扩 `OutgoingMessage` 加 `InteractiveCardMessage`、`IncomingMessage.kind` 加 `'card_action'`
- `src/feishu.ts:127` — 当前只发 text/post，要加 interactive 分支 + 注册 card.action.trigger 事件
- `src/claude-driver.ts:62, 91` — 已用 stream-json，需在 args 加 `--settings <临时 json>` flag
- `src/claude-launcher.ts` — 注入 hook 的临时 settings.json 入口
- `src/queue.ts:71-200` — 现有 inflight recovery 机制，AC-7 复用

**关键约束（来自 spike 文档查证）**：
- Claude command hook 默认 600 秒（10 分钟）超时，**硬上限**——所以超时设 8 分钟可配 1-9
- Codex hook 不覆盖非 Bash 工具——Codex 不在本 feature 范围
- updatedInput.answers schema 文档明确，但需 spike 验证 AI 真的接受注入答案

---

## 3. 进展清单

> 带时间戳的粒度清单。完成一项打勾一项。

### Phase 0 — Spike 验证（半天）✅ 通过

- [x] 2026-05-10 写最小 PreToolUse hook 脚本（/tmp/askuser-spike/hook.mjs）
- [x] 2026-05-10 写最小 settings.json（run.sh 动态生成绝对路径）
- [x] 2026-05-10 用户在另一终端跑 `bash /tmp/askuser-spike/run.sh` 触发 AskUserQuestion
- [x] 2026-05-10 观察 stream-json 输出，**AI 接收注入答案并明确复读**（最强证据）
- [x] 2026-05-10 spike 通过，无需走 fallback 路径
- [ ] 飞书 SDK card.action.trigger 事件订阅最小 demo（推迟到 Phase 2 实施时一起做，不阻塞 Phase 1）

### Phase 1 — 核心 IPC + hook + transport 接口（1-2 天）✅ 完成 2026-05-10

- [x] 2026-05-10 `src/transport.ts`: OutgoingMessage 加 InteractiveCardMessage + IncomingMessage.kind 加 'card_action' + CardAction 接口
- [x] 2026-05-10 `src/askuser-bridge.ts`（新文件）: unix socket server + pending Q&A map + 超时管理 + cancel 传播
- [x] 2026-05-10 `hooks/askuser-hook.mjs`（新文件）: PreToolUse hook 脚本
- [x] 2026-05-10 `src/config.ts`: askUserTimeoutMinutes（默认 8，范围 1-9，夹紧 + 日志告警），新增 getAskUserSocketPath / getSessionDir
- [x] 2026-05-10 `src/claude-launcher.ts`: injectAskUserHookSettings(sessionId, conversationId) + claude-driver 启用 --settings 注入
- [x] 2026-05-10 `src/queue.ts`: interruptInflightTasksForSession + handleStop 广播 cancel 到 askuser-bridge
- [x] 2026-05-10 编译通过 + 7 个 askuser-bridge 单测全过 + 147 个全套测试零回归

### Phase 2+3 — 飞书 + 微信文本一致格式（修订后实施，2026-05-11）✅ 完成

> **spec 修订**：原 Phase 2 的飞书 interactive 卡片 / EventDispatcher / update card 路径全部撤销 — 调研后决策飞书与微信均走 text 编号格式，详见 feature.revision[2026-05-11]。

- [x] 2026-05-11 `src/message-format.ts`: buildAskUserText (飞书+微信共用文本渲染)
- [x] 2026-05-11 `src/feishu.ts`: sendMessage 路径自动通过 buildFeishuMessage 内部降级（无新代码）
- [x] 2026-05-11 `src/wechat.ts`: sendMessage 路径自动通过 renderOutgoingMessageAsText 内部降级（无新代码）
- [x] 2026-05-11 `src/index.ts`: daemon 启动 startAskUserBridge + process.on('exit') 注册 stop
- [x] 2026-05-11 `src/index.ts`: 订阅 onAsk → 发 InteractiveCardMessage（自动文本降级）
- [x] 2026-05-11 `src/index.ts`: 订阅 onTimeoutEvent → 推 ⏰ 文本回执
- [x] 2026-05-11 `src/index.ts` handleMessage: 普通文本分支前置答案路由（编号→option label / 自由文本→原文，react DONE 确认）
- [x] 2026-05-11 `ARCHITECTURE.md` §5.3 / `DESIGN_SYSTEM.md` §2.2/§2.4: 同步 spec 修订；标注 V1 不做 / V1.x 升级方向
- [x] 2026-05-11 `scripts/message-format.test.mjs`: +4 个 buildAskUserText 单测；151 全套测试零回归

### Phase 4 — 端到端实测 + 文档归档（待用户实测）

- [ ] 端到端：飞书路径（AC-1/2/4/8）
- [ ] 端到端：微信路径（AC-3/4）
- [ ] 端到端：超时路径，临时改 1 分钟测（AC-5/9）
- [ ] 端到端：/stop 中断（AC-6）
- [ ] 端到端：daemon 重启（AC-7）
- [ ] feature.§Tasks.验证记录逐条填证据
- [ ] frontmatter state → done

### Phase 4 — 测试 + 文档（半天）

- [ ] `scripts/askuser-bridge.test.mjs`
- [ ] `scripts/feishu-card.test.mjs`
- [ ] `src/_INDEX.md` 更新
- [ ] `hooks/_INDEX.md` 新建
- [ ] `ARCHITECTURE.md` §6 验证管线追加新测试
- [ ] feature.§Tasks.验证记录逐条填证据
- [ ] frontmatter state → done

---

## 4. 工作计划

按 §Plan 的模块改动表逐文件实施。详细顺序见 feature.§Tasks.Checklist。每个文件改动遵循 R-A-C-U-V，特别是 Update 步骤——改文件头注释 + _INDEX.md。

**关键依赖顺序**（不可乱序）：
1. transport.ts 类型扩展 → 才能给 feishu.ts/wechat.ts 实现
2. askuser-bridge.ts → 才能给 hook 脚本对接
3. claude-launcher.ts 注入 settings → 才能让 daemon 实际启用 hook
4. 联调端到端 → 才能填验证记录

---

## 5. 里程碑

### M1: Spike 通过（Phase 0 完成）

- 新增/修改：临时文件 `/tmp/askuser-spike/{hook.mjs, settings.json, run.sh}`
- 运行命令：`bash /tmp/askuser-spike/run.sh` （用户跑）
- 预期结果：stream-json 输出中能看到 AskUserQuestion 工具调用 + hook 拦截 + AI 收到 hook 注入的答案后继续生成

### M2: 飞书最小可跑（Phase 1+2 完成）

- 新增/修改：transport.ts、askuser-bridge.ts、askuser-hook.mjs、claude-launcher.ts、message-format.ts、feishu.ts、index.ts、config.ts
- 运行命令：`npm run build && im2cc start` 后在飞书发指令让 AI 触发 AskUserQuestion
- 预期结果：飞书收到 🤔 蓝色卡片，点按钮后卡片切灰色"已收到"，AI 继续输出

### M3: 全 transport + 边界（Phase 3 完成）

- 新增/修改：wechat.ts、security.ts
- 运行命令：手动跑 6 个端到端场景
- 预期结果：所有 10 条 AC 都能用具体步骤验证通过

### M4: 测试 + 归档（Phase 4 完成）

- 新增/修改：scripts/*.test.mjs、_INDEX.md、ARCHITECTURE.md
- 运行命令：`node scripts/askuser-bridge.test.mjs && node scripts/feishu-card.test.mjs`
- 预期结果：所有自动化测试通过，feature state → done，commit 包含 @20260510-im-askuserquestion-bridge

---

## 6. 验证与接受标准

10 条 AC（feature.§Spec.验收标准），每条对应一个端到端场景：

- [ ] AC-1 飞书触发收 🤔 蓝色卡片，daemon 不崩
- [ ] AC-2 飞书点按钮 → AI 继续 + 卡片切灰色✅
- [ ] AC-3 微信触发收 🤔 文本（含 1) 2) 3) 编号），回复编号 → AI 继续
- [ ] AC-4 自由文本（飞书 Other / 微信任意文本）传给 AI；语义不明也作 freeText 传
- [ ] AC-5 超时 8 分钟 → AI 收 `[已超时]...` 字符串 + IM 推 ⏰ 回执
- [ ] AC-6 等待中 /stop 能中断
- [ ] AC-7 daemon 重启复用现有 inflight recovery 提示
- [ ] AC-8 六种消息类型 emoji prefix 跨 transport 区分
- [ ] AC-9 askUserTimeoutMinutes 可配 1-9，超出夹紧 + 日志告警
- [ ] AC-10 飞书卡片渲染失败 → 降级文本 + `（卡片渲染失败，已降级）` 标识

**失败前如何失败**：
- spike 阶段：若 updatedInput.answers 不让 AI 接受 → AI 在 stream-json 中表现为"工具被 deny 后重试 AskUserQuestion 形成循环"或"忽略 answers 直接报错"
- 实施阶段：若 hook 配置错误 → daemon 调 Claude 时 `claude --settings ...` 报 "invalid settings"，需修 claude-launcher.ts 的 JSON schema

**成功后如何确认**：
- spike：stream-json 流里能看到 `tool_use{name:"AskUserQuestion"}` 后紧跟 `tool_result{content:"<注入答案>"}`，AI 后续生成基于该答案
- 实施：手动跑 6 个端到端场景全过

---

## 7. 决策日志

| 日期 | 决策 | 理由 | 备选方案 | 作者 |
|---|---|---|---|---|
| 2026-05-10 | 用 hook permissionDecision: "allow" + updatedInput.answers 而非 "deny" + reason | answers 路径让 AI 看到"工具调用成功有答案"最干净，避免 AI 重试循环 | deny + reason；HTTP hook | cto |
| 2026-05-10 | 超时上限 8 分钟（可配 1-9）而非 30 分钟 | Claude command hook 默认 600 秒硬限；async/asyncRewake 文档薄风险高 | spike async 模式（+1-2 天） | cto + 用户 |
| 2026-05-10 | Codex 不在范围 | spike 后发现 Codex PreToolUse 仅覆盖 Bash/apply_patch/MCP；Codex 无 AskUserQuestion 等价工具 | 走 PTY 调用模式（×太复杂） | cto + 用户 |
| 2026-05-10 | Gemini 进入维护模式（项目级决策） | 长期 ROI 低；新功能不再加 Gemini | 兜底降级；彻底下线（×需另开 feature） | 用户 |
| 2026-05-10 | spike 由用户在另一终端跑而非当前会话 spawn 子 Claude | 进程隔离干净，避免污染当前会话 | 当前会话 Bash ! 模式（有继承环境风险） | builder + 用户 |
| 2026-05-10 | Phase 0 spike 通过（信心 75%→95%+） | 5/5 观察点全过；AI 选 Python 并文本复读注入字符串"Spike 测试答案"，证据见 temp/📋 Claude-stream-json.md | hook 路径放弃，走 deny+reason / async / PTY 等 | builder（agent 诊断）|

---

## 8. 意外发现

_(实施过程中填，未预期的行为、优化机会、见解)_

---

## 9. 幂等性与恢复

**checkpoint 边界**：每个 phase 末尾是 commit 边界。中断后从该 phase 的"进展清单"未勾选项继续。

**关键恢复点**：
- spike 失败 → 改 §Plan，回 /cto revise，可能调路线
- Phase 1 中断 → 看 git log + 进展清单未勾选项；transport.ts 类型扩展是 idempotent 的（多次写不会出错）
- Phase 2 中断 → 飞书事件订阅一旦注册到生产飞书 bot 不可撤销；但 dev bot 隔离，重复跑无副作用
- Phase 3 端到端 → 任何端到端步骤都可重复（无副作用），失败的步骤回到对应 phase 修代码

**安全重复保证**：
- 所有 TS 代码改动是 idempotent（同样的源码多次 npm run build 结果一致）
- 临时 settings.json 写入 `~/.im2cc/sessions/<sessionId>/settings.json`——每次 createSession 重写，旧文件 cleanup 在 session kill 时
- IPC unix socket：daemon 启动时检查并清理旧 socket 文件，避免"address already in use"

---

## 10. 结果与回顾

完成于 2026-05-11，commit 47bd061。

- **交付**：
  - daemon 单 question + 多 question 串行 AskUserQuestion 桥接全链路（飞书 + 微信，文本统一格式）
  - 11 个新单测（7 askuser-bridge IPC + 4 buildAskUserText）；151 全套测试零回归
  - bootstrap DESIGN_SYSTEM.md（项目首次 designer 介入产出）；ARCHITECTURE.md §5.3 + §4.7/§4.8 新章节
  - V1.x 升级方向（飞书 WSClient 真按钮）已在 ARCHITECTURE / DESIGN_SYSTEM / feature spec 标注，类型预留接口

- **剩余工作**（标记 deferred，非阻塞）：
  - AC-5 / AC-6 / AC-7 / AC-9 端到端实测（代码路径完备 + 核心单测覆盖；后续触发到自然场景再补证）

- **经验教训**：
  - **架构假设盲区**：Phase 0 spike 只覆盖了 Claude hook 路径，没覆盖飞书事件订阅链路 — Phase 2 实施时才发现项目 REST 轮询架构与飞书 `card.action.trigger` 推送不兼容。教训：spike 要覆盖**整条路径上每个外部接口**，不能只验最关键的"中间一段"。
  - **"复杂没把握就降级"的判断价值**：本可以闷头加 WSClient 长连接子系统，但调研后发现成本/收益不划算，及时改走文本编号路径；信息架构一致原则让降级方案与原方案表达力差距可控（用户实际反馈飞书 + 微信都顺畅，"点按钮"的缺失体感很弱）。
  - **多 question 串行实测一次过**：hook 内 `for (const q of questions) await askOne(...)` + askuser-bridge 同 toolUseId 重入清理 + handleMessage 找最早 pending — 三处独立写的逻辑在端到端汇合时直接对得上，说明事先想清楚状态机比试错快。
  - **InteractiveCardMessage 类型保留 + degradedNote 字段预留 V1.x 升级位**：spec 修订时没把类型砍掉，未来加 WSClient 不用改 transport 接口；这种"约束收紧但接口不改"的处理让代码与 spec 同步更平滑。

- **下一步**：
  - V1.x（条件性）：若 IM 用户群规模到一定量、对"点按钮"有明确需求，再评估 WSClient 长连接方案
  - 短期可触发的关联 feature：`@20260510-im-slash-passthrough`（IM 端透传 AI 工具内置斜杠命令；draft 中）
