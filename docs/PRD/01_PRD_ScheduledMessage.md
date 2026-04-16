# 定时消息（Scheduled Message） - PRD

## 基本信息
- 文档版本：v1.0
- 创建日期：2026-04-17
- 关联路线图：暂无（首份 PRD，im2cc v0.4 增量功能）
- 关联实现：`src/scheduler.ts` / `schedule-store.ts` / `schedule-parser.ts`

## 背景

Claude Code 等 AI 工具有 5 小时配额窗口限制。开发者经常在配额耗尽时正处于半成品状态，等到下一个窗口开启需要立即继续，但用户不可能 24 小时盯着闹钟。

im2cc 原本的交互模式是"用户主动发消息 → AI 响应"。本功能要让 IM 端能挂一个"定时器"，到点自动以用户身份给本地某个 session 投递一条消息，触发 AI 在指定时刻继续工作——典型场景是配额窗口续接、晨会准备、周期性维护任务。

## 用户故事

**US-1（配额续接，主场景）**：作为开发者，我希望在飞书发"`/at 19:00 继续刚才的任务`"，以便配额恢复后 19:00 自动开工，下班回家时已有进展。

**US-2（晨会准备）**：作为开发者，我希望在飞书发"`/cron 0 9 * * 1-5 总结昨日 git log 准备站会`"，以便每个工作日早 9 点自动汇总昨日改动。

**US-3（短间隔触发）**：作为开发者，我希望发"`/in 2h 继续`"，以便 2 小时后自动唤起当前对话。

**US-4（管理回看）**：作为开发者，我希望在飞书发"`/at list`"，以便看到全部正在排队的定时消息（包含其他对话的），避免"半年前设的 cron 不知道还在跑"。

**US-5（远程取消）**：作为开发者，我希望发"`/at cancel <对话名>`"，以便不切换 session 也能停掉某个正在排的定时消息。

**US-6（替换覆盖）**：作为开发者，我希望对同一个 session 重新设定时消息时直接覆盖旧的，以便心智简单（不用先 cancel 再 set）。

## 功能描述

### 核心流程

```
[设置]
   /at 14:30 继续 → parseAt → upsertSchedule(name 主键) → setTimeout 挂载
   ↓
[持久化]
   ~/.im2cc/data/schedules.json（绝对时间戳 nextFireAt）
   ↓
[触发]
   timer 到点 → fireSchedule
     → 发回执到原 chat
     → 找当前 sessionId 的活跃 binding
        - 有：enqueue 走 queue，输出回当前接入端
        - 无：driver.sendMessage 直调，输出落日志
     → at/in：删除；cron：算下次重新挂 timer
   ↓
[管理]
   /at（无参，已绑定）→ 当前 session 的定时
   /at list → 全部 session 的定时
   /at cancel → 取消当前 session 的（需绑定）
   /at cancel <name> → 取消任意 session 的（无需绑定该 session）
```

### 功能点清单

#### 一、设置（已实现 v0.4）

1. `/at HH:MM <消息>` — 今天该时刻；已过推到明天
2. `/at YYYY-MM-DD HH:MM <消息>` — 绝对时刻；过去则报错
3. `/in <时长> <消息>` — 30s / 5m / 2h / 1d，可组合 1h30m
4. `/cron <分> <时> <日> <月> <周> <消息>` — 5 段标准 cron（不到秒）
5. 设置时要求当前 IM 群已绑定一个 session，且该 session 在 registry 已注册
6. 同 session 重复设置 → 覆盖旧的并在回执中提示"已替换"
7. 每个 session 同一时刻只允许一条定时消息（任何 kind）

#### 二、触发（已实现 v0.4）

8. nextFireAt 是绝对时间戳（ms epoch），daemon 重启时按"剩余 ms"重挂 setTimeout — **重启零漂移**
9. 错过窗口处理：
   - at / in：daemon 恢复后立即触发，回执标延迟分钟数
   - cron：跳过本次按下次正常算，回执告知错过原因
10. 触发时通过 `lookup(name)` 实时查 registry 拿 sessionId/cwd/tool — **fork 感知**（自动跟随 Claude session 漂移）
11. 触发时若目标 session 无任何 IM 端绑定，仍然投递到本地工具，输出仅写入日志
12. 触发回执发到**原创建 chat**（不论当前绑定状态变没变），格式包含触发类型、消息预览、投递结果说明

#### 三、管理（v0.4 缺口，本 PRD 补全）

13. `/at`（无参，需绑定）— 显示当前 session 的定时消息（已实现）
14. `/at cancel`（需绑定）— 取消当前 session 的定时消息（已实现）
15. **`/at list`（无需绑定，新增）** — 列出全部 session 的定时消息，按 nextFireAt 升序，每行包含：
    - session name
    - kind（at/in/cron）
    - spec（原表达式）
    - nextFireAt（绝对时间 + 相对时间）
    - 消息预览（截断 60 字符）
16. **`/at cancel <name>`（无需绑定该 session，新增）** — 远程取消指定 session 的定时消息
17. `/in list`、`/cron list` 等价于 `/at list`（语义统一，meta 入口）
18. `/in cancel <name>`、`/cron cancel <name>` 等价于 `/at cancel <name>`

## 验收标准

### 已实现部分（回归）
- [x] `/at 14:30 继续` 在今天 14:30（已过则明天）按时触发
- [x] `/at 2026-04-20 09:00 xx` 过去时间报错
- [x] `/in 60s xx` 60 秒后触发
- [x] `/cron 0 9 * * * xx` 每天 09:00 触发
- [x] 同 session 重复 /at 替换旧的并提示"已替换"
- [x] daemon kill 后重启，未到时间的 schedule 仍按原时间触发（零漂移）
- [x] 错过窗口的 at/in 立即触发，cron 跳过本次
- [x] 触发回执发到原 chat
- [x] 触发后 at/in 自动删除，cron 重算下次

### 本次新增
- [ ] `/at list` 在任何 chat 都能调用，无需该 chat 已绑定 session
- [ ] `/at list` 输出按 nextFireAt 升序
- [ ] `/at list` 单行包含 session name / kind / spec / 触发时间（绝对+相对）/ 消息预览
- [ ] `/at list` 在零定时消息时输出友好提示
- [ ] `/at cancel <name>` 在任何 chat 都能调用，成功取消并提示
- [ ] `/at cancel <name>` 当 name 不存在时友好报错（建议 `/at list`）
- [ ] `/at cancel`（无 name 参数且当前未绑定）友好报错（提示用 `/at cancel <name>` 或先 /fc）
- [ ] `/in list` 和 `/cron list` 行为等同 `/at list`
- [ ] `/in cancel <name>` 和 `/cron cancel <name>` 行为等同 `/at cancel <name>`
- [ ] 帮助文档（`/fhelp`）更新管理命令
- [ ] 全量测试通过（含本次新增 list/cancel 解析与 store 行为测试）

## 边界情况

### 做什么
- 全局 list：跨 session、跨 transport（飞书/微信群里都能调）
- 远程 cancel：按 session name 取消，无需该 session 当前绑定到本 chat
- meta 入口三命令同义：`/at|/in|/cron list`、`/at|/in|/cron cancel <name>`

### 不做什么
- ❌ 暂停/恢复（pause/resume）— 用 cancel + 重设替代，避免引入第三种状态
- ❌ 编辑（edit-in-place）— 用覆盖式重设替代
- ❌ 触发历史/审计日志 — daemon 日志已记录，不暴露到 IM
- ❌ 批量取消（`/at cancel all`）— 防误操作；多条逐一 cancel
- ❌ 跨 transport 的回执路由（飞书设的回执送到微信）— 始终回到原 chat

### 异常处理

| 异常情况 | 处理方式 |
|---|---|
| `/at list` 时 schedules.json 损坏 | 跳过损坏条目，照常列出剩余 |
| `/at cancel <name>` name 不存在 | 提示"未找到 <name> 的定时消息" + 建议 `/at list` |
| `/at cancel`（无 name 且当前无绑定） | 提示"请先 /fc 接入对话或用 /at cancel \<name\>" |
| `/at list` 输出超过 IM 单条上限（28KB 飞书 / 4KB 微信） | 截断并提示"还有 N 条未显示，回电脑端查看" |
| 设置时 session 不在 registry | 拒绝设置（已实现） |
| 取消时 session 已 fk 但 schedule 还在 | cancel 仍能成功（按 schedule.name 取消，不依赖 registry） |

## 待确认项

- [x] cron 表达式精度到秒？— 不需要（已确认）
- [x] 错过窗口阈值？— 一次性不限阈值，cron 跳过（已确认）
- [x] 每 session 多条还是单条？— 单条覆盖（已确认）
- [ ] **新增**：`/at list` 输出过长时是否做分页？— 当前提案：截断 + 提示，不做翻页。**待用户确认**。
- [ ] **新增**：`/at cancel <name>` 是否要二次确认（防误操作）？— 当前提案：不要，cancel 操作已可逆（重新设即可）。**待用户确认**。

## 修订记录

| 日期 | 版本 | 变更内容 |
|---|---|---|
| 2026-04-17 | v1.0 | 初版：覆盖 v0.4 已实现部分 + 补全管理面（list / cancel \<name\>） |
