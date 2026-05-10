---
schema_version: 1

id: 20260510-fix-classify-no-ext-shadow
title: fix — classifyFile 无扩展名早返回，遮蔽 Dockerfile/Makefile 分类
state: done
type: fix
size: XS
version: Unscheduled

current_owner: null
last_actor: builder
handoff_reason: null

created_at: 2026-05-10T03:00:00Z
updated_at: 2026-05-10T04:30:00Z

depends_on: []
related: ["20260510-office-doc-relay"]
links:
  pr: ""
  issue: ""
  branch: ""
  deploy: ""

commit_range: "pending — 用户尚未 commit；改动文件：src/file-staging.ts + scripts/office-upgrader.test.mjs"

revision:
  - date: 2026-05-10T03:00:00Z
    actor: pm
    from_state: null
    to_state: spec_ready
    from_owner: null
    to_owner: builder
    handoff_reason: needs_builder_build
    action: "from-bug-report: 由 @20260510-office-doc-relay builder 阶段意外发现；XS 修复，spec 直接成稿（无 intake 必要）"
  - date: 2026-05-10T04:00:00Z
    actor: builder
    from_state: spec_ready
    to_state: building
    from_owner: builder
    to_owner: builder
    handoff_reason: null
    action: "preflight 三问全否；进入 BUILD 模式"
  - date: 2026-05-10T04:30:00Z
    actor: builder
    from_state: building
    to_state: done
    from_owner: builder
    to_owner: null
    handoff_reason: null
    action: "AC-1..AC-8 全部 passed；23 个 mjs 测试套件无回归"
---

# fix — classifyFile 无扩展名早返回，遮蔽 Dockerfile/Makefile 分类

## §Spec

### 背景

`src/file-staging.ts:79` 的 `classifyFile()` 函数有一个早返回 bug：

```typescript
export function classifyFile(fileName: string): FileCategory {
  const ext = path.extname(fileName).slice(1).toLowerCase()
  if (!ext) return 'unsupported'                          // ← 早返回
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (OFFICE_EXTENSIONS.has(ext)) return 'office'
  // 特殊无扩展名文件（如 Dockerfile, Makefile）通过文件名匹配
  const baseName = path.basename(fileName).toLowerCase()
  if (baseName === 'dockerfile' || baseName === 'makefile') return 'text'  // ← 永远到不了
  return 'unsupported'
}
```

无扩展名文件（`Dockerfile` / `Makefile`）会在 `if (!ext)` 处直接 return `'unsupported'`，永远到不了底部的 baseName 检测分支。

**与文档/注释意图不符**：
- 注释明示"特殊无扩展名文件（如 Dockerfile, Makefile）通过文件名匹配"
- `TEXT_EXTENSIONS` 集合也包含 `'dockerfile'` / `'makefile'`（说明设计者意图它们归 text）
- `src/_INDEX.md` 描述 file-staging 为"格式校验"，未提示对无扩展名文件的弃疗

**何时发现**：在 `@20260510-office-doc-relay` 的 builder 阶段写新单测时，按预期断言 `classifyFile('Dockerfile') === 'text'` 失败；触发即时定位。

### 用户故事

作为一名移动端用户，我希望从 IM 发送项目里的 `Dockerfile` 或 `Makefile` 给本地 AI 工具时，文件能被识别为文本类正常下载、暂存、拼进 prompt——而不是被误判为"不支持的格式"拒收。

### 核心流程

1. 用户在 IM 发送名为 `Dockerfile`（无扩展名）的文件
2. im2cc 接收 → `classifyFile('Dockerfile')` → 返回 `'text'`
3. 文件按 text 路径下载到 inbox 暂存
4. 用户下条文本指令到达时，文件路径正常拼进 prompt 给 AI

### 验收标准

- **AC-1**: `classifyFile('Dockerfile')` 返回 `'text'`
- **AC-2**: `classifyFile('Makefile')` 返回 `'text'`
- **AC-3**: `classifyFile('dockerfile')` 返回 `'text'`（小写）
- **AC-4**: `classifyFile('MAKEFILE')` 返回 `'text'`（大写）
- **AC-5**: `classifyFile('')` 仍然返回 `'unsupported'`（空文件名仍归不支持，避免引入回归）
- **AC-6**: `classifyFile('foo')` 返回 `'unsupported'`（任意无扩展名 + 不在白名单 → 仍归不支持）
- **AC-7**: 现有所有 file-staging 相关单测仍通过（无回归）
- **AC-8**: 同步把 `@20260510-office-doc-relay` 的 `scripts/office-upgrader.test.mjs` 里反映此 bug 现状的断言改回"应有的正确断言"（assert `'text'`）+ 删除"预存在 bug"的注释

### 边界

**做什么**：
- 修 `src/file-staging.ts` 的 `classifyFile()` 早返回逻辑
- 顺手在 `scripts/office-upgrader.test.mjs` 把 Dockerfile 断言改回 `'text'`，删 bug 注释

**不做什么**：
- 不扩展无扩展名文件支持范围（不加 LICENSE / Procfile / Rakefile 等其他常见无扩展名文件——若需扩展另建 feature）
- 不改 IMAGE / OFFICE 的分类逻辑
- 不改 `TEXT_EXTENSIONS` 集合内容

**异常处理**：
| 异常 | 处理 |
|---|---|
| `classifyFile(undefined)` | 已由 TypeScript 类型守卫保证 — 无需运行时处理 |
| 文件名含路径（如 `path/to/Dockerfile`）| `path.basename()` 已剥离路径，正常工作 |

### 待确认项
（无）

---

## §Plan
<!-- Owner: /cto. XS 修复无需独立 §Plan；实现路径已在 §Spec 暗含。 -->

修复方法（建议）：调整 `classifyFile()` 顺序——把 baseName 检测前置到 `if (!ext)` 之前，或把 `if (!ext)` 改为 `if (!ext && baseName !== 'dockerfile' && baseName !== 'makefile')`。前者更清晰。

```typescript
export function classifyFile(fileName: string): FileCategory {
  const baseName = path.basename(fileName).toLowerCase()
  if (baseName === 'dockerfile' || baseName === 'makefile') return 'text'
  const ext = path.extname(fileName).slice(1).toLowerCase()
  if (!ext) return 'unsupported'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (OFFICE_EXTENSIONS.has(ext)) return 'office'
  return 'unsupported'
}
```

新依赖：无。
回归风险：极低（只把 baseName 检测从"after ext check"移到"before ext check"，不改其他分支语义）。

---

## §Design
<!-- 无 UI 决策 -->

---

## §Tasks
<!-- Owner: /builder. -->

### 影响检查 (preflight)

- [x] **问 0**：用户意图明确绑定到本 @<id>？— 是（用户直接 `/builder @20260510-fix-classify-no-ext-shadow`）
- [x] **问 1 (架构)**：涉及数据模型 / API / 权限 / 后台任务 / 跨模块边界 / 新依赖？— 否（纯函数局部修复）
- [x] **问 2 (UI)**：涉及新页面 / 新命令 / 新 API / 全局 token？— 否
- [x] **问 3 (Spec)**：§Spec 仍有"待确认项"或 AC 含 "TBD"？— 否（所有 AC 明确）

### Checklist

- [x] T1：调整 `src/file-staging.ts:classifyFile()` 把 baseName 检测前置
- [x] T2：在 `scripts/office-upgrader.test.mjs` 加 4 条 Dockerfile/Makefile 大小写断言（AC-1..AC-4）+ 2 条边界断言（AC-5..AC-6）
- [x] T2.1：把当前 office-upgrader.test.mjs 中"反映 bug 现状"的 `Dockerfile === 'unsupported'` 断言改为 `=== 'text'`，并删除 bug 注释
- [x] T3：跑 `npm run build` + 全部 23 个 mjs 测试，无回归
- [x] T4：state → done；commit_range 暂记 pending（用户尚未 commit）

### 决策记录
| 决策点 | 选择 | 理由 |
|---|---|---|
| 修复方式 | 把 baseName 检测前置到 `if (!ext)` 之前 | §Plan 推荐方案 A；逻辑顺序更直观，避免在 `if (!ext)` 表达式里嵌套白名单条件 |
| 测试组织 | 拆成 3 个 it：现有 categories（保留）+ extensionless special files（AC-1..AC-4）+ unsupported semantics（AC-5..AC-6） | 三组语义清晰；失败定位更快 |
| 注释 | 在源码 baseName 检测处加一句"否则会被 !ext 早返回遮蔽" | 解释 why（防止未来重构时回归 bug），不解释 what |

### 升级记录
| 日期 | 升级到 | handoff_reason | 原因 | 结果 |
|---|---|---|---|---|

### 验证记录
| AC | command / steps | exit_code / result | evidence | timestamp | status |
|---|---|---|---|---|---|
| AC-1 | `node --test scripts/office-upgrader.test.mjs` (test 6 第 1 条 assert) | exit 0 — `classifyFile('Dockerfile') === 'text'` | test #6 ok | 2026-05-10T04:25+08:00 | passed |
| AC-2 | 同上，test 6 第 2 条 assert | exit 0 — `classifyFile('Makefile') === 'text'` | test #6 ok | 2026-05-10T04:25+08:00 | passed |
| AC-3 | 同上，test 6 第 3 条 assert | exit 0 — `classifyFile('dockerfile') === 'text'` | test #6 ok | 2026-05-10T04:25+08:00 | passed |
| AC-4 | 同上，test 6 第 4 条 assert | exit 0 — `classifyFile('MAKEFILE') === 'text'` | test #6 ok | 2026-05-10T04:25+08:00 | passed |
| AC-5 | 同上，test 7 第 1 条 assert | exit 0 — `classifyFile('') === 'unsupported'` | test #7 ok | 2026-05-10T04:25+08:00 | passed |
| AC-6 | 同上，test 7 第 2 条 assert | exit 0 — `classifyFile('foo') === 'unsupported'` | test #7 ok | 2026-05-10T04:25+08:00 | passed |
| AC-7 | `for f in scripts/*.test.mjs; do node --test $f; done` | 23/23 套件 pass，0 fail | 总计 ~145 个 test 全过 | 2026-05-10T04:27+08:00 | passed |
| AC-8 | `git diff scripts/office-upgrader.test.mjs` | Dockerfile 断言改为 `'text'`，bug 注释 2 行已删 | 见 unstaged diff | 2026-05-10T04:25+08:00 | passed |

---

## §Log
<!-- Owner: /builder. -->

- **2026-05-10 04:30 (builder, v1.0)** — 初始修复完成。
  - 改动 `src/file-staging.ts:classifyFile()`：把 `path.basename().toLowerCase()` 的 dockerfile/makefile 检测前置到 `if (!ext)` 之前，根因消除。
  - 改动 `scripts/office-upgrader.test.mjs`：删 bug 注释 2 行，把 `Dockerfile === 'unsupported'` 断言改回 `=== 'text'`，新增 `classifyFile recognizes extensionless special files (case-insensitive)` 和 `classifyFile keeps unsupported semantics for empty / unknown extensionless names` 两个 test，覆盖 AC-1..AC-6。
  - 验证：`npm run build` 通过；23 个 `scripts/*.test.mjs` 全过（office-upgrader 自身从 8→10 test，其余无变化）。
  - **commit_range pending**：当前工作区还有 `@20260510-office-doc-relay` 的衍生改动未 commit；建议用户在下次 commit 时把这两个文件单独成一个 `fix(file-staging): ...` commit，commit 后再回填本 feature frontmatter 的 `commit_range`。
