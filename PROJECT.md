# negus Web 协作工作台项目说明

更新日期：2026-09-14 01:03 +08:00

本次核对分支：`codex/publish-current-panel`。代码基线：`2114b7c6275db02479b7ff708f47491fab8c53ef`。
本轮依据现有文档、前端组件、后端路由及服务实现进行静态核对，未启动服务、运行构建或重新进行实机验收。以下“已有实现”不表示已部署，也不替代功能档案的验收状态。

本文件只说明 negus Web 协作工作台。Codex Dream Skin 换肤工具的使用说明放在 `macos/README.md` 和 `windows/README.md`。

## 项目定位

negus 的产品定位是一个可以用自然语言不断定制的个人／企业工作空间：通过浏览器访问，按需求增加或调整功能页面，并把入口放在实际工作需要的位置。

2026-09-14 确认的三个核心卖点是“能联网，有浏览器就能用”“随时随地按需求定制页面”“任何功能，任何位置”。详细用户流程、发展方向与现有／待实现边界统一见 [`PRODUCT_DEFINITION.md`](./PRODUCT_DEFINITION.md#产品定位与核心卖点)。

当前实现以真实 Codex 工作过程为基础，主要包括：

- 查看真实 Codex Thread；
- 在浏览器中继续发送和控制任务；
- 显示执行过程、流式回复和项目状态；
- 项目群聊、Agent 单聊和交付物协作；完整体验以对应功能的验收状态为准。

仓库同时保留早期的 macOS 和 Windows Codex 换肤工具。换肤工具是历史产品线，当前 Web 工作台的主要代码在 web-ui 和 windows/server。

本项目不是 OpenAI 官方产品。

## 现有实现功能介绍

### 1. 真实 Codex 对话与执行控制

用户可以浏览真实会话、读取标题和历史、新建及重命名会话，发送文本或附件；任务执行中可以追加指令或停止。前端显示流式回复和执行活动，并包含分页、虚拟列表、快照缓存、SSE 重连及状态校正逻辑。消息提交使用提交身份、状态查询和去重机制，降低重试或多设备更新造成的重复消息。

消息支持复制、重新编辑、失败重试，以及从已完成 Turn 分叉继续；会话支持活动/归档列表和恢复。分叉、归档、审查等操作依赖所选 Codex 运行时支持，归档不是删除。

代码依据：[会话页面](./web-ui/src/App.tsx)、[会话路由](./windows/server/routes/conversation-routes.mjs)、[会话服务](./windows/server/conversation-service.mjs)。

### 2. 后续指令队列、模型、上下文与 Goal

- 后续指令可以进入当前 Thread 的队列；服务已有队列存储、调度及编辑、删除、移动等操作。它是对话后续指令队列，不是生图批处理或定时任务系统。
- 支持模型和思考强度切换；运行中的会话禁止通过对应接口直接切换。上下文支持状态读取、自动压缩阈值设置及主动压缩。
- 已接入原生审查 `review/start`。Goal 不仅有能力菜单，还提供目标状态、用时和 Token 展示，以及暂停、继续、完成和清除操作；后端直接转发 `thread/goal/get`、`set`、`clear`，不维护第二套目标生命周期。实际可用性取决于本机 Codex 版本，本轮未探测运行时。

代码依据：[输入区](./web-ui/src/features/conversations/components/ConversationComposer.tsx)、[后续指令路由](./windows/server/routes/follow-up-queue-routes.mjs)、[队列服务](./windows/server/follow-up-queue-service.mjs)、[Goal 控件](./web-ui/src/features/goals/components/GoalControl.tsx)、[原生协议适配](./windows/server/app-server-conversation-store.mjs)。

### 3. 多项目目录、员工与群聊

已有项目目录、业务项目和员工项目身份、员工长期会话、项目群聊、`@` 路由及回复发布能力。用户可以进入员工单聊，读取执行状态、发送任务和调整员工模型设置；群聊通过真实 Agent 执行，并将结果发布回公共群聊。普通项目、员工会话和目标文件访问范围在数据层分别记录。

产品规定员工直属单聊及其参与各群聊的会话归员工自己的项目，工作项目保留公共群聊记录。现有 Desktop 仍可能把仓库内员工子目录的 Thread 聚合到 negus 主项目；此问题已明确暂缓，不应介绍成归类完全隔离。群聊的历史、流式过程、队列和模型/上下文体验也不能宣称已全部与单聊一致。

代码依据：[项目目录](./web-ui/src/features/project-directory/components/ProjectDirectory.tsx)、[员工接口](./windows/server/routes/employee-routes.mjs)、[群聊界面](./web-ui/src/features/group-chat/GroupApp.tsx)、[结果发布接口](./windows/server/routes/agent-publication-routes.mjs)、[服务组装与会话归属](./windows/scripts/remote-room-demo.mjs)。

### 4. 附件、富文本与自然语言生图

已有 Markdown、代码、表格、链接及图片、音频、视频和普通文件内容渲染。媒体通过后端登记和访问接口提供，音视频支持 Range 读取；附件上传、失败恢复、大文件和跨设备草稿的完整体验仍需实机确认。

生图入口已进入真实 Codex Thread/Turn，并有 image MCP、生成记录和图片输出处理，支持自然语言生图及同会话继续改图的代码链路。供应商、认证及运行时能力必须可用；专门生图工作台、批量模板和定时自动化仍是后续范围。

代码依据：[内容渲染](./web-ui/src/features/conversations/rendering/ContentRenderer.tsx)、[媒体服务](./windows/server/media-service.mjs)、[图片 MCP](./windows/server/image-generation/mcp-server.mjs)、[图片输出](./windows/server/image-generation/image-output.mjs)。

### 5. 成果预览、版本与审核

Agent 成果可以登记为 Artifact，查询版本、预览、下载并提交审核结果。已有静态 HTML 生成、通过 Edge 输出 PDF、安全打开网页和群聊发布链路。PDF 生成依赖本机浏览器和运行环境；整体交付体验仍待验证，不等同于完整网页编辑器或 Office 文档平台。

代码依据：[成果路由](./windows/server/routes/artifact-routes.mjs)、[成果服务](./windows/server/artifact-service.mjs)、[HTML/PDF 服务](./windows/server/web-output-service.mjs)。

### 6. 移动端、用量和项目管理

已有移动端布局、PWA 安装资源、设备身份和新版本刷新提示。用量控件提供浮生云算摘要与详情；模型智能/效率控件支持筛选和排序，内容依赖对应数据源，不能视为本次实测。项目管理页面从仓库条目文件读取摘要和更新记录，项目目录也有活动状态接口。

代码依据：[用量控件](./web-ui/src/features/usage-monitor/components/UsageSummaryControl.tsx)、[模型比较控件](./web-ui/src/features/intelligence-efficiency/components/IntelligenceEfficiencyControl.tsx)、[项目管理页面](./web-ui/src/features/project-management/ProjectManagementApp.tsx)、[项目状态接口](./windows/server/routes/project-review-routes.mjs)、[PWA](./web-ui/src/pwa/)。

### 7. 员工成长：已有基础设施，自动学习尚未接通

源码包含事实和提案存储、规则/技能提案批准或拒绝、批准后写入员工 `AGENTS.md` 或 `.agents/skills/*/SKILL.md`，以及写入失败回退和日志。已有成长面板和接口。

但当前启动入口使用无模型注入的默认评审器，返回空的 facts、rules、skills。因而只能确认审核与落盘基础设施存在，不能说员工每次任务后会自动提炼经验、生成技能或完成每日压缩。长期经验和自动学习的产品范围仍以产品定义为准。

代码依据：[成长服务](./windows/server/employee-growth-service.mjs)、[默认评审器](./windows/server/employee-growth-reviewer.mjs)、[成长接口](./windows/server/routes/employee-growth-routes.mjs)、[成长面板](./web-ui/src/features/employee-growth/components/EmployeeGrowthPanel.tsx)。

功能验收状态仍以 [功能状态索引](./docs/feature-development/FEATURE_STATUS_INDEX.md) 和对应档案为准；索引中的历史测试数量及部署结论不是本次检查结果。

## 产品定义入口

当前产品行为、用户流程、归属关系和不可违反的边界统一写在 [`PRODUCT_DEFINITION.md`](./PRODUCT_DEFINITION.md)。本文件提供带代码依据的实现概览，不重新定义产品行为；历史计划和逐版本记录仍放在功能档案中。

固定阅读顺序：`PROJECT.md` -> `PRODUCT_DEFINITION.md` -> 本次涉及的 `FEAT-*.md`。

其中群聊和员工的核心原则是：工作项目拥有项目文件和公共群聊记录；员工自己的项目始终拥有该员工的直属单聊和参与各项目群聊的长期会话。员工可以操作目标工作项目，但不得在目标工作项目的普通会话列表中创建或留下员工会话。

## 代码结构与模块入口

| 路径 | 内容 |
| --- | --- |
| `web-ui/src/features/` | React 前端功能模块 |
| `web-ui/src/components/`、`web-ui/src/shared/` | 跨页面 UI、API 和模型共用代码 |
| `windows/server/` | Web API、SSE、会话、群聊、Artifact 和生图服务 |
| `windows/server/routes/` | HTTP 路由入口 |
| `windows/scripts/remote-room-demo.mjs` | Web 服务组装和启动入口 |
| `windows/scripts/start-web-demo.ps1`、`restart-web-demo.ps1` | Web 服务启动和重启 |
| `runtime/` | 会话、执行、群聊、Artifact、员工和媒体数据 |
| `macos/` | Codex Dream Skin macOS 换肤代码和资源 |
| `windows/assets/`、`windows/scripts/*dream-skin*` | Codex Dream Skin Windows 换肤代码和资源 |
| `docs/` | 项目、功能、架构、研究、管理和历史记录 |

## 模块查找表

| 要修改的模块 | 先读的文档 | 主要代码位置 |
| --- | --- | --- |
| 单人 Web 对话、执行、历史 | `docs/feature-development/features/FEAT-001-single-codex-web.md` | `web-ui/src/features/conversations/`、`execution/`、`context-management/`；`windows/server/conversation-service.mjs`、`app-server-conversation-store.mjs`、`execution-tracker.mjs` |
| 多业务项目与会话归类 | `docs/feature-development/features/FEAT-017-multiple-business-projects.md` | `web-ui/src/features/project-directory/`；`windows/server/business-project-config.mjs`、`project-identity-store.mjs`、`employee-project-directory.mjs` |
| 项目群聊和多 Agent | `docs/feature-development/features/FEAT-002-group-multi-agent.md` | `web-ui/src/features/group-chat/`；`windows/server/group-room-store.mjs`、`multi-agent-service.mjs` |
| 附件和内容渲染 | `docs/feature-development/features/FEAT-003-attachments-content-rendering.md` | `web-ui/src/features/attachments/`、`conversations/rendering/`；`windows/server/content-blocks.mjs`、`media-service.mjs` |
| PWA、设备和移动端入口 | `docs/feature-development/features/FEAT-004-pwa-device-identity.md` | `web-ui/src/pwa/`、`features/device/`、`features/app-update/`；`web-ui/public/`、`windows/server/request-handler.mjs` |
| Desktop/Web 连续性和实时事件 | `docs/feature-development/features/FEAT-005-desktop-web-continuity.md` | `windows/server/app-server-client.mjs`、`app-server-conversation-store.mjs`、`execution-tracker.mjs`、`realtime-hub.mjs` |
| Artifact、HTML 和 PDF | `docs/feature-development/features/FEAT-007-agent-artifacts.md`、`FEAT-008-html-page-pdf-generation.md` | `web-ui/src/features/artifacts/`；`windows/server/artifact-service.mjs`、`web-output-service.mjs`、`request-handler.mjs` |
| 自然语言生图 | `docs/feature-development/features/FEAT-015-image-generation-and-automation-workbench.md` | `web-ui/src/features/` 相关生图入口；`windows/server/image-generation/`、`conversation-routes.mjs` |
| macOS 换肤 | `macos/README.md`、`macos/SKILL.md` | `macos/` |
| Windows 换肤 | `windows/README.md`、`windows/SKILL.md` | `windows/assets/`、`windows/scripts/*dream-skin*`、`windows/scripts/injector.mjs` |

## 数据和运行链路

主要数据链路：

Codex app-server
-> app-server conversation store
-> conversation service
-> HTTP API 和 SSE
-> React Web UI

app-server 是主要数据源。本地 Codex JSONL 是降级数据源。

主要页面：

- /：单人对话
- /group.html：项目群聊
- /progress.html：项目进度
- /project-management.html：项目管理兼容入口

构建和运行：

- 构建：pnpm build:ui
- 启动：pnpm start:demo
- 重启：pnpm restart:demo
- canonical 服务端口：9360
- 4173 是旧的 Vite Preview 入口，不作为交付地址

## 当前限制

- Desktop 和 Web 可以写入同一个持久化 Thread，但 Desktop 已打开页面不会实时显示 Web 外部追加内容。
- Desktop 和 Web 暂不应同时向同一个 Thread 发送任务。
- 群聊、多 Agent 和员工项目能力仍在持续开发。
- 固定公网入口、正式认证和长时间远程运行仍需进一步验收。
- 移动端、断线恢复、长任务和跨端体验仍以真实验收结果为准。
- 当前版本尚未具备完整的企业权限、任意业务页面自动发布和跨员工助手通信；这些方向按具体功能逐步设计与验收。

## 资料入口

- 助手工作规则：`AI_ASSISTANT_WORK_RULES.md`
- 功能状态：`docs/feature-development/FEATURE_STATUS_INDEX.md`
- 功能详情：`docs/feature-development/features/`
- 开发常见错误：`docs/feature-development/DEVELOPMENT_COMMON_MISTAKES.md`
- 架构职责：docs/architecture/
- 项目管理：docs/project-management/
- 研究和证据：docs/research/、docs/records/
- 产品愿景和历史讨论：docs/records/VISION_NOTES.md、项目战略与多角色评审/
