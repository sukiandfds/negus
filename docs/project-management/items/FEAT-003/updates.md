# FEAT-003 更新记录

### 2026-11-09 助手生成文件可直接下载

- 状态：implemented，已发布生效。
- 本次更新：助手通过 `::file{path="服务器绝对路径"}` 交付生成文件；服务端复用媒体登记和现有文件卡，普通消息实时完成、历史恢复、员工历史及群聊均显示正文和下载入口。
- 用户影响：助手生成脚本、文档等文件后，用户会直接看到附件卡和下载按钮，不再只能点击普通本地路径链接。
- 验证：交付解析、实时消息、附件、群聊和提示词定向测试 69/69 通过；DeepSeek 只读复核通过。
- 生效：前端 `feishu-mw8zrofe` 已发布；后端任务 `1794212493127-99255` 已完成，运行版本 `1794212469585-3edd790e`。

### 2026-11-09 附件按原始文件交给 Codex

- 状态：implemented，已发布生效。
- 本次更新：普通附件改为发送文件名和服务器本地路径，由 Codex 使用文件工具读取；移除把 `.md`、文本等附件正文直接拼入模型输入的逻辑。图片、音频输入保持不变。
- 用户影响：上传 `.ini`、`.md` 等文件后，助手可以像读取普通本地文件一样分析原文件，不再依赖预先提取的正文。
- 验证：附件输入与内容渲染定向测试 16/16 通过；真实 HCG/LCG `.ini` 路径由 DeepSeek 读取，正确识别 `0x5070` 分别为 `0x04`、`0x05`。
- 生效：受控重启任务 `1794204494199-96809` 已完成，运行版本 `1794204468806-a07a6969`。

### 2026-07-25 22:49 +08:00

- 状态：pending_review
- 本次更新：支持上传、图片/音频/视频/文件展示和 Markdown 本地图片登记。
- 用户影响：基础附件能力可用，真实大文件和失败恢复仍需体验确认。
- 证据：`docs/negus-knowledge/features/feature-records/FEAT-003-attachments-content-rendering.md`
### 2026-11-16 Mermaid 图表

- 在共用 Markdown 代码块入口接入按需加载 Mermaid，保留原 CodeBlock 源码复制；错误图表展开源码，输入更新后重新绘制。未改滚动定位及测量逻辑。
- 严格模式、SVG 二次净化、禁用 HTML 标签及图内链接，限制代码长度和边数。
- TypeScript、diff check 通过；真实 Chromium 验证流程图、时序图、错误恢复、普通代码、安全输入和 390px 宽度通过。证据：`ui-feishu/validation/mermaid-browser.test.mjs`、`work/mermaid-20261116/browser.png`。
- 受控前端发布结果为 published，buildId `feishu-mwiwtgi2`，时间 `2026-11-16T06:56:01.292Z`；后端未重启。Terra 独立验收另行回传。

### 2026-11-16 Terra 验收修正：窄屏宽图

- Terra 首次验收未通过：390px 页面中的六节点横向图被压缩，文字约 5px 高；其余项目通过。证据 `work/mermaid-20261116/independent-test.mjs`。
- 修正为按 SVG viewBox 原始宽度绘制，由现有图框内部横向滚动；不修改对话列表滚动、定位和测量逻辑。
- Chromium 复核六节点图 SVG 宽度 1298px，节点文字高度 19px；TypeScript 和 diff check 通过。继续交由原 Terra 任务仅复验窄屏可读性、图框内部横向滑动及本次发布生效结果。
- 本次受控前端发布 `feishu-mwiwyvir`，结果 published，时间 `2026-11-16T07:00:13.960Z`，未重启后端。
- Terra 独立补验通过：390px 页面文字可读，图框内部可横滑到末节点，页面无横向溢出，源码可访问；线上版本与本次发布一致。证据 `work/mermaid-20261116/mobile-recheck.mjs`、`mobile-recheck-left.png`、`mobile-recheck-right.png`、`mobile-recheck-source.png`（后三项位于同目录）。结合首次其余通过项，本次功能验收通过。
### 2026-11-16 图表基础预览交互

- 按本轮用户明确要求补齐点击图形/按钮打开大图，拖动、滚轮/双指缩放、缩放按钮、适应窗口、原始大小，以及关闭按钮/Esc/遮罩关闭。复用 CodeBlock 样式，独立通用 DiagramViewer 按需加载，使用原生 dialog 管理焦点。
- 浏览器自测 `work/mermaid-20261116/viewer-test.mjs` 通过打开、缩放按钮、拖动、滚轮、适应窗口、Esc、键盘打开、关闭及390px展示；TypeScript、diff check通过。
- 当前仅工作区实现，按用户“验收通过之后”要求，交 Terra 验收通过后再受控发布前端；本次不需要后端重启。
### 2026-11-16 预览验收两项修正

- Terra 指出初次打开时未适应视口，及通过工具栏按钮打开后关闭时焦点落到 body；其他拖动、缩放和手机触控均通过。
- 适应操作延至 dialog 显示后的下一帧；明确保存实际打开控件，关闭预览后将焦点还原到该控件并 preventScroll，不修改对话滚动逻辑。
- 定向浏览器验证 `work/mermaid-20261116/viewer-fixes-test.mjs`：1000px/390px 初始完整展示宽图，关闭按钮、遮罩、Esc 三种方式均返回打开按钮。TypeScript 和 diff check 通过。继续由原 Terra 任务仅补验这两项；通过前不发布。
### 2026-11-16 Terra 预览交互最终验收

- Terra 补验通过：1000px/390px 画布初始完整适应六节点宽图；按钮/图形两种入口搭配关闭按钮/遮罩/Esc三种退出，焦点均恢复至原触发控件。首次其余拖动、滚轮、缩放按钮、单指拖动与双指缩放通过项继续有效。
- 证据 `work/mermaid-20261116/viewer-reaccept.mjs` 及同目录 `viewer-reaccept-1000.png`、`viewer-reaccept-390.png`。验收后受控发布结果 published，版本 `feishu-mwixifba`，时间 `2026-11-16T07:15:26.164Z`；后端未重启。
- 证据：`work/mermaid-20261116/viewer-reaccept.mjs`、`viewer-reaccept-1000.png`、`viewer-reaccept-390.png`（同目录）。按用户要求验收通过后执行受控前端发布，无需后端重启。

### 2026-11-20 公网附件交付

- 正式发布 1795107809916-8b5f5414。移动宽度 Chrome 在隔离群聊使用真实 COS 上传 5 MiB，用时 5.55 秒；上传完成后点击发送，0.93 秒内消息返回 202 且 Mac 保存逐字节相同的原件。隔离本地群聊的桌面和移动宽度发送/查看验证通过。
- Astra low 独立审核及复验覆盖正式群聊入口、放弃本地草稿、重复交付和 COS 删除方法。自动化覆盖在 windows/tests/cos-attachments.test.mjs。
