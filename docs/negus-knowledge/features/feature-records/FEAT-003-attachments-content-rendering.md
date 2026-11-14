---
feature_id: FEAT-003
title: 附件与对话内容渲染
status: implemented_pending_review
current_version: v0.3.0
last_updated: 2026-07-25 22:49 +08:00
owners: [attachments, content_rendering, media]
key_paths:
  - web-ui/src/features/attachments
  - web-ui/src/features/conversations/rendering
  - windows/server/content-blocks.mjs
  - windows/server/media-service.mjs
---

# FEAT-003：附件与对话内容渲染

## 当前快照

- 对话支持 Markdown、代码、表格、选项、图片、音频、视频和普通文件块。
- 单人页和群聊共用附件选择、预览、上传状态和移除能力。
- 本地结构化图片和 Markdown 本地图片会登记到受控媒体服务，再通过带权限的 `/api/media/<id>` 加载。
- 每个附件当前限制 `20 MB`，一次最多 `6` 个；尚无分片、断点续传和字节级进度。

## 用户可见结果

用户可以从输入框选择图片或文件并发送；图片直接显示，音频和视频使用浏览器控件，其他文件提供打开/下载。上传时会显示阶段提示。浏览器不能任意读取电脑路径，只能访问服务端已经登记的媒体。

## 目标与边界

目标：保证真实 Codex 对话中的主要内容类型不会被压平成错误文本，并提供最小可用的附件发送链路。

当前不解决：

- 任意 HTML 在页面内直接执行；HTML 默认作为文件打开或下载；
- 大文件分片、断点续传、病毒扫描和云对象存储；
- 允许浏览器传入任意绝对路径读取本机文件；
- 复杂办公文档在对话内完整编辑。

## 架构与数据链路

```text
Codex item / JSONL content
  -> content-blocks parser
  -> ContentBlock[]
  -> ContentRenderer

Browser selected files
  -> attachmentApi
  -> media-service registration
  -> attachment IDs
  -> Codex message / group message

Local image path in Markdown
  -> server-side recognition
  -> media-service.register
  -> /api/media/<id>
  -> withAccessToken
```

## 开发计划与关键决策

- 内容解析属于服务端/数据层，视觉展示属于 renderer，上传草稿属于 attachments 功能域。
- 媒体必须通过登记 ID 访问，不增加“客户端传绝对路径”的通用接口。
- HTML 等高风险内容不直接嵌入执行；当前优先下载或新窗口打开。
- 性能上图片懒加载，音视频使用 `preload=metadata`，避免会话加载时下载全部媒体。

## 问题记录

| 问题编号 | 分类 | 状态 | 问题 | 根因与正确路径 |
| --- | --- | --- | --- | --- |
| `FEAT-003-I01` | 特例 | resolved | 纯文本模型破坏图片、选项和文件结构 | 解析层只保留 text；改为 `ContentBlock` 判别联合类型 |
| `FEAT-003-I02` | 特例 | resolved | Markdown 中本地绝对路径图片显示破图 | 浏览器不能读取 `C:/...`；服务端识别并登记到 media-service |
| `FEAT-003-I03` | 特例 | mitigated | 上传只有阶段提示，没有百分比 | 当前请求协议没有字节进度事件；正式大文件能力需单独设计 |
| `FEAT-003-I04` | 普适 | active | 曾只从前端理解图片渲染，遗漏服务端安全边界 | 见 `PROC-001`；媒体功能必须同时核对解析、登记、鉴权和渲染 |

## 版本时间线

### 2026-07-22 | v0.1.0 | implemented

- 计划：修复真实对话内容被错误压平的问题。
- 实际：建立结构化内容块和独立 `ContentRenderer`。
- 偏差：当时只覆盖已结构化媒体，本地 Markdown 路径仍未解决。
- 问题：`FEAT-003-I01` resolved；`FEAT-003-I02` 尚未发现。
- 验证：见 `../../records/DEVELOPMENT_LOG_2026-07-22.md`。
- Git：相关变化进入 `8cf1e3e` 前后的开发线。

### 2026-07-25 00:04 +08:00 | v0.2.0 | implemented_pending_review

- 计划：让输入框可以发送图片和其他附件。
- 实际：完成选择、预览、上传、ID 解析和单人/群聊消息附件。
- 偏差：上传进度仍为阶段提示。
- 问题：`FEAT-003-I03` mitigated。
- 验证：见 `../../records/DEVELOPMENT_BUG_LOG_2026-07-25.md`。
- Git：`5a8ad71`。

### 2026-07-25 22:49 +08:00 | v0.3.0 | implemented_pending_review

- 计划：修复助手 Markdown 本地图片并统一附件反馈。
- 实际：本地 Markdown 图片接入 media-service；单人和群聊共享上传状态组件。
- 偏差：没有扩展任意本地文件读取接口，保持最小安全范围。
- 问题：`FEAT-003-I02` resolved；`FEAT-003-I04` 转为普适经验。
- 验证：两张测试图片通过 `/api/media/...` 加载，构建和定向测试通过。
- Git：`5a8ad71`。

## 下一步

### 2026-09-30：共享代码块展示（handoff_pending）

- 用户确认排除发送前输入框；本轮仅处理对话代码和运行命令，重复答案问题暂缓。
- 基线 `codex/publish-current-panel` / `c8c7b66`，保留已有未提交改动。
- 新增共享 `CodeBlock`，使用原生 details/summary 折叠，提供全文复制与限定高度的代码视图。命令默认收起为一行；助手 Markdown 代码超过 500 字符收起。行内代码不受影响。
- 用户消息沿用外层 500 字折叠，展开后代码使用共享组件但不再嵌套折叠；截断预览不提供代码复制，避免复制残缺内容。完整消息复制入口保留。
- `MarkdownContent` 显式启用新组件，群聊、文件预览及其他调用保持旧行为；不改命令执行、停止、存储与输入框。运行命令沿用 activity.id，不以正文变化重置原生展开状态；卸载重挂载后默认收起。
- 验证：TypeScript、隔离 Vite 构建通过；实际 React 静态渲染验证 500/501 门槛、用户单层折叠、命令全文、行内代码与其他 Markdown 调用方。构建目录 `runtime/codeblock-validation`，未覆盖线上前端。
- 限制：真实浏览器点击、剪贴板权限、流式更新和虚拟列表滚动未验收；未发布、未重启、未提交。

- 根据真实文件大小决定是否需要字节级进度和分片上传。
- 新内容类型先扩展 `ContentBlock`，不要在页面组件中加入字符串猜测。
- HTML 预览需要独立安全沙箱设计，当前不直接执行。

### 2026-09-30：附件正文归类与用户长消息折叠（handoff_pending）

- 用户确认：上传文档显示文件卡片，不把文档原文当成用户正文；直接输入或粘贴的用户消息超过 500 字符默认折叠，换行不计，代码采用相同门槛。画像分析仍结合上下文，本轮不新增画像规则。
- 基线：`codex/publish-current-panel` / `c8c7b66`。保护已有未提交改动，本轮不改编辑重发、不处理独立的历史闪屏问题。
- 复现：基线解析器把发送链路的 `[附件正文：…]` 内容并入 `message.text`。
- 修复：共用用户消息解析器在 Markdown 解析前分离有文件引用的完整附件正文封装；兼容 typed input、原生文件头与 JSONL 历史，恢复文件卡片。助手所需的原始输入保持原样；协议原始记录仍包含带标记的附件文本，Negus 的消息正文和摘要不再混入它。文件已不可用或封装不完整时保留文本，避免丢失唯一可见内容。
- 前端：复用 `CollapsedMarkdown` 的可选字符门槛，首次渲染即为折叠状态；文件卡片保持可见，消息数据及原有全文复制入口不截断。旧行数折叠调用不变；仅重新加载含旧附件正文的会话快照，保留选择与无关缓存。
- 验证：附件发送、内容解析、历史、摘要/转交定向测试；TypeScript 与隔离 Vite 构建；实际 React 组件静态渲染覆盖 500/501 字符、换行、emoji、代码、多文本块、附件与助手回复，快照检查覆盖旧缓存兼容。
- 限制：静态渲染不是浏览器交互验收；展开/收起点击、复制到剪贴板、手机滚动和真实供应商尚未验收。浏览器工具此前报告认证不可用。未发布、未重启、未提交。

## 2026-09-30：远程对话文件链接修复（未发布，handoff_pending）

- 范围：用户要求最小修改，修复助手回答中文件名链接打开 Negus 桌面的问题。基线 `c8c7b66`，分支 `codex/publish-current-panel`；保留工作区已有附件、代码块及其他修改。
- 单聊共用 Markdown 渲染器将文件链接转到受认证的 `/api/session/file`；按 thread/message 核对原回答确实引用该链接，并复用既有 Agent 会话授权和媒体服务。已有缓存消息无需重写。流式纯文本仍保持现状，正式消息才提供可点击链接。
- 相对路径按会话 cwd 解析，支持绝对路径、file URL、中文空格、常见行号和 Markdown 引用链接；realpath 限制当前项目内的普通文件，拒绝越界符号链接。项目外文件、已删除文件或无法核对的临时消息返回 404，不开放任意本机文件读取。
- 文本、代码、Markdown 在新标签页以纯文本查看；其他格式沿用媒体服务。脚本/HTML 不执行，不新增弹窗，不修改输入框、消息正文或发送链路。行号用于找准文件，本轮不增加行号定位界面。
- Service Worker 仅对应用页面启用离线首页兜底，文件路径访问失败不再替换成桌面。
- 验证：22 项定向测试通过（文件解析/媒体响应/缓存兜底/对话路由/附件）；TypeScript、MJS 语法、隔离 Vite 构建及 diff 检查通过。额外静态组件渲染检查受测试工具 CSS 模块配置阻碍，未完成；未做真实浏览器或 Windows 实机验收。未发布、未重启、未提交。
