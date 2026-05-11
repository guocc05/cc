# im2cc Design System

> **维护者**：/designer。本文件由各 feature 的设计决策增量沉淀（见每个 feature 的 §Design 段）。
> **首次创建**：2026-05-10，由 `@20260510-im-askuserquestion-bridge` bootstrap。
> **不替代**：feature 级 §Design（具体设计细节）、ARCHITECTURE.md（技术约束）、PROJECT.md（产品概述）。本文件只沉淀**全局视觉/交互规范**。

---

## 0. 项目 Surface

im2cc 是 CLI + IM 双 surface 工具：

| Surface | 触点 | 设计关注点 |
|---|---|---|
| **CLI** | 终端命令（fn / fc / fl / fk / fd / fs / im2cc subcommands） | 命令习惯、参数风格、help 文案、输出格式、错误信息 |
| **IM** | 飞书机器人 / 微信机器人 | 消息视觉语言、卡片设计、emoji prefix 体系、跨 transport 一致性 |

每个 feature 的 `interface_surface` 字段决定它涉及哪些 surface，相关章节生效。

---

## 1. 项目设计原则

1. **emoji prefix 是消息类型的视觉锚点**：用户通过开头的 emoji 一眼识别消息性质，不需要读完才理解
2. **跨 transport 信息架构一致**：同一信息在飞书卡片 / 微信文本 / 未来通道中，五要素必须一一对应（不少不多不换序）
3. **降级路径明示**：当富表达降级为文本（如卡片失败 / 微信无卡片能力）时，用户必须能看出"这是降级态"
4. **不打扰多于打扰**：用户没主动操作时，不主动 push 反馈消息（如微信不发"已收到"回执）
5. **CLI 短名字优先**：高频操作命令一律单字符或两字符（fn / fc / fl 等），低频或破坏性操作命令用全词（im2cc secure / im2cc reset）

---

## 2. IM 消息视觉语言

### 2.1 emoji prefix 体系（核心规范）

**每个 emoji prefix 唯一对应一种消息类型**，不复用、不重复使用。新增消息类型必须申请新 emoji，更新本表。

| Emoji | 消息类型 | 使用场景 | 用户应感知 | 引入 |
|---|---|---|---|---|
| （无 prefix） | AI 普通输出 | AI 工具的流式 / 终态输出 | "AI 在跟我说话" | 项目初始 |
| `⏳` | 排队提示 | 任务排队中 | "稍等，前面还有任务" | 项目初始（queue.ts）|
| `✅` | 命令成功回执 | /stop、/fc、/fn 等命令的成功反馈 | "我的命令做完了" | 项目初始 |
| `❌` | 错误 | AI 工具失败 / 系统错误 | "出问题了" | 项目初始（output.ts:54）|
| `⚠️` | 系统警告 | 截断、降级、状态告警 | "注意一下" | 项目初始 |
| `⏰` | 定时消息触发 / 超时回执 | scheduler 触发 / 提问超时 | "时间到了" | 项目初始（scheduler.ts:131）/ @20260510-im-askuserquestion-bridge |
| `🕐` | 当前定时消息状态 | 查询定时消息时的展示头 | "这是当前的定时消息" | 项目初始（scheduler.ts:235）|
| `🤔` | **AI 提问（等回答）** | AI 调用 AskUserQuestion 类反向交互 | **"AI 在等我"** | @20260510-im-askuserquestion-bridge |
| `✏️` | Other / 自由输入引导 | 提问卡片中提示用户可自由回答 | "我可以自己说" | @20260510-im-askuserquestion-bridge |
| `⏱` | 超时倒计时提示 | 卡片中显示等待上限 | "我得在 X 时间内答" | @20260510-im-askuserquestion-bridge |

**禁止**：
- 不允许同一消息类型在不同上下文用不同 emoji
- 不允许 AI 普通输出加 prefix（破坏 AI 输出的"原汁原味"）
- 不允许在 AI 输出文本内嵌入这些保留 emoji 作随机修饰（与系统语义冲突）

### 2.2 飞书消息形式选择规则

飞书 SDK 支持 4 种 msg_type，按优先级选用：

| msg_type | 何时用 |
|---|---|
| `text` | AI 普通流式输出 / 单段消息 / 短系统回执 / **AskUserQuestion 反向提问（V1）** |
| `post` | 多段结构化系统消息（多 section + 可选 title），见 `OutgoingMessage.PanelMessage` |
| `interactive` | 暂不使用 — V1 项目无事件订阅推送链路；V1.x 评估 WSClient 长连接后再启用 |
| `image` / `file` | 文件传输回执（office-doc-relay feature 使用）|

**关于 `interactive` 的暂缓决策**（2026-05-11）：
- 项目当前 `feishu.ts` 是 REST 轮询模式，没有事件订阅 push
- 飞书 button 点击回调依赖 `card.action.trigger` 推送，必须自建 WSClient 长连接 + 心跳/重连/失败补偿
- 为本 feature 引入这个子系统不划算（详见 ARCHITECTURE §5.3）
- V1 飞书与微信都走 `text`，信息架构完全一致

### 2.3 微信降级规则

微信（ClawBot iLink）目前**只支持纯文本**。任何飞书侧的富表达必须有微信文本降级版本：

| 飞书侧 | 微信降级 |
|---|---|
| `post` 多段结构 | 平铺为多行文本，section title 用 `**title**：` |
| `interactive` 卡片（V1.x 后） | 五要素平铺为单条文本，编号用 `1)` 而非 `1.`（避免被识别为有序列表自动重排）；编号纯数字用户回复 → 选项 label，自由文本 → 原文 |

### 2.4 跨 transport 一致性原则

**信息架构必须一致**——同一份语义在不同 transport 中表达时，五要素一一对应：

以 AI 提问为例（V1 飞书 + 微信完全一致格式）：

| 五要素 | 飞书 + 微信（V1） | 飞书 interactive 卡片（V1.x 升级方向） |
|---|---|---|
| 标识 | 文本首行 `🤔 Claude 想问你`（可选 `（卡片渲染失败，已降级）` 后缀） | Header 文案 + 蓝色 template |
| 问题 | 第二段（独立段，前后空行） | Question 区 markdown 渲染 |
| 选项 | `1) 选项 A` / `2) 选项 B` 编号文本列表 | 垂直 button 列表 |
| Other 入口 | `✏️ 直接回复编号或你的自定义答案` | note 粉色文案 |
| 超时提示 | `⏱ N 分钟内未回复将自动继续` | note 灰色文案 |

未来加新 transport（钉钉 / Slack 等）时套此规范——若该 transport 不支持卡片，按 V1 文本格式降级。

---

## 3. CLI 命令习惯（追溯文档化）

### 3.1 命令命名

| 类型 | 风格 | 例 |
|---|---|---|
| 高频会话操作 | **单字符或两字符短名** | `fn` (new) / `fc` (connect) / `fl` (list) / `fk` (kill) / `fd` (disconnect) / `fs` (status) |
| IM 端控制命令 | **`/` 前缀** | `/mode` / `/stop` / `/at` / `/in` / `/cron` |
| 管理操作 | **完整动词** | `im2cc start` / `im2cc stop` / `im2cc secure` / `im2cc reset` |
| 工具切换 | **`fn-<tool>` 别名** | `fn-codex` / `fn-claude` / `fn-gemini` |

**为什么**：高频操作单字符降低肌肉记忆负担；管理操作全词避免误触。

### 3.2 参数风格

- **位置参数**：name 在前、path 在后（`fn auth ~/Code/foo`）
- **可选 flag**：`--tool <name>`、`--mode <mode>` 等长名
- **不用短 flag**（`-t` `-m`）——避免与短命令名混淆，提升可读性

### 3.3 命令输出

| 输出场景 | 风格 |
|---|---|
| 成功回执 | `✅ <一句话>`（如 `✅ 已中断当前任务`）|
| 失败 | `❌ <一句话>`（exit code 非零）|
| 警告但不阻塞 | `⚠️ <一句话>` |
| 列表（fl / list） | 表格形式，列对齐；空时 `(无数据)` |
| 多段状态（fs / status） | 标题 + 分节，section title 用 `:` 结尾 |

### 3.4 错误消息

错误消息必须**告诉用户下一步怎么办**，不只是描述问题：

- ❌ 反例：`Error: session not found`
- ✅ 正例：`❌ session "abc" 不存在。请用 fl 查看可用 session，或用 fn 创建新会话。`

---

## 4. 设计系统的扩展规则

新 feature 引入 UI / 交互决策时：

1. **复用优先**：先看本 DS 是否已有规范覆盖
2. **若需新增** emoji / 命令风格 / 卡片样式：在对应 feature 的 §Design 段写明，并把规范回写本文件相应章节
3. **若需修改既有规范**（如改 emoji 含义）：触发 SYSTEM-CHANGE 流程，必须 BLOCKING 用户确认（影响所有现有 feature）
4. **追溯文档化**：发现现有未文档化的实践（如 `⏳` emoji 一直在用但 DS 没写），把它写入本文件，记修订记录

---

## 修订记录

| 日期 | feature | 变更 |
|---|---|---|
| 2026-05-10 | @20260510-im-askuserquestion-bridge | bootstrap DESIGN_SYSTEM.md；§1 项目设计原则；§2 IM 消息视觉语言（emoji prefix 体系 + 飞书消息形式选择 + 微信降级 + 跨 transport 一致性）；§3 CLI 命令习惯（追溯文档化）；新增 emoji 🤔 ✏️ ⏱（提问交互），追溯既有 ⏳ ✅ ❌ ⚠️ ⏰ 🕐 |
| 2026-05-11 | @20260510-im-askuserquestion-bridge | V1 飞书 interactive 卡片暂缓 — 调研后决策飞书与微信均走 text 编号格式（信息架构一致）；§2.2 标记 interactive 暂不使用 + 写入暂缓理由；§2.4 跨 transport 一致性表新增 V1 / V1.x 双列对照 |
