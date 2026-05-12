# im2cc Architecture

> **维护者**：/cto。本文件由各 feature 的架构决策增量沉淀（见每个 feature 的 §Plan 段）。
> **首次创建**：2026-05-10，由 `@20260510-office-doc-relay` bootstrap。
> **不替代**：feature 级 §Plan（模块改动细节）、文件级头注释（@input/@output）、目录级 `_INDEX.md`（文件清单）。本文件只沉淀**全局约束 + 跨 feature 模式**。

---

## 1. 系统架构概览

```
┌─────────────────────┐         ┌─────────────────────┐
│  IM 层 (Transport)  │         │  工具层 (ToolDriver) │
├─────────────────────┤         ├─────────────────────┤
│ FeishuAdapter       │ ──────► │ ClaudeDriver        │
│ WeChatAdapter       │         │ CodexDriver         │
│ <未来>              │         │ GeminiDriver        │
└─────────────────────┘         └─────────────────────┘
       消息接收/回传                AI CLI 调用/会话管理
              │                              │
              └──────────► daemon ◄──────────┘
                          (单实例)
              │
              ▼
        ~/.im2cc/data/
        (registry / bindings / queue)
```

**两层抽象**（核心设计）：

| 抽象 | 接口 | 职责 |
|---|---|---|
| **TransportAdapter** | `src/transport.ts` | IM 通道：消息接收/发送/资源下载 |
| **ToolDriver** | `src/tool-driver.ts` | AI 工具：session 创建/恢复/消息发送/中断 |

**BaseToolDriver** (`src/base-driver.ts`) 提供通用 tmux 管理 / 进程中断 / 流式输出解析，三个 driver 继承复用。

新增 IM 通道或 AI 工具只需实现对应接口，核心代码零改动。

---

## 2. 核心技术栈

| 层 | 选型 | 选型理由 |
|---|---|---|
| 运行时 | Node.js >= 20 | TypeScript 原生支持；macOS 全局可用 |
| 语言 | TypeScript (ESM) | 与 Node 生态无缝 + 类型安全 |
| 守护 | macOS LaunchAgent | 系统级开机自启；用户态无需 root |
| 进程管理 | tmux | 用于 AI CLI 交互式 session 的容器（CLI 端用） |
| 飞书 SDK | `@larksuiteoapi/node-sdk` | 官方 SDK；已支持双域名 fallback (open.feishu.cn ↔ open.larksuite.com) |
| 微信 | ClawBot iLink (REST) | 第三方 bot 协议；无官方 IM 通道 |
| 配置 | JSON 文件 (~/.im2cc/) | 无 DB 依赖；原子写 + chmod 0600 |

**OS 限定**：仅 macOS（package.json `"os": ["darwin"]`）。

---

## 3. 数据存储

```
~/.im2cc/
├── config.json              # 飞书凭证、白名单、默认参数（chmod 0600）
├── wechat-account.json      # 微信 bot token (chmod 0600)
├── data/
│   ├── registry.json        # 命名 session 注册表（registry 是 session 身份的唯一权威）
│   ├── bindings.json        # IM ↔ session 绑定（transport + tool 感知）
│   ├── poll-cursors.json    # IM 消息轮询游标
│   ├── pending.json         # 待处理消息队列
│   ├── schedules.json       # 定时消息（at/in/cron）
│   └── inflight/            # 执行中任务的持久化 snapshot
└── logs/                    # daemon 日志

<project-cwd>/.im2cc-inbox/   # IM 上传文件的暂存目录（chmod 0600 + .gitignore + TTL 清理）
```

---

## 4. 架构红线（硬规则）

下列约束跨整个 daemon 生命周期生效，任何 feature 的 §Plan 不得违反。

### 4.1 daemon 单实例不变量
任何时刻只能有一个 daemon 进程。三层纵深防御：
- 启动时杀僵尸（`im2cc start` 内部）
- 运行时自检（每分钟一次 PID 校验）
- lock 文件（`~/.im2cc/daemon.pid`）
> 历史教训：2026-03-24 修复的最严重 bug 来自双 daemon 并发写 registry，导致 session 漂移。

### 4.2 registry 是 session 身份的唯一权威
- tmux session 命名只是进程管理标签，**不是身份**
- 所有 session lookup / 路由 / 绑定切换都必须通过 `registry.ts`
- /fc /fn /fk 等命令都依赖 registry 派生
- **tmux session 引用必须精确匹配**：所有 `tmux ... -t <name>` 调用必须用 `-t =<name>` 语法强制禁用 prefix match。否则当 session 名互为前缀时（如 `im2cc` / `im2cc01`），prefix match 会让前者命中后者，造成 has-session 误判、kill-session 误杀、attach 切到错的 session 等连锁问题。引入：`@20260512-fc-tmux-client-preempt` (2026-05-12)

### 4.3 独占访问
同一 session 同一时刻只能在一个端使用（电脑 tmux / 飞书 / 微信三端互斥），由 binding 机制保证。

### 4.4 mode-policy 是模式定义的唯一真相源
权限模式必须使用各工具 CLI 的原生名称（如 Claude `acceptEdits` / Codex `auto-edit`），**不自定义模式名**。所有映射在 `src/mode-policy.ts`。

### 4.5 非交互模式约束
daemon 通过 `claude -p` / `codex exec` 等非交互 flag 调用工具 CLI。**Plan 模式在此场景下不可用**——任何依赖 stdin 交互的 AI 能力都得换实现路径。

### 4.6 后台任务必须 CRUD 五件套
所有持久化的后台任务（schedule / cron / 订阅 / timer）必须提供 list / show / cancel / update / 触发回执，不只是创建入口。
> 历史教训：把存储约束误当交互模型，造成"任务建了找不回"。

### 4.7 远程交互的反向桥接强制（与 §4.5 互补）
**引入**：`@20260510-im-askuserquestion-bridge` (2026-05-10)

AI 工具在远程执行（IM 端经 daemon 调用）时若调用反向交互工具（典型代表：Claude 的 `AskUserQuestion`），不允许直接暴露非交互失败给用户——daemon 必须通过工具自身的 hook / 拦截机制接管，要么桥接到 IM 端，要么用注入答案优雅降级。

具体落实在该 feature §Plan：Claude PreToolUse hook + 本地 unix socket + 飞书 interactive 卡片 / 微信文本降级。

**约束**：
- 不允许"daemon 直接吞错让任务静默失败"
- 不允许"让 AI 看到工具不可用错误自行重试"导致循环
- 任何新增反向交互工具（未来若出现 AskUserPermission 等）必须按本红线套路接管

### 4.8 Gemini 进入维护模式
**引入**：2026-05-10（项目级决策，非单 feature）

Gemini 不再接受新功能开发，仅维持现有功能可用。原因：Gemini CLI 在远程交互场景下表现不稳定，长期投入 ROI 低。

**具体规则**：
- 新 feature 默认仅覆盖 Claude（+ Codex 视情况），Gemini 不在范围内
- 现有 Gemini 路径出现 bug 仍修，但不为 Gemini 增加新能力
- 相关 PR / spec 不再写"是否覆盖 Gemini"作为待确认项
- 若需彻底下线，单开 feature 走 abandonment 流程

---

## 5. 跨 Feature 模式

### 5.1 ToolCapabilities-Driven 文件处理策略
**引入**：`@20260510-office-doc-relay` (2026-05-10)

**问题**：不同 AI 工具对二进制文档（pdf/docx/xlsx/pptx）的处理能力不对称——Claude 自带 Anthropic document-skills plugin；Codex/Gemini 只能靠 prompt 引导自行 spawn 外部工具（pandoc / python / pdftotext 等）。

**模式**：在 `ToolCapabilities` 接口上声明文件处理能力，daemon 按 capability 选择 prompt 模板。

```typescript
interface ToolCapabilities {
  // ... 已有字段
  officeDocStrategy: 'native' | 'prompt-template'
}
```

| 策略 | 含义 | 当前 driver |
|---|---|---|
| `'native'` | 工具自带 skill/能力 | Claude（依赖 document-skills plugin）|
| `'prompt-template'` | 靠 prompt 引导工具自行 spawn 外部命令 | Codex / Gemini |

**Daemon 职责边界**：
- ✅ 仅做"必需的归一化"（如旧格式 .doc/.xls/.ppt 用 soffice 升格为新格式）
- ✅ 按 driver capability 注入不同 prompt 模板（统一在 `src/attachment-prompt.ts`）
- ❌ 不做"读懂内容"的工作（这是 AI 端职责）
- ❌ 不做工具链自检 / 自动安装（依赖管控由 AI 闭环：缺工具时 AI 在 IM 端引导用户安装）

**扩展规则**：
- 新增文件类型（如 epub、odt） → 在 `src/file-staging.ts` 扩白名单 + 决定是否需要 daemon 归一化
- 新增 driver → 实现 ToolCapabilities 时必须显式声明 `officeDocStrategy`，不允许 default
- prompt 模板话术变更 → 集中改 `src/attachment-prompt.ts`，不允许在 `index.ts` 散落 hardcode

### 5.2 IM 端文件暂存机制
**引入**：早于 V4.0（2026-04 之前；本节为追溯文档化）

文件从 IM 落地到 AI 工具的统一路径：
1. `TransportAdapter.downloadMedia()` 下载到 `<binding.cwd>/.im2cc-inbox/<messageId>.<ext>`（chmod 0600 + 目录自带 `.gitignore`）
2. `stageFile()` 暂存到 per-chat 内存队列
3. 用户下一条文本指令到达时，`consumeStaged()` 取出文件路径拼入 prompt
4. `runInboxCleanup()` 按 `inboxTtlMinutes` 周期清理过期文件

新增 IM 通道时，**必须实现 `downloadMedia`**；不实现则该通道不支持文件传输。

### 5.3 IM 反向交互桥接（PreToolUse hook + IPC + 文本编号）
**引入**：`@20260510-im-askuserquestion-bridge` (2026-05-10)
**V1 spec 修订**：2026-05-11（飞书 interactive 卡片改走文本编号；详见 feature revision）

**问题**：AI 工具（典型 Claude）在远程模式下调用 `AskUserQuestion` 等反向交互工具时，stdin 不可达，daemon 默认场景下任务会卡住或 AI 无限重试。

**模式**：在工具自身的 PreToolUse hook 中拦截目标工具，通过本地 IPC（unix socket）与 daemon 沟通，daemon 渲染**统一文本格式**到 IM 端等待用户回复，回填 hook 让工具调用直接拿到"答案"。

```
AI 调用 AskUserQuestion
    │
    ▼
Claude PreToolUse hook (hooks/askuser-hook.mjs，由 daemon 注入临时 settings.json)
    │  ↕ unix socket (~/.im2cc/sockets/askuser.sock，权限 0700/0600)
    ▼
daemon askuser-bridge.ts
    │
    ▼ TransportAdapter.sendMessage(InteractiveCardMessage) → 内部降级 buildAskUserText 文本
    │
    ▼
IM 端用户（飞书 + 微信完全一致格式）
    │
    ▼ 用户回 "1" / "JavaScript" / 自由文本（普通 text 路径）
    │
    ▼
daemon handleMessage 检测当前 binding session 有 pending askuser → submitAnswerByToolUseId 注入
    │
    ▼ socket → hook → hookSpecificOutput.updatedInput.answers
    ▼
AI 收到"工具调用成功+答案"，继续推进
```

**关键约束**：
- hook 命令默认超时 600s（10 分钟）—— **远程交互超时不可超 9 分钟**（默认 8）
- 用 `permissionDecision: "allow" + updatedInput.answers` 回填，不用 `deny`（避免 AI 重试循环）
- 超时降级：`answers` 注入 `[已超时] 用户未回复，请基于当前信息做合理假设并标注`，不让 AI 误以为是用户真实回答
- daemon 重启 → Claude 进程随之死亡 → 复用 §inflight recovery 提示，不另造持久化
- V1 飞书与微信都不依赖事件订阅 push（项目现有 REST 轮询模式不变）

**扩展规则**：
- 飞书 + 微信：统一文本格式（信息架构五要素：🤔 标识 / 问题 / 1) 2) 3) 编号选项 / ✏️ Other 入口 / ⏱ 超时提示）
- transport 接收 `InteractiveCardMessage` 时内部降级 `buildAskUserText` 文本，调用方不感知
- 新增 IM 通道：若想支持真按钮，需自建事件订阅子系统并实现 `kind:'card_action'` 路由；否则文本降级即可
- 未来新增反向交互工具（如 AskUserPermission），复用本架构，仅在 hook matcher 上加目标工具名

**V1.x 升级方向（不在 V1 范围）**：
- 飞书 WSClient 长连接订阅 `card.action.trigger` 实现真"点按钮 + 卡片 update 已收到"体验
- 评估前提：心跳/重连/错过事件补偿成本可接受

---

## 6. 验证管线

```bash
npm run build                                      # TypeScript 编译
node scripts/mode-policy.test.mjs                  # 模式映射测试
node scripts/tool-cli-args.test.mjs                # CLI 参数构造测试
node scripts/support-policy.test.mjs               # 支持矩阵测试
node scripts/office-upgrader.test.mjs              # office 升格测试 (@20260510-office-doc-relay)
bash scripts/smoke.sh                              # 端到端冒烟（需活跃 daemon + IM 凭证）
```

任何 §Plan 引入的新模块都应在此追加对应单测脚本。

---

## 修订记录

| 日期 | feature | 变更 |
|---|---|---|
| 2026-05-10 | @20260510-office-doc-relay | bootstrap ARCHITECTURE.md；引入 §5.1 ToolCapabilities-driven 文件处理策略；追溯文档化 §5.2 IM 文件暂存机制 |
| 2026-05-10 | @20260510-im-askuserquestion-bridge | 引入 §4.7（远程交互反向桥接强制，与 §4.5 互补）；§4.8（Gemini 维护模式，项目级决策）；§5.3（IM 反向交互桥接架构：PreToolUse hook + IPC + transport 卡片） |
| 2026-05-11 | @20260510-im-slash-passthrough | 无新红线 / 跨 feature 模式；spike 实证 `-p` / `exec` 非交互模式下纯"工具内置斜杠命令透传"不可行（仅 Claude /compact 例外）；feature 在 commands.ts 实现"会话控制 alias 层"——/clear /compact /model /status 注册为 im2cc 命令；详见 docs/features/20260510-im-slash-passthrough.md §Plan |
