# office-docs fixture

> 本目录仅含 `.gitignore` 和本 README 入 git；fixture 文件 local-only（避免敏感数据 + 文件大小）。
> 由 `@20260510-office-doc-relay` 在 2026-05-10 用 LibreOffice 26.2.3 生成。

## 用途

对 `@20260510-office-doc-relay` 的 8 条 AC 做端到端验证。每个 fixture 含一个**唯一短语**，AC 判定方式是"AI 回复必须包含该短语"——证明 AI 真正读到了文件内容（而非编造）。

## 文件清单与唯一短语

| 文件 | 类型 | 唯一短语 | AC 关联 |
|---|---|---|---|
| `sample.pdf`     | 新格式 | `OFFICE-DOC-RELAY-AC-FIXTURE-PDF-001` | AC-1 |
| `sample.docx`    | 新格式 | `OFFICE-DOC-RELAY-AC-FIXTURE-DOCX-001` | AC-2 |
| `sample.xlsx`    | 新格式 | `OFFICE-DOC-RELAY-AC-FIXTURE-XLSX-001` | AC-2 |
| `sample.pptx`    | 新格式 | `OFFICE-DOC-RELAY-AC-FIXTURE-PPTX-001` | AC-2 |
| `sample.doc`     | 旧格式 | `OFFICE-DOC-RELAY-AC-FIXTURE-DOC-001`  | AC-3（含 soffice 升格） |
| `sample.xls`     | 旧格式 | `OFFICE-DOC-RELAY-AC-FIXTURE-XLS-001`  | AC-3 |
| `sample.ppt`     | 旧格式 | `OFFICE-DOC-RELAY-AC-FIXTURE-PPTX-001`*| AC-3 |
| `corrupted.docx` | 损坏样本 | （8 字节 `0x00`，非合法 zip）| AC-6（错误降级判定）|

*注：`sample.ppt` 由 `sample.pptx` 经 `soffice --convert-to ppt` 转换而来，slide 内容继承 `PPTX-001` 短语；此为可接受现状，验证 AC-3 时仍可凭此唯一字符串判定 AI 是否读到内容。

## AC 验证流程（建议）

1. 启动 daemon：`im2cc start`
2. 在飞书 bot 群里 `/fc <session-name>` 接入一个绑定 Claude 的 session
3. 发送 fixture 文件 → 紧跟一句"请在回复中包含文件中出现的唯一短语原文"
4. 等待 AI 回复 → grep 短语是否出现
5. 切换到 Codex session 重复，验证 prompt-template 策略
6. corrupted.docx：发送后看回复是否含 "损坏" / "无法读取" / "降级" 之一（AC-6）
7. 卸载 LibreOffice 后发 `.doc`：看回复是否含 "安装" / "brew" / "soffice" 之一（AC-7）

## 重新生成

如需重新生成 fixture：

```bash
# 准备 LibreOffice (V1 唯一硬依赖)
brew install --cask libreoffice

# 生成步骤见本 feature 的 §Log "2026-05-10 阶段一"
```
