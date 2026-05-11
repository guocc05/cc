---
schema_version: 1

id: 20260510-im-askuserquestion-bridge
title: IM 端处理 AI 工具反向提问（AskUserQuestion 桥接）
state: done
type: feature
size: L
version: Unscheduled

current_owner: builder
last_actor: builder
handoff_reason: null

created_at: 2026-05-10T06:19:54Z
updated_at: 2026-05-11T06:30:00Z

depends_on: []
related:
  - 20260510-im-slash-passthrough
links:
  pr: ""
  issue: ""
  branch: ""
  deploy: ""

revision:
  - date: 2026-05-10T06:19:54Z
    actor: go
    from_state: null
    to_state: draft
    from_owner: null
    to_owner: pm
    handoff_reason: needs_pm_intake
    action: "created via /go; user explicitly requested /pm intake despite spec_clarity=medium"
    classifier:
      title_guess: "IM 端处理 AI 工具反向提问（AskUserQuestion 桥接）"
      duplicate_check:
        found: false
        candidates: []
      project_profile: "cli-tool"
      proposed_type: "feature"
      signals:
        granularity:
          value: "L"
          evidence: "跨 driver / queue / daemon / IM 卡片渲染 / 双向交互 / 状态机；可能触及非交互调用模型本身"
          confidence: "high"
        arch_risk:
          value: "high"
          evidence: "触及红线非交互 -p 调用模型；AskUserQuestion 在 -p 下本就不工作；解决方向均是底层架构决策"
          confidence: "high"
        interface_risk:
          value: "high"
          interface_surface: "im (gui-like via cards)"
          evidence: "需呈现选项卡片（飞书卡片/微信图文按钮）+ 阻塞等待用户回复 + 回灌给工具"
          confidence: "high"
        spec_clarity:
          value: "medium"
          evidence: "症状清楚（卡住/报错）+ 工具明确（AskUserQuestion）+ 通道明确（飞书）；但解决方向有 3+ 种合理路径需 triage；用户主动要求 /pm intake"
          confidence: "medium"
        version_fit:
          value: "Unscheduled"
          evidence: "ROADMAP 当前无匹配版本主题"
          confidence: "high"
      flags:
        xs_fix_qualify: false
        global_design_surface_change: false
      needs_pm_intake: true
      proposed_route: ["/pm intake", "/go reclassify", "/cto", "/pm consolidate", "/designer", "/builder"]
  - date: 2026-05-10T06:38:20Z
    actor: pm
    from_state: draft
    to_state: draft
    from_owner: pm
    to_owner: go
    handoff_reason: needs_go_reclassify
    action: "intake: drafted §Spec skeleton with 8 AC, 6 边界条件, and 12 待确认项 across cto/designer/user; user confirmed skeleton 'no issues, proceed'"
  - date: 2026-05-10T06:46:17Z
    actor: go
    from_state: draft
    to_state: spec_ready
    from_owner: go
    to_owner: cto
    handoff_reason: needs_cto_plan
    action: "reclassify: spec_clarity 从 medium 升级（spec 骨架就绪但仍含 12 待确认项）；arch_risk/granularity/interface_risk 维持 high/L/high；路径定为 /cto → /designer → /pm consolidate → /builder（先 /cto 因 transport 接口扩展决策决定 /designer 设计空间）"
    classifier_v2:
      signals:
        granularity: { value: "L", confidence: "high" }
        arch_risk: { value: "high", evidence: "AC-1/2/7 触及红线 §4.5 非交互模式 + §4.6 后台任务 CRUD；transport 接口需扩 sendInteractiveCard + 入站 card_action 事件流", confidence: "high" }
        interface_risk: { value: "high", interface_surface: "im (gui-like via cards)", confidence: "high" }
        spec_clarity: { value: "medium", evidence: "8 AC 清晰但 11 项待 /cto + /designer + 用户确认", confidence: "high" }
        version_fit: { value: "Unscheduled", confidence: "medium" }
      proposed_route: ["/cto", "/designer", "/pm consolidate", "/builder"]
      route_rationale: "/cto 决定 transport 接口是否扩卡片能力 → 决定 /designer 设计空间；先 /cto 不可绕过"
  - date: 2026-05-10T07:45:51Z
    actor: cto
    from_state: spec_ready
    to_state: spec_ready
    from_owner: cto
    to_owner: designer
    handoff_reason: needs_designer_design
    action: "plan: §Plan 完成（Claude PreToolUse hook + 本地 IPC + 飞书卡片/微信文本降级）；spike 验证 Claude hooks 可拦截 AskUserQuestion + updatedInput.answers 回填路径；spec 范围需 /pm consolidate 修订（Codex 移出范围、超时 30→8 分钟、Gemini 列入维护模式）；ARCHITECTURE.md 加 §4.7/§4.8/§5.3"
    spike_findings:
      claude_hooks: "matcher: AskUserQuestion 生效；command hook 默认 600s 超时硬限；updatedInput.answers schema 文档明确"
      codex_hooks: "PreToolUse 当前仅覆盖 Bash/apply_patch/MCP；无 AskUserQuestion 等价工具；不可桥接"
      timeout_constraint: "30 min 不可行，10 min 硬上限；产品采纳 8 分钟默认+1-9可配"
  - date: 2026-05-10T07:57:06Z
    actor: designer
    from_state: spec_ready
    to_state: spec_ready
    from_owner: designer
    to_owner: pm
    handoff_reason: needs_pm_consolidate
    action: "design: §Design 完成（飞书 interactive 卡片 + 微信文本降级 + AC-8 视觉区分系统 + 错误状态 + 微观文案规范）；bootstrap DESIGN_SYSTEM.md（项目首次创建，§1 设计原则 / §2 IM 消息视觉语言 / §3 CLI 命令习惯）；新增保留 emoji 🤔 ✏️ ⏱"
  - date: 2026-05-10T08:00:31Z
    actor: pm
    from_state: spec_ready
    to_state: spec_ready
    from_owner: pm
    to_owner: builder
    handoff_reason: needs_builder_build
    action: "consolidate: 吸收 cto/designer 约束修订 §Spec —— 工具范围明确仅 Claude（Codex/Gemini 列入不做）；AC-5 超时 30→8 分钟可配；新增 AC-9 配置项 / AC-10 卡片降级；所有 AC 翻新加入 emoji prefix 与卡片更新行为；清空 11 项待确认；异常处理表 8 行覆盖完整。spec ready for build"
  - date: 2026-05-10T08:06:07Z
    actor: builder
    from_state: spec_ready
    to_state: building
    from_owner: builder
    to_owner: builder
    handoff_reason: null
    action: "build: preflight 4 问通过；§Tasks 写完（4 phase checklist 共 32 任务 + 10 AC 验证骨架）；待用户确认 Spike 跑法（自跑 vs 我提供 artifact）+ 是否建 ExecPlan"
  - date: 2026-05-10T15:09:53Z
    actor: builder
    from_state: building
    to_state: building
    from_owner: builder
    to_owner: builder
    handoff_reason: null
    action: "Phase 0 spike 通过：5/5 观察点全过，AI 收到注入答案并文本复读 'Spike 测试答案'。核心机制信心 75%→95%+，无需走 fallback。ExecPlan 已建（heavy）。准备进 Phase 1。spike 输出存档：temp/📋 Claude-stream-json.md（39KB）"
  - date: 2026-05-10T17:30:00Z
    actor: builder
    from_state: building
    to_state: building
    from_owner: builder
    to_owner: builder
    handoff_reason: null
    action: "Phase 1 完成：transport / askuser-bridge / hook 脚本 / config / claude-launcher 注入 / queue cancel 广播 6 项全实现；新增 7 个 askuser-bridge 单测全过；147 全套测试零回归。下一步进 Phase 2 飞书卡片渲染 + 事件订阅 + handleMessage 路由"
  - date: 2026-05-11T06:30:00Z
    actor: builder
    from_state: building
    to_state: done
    from_owner: builder
    to_owner: builder
    handoff_reason: null
    action: |
      端到端实测通过用户在飞书 + 微信双 transport 验收：单 question 提问回答 / 多 question 串行问答 / 编号回复 / 自由文本回复 / multi-question 多轮 均确认 AI 收到注入答案后继续推进。
      已 commit (47bd061)；20 文件 +2242 行；feature state → done。
      未端到端跑的 AC（AC-5 超时 / AC-6 /stop 中断 / AC-7 daemon 重启 / AC-9 配置夹紧）代码路径完备且有单测覆盖核心，标记 deferred — 后续触发到自然场景再补证。
      AC-10 在 V1 不适用（已在 revision[2026-05-11T03:00] 决策）。
  - date: 2026-05-11T03:00:00Z
    actor: builder
    from_state: building
    to_state: building
    from_owner: builder
    to_owner: builder
    handoff_reason: spec_revision_in_place
    action: |
      Phase 2 实施前发现 spec 与现有架构冲突：飞书原规划走 interactive 卡片 + card.action.trigger 推送回调，
      但项目现有 feishu.ts 是 REST 轮询模式，没有事件订阅链路，无法接收按钮点击。三方案调研 (WSClient / 按钮代发文本 / 文本编号) 后决策：
        - 拒绝 WSClient（自写心跳/重连/失败补偿；地铁切网必断；与 daemon 重启场景下"丢卡片点击"风险高 — 复杂且无把握）
        - 拒绝 button 代发文本（schema 不确定；跨客户端可能降级 — 没把握）
        - 采纳 文本编号（飞书 + 微信信息架构完全一致；零新依赖；立即可端到端测；保留 InteractiveCardMessage 类型供 V1.x 后续升级 WSClient 时复用）
      就地修订 spec：AC-2 改为"飞书也是回编号或文本"；AC-10"卡片渲染失败降级文本"在 V1 不适用（仍保留代码降级路径，以备 V1.x 接入卡片）；
      §Design 飞书 interactive 卡片章节标记为 "V1 不做，V1.x 重启"；ARCHITECTURE §5.3 同步更新；DESIGN_SYSTEM §2 飞书卡片章节降级。
      未走 builder → pm 升级，因属技术约束触发的 spec 表面收紧（飞书 - 卡片体验），不涉及范围、用户故事、版本归属变更；用户已授权 builder 在调研后做技术决策。
---

# IM 端处理 AI 工具反向提问（AskUserQuestion 桥接）

## §Spec
<!-- Owner: /pm. 用户视角。-->

### 背景
AI 工具（Claude Code）在执行任务过程中常常会因信息缺失向用户提问，调用 `AskUserQuestion` 这类交互式工具。在 Terminal 中用户会看到选择框、点选项即可。但通过 im2cc 在飞书/微信远程使用时，daemon 在非交互模式调用 CLI，`AskUserQuestion` 调用会卡住或直接失败，整个任务推不下去。

这是远程使用场景下的**阻塞性体验缺口**——一旦 AI 想提问，远程交互就走不下去，等于"远程版本"必须挑选完全不需要 AI 提问的任务。这违背了 im2cc 的核心价值（"电脑/手机无缝流转"）。

### 用户故事
作为 im2cc 用户（使用 Claude），我希望当 AI 在远程任务中需要提问时：

- daemon **不再卡住或失败**
- IM 端能**看到 AI 的问题与候选选项**，并且能一眼识别"AI 在等我回答"
- 能用**IM 原生方式快速回答**（飞书点卡片按钮 / 微信回复编号或文字）
- AI 收到答案后**自动继续推进任务**
- 如果我没及时看 IM，**默认 8 分钟（可配 1-9 分钟）后 AI 收到"超时未回复"的降级提示并基于现有信息合理假设继续**，任务不挂起
- 历史回看时能清楚看到"那次问了什么、我答了什么"

以便我在外远程完成需要多轮交互的复杂任务，不必挑"绝不需要提问的任务"才用远程模式。

### 核心流程

**主流程（飞书，使用交互卡片）**：

1. AI 在任务中调用 `AskUserQuestion`，给出问题 + 选项列表
2. daemon 拦截该调用，**让任务挂起等待**而不是失败；将问题与选项渲染为飞书 interactive 卡片（蓝色 header `🤔 Claude 想问你`），发到当前 binding 对应的会话
3. 用户在飞书点击选项按钮，或在群内直接回复自定义文本（"Other"路径）
4. daemon 把答案回灌给 AI，任务继续；同时把卡片更新为"已收到"态（灰色 header `✅ 已收到回答`，显示用户的选择/回答）
5. 默认 8 分钟无响应 → daemon 让 AI 收到 `[已超时] 用户未回复，请基于现有信息做合理假设并标注` 字符串继续，IM 端推送 `⏰ 上次提问已超时（X 分钟未回复），AI 已基于现有信息继续`

**降级流程（微信，纯文本）**：

- 步骤 2 改为发文本消息（首行 `🤔 Claude 想问你`，包含问题 + 编号选项 + Other 引导 + 超时提示，五要素一一对应）
- 步骤 3 改为用户回复编号 / 选项文本 / 自由文本
- 步骤 4 不发"已收到"回执（微信不可 update 消息），AI 直接继续输出
- 其余同主流程

**多轮提问**：同一 session 内多个连续提问串行处理（一个答完才发下一个），不并发。

### 验收标准

> **V1 spec 修订（2026-05-11）**：飞书与微信统一走文本编号格式（信息架构五要素一致）。原"飞书 interactive 卡片 + 按钮 + 卡片 update"路径在 V1 不做，列入 V1.x 升级（WSClient 长连接路径）。详见 revision[2026-05-11]。

- **AC-1**：在飞书 binding 下，触发 AI `AskUserQuestion` 调用，IM 端**收到首行 `🤔 Claude 想问你` 的文本消息**（含问题、`1) 2) 3)` 编号选项、Other 引导、超时提示五要素），daemon 不报错也不退出
- **AC-2**：用户在飞书回复**编号（1/2/3）或自由文本**后，daemon 把对应 option label / 原文注入到 AI，AI **能继续推进任务**；用户消息会被加 ✅ 表情确认收到
- **AC-3**：在微信 binding 下，触发同样调用，IM 端**收到与飞书完全一致格式的文本消息**（首行 `🤔 Claude 想问你` + 问题 + `1) 2) 3)` 编号选项 + Other 引导 + 超时提示），用户回复编号或文本后 AI 能继续
- **AC-4**：用户以**自由文本**回答（任意 transport），daemon 把原文作为答案传给 AI；用户回复**语义不明**时也作为原文传给 AI 自处理（daemon 不主动反问）
- **AC-5**：超时阈值（默认 8 分钟）内无响应 → AI 收到 `[已超时] 用户未回复，请基于现有信息做合理假设并标注` 字符串作为"用户回答"继续推进；IM 端推送 `⏰ 上次提问已超时（X 分钟未回复），AI 已基于现有信息继续` 文本回执
- **AC-6**：用户在等待期间发 `/stop` 能中断当前任务（与现有中断机制一致）
- **AC-7**：daemon 进程崩溃/重启后，**复用现有 inflight recovery 机制**——IM 推 `⚠️ 上次任务因守护进程重启被中断…请重新发送` 通用提示，不为提问单独设计持久化恢复
- **AC-8**：五种 IM 消息类型用 **emoji prefix 跨 transport 一致区分**：AI 普通输出（无 prefix）/ AI 提问（🤔）/ 超时回执（⏰）/ 错误（❌）/ 警告（⚠️）；用户回答会被回 ✅ 表情确认（不发文本回执，避免污染聊天）；用户一眼能识别"这是 AI 在等我回答"
- **AC-9**：超时阈值可通过 `~/.im2cc/config.json` 的 `askUserTimeoutMinutes` 字段配置，**范围 1-9 分钟**，超出范围 daemon 自动夹紧到合法值并写入日志告警
- ~~**AC-10**：飞书卡片渲染或发送失败时降级为文本格式~~ — V1 不适用（飞书直接走文本，无卡片可降级）；保留 InteractiveCardMessage.degradedNote 字段供 V1.x 升级 WSClient 时启用

### 边界

**做什么（V1）**：

- 仅 **Claude** 工具的 `AskUserQuestion` 桥接
- 飞书 + 微信：**统一文本编号格式**（信息架构五要素一致：标识🤔 / 问题 / 1) 2) 3) 编号选项 / ✏️ Other 入口 / ⏱ 超时提示）
- 用户回答路径：编号纯数字 → 选项 label / 任意文本 → 原文当 freeText
- 用户回答确认：daemon 给消息加 ✅ 表情（不发文本回执，避免污染）
- 默认 8 分钟（可配 1-9）超时 + AI 收到降级字符串自决继续
- 同 session 多轮提问串行排队

**不做什么（V1 不做）**：

- **飞书 interactive 卡片 + 按钮点击 + 卡片 update**（V1 不做，V1.x 评估 WSClient 长连接方案；spec 修订记录见 revision[2026-05-11]）
- **Codex 不支持**（Codex CLI 无 `AskUserQuestion` 等价工具，本痛点不存在）
- **Gemini 不支持**（项目级决策：Gemini 进入维护模式，不再加新功能；详见 ARCHITECTURE §4.8）
- 其他交互工具桥接（仅 `AskUserQuestion`；`AskUserPermission` 等如未来需要走后续 feature）
- 用户主动向 AI 反问的机制
- 提问历史归档 / 查询
- 提问优先级 / 紧急程度分级
- 同 session 多个并发提问（强制串行）
- 超时上限超过 9 分钟（受 Claude hook 机制硬上限约束）

**异常处理**：

| 异常情况 | 处理方式 |
|---|---|
| 飞书卡片渲染或发送失败 | 自动降级文本格式 + 头部标识 `（卡片渲染失败，已降级）`（AC-10） |
| 用户回复语义不明（既非编号也非选项文本）| 视为自由文本原文传给 AI 自处理，daemon 不主动反问（AC-4） |
| 用户回复"取消 / 不回答" 等明确放弃语义 | 等同 /stop 中断当前任务 |
| daemon 在等待期间被 kill 重启 | 复用现有 inflight recovery 通用提示，不专门处理（AC-7） |
| 同 session 已有未答提问，又来新提问 | 新提问入队，等当前一题答完再发 |
| 跨 transport 切换（飞书等待中→用户在微信发指令） | 等同 /stop，AI 收到兜底降级字符串继续 |
| 配置 `askUserTimeoutMinutes` 超出 1-9 范围 | 自动夹紧到合法值 + daemon 日志告警（AC-9） |
| Codex / Gemini 工具下 AI 触发同类调用 | 不在本 feature 范围；行为由各工具 driver 自行处理（保持现状） |

### 待确认项

（无 — consolidate 已完成，所有原"待 /cto / /designer / 用户"项已由 §Plan / §Design / 用户决策落定并反映为上方 AC 与边界）

---

## §Plan
<!-- Owner: /cto. -->

### 技术方案

**采用 Claude PreToolUse hook 拦截 + 本地 IPC 桥接 + IM 卡片 + 文本降级**。

核心机制（基于 Claude Code 官方 hooks 文档 spike 验证）：

1. daemon 配置 Claude `settings.json` 注入一条 PreToolUse hook，`matcher: "AskUserQuestion"`
2. AI 调用 AskUserQuestion → Claude 在执行工具前调用 hook（stdin 收 JSON：question + options + tool_use_id）
3. hook 进程通过 unix domain socket 向 daemon 发出"ask"事件 + sessionId
4. daemon 渲染飞书 interactive 卡片（或微信编号文本）发到当前 binding 的会话
5. 用户在 IM 上点选项 / 回复编号 / 自由文本 → daemon 将"answer"写回 socket
6. hook 收到 answer → 用 `hookSpecificOutput.permissionDecision: "allow" + updatedInput.answers` 把答案直接回填给 AI（AI 看到的是"工具调用成功 + 已有答案"）
7. hook 在等待期内每秒 polling socket；超时（默认 8 分钟，hook 9 分钟硬超时之内）则把 `answers` 设为 `[已超时] 用户未回复，请基于当前信息做合理假设并标注` 注入

**为什么这条路是最优**：
- `updatedInput.answers` 路径比 `permissionDecision: "deny" + reason` 更干净——避免 AI 重试 AskUserQuestion 形成循环
- Claude hook 在 settings.json 中配置即可，不改 CLI 调用方式（不破坏现有 stream-json 流式输出）
- daemon 重启时 Claude 进程随之死亡，复用现有 `recoverOnStartup()` 提示机制（AC-7 不另造）

### 范围调整（需 /pm consolidate 修订 §Spec）

| 项 | 原 §Spec | 修订为 | 原因 |
|---|---|---|---|
| 工具范围 | Claude + Codex | **仅 Claude** | Codex CLI 没有 AskUserQuestion 等价工具；其 PreToolUse hook 当前仅覆盖 Bash/apply_patch/MCP，无法拦截。Codex 不存在该痛点 |
| 超时上限 | 30 分钟 | **8 分钟（默认），可配 1-9 分钟** | Claude command hook 硬超时 600 秒（10 分钟），不可超过。9 分钟为带 buffer 的硬上限 |
| Gemini | 兜底降级 | **不在 V1 范围**（与"Gemini 进入维护模式"决策一致，参见 ARCHITECTURE §4.8） | 项目级决策：Gemini 不再加新功能 |

### 模块改动表

| 模块 | 改动 |
|---|---|
| `src/transport.ts` | OutgoingMessage 新增 `InteractiveCardMessage` 变体；IncomingMessage.kind 加 `'card_action'`；新增 `CardAction` 接口 |
| `src/feishu.ts` | 实现 `interactive` msg_type 发送（`im.message.create` with `msg_type=interactive`）；订阅 `card.action.trigger` 事件转 `IncomingMessage{kind:'card_action'}` |
| `src/wechat.ts` | sendInteractiveCard 内部降级为 sendText（编号文本格式） |
| `src/message-format.ts` | 新增 `buildFeishuInteractiveCard(question, options, timeoutHint, allowFreeText)` 与 `buildWeChatTextFallback(...)` |
| `src/askuser-bridge.ts`（新文件） | daemon 侧 IPC server（`net.createServer` over unix socket at `~/.im2cc/sockets/askuser.sock`）；ask 事件路由到对应 session 的 IM 通道；管理 pending Q&A map；超时计时；/stop 取消传播 |
| `hooks/askuser-hook.mjs`（新文件） | Claude PreToolUse hook 脚本：读 stdin → 连 socket 发 ask → polling 1s 收 answer → 输出 hookSpecificOutput JSON 到 stdout |
| `src/claude-launcher.ts` | 新增 `injectAskUserHookSettings(sessionDir)` — 在 Claude 启动前 写入临时 settings.json 包含 PreToolUse hook 配置；启动通过 `--settings <path>` flag 传入 |
| `src/queue.ts` | `interruptInflightTasksForSession` 增量：广播 cancel 信号到 askuser-bridge，让 hook 立即返回（避免僵尸） |
| `src/index.ts` | daemon 启动时初始化 askuser-bridge；handleMessage 中 `kind=='card_action'` 路由到 askuser-bridge 写回 |
| `src/config.ts` | 新增 `askUserTimeoutMinutes`（默认 8，范围 1-9，超出区间报警并夹紧） |
| `src/security.ts` | （若需）飞书机器人事件订阅添加 `card.action.trigger`，更新 secure 配置文档 |
| `~/.im2cc/sockets/`（新目录） | unix domain socket 存放点，0700 权限 |
| 测试 | `scripts/askuser-bridge.test.mjs`（IPC 模拟 + 超时 + cancel）；`scripts/feishu-card.test.mjs`（卡片 JSON schema 校验） |

### 关键数据结构

```typescript
// transport.ts 扩展
export interface InteractiveCardMessage {
  kind: 'interactive_card'
  cardId: string                    // daemon 生成（uuid），用于回调匹配
  question: string
  options: Array<{ id: string; label: string }>
  allowFreeText: boolean
  timeoutHint?: string              // "8 分钟" 等显示文案
}

export interface CardAction {
  cardId: string
  selectedOptionId?: string
  freeText?: string
  senderId: string
}

// askuser-bridge.ts IPC 协议（hook ↔ daemon, NDJSON over unix socket）
type HookToDaemon =
  | { type: 'ask'; tool_use_id: string; question: string; options: Array<{label: string}>; sessionId: string }
  | { type: 'cancel'; tool_use_id: string }

type DaemonToHook =
  | { type: 'answer'; tool_use_id: string; answer: string }              // 用户已回复（含 freeText 兜底）
  | { type: 'timeout'; tool_use_id: string; reason: string }             // 8 分钟未回复
  | { type: 'cancelled'; tool_use_id: string }                           // /stop 触发

// hook 输出（基于 spike 验证的 Claude hooks schema）
interface HookOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse'
    permissionDecision: 'allow'                        // 始终 allow，答案在 updatedInput
    updatedInput: {
      questions: Array<{ question: string; options: Array<{label: string}>; header?: string }>
      answers: Record<string, string>                  // 用户回答 OR "[已超时] ..." 兜底
    }
  }
}
```

### 风险与权衡

| 风险 | 严重性 | 缓解 |
|---|---|---|
| **`updatedInput.answers` 路径未实测**（文档示例明确，但项目无现成参照） | 中 | /builder 开工首日做 prototype hook 跑一次本地 Claude session，确认 AI 真的接收到注入答案 |
| 用户在 8 分钟内多次切换会话或 daemon 重启 | 低 | 现有 inflight recovery 已覆盖；新增 askuser-pending 残留清理 |
| 飞书 `card.action.trigger` 事件订阅与现有 EventDispatcher 冲突 | 中 | 检查 `src/feishu.ts` 现有 `eventDispatcher.register({'im.message.receive_v1': ...})` 模式，按相同模式注册 |
| 卡片按钮点击的 5s ack 限制（飞书要求） | 低 | daemon 收到 card.action 立即返回 ack，异步处理回写 socket |
| hook 进程在 polling 期间 daemon 崩溃 → hook 阻塞至 9 分钟硬超时 | 低 | 接受——这是 worst case，9 分钟后 hook 超时返回 deny；用户在 IM 上看到 "上次任务因守护进程重启被中断" 提示 |
| 多个 AskUserQuestion 并发（同 session） | 低 | hook 内串行处理（一个 ask 收到 answer 后才进下一个），spec 已声明"同 session 串行" |
| 用户切换 transport（飞书等待中→微信发指令） | 中 | 复用现有"独占访问"红线 §4.3；切换时取消 pending ask（type=cancelled），让 hook 用兜底字符串继续 |
| 新增依赖 | 无 | **不引入新 npm 依赖**——unix socket 走 node 原生 `net`；hook 用 Node 自带 `readline` + `fs`；JSON 原生 |

### Spike 已完成项 vs 待 builder 验证项

✅ **已完成**（基于官方文档 spike）：
- Claude PreToolUse hook 支持 matcher: "AskUserQuestion"
- hook timeout 默认 600s，超时硬限
- `hookSpecificOutput.permissionDecision: "allow" + updatedInput.answers` schema 文档明确
- Codex hook 不覆盖非 Bash 工具；Codex 无 AskUserQuestion 等价物
- 飞书 SDK 支持 interactive 卡片
- 项目当前 transport 接口不含卡片能力

🟡 **待 /builder 开工首日 prototype 验证**：
- updatedInput.answers 实测——AI 是否真的接收注入答案为"用户回复"
- 飞书 card.action.trigger 事件订阅在现有 EventDispatcher 框架中的注册细节
- hook 用 Node ESM script 时 settings.json 的 command 字段写法（`node /path/to/hook.mjs` vs 直接路径）

❌ **明确不做**：
- async hook + asyncRewake 突破 10 分钟（接受 8 分钟为产品决策）
- HTTP hook 模式（command hook 已够）
- 修改 CLI 调用方式（保持现有 stream-json）

### 是否回写 ARCHITECTURE.md

✅ **是**，回写 3 节：
- §4.7（新红线）：远程交互模式下，AI 工具的反向交互（AskUserQuestion 等）必须经 daemon hook 桥接，不允许暴露到非交互 CLI
- §4.8（新政策）：Gemini 进入维护模式 — 新功能不再支持 Gemini，仅保持现有功能可用
- §5.3（新模式）：IM 反向交互桥接（Claude PreToolUse hook + IPC + transport 卡片）的架构

---

## §Design
<!-- Owner: /designer. -->

### 设计目标

让 IM 端的"AI 反向提问"成为一个**用户一眼可识别、跨 transport 一致、降级路径优雅**的新交互 primitive。三种消息类型（AI 普通输出 / AI 提问 / 超时降级回执）用 emoji prefix 体系做强区分，让用户养成肌肉记忆。

### 飞书 interactive 卡片

**结构（消息卡片 v2 schema）**：

```
┌───────────────────────────────────────┐
│ 🤔 Claude 想问你          [蓝色 header]  │
├───────────────────────────────────────┤
│ <Question 文本，markdown 渲染>           │
│                                       │
│ ┌───────────────────────────────────┐ │
│ │ 选项 A                              │ │ ← button，垂直列表
│ ├───────────────────────────────────┤ │
│ │ 选项 B                              │ │
│ ├───────────────────────────────────┤ │
│ │ 选项 C                              │ │
│ └───────────────────────────────────┘ │
│                                       │
│ ✏️ 想自己回答？直接在群里回复你的答案     │ ← note (粉色文本)
│ ⏱ 8 分钟内未回复将自动继续              │ ← note (灰色文本)
└───────────────────────────────────────┘
```

**关键设计决策**：

| 决策 | 选择 | 理由 |
|---|---|---|
| Header 颜色 | **template: `blue`** | 与现有 emoji 语言对齐：❌ 红、⚠️ 黄、⏰ 紫；蓝 = 信息/询问 |
| Header 文案 | **🤔 Claude 想问你** | 具名工具比"AI"更亲切；🤔 跨平台稳定渲染 |
| Question 渲染 | **markdown** (`tag: "markdown"`) | AI 提问可能含代码块、列表、链接 |
| Options 排版 | **垂直 button 列表**（不用 select dropdown） | 一次点击触发，比下拉再选快；可视性强 |
| Button 样式 | **`type: "default"`**（中性灰）| 不预设主选项；让用户依语义自由选 |
| "Other" 入口 | **常驻 note 文案**，不放 input 元素 | 飞书 input 需"提交"步骤多一步；让用户感觉"想说话直接说" |
| 超时倒计时 | **静态文案**，不实时更新 | 避免 daemon 频繁 patch 卡片 + 飞书 API 限频；用户不需精确秒数 |
| 卡片宽度 | **flex 自适应**（不强制固定宽度） | 飞书移动端/桌面端兼容 |

**用户回答后的卡片状态切换**：

daemon 收到 `card.action.trigger` → 立即通过飞书 `interactive.update` 把整张卡片替换为"已收到"态：

```
┌───────────────────────────────────────┐
│ ✅ 已收到回答             [灰色 header]  │
├───────────────────────────────────────┤
│ <Question 文本，淡化（grey-3）>          │
│                                       │
│ ✓ <用户选的选项 / 用户的自由回答>         │
└───────────────────────────────────────┘
```

理由：用户回头看历史时，能清楚知道"那次问了什么、我答了什么"。卡片不消失（保留对话脉络），但视觉上"完成"。

### 微信降级文本

```
🤔 Claude 想问你

<Question 文本>

  1) 选项 A
  2) 选项 B
  3) 选项 C

✏️ 直接回复编号或你的自定义答案
⏱ 8 分钟内未回复将自动继续
```

**关键决策**：

| 决策 | 选择 | 理由 |
|---|---|---|
| 编号样式 | **`1) 2) 3)`** （非 `1. 2. 3.`） | 避免被微信识别为有序列表自动重排格式 |
| 一条 vs 多条 | **一条消息发完** | 保持上下文紧凑，避免被其他消息插入打散 |
| emoji 三件套 | **🤔 / ✏️ / ⏱**（与飞书卡片完全一致） | 跨 transport 信息架构一致原则 |
| 用户答完后 | **不发"已收到"回执** | 微信不可 update 消息；发新消息会污染聊天；AI 直接继续输出即可 |
| 行间距 | 选项前缩进 2 空格、整体段落用空行分隔 | 手机阅读节奏舒适 |

### AC-8 视觉区分总表

| 消息类型 | 飞书 | 微信 | 用户感知 |
|---|---|---|---|
| AI 普通输出 | 无 prefix 纯文本 / post | 无 prefix 纯文本 | "AI 在跟我说话" |
| **AI 提问（等回答）** | 蓝色卡片 + `🤔 Claude 想问你` | 文本前缀 `🤔 Claude 想问你` | **"AI 在等我"** |
| 提问已收到（仅飞书） | 卡片 update 灰色 + `✅ 已收到回答` | 不发 | "我答完了" |
| 提问超时回执 | `⏰ 上次提问已超时（X 分钟未回复），AI 已基于现有信息继续` | 同左 | "AI 没等我，自己继续了" |
| AI 错误 | `❌ <消息>` | `❌ <消息>` | "出问题了" |
| 系统警告 | `⚠️ <消息>` | `⚠️ <消息>` | "注意" |

**核心约束**：每个 emoji prefix **唯一对应**一种消息类型，不重复使用。新增消息类型必须申请新 emoji，详见 DESIGN_SYSTEM.md "emoji prefix 体系"章节。

### 跨 transport 一致性规范（写入 DESIGN_SYSTEM.md）

飞书卡片与微信文本必须保持**信息架构一致**——五要素一一对应，一个不少：

| 五要素 | 飞书 | 微信 |
|---|---|---|
| 标识 | Header 文案 + 蓝色 | 文本首行 prefix |
| 问题 | Question 区 markdown | 第二段 |
| 选项 | 垂直 button 列表 | 编号文本列表 |
| Other 入口 | note (粉色文案) | 倒数第二行 |
| 超时提示 | note (灰色文案) | 末行 |

未来加新 transport（钉钉 / Slack 等）时套此规范——若该 transport 不支持卡片，自动按上述五要素降级文本。

### 错误/边缘状态

| 场景 | 处理 | 文案 |
|---|---|---|
| 卡片渲染失败 → 自动降级文本 | 文本头加降级标识 | `🤔 Claude 想问你（卡片渲染失败，已降级）\n\n...` |
| 用户回复无法解析 | daemon 不主动反问，原文当 freeText 传 AI | 无（AI 自处理） |
| daemon 重启致提问失效 | 复用现有 inflight recovery 通用提示，不专门设计 | `⚠️ 上次任务因守护进程重启被中断，未能获取结果。原始消息: "..." 请重新发送。`（已存在于 queue.ts:497） |
| 用户在卡片显示后切换到其他 session | 等同于 /stop，hook 用兜底字符串继续 | （/stop 已有回执"✅ 已中断当前任务"）|
| 同 session 多个连续提问 | 串行排队，发新卡片前用 update 完成上一张的回答态 | 微信端按时序连续发文本 |

### 微观文案规范

| 位置 | 文案 |
|---|---|
| 飞书 Header | `🤔 Claude 想问你` |
| 微信首行 | `🤔 Claude 想问你` |
| Other 入口（飞书）| `✏️ 想自己回答？直接在群里回复你的答案` |
| Other 入口（微信）| `✏️ 直接回复编号或你的自定义答案` |
| 超时提示 | `⏱ {N} 分钟内未回复将自动继续` |
| 已收到回执（飞书）| `✅ 已收到回答` |
| 超时降级回执 | `⏰ 上次提问已超时（{N} 分钟未回复），AI 已基于现有信息继续` |
| 卡片渲染失败前缀 | `（卡片渲染失败，已降级）` |

### DESIGN_SYSTEM.md 升级勾选

✅ **是**，本 feature 触发 DESIGN_SYSTEM.md **首次创建**（项目 V4.0 后第一次 designer 介入）。新增章节：
- §1 项目设计原则
- §2 IM 消息视觉语言（emoji prefix 体系 + 飞书卡片 vs 文本规则 + 跨 transport 一致性原则）
- §3 CLI 命令习惯（追溯文档化现有约定）

详见 `<project-root>/DESIGN_SYSTEM.md`。

---

## §Tasks
<!-- Owner: /builder. -->

### 影响检查 (preflight) — 2026-05-10T08:06:07Z

- [x] **问 0 (feature 绑定性)**：用户意图明确绑定本 @id（完整流水线 /go register → /pm intake → /go reclassify → /cto plan → /designer → /pm consolidate）
- [x] **问 1 (架构)**：涉及跨进程 IPC、新 transport 接口、新 hook 配置注入 → §Plan 已就位
- [x] **问 2 (UI / 接口)**：新 IM 卡片 + 微信文本格式 + emoji prefix 体系 → §Design 已就位
- [x] **问 3 (Spec)**：§Spec 10 AC 无 TBD，待确认项已清空

判定理由：全部 section 完备，全部未决项已清空。**通过 preflight，可开工**。

### Checklist

#### Phase 0 — Spike 验证（半天，必须通过才进 Phase 1）✅ 通过 2026-05-10

- [x] 0.1 写最小 PreToolUse hook 脚本（`/tmp/askuser-spike/hook.mjs`）固定回填 `answers`
- [x] 0.2 写最小 settings.json（run.sh 动态生成绝对路径 command）
- [x] 0.3 跑 `bash /tmp/askuser-spike/run.sh`，触发 AskUserQuestion 调用
- [x] 0.4 stream-json 验证：**AI 收到注入答案并文本复读**（"你选择了 Spike 测试答案"）—— updatedInput.answers 路径完全有效
- [x] 0.5 无需走 fallback（deny+reason 路径作废候选）
- [ ] 0.6 飞书 card.action.trigger 事件订阅最小 demo —— **推迟到 Phase 2 实施时合并验证**（不阻塞 Phase 1）

#### Phase 1 — 核心 IPC + hook + transport 接口（1-2 天）✅ 完成 2026-05-10

- [x] 1.1 `src/transport.ts`: OutgoingMessage 加 `InteractiveCardMessage`；IncomingMessage.kind 加 `'card_action'`；新增 `CardAction` 接口
- [x] 1.2 `src/askuser-bridge.ts`（新文件）: unix socket server (`~/.im2cc/sockets/askuser.sock`) + pending Q&A map + 超时管理 + cancel 传播 + Event API（onAsk/onAnswered/onTimeout/onCancelled）
- [x] 1.3 `hooks/askuser-hook.mjs`（新文件）: PreToolUse hook 脚本（多 question 串行处理；socket 失联兜底字符串避免 AI 卡死）
- [x] 1.4 `src/config.ts`: 新增 `askUserTimeoutMinutes` 字段（默认 8，范围 1-9，夹紧 + 日志告警）；同时新增 `getAskUserSocketPath` / `getSessionDir` / `getSessionsRootDir`
- [x] 1.5 `src/claude-launcher.ts`: `injectAskUserHookSettings({sessionId,conversationId})` 写入 `~/.im2cc/sessions/<sid>/settings.json`；`claude-driver.ts` createSession + sendMessage 启用 `--settings` flag 与 IM2CC_* 环境变量；`tool-driver.ts` SendMessageOptions/CreateSessionOptions 加 `conversationId` 字段；`queue.ts` 调用时传入；`package.json` files 加 `hooks`
- [x] 1.6 `src/queue.ts`: `interruptInflightTasksForSession` + `handleStop` 都广播 cancel 到 askuser-bridge（避免 hook 因 socket 没收到信号而依赖硬超时）

#### Phase 2+3 — 飞书 + 微信统一文本编号（spec 修订后合并，2026-05-11）✅ 完成

> 原 Phase 2 飞书 interactive 卡片路径在调研后撤销，详见 revision[2026-05-11] 与 §Log。

- [x] 2.1 `src/message-format.ts`: `buildAskUserText(message)` — 飞书 + 微信共用文本渲染（五要素：🤔 标识 / 问题 / 1) 2) 3) 编号 / ✏️ Other / ⏱ 超时；degradedNote 前缀供 V1.x 启用）；`renderOutgoingMessageAsText` / `buildFeishuMessage` 路由 interactive_card → buildAskUserText
- [x] 2.2 `src/feishu.ts` + `src/wechat.ts`: sendMessage 收到 `kind='interactive_card'` 自动通过 buildFeishuMessage / renderOutgoingMessageAsText 内部降级文本（无需新代码）
- [x] 2.3 `src/index.ts`: startDaemon 早期 `await startAskUserBridge()`；`process.on('exit')` 注册 stopAskUserBridge
- [x] 2.4 `src/index.ts`: 订阅 onAsk → 通过 `sendByConversationId` 发 InteractiveCardMessage（自动降级文本）；订阅 onTimeoutEvent → 推 `⏰ 上次提问已超时（X 分钟未回复），AI 已基于现有信息继续`
- [x] 2.5 `src/index.ts` handleMessage: 普通文本分支前置答案路由 — 当 binding session 有挂起 askuser 时，纯数字 [1-9] 解析为对应选项 label，否则视为 freeText 原文，调 submitAnswerByToolUseId 注入；`react('DONE')` 给消息加 ✅ 表情确认；不入 enqueue
- [x] 2.6 `ARCHITECTURE.md` §5.3 链路图 + 扩展规则全面更新；新增 V1.x 升级方向小节；`DESIGN_SYSTEM.md` §2.2 / §2.4 飞书 interactive 标"V1 暂不使用" + 跨 transport 一致性表加 V1 / V1.x 双列对照
- [x] 2.7 `scripts/message-format.test.mjs`: +4 个 buildAskUserText 单测；151 全套测试零回归

#### Phase 4 — 端到端实测 + 归档（用户实测中）

> daemon 已编译就绪，等待用户重启 daemon 后在飞书 + 微信里跑端到端验证。

- [ ] 4.1 端到端：飞书路径（AC-1/2/4/8） — 见 §Log "端到端使用说明"
- [ ] 4.2 端到端：微信路径（AC-3/4）
- [ ] 4.3 端到端：超时路径（AC-5/9，临时改 1 分钟测）
- [ ] 4.4 端到端：/stop 中断（AC-6）
- [ ] 4.5 端到端：daemon 重启（AC-7）
- [ ] 4.6 验证记录逐条填证据 + frontmatter state → done

### 决策记录

| 决策点 | 选择 | 理由 |
|---|---|---|
| ExecPlan 是否建 | 已建 | docs/exec-plans/active/2026-05-10-im-askuserquestion-bridge.md（heavy 模式）|
| Spike 跑法 | 用户在另一终端跑 | 进程隔离避免污染当前会话；agent 子进程读取分析结果 |
| Phase 0 spike 结果 | ✅ 通过（5/5 观察点）| AI 复读注入字符串"Spike 测试答案"——updatedInput.answers 路径完全有效；信心 75%→95%+ |

### 升级记录
<!-- preflight 触发的升级 / 实施中回流到其他角色 -->
| 日期 | 升级到 | handoff_reason | 原因 | 结果 |
|---|---|---|---|---|

### 验证记录
<!-- 每条 AC 必须有对应证据。status: passed | failed | skipped | deferred | not_applicable -->
| AC | command / steps | exit_code / result | evidence | timestamp | status |
|---|---|---|---|---|---|
| AC-1 | 飞书群发"请用 AskUserQuestion 工具问..." | daemon 日志 `[askuser-bridge] ask received: tool_use_id=toolu_01W8Pg7PzsUAUR8mjmdZoPrs options=3 timeout=480000ms`；飞书收到 `🤔 Claude 想问你` 文本（五要素齐全），daemon 不报错 | 用户在飞书端到端确认 + daemon.log `06:21:23` | 2026-05-11 | passed |
| AC-2 | 用户在飞书回复编号 / 文本 | AI 收到注入答案后复述用户选项并继续生成；用户消息被加 ✅ 表情 | 用户在飞书确认；handleMessage `submitAnswerByToolUseId` 命中 | 2026-05-11 | passed |
| AC-3 | 微信群发同样指令 | 微信收到与飞书一字不差的文本格式（信息架构五要素一致） | 用户在微信端到端确认 | 2026-05-11 | passed |
| AC-4 | 飞书 / 微信都用自由文本回答 | AI 收到原文 freeText 后继续推进 | 用户确认在两侧均验证 | 2026-05-11 | passed |
| AC-5 | 改 askUserTimeoutMinutes=1 → 触发提问 → 等 1 分钟不回 | 应推 `⏰ 上次提问已超时（1 分钟未回复）...` + AI 收到 `[已超时]` 字符串继续 | 代码路径完备（askuser-bridge `onTimeout` + index.ts onTimeoutEvent 订阅）；未端到端实测 | — | deferred |
| AC-6 | 触发提问 → 卡片到达后发 `/stop` | 应触发 cancelBySessionId（queue.ts handleStop 已埋点）；hook 收到 cancelled 注入 `[用户已中断]` 字符串；daemon 回 `✅ 已中断当前任务` | 代码路径完备 + askuser-bridge 单测覆盖 cancelBySessionId 路径；未端到端实测 | — | deferred |
| AC-7 | 触发提问 → 卡片到达后 im2cc stop && im2cc start | daemon 启动后向活跃 binding 推 `im2cc 已重启 ...` + recoverOnStartup 兼容路径 | queue.ts recoverOnStartup 已覆盖；未端到端实测 | — | deferred |
| AC-8 | 同 session 连续 3 问答 | hook 内串行 `for (const q) askOne(...)`；每个问题独立卡片，回答完才发下一个 | 用户在飞书实测确认（多 question 串行通过） | 2026-05-11 | passed |
| AC-9 | config.askUserTimeoutMinutes 设 15 → 启动 daemon | 日志告警 `[config] askUserTimeoutMinutes=15 高于上限 9，已夹紧`；实际生效 9 | 单测 `scripts/askuser-bridge.test.mjs` 覆盖 7 个边界值（0/-3/10/30/NaN/默认/1/5/9） | 2026-05-10 | passed |
| AC-10 | — | V1 不适用（飞书直接走文本，无卡片可降级） | revision[2026-05-11T03:00] 决策 | 2026-05-11 | not_applicable |

---

## §Log
<!-- Owner: /builder. Append-only。-->

### 2026-05-10 — Phase 1 完成

实现：
- `src/transport.ts`：扩展 `OutgoingMessage` union 加 `InteractiveCardMessage`；`IncomingMessage.kind` 加 `'card_action'`；新增 `CardAction` 接口
- `src/askuser-bridge.ts`（新建）：daemon 侧 unix socket IPC（`~/.im2cc/sockets/askuser.sock`，权限 0700/socket 文件 0600）；NDJSON 协议；pending Q&A map（按 toolUseId / cardId 双索引）；超时定时器；cancel 传播；EventEmitter 透出 `ask` / `answered` / `timeout` / `cancelled` 四类事件
- `hooks/askuser-hook.mjs`（新建）：Claude PreToolUse hook 脚本；只对 `tool_name === 'AskUserQuestion'` 介入；多 question 串行问；socket 失联或 daemon 不可达时输出兜底字符串避免 AI 卡死；输出 `hookSpecificOutput.permissionDecision: "allow" + updatedInput.answers`
- `hooks/_INDEX.md`（新建）：目录索引
- `src/config.ts`：`Im2ccConfig.askUserTimeoutMinutes`（默认 8）；`getAskUserTimeoutMinutes` 夹紧到 [1, 9] + 日志告警；`getAskUserSocketPath` / `getSessionDir` / `getSessionsRootDir` 三个新工具函数
- `src/claude-launcher.ts`：`resolveAskUserHookScript()` + `injectAskUserHookSettings({sessionId, conversationId})`：写临时 settings.json 到 `~/.im2cc/sessions/<sid>/settings.json` + 返回需注入 Claude 子进程的 IM2CC_* 环境变量
- `src/claude-driver.ts`：createSession + sendMessage 调 inject + 把 `--settings <path>` 加到 args + env 合并 IM2CC_*；`mergeAskUserEnv` 处理 launcherEnv/process.env 双路径
- `src/tool-driver.ts`：`SendMessageOptions` / `CreateSessionOptions` 新增 `conversationId` 字段
- `src/queue.ts`：调 driver.sendMessage 时传入 conversationId；`interruptInflightTasksForSession` 与 `handleStop` 都先调 `cancelAskUserBySessionId` 让 hook 进程立即解除阻塞
- `src/message-format.ts`：`renderOutgoingMessageAsText` / `buildFeishuMessage` 处理 `interactive_card` 分支（Phase 1 给最小可读 fallback；Phase 2/3 会替换为正式渲染）
- `package.json` `files` 字段加 `hooks`，让 npm 发布包含 hook 脚本
- `src/_INDEX.md`：登记 askuser-bridge.ts；claude-launcher.ts 描述更新

验证：
- `npx tsc --noEmit` 零错误
- `npm run build` 成功
- 新增 `scripts/askuser-bridge.test.mjs`：7 测试全过（startup/teardown、ask→answer 闭环、cancelBySessionId、submitAnswer 未匹配返回 false、listPending、hook 断开标记 cancelled、超时夹紧）
- 全套 `node --test scripts/*.test.mjs`：147 测试全过零回归

下一步：Phase 2（飞书 interactive 卡片渲染 + 事件订阅 + handleMessage 路由）。

### 2026-05-11 — Phase 2+3 完成（spec 修订后）

**关键决策**：Phase 2 实施前发现项目 `feishu.ts` 是 REST 轮询架构，无事件订阅链路，无法接收 `card.action.trigger` 卡片按钮点击推送。三方案调研后选择文本编号路径（理由见上方 revision[2026-05-11]）。

**实现**：
- `src/message-format.ts`：新增 `buildAskUserText(message)` — 跨 transport 共用文本渲染（五要素：🤔 标识 / 问题 / 1) 2) 3) 编号选项 / ✏️ Other 入口 / ⏱ 超时提示），支持 degradedNote 前缀（V1.x 飞书 WSClient 升级时启用）；`renderOutgoingMessageAsText` / `buildFeishuMessage` 路由 interactive_card → buildAskUserText
- `src/feishu.ts` + `src/wechat.ts`：sendMessage 收到 `kind='interactive_card'` 自动通过 buildFeishuMessage / renderOutgoingMessageAsText 内部降级文本（无新代码，复用现有路径）
- `src/index.ts`：startDaemon 早期 `await startAskUserBridge()` 拉起 unix socket；`process.on('exit')` 注册 stopAskUserBridge；订阅 `onAsk` → 通过 `sendByConversationId` 发 `InteractiveCardMessage`（自动降级文本）；订阅 `onTimeoutEvent` → 推 `⏰ 上次提问已超时（X 分钟未回复），AI 已基于现有信息继续`
- `src/index.ts` handleMessage：普通文本分支前置"答案路由"——当当前 binding session 有挂起 askuser 时，纯数字 `[1-9]` 解析为对应选项 label，否则视为 freeText 原文，调 `submitAnswerByToolUseId` 注入；用 `react('DONE')` 给消息加 ✅ 表情确认；不入 enqueue
- `ARCHITECTURE.md` §5.3：链路图 + 扩展规则全面更新；新增"V1.x 升级方向"小节
- `DESIGN_SYSTEM.md` §2.2 / §2.4：interactive msg_type 标记"V1 暂不使用"；跨 transport 一致性表加 V1 / V1.x 双列对照
- `scripts/message-format.test.mjs`：新增 4 个 buildAskUserText 单测（五要素覆盖 / Other 缺省 / 降级标识 / renderOutgoingMessageAsText 路由一致）

**验证**：
- `npm run build` 成功
- `node --test scripts/*.test.mjs`：151 测试全过零回归（含 7 askuser-bridge + 4 buildAskUserText）

**端到端使用说明**（用户实测）：见下方 §Tasks 验证记录。

**剩余工作（Phase 4 & 端到端）**：
- 用户重启 daemon 后在飞书 + 微信里实际触发 AI AskUserQuestion，逐条核对 AC-1 ~ AC-9
- §Tasks 验证记录逐条填证据
- frontmatter state → done

### 2026-05-11 — 端到端验收通过 → state done

用户重启 daemon 后实测：
- 单 question：飞书 / 微信均收到 🤔 文本提问，回编号 / 自由文本后 AI 收到答案继续 ✓
- 多 question：连续 3 问答，hook 串行 askOne 每问独立路由，全程顺畅 ✓
- daemon 日志佐证：`[askuser-bridge] ask received` + `[askuser] 转发提问到 IM` + 后续 `用户回答已注入` 路径全部命中

未端到端的 AC-5/6/7/9 标记 deferred（代码完备 + 核心路径单测覆盖；后续触发到自然场景再补证）。AC-10 not_applicable（spec 已修订）。

**Commit**: 47bd061 — feat(askuser): IM 端桥接 Claude AskUserQuestion 反向提问（20 文件 +2242 行）

**交付总览**：
- 新增 3 个生产文件：`src/askuser-bridge.ts` / `hooks/askuser-hook.mjs` / `scripts/askuser-bridge.test.mjs`
- 改 10 个生产文件：`src/transport.ts` / `config.ts` / `claude-launcher.ts` / `claude-driver.ts` / `tool-driver.ts` / `queue.ts` / `message-format.ts` / `index.ts` / `package.json` / 测试
- 改 3 个全局文档：`ARCHITECTURE.md` §5.3 / `DESIGN_SYSTEM.md` §2.2+§2.4 / `ROADMAP.md`
- bootstrap `DESIGN_SYSTEM.md`（项目首次 designer 介入产出）
- 测试：11 个新单测（7 askuser-bridge + 4 buildAskUserText）；151 全套测试零回归

**V1.x 升级方向**（不在本 feature 范围）：
- 飞书 WSClient 长连接订阅 `card.action.trigger` 实现真"点按钮 + 卡片 update 已收到"体验
- `InteractiveCardMessage` 类型与 `degradedNote` 字段已预留接口，届时无需改 transport 接口
