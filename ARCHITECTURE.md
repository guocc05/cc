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

### 4.3 独占访问
同一 session 同一时刻只能在一个端使用（电脑 tmux / 飞书 / 微信三端互斥），由 binding 机制保证。

### 4.4 mode-policy 是模式定义的唯一真相源
权限模式必须使用各工具 CLI 的原生名称（如 Claude `acceptEdits` / Codex `auto-edit`），**不自定义模式名**。所有映射在 `src/mode-policy.ts`。

### 4.5 非交互模式约束
daemon 通过 `claude -p` / `codex exec` 等非交互 flag 调用工具 CLI。**Plan 模式在此场景下不可用**——任何依赖 stdin 交互的 AI 能力都得换实现路径。

### 4.6 后台任务必须 CRUD 五件套
所有持久化的后台任务（schedule / cron / 订阅 / timer）必须提供 list / show / cancel / update / 触发回执，不只是创建入口。
> 历史教训：把存储约束误当交互模型，造成"任务建了找不回"。

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
