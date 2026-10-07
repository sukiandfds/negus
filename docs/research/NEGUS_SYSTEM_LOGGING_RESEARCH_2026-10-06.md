# Negus 全系统日志与用户原文提取调研

日期：2026-10-06；任务：RESEARCH-005。

## 1. 需求、范围与证据边界

用户原话：

> 按照之前说的，我要为整个Negus系统都加入日志功能。请你先调研一下，用户能在negus上进行的操作，看看要怎么开发这个整个negus系统的日志功能。用户发送的具体内容，则后续需要被单独提取出来，分析用户的要求喜好。请你先理解我的意思。不明白的你现在问我

> 1.不加。这个在后端日志加，前端不显示。我计划是后续negus的任何用户行为都会有日志记录，有明确的debug内容，有明确的流程。用户做了什么-后端运行情况-如何返回呈现-这一整套都有完整的日志。而且连带的其他功能也会有日志。2和3，如果最小代码改动，而且是尽量以删减和优化代码为主能怎么改？所有的改动都应该以删减和优化为主。不要再增加屎山了。

理解：日志用于还原真实使用链路和定位故障；用户原文另存可提取的数据，后续再分析要求与喜好。前端需要内部采集操作和展示结果，最终进入后台日志；不增加面向用户的调试界面。

此前澄清的范围：全部已提交需求，包括聊天、目标、交互回答、Agent 指令和图片要求；本次先设计记录与提取，偏好推断后做。操作粒度采用建议：记录有意义的动作及结果，排除每次按键、鼠标移动和流式 Token。此粒度是工作假设，最终体验由用户验收。

代码基线：`codex/publish-current-panel`，HEAD `427a708fa85f4564822caeac97c6601bd97b4745`。研究对象为当前工作区源码，包含尚未提交的 Agent 负责人实验变更；这些变更不等于当前服务已加载。交接提供的运行快照是 `runtime/releases/1791274924730-3ca8742e`，本次没有重新验证部署状态。实验任务模块只作为将来的日志接入点，不计为已上线能力。

已直接阅读用户转发的《对话修复》历史资料，结合本轮原话理解问题；历史提交、重启和修复要求没有在本次重新执行。历史资料的助手结论是上下文，不作为本次复测证据。

本轮完成静态源码调研和开发建议，没有修改运行代码、重启服务、调用付费供应商、提交或推送。本报告的验收矩阵尚未执行。

## 2. 现状：已有记录为什么不够

| 现有来源 | 已有作用 | 对全系统日志的缺口 | 源码 |
| --- | --- | --- | --- |
| console 与进程日志 | 出错警告、启动信息、供应商诊断 | 格式与关联关系不统一；前端未发请求、页面未展示无法追溯 | `request-handler.mjs`、`app-server-client.mjs` |
| submission store | 提交去重、pending/accepted/failed 查询 | 24 小时有效期、最多 500 条；fingerprint 是消息相关 JSON，不是长期原文档案；accepted 不代表回复成功 | [submission-store](../../windows/server/submission-store.mjs) |
| 原生 Codex 会话/JSONL | 用户消息、工具活动和模型回复 | 不覆盖浏览器本地操作、拒绝的提交、独立页面与维护脚本；提示词可能已被加工 | [app-server store](../../windows/server/app-server-conversation-store.mjs) |
| execution 与队列状态 | 当前执行和待发送任务 | 快照覆盖旧值；无法仅凭最终状态还原每步原因 | [执行](../../windows/server/execution-tracker.mjs)、[队列](../../windows/server/follow-up-queue-service.mjs) |
| SSE hub | 实时通知与短暂补发 | 内存保留 200 个事件，进程重启后事件序号重新开始；没有页面应用/展示回执 | [realtime-hub](../../windows/server/realtime-hub.mjs) |
| 图片 run store | 图片任务、输出和恢复状态 | 原文会 trim、截断；最多 200 条；不能作完整用户原文来源；重启未完成项标 unknown | [image run store](../../windows/server/image-generation/image-generation-run-store.mjs) |
| 群聊、员工成长和 Artifact 记录 | 业务消息、提案、交付版本、审核 | 局部业务历史，不含完整请求到页面链路 | [群聊路由](../../windows/server/routes/group-routes.mjs)、[成果服务](../../windows/server/artifact-service.mjs) |
| 维护结果文件和 tunnel 日志 | 启停、恢复、发布等诊断 | `report` 保存最新结果 JSON，缺统一因果关联；部分 CLI 输出包含访问链接，不能原样复制进新日志 | [脚本公共层](../../scripts/negus-service-common.mjs)、[tunnel](../../scripts/negus-tunnel.mjs) |

现有依赖没有统一日志库或 OpenTelemetry。先复用现有业务状态和 ID，增加一个共享结构化记录接口。不要重写提交去重、执行状态、原生会话或队列调度。

## 3. 用户操作覆盖清单

表中“记录”指未来接入后的事件，不表示当前已具备。读取动作记录一次用户打开及读取结果；轮询、心跳和重复快照按周期汇总，避免放大数据量。

| 用户操作 | 当前实际链路/入口 | 应记录的过程与结果 | 原文提取范围 |
| --- | --- | --- | --- |
| 打开 Negus、刷新、从手机恢复页面 | 静态资源、PWA、`/api/project`、device/version；[HTTP 公共层](../../web-ui/src/shared/api/http.ts) | 页面启动、构建版本、可见性、请求失败、初始数据应用、资源加载失败；首次页面未加载时只能依靠边缘/服务日志 | 无 |
| 切换桌面/对话/项目/群聊等视图 | [App](../../web-ui/src/App.tsx)、[项目目录](../../web-ui/src/features/project-directory/components/ProjectDirectory.tsx)；部分切换纯本地 | 动作来源、旧/新对象、读取开始/完成、被迟到结果忽略、活动视图显示结果 | 无 |
| 新建草稿、首次发送、取消草稿 | [会话 hook](../../web-ui/src/features/conversations/hooks/useProjectConversations.ts)、`/api/session/create` 与 message | 区分打开草稿和实际创建；创建 ID 与首次提交关联；未提交草稿不收正文 | 首次明确提交的内容 |
| 打开会话、翻页、搜索/筛选、归档列表 | sessions/session 与前端缓存；会话 hooks | 缓存或远端来源、页游标、消息数量、快照版本、失败/过期忽略；不复制全部历史 | 无新原文 |
| 重命名、归档、恢复、复制/分叉、审查 | [会话路由](../../windows/server/routes/conversation-routes.mjs) | 操作对象与结果；标题更新来源是手动还是自动；视图应用结果；分叉源 turn 与新 thread | 用户手动标题可作为命名类输入；审查选项/补充要求单独分类 |
| 发送、执行中追加、失败重试、发送后切走 | message、submission、execution-status、RPC；[execution hook](../../web-ui/src/features/execution/hooks/useCodexExecution.ts) | 固定点击时目标/内容/配置；接收、校验、去重、路由、turn 接收、执行终态、事件到达/应用/展示；切走不记为取消 | 原始正文、附件引用；重试关联原输入，避免重复计为新要求 |
| 编辑消息后提交 | composer + message | 新修订与原消息/输入关联；取消编辑只记录动作，不采集草稿 | 明确重发时保存新版本，保留旧版 |
| 回答助手提问、确认或拒绝 | `/api/session/user-input`、员工 confirm；[用户输入 hook](../../web-ui/src/features/conversations/hooks/useProjectConversations.ts) | question/requestId、选项 ID、用户所选/自由回答、后端处理与恢复执行 | 保留回答及问题引用；选择项标 `selected_option`，不要冒充用户手写文字 |
| 停止、暂停、继续执行 | interrupt、原生 Goal set/clear | 用户请求停止、上游确认、中断结果分别记录；Goal 与 turn 状态分开 | 控制动作；附带说明才是正文 |
| 选择供应商/配置/模型/思考等级 | models/defaults、session model/effort、[模型 hook](../../web-ui/src/features/models/hooks/useModels.ts) | 草稿选择、确认保存、pendingProviderId、实际生效配置分别记录；默认值/会话值/用户选择来源及实际 turn 设置 | 结构化偏好操作；不记录凭据 |
| 读取上下文、调整压缩阈值、主动压缩 | context status/settings/compact | 请求、阈值变更、执行结果、更新后的上下文状态；后台自动压缩标 system | 参数与明确要求，排除模型生成摘要 |
| 创建/改写目标、暂停/继续/完成/清除 | [Goal UI](../../web-ui/src/features/goals/components/GoalControl.tsx)、`/api/session/goal` | 目标修订、原生操作结果、生命周期与附属执行；不能把目标置 active 当执行完成 | 提交的 objective 与附件；保存前捕获，区分系统附加执行内容 |
| 排队、编辑/删除/移动队列、重试、立即发送 | [队列路由](../../windows/server/routes/follow-up-queue-routes.mjs)、[队列服务](../../windows/server/follow-up-queue-service.mjs) | queueItemId、顺序变化、内容修订、dispatch 与实际 turn 关联；删除不覆盖原提交历史 | 入队原文和保存的修改；自动 dispatch 不产生第二份用户输入 |
| 上传附件、移除附件、打开/下载/播放媒体 | uploads、media，Range 请求；[媒体服务](../../windows/server/media-service.mjs) | 选择/上传结果、大小/MIME/媒体 ID；移除关联；导航与图片加载/播放失败；Range 读取汇总 | 附件 ID、顺序、用户说明；不把附件全文自动当用户原话 |
| 桌面区域新增、选择、移动、缩放、固定、删除 | [桌面组件](../../web-ui/src/features/desktop/EditableDesktop.tsx)、[workspace](../../web-ui/src/features/desktop/useDesktopWorkspace.ts) | 大多仅在前端；记录操作结束位置和本地保存成功/失败，不记录每一帧拖动 | 无；区域命名/明确说明另作结构化输入 |
| 对选区发要求，含前端本地执行 | workspace `executeLocal` / `prepareRequest`；`desktop-operations.json` | 用户提交、local/remote 分支、区域 ID、更新与持久化、实际区域结果；助手回复不能替代区域修改完成 | 必须在追加“区域执行上下文”之前保存原文；本地命令也要保存 |
| 查看当前任务、自动化组件、打开/关闭/筛选 | [当前任务](../../web-ui/src/features/desktop/CurrentTasksWidget.tsx)、[自动化组件](../../web-ui/src/features/desktop/AutomationsWidget.tsx) | 读取来源、筛选、视图结果；当前 API 读取已有自动化，不虚构创建/修改能力 | 无；未来新能力再注册 |
| 加入群聊、更新在线信息、发消息/附件/@Agent、停 Agent、调整模型 | [GroupApp](../../web-ui/src/features/group-chat/GroupApp.tsx)、[group routes](../../windows/server/routes/group-routes.mjs) | room/member/message；一路输入分发到各 workId/agentId；每个子工作完成/失败；公共消息发布与展示 | 群聊原文；对每个 Agent 的改写指令标 generated，不多算用户输入 |
| 员工会话打开、发任务、确认变更、改模型、查状态 | [employee routes](../../windows/server/routes/employee-routes.mjs)、[员工运行时](../../windows/server/employee-runtime-service.mjs) | employeeId、直属 conversation/thread、请求与实际后台工作、确认对象和结果 | 原始任务和确认项引用；已有负责人实验单独标未上线 |
| Agent 会话打开、回复分享/发布到目标 | [publication routes](../../windows/server/routes/agent-publication-routes.mjs)、[分享 UI](../../web-ui/src/features/agent-sharing/components/AgentMessageShareControl.tsx) | 来源/目标、消息、权限/校验、发布结果和接收方展示 | 分享动作是用户操作，分享的助手回复仍标 assistant |
| 查看成长提案、批准/拒绝 | [growth routes](../../windows/server/routes/employee-growth-routes.mjs)、[面板](../../web-ui/src/features/employee-growth/components/EmployeeGrowthPanel.tsx) | 提案 ID、决定、写入规则/技能结果、回退；不能声称已有自动学习闭环 | 用户决定/备注；提案正文来源保留为系统/模型 |
| 复制消息/分享链接、摘要、转发历史到其他对话 | [forward routes](../../windows/server/routes/conversation-forward-routes.mjs)、[forward service](../../windows/server/conversation-forward-service.mjs) | 剪贴板成功/失败；源/目标与 requestId；摘要生成、历史文件准备、入队/送达结果 | 转发动作为用户授权；系统生成转发提示与历史文件不是用户此次新写的需求 |
| 成果列表、版本/预览、HTML 打开、下载、批准/退回审核 | [artifact routes](../../windows/server/routes/artifact-routes.mjs)、[预览](../../web-ui/src/features/artifacts/components/ArtifactPreview.tsx) | artifact/versionId、生成/发布/预览/媒体加载、决定与落盘；浏览器导航不一定经过 fetch 包装 | 审核 note 与用户决定；成果正文不作用户原话 |
| 查看项目状态/进度/管理条目/更新/记忆、提交页面修改要求 | system/project-review 路由；[项目管理](../../web-ui/src/features/project-management/ProjectManagementApp.tsx) | 对象、读取结果、页面草稿创建与返回；筛选/展开本地动作 | page-drafts 的 `request` 和 `location`，明确来源及目标 |
| 设置页浏览/搜索、保存/删除配置、发现模型、测试、设置默认 | [SettingsPage](../../web-ui/src/features/settings/SettingsPage.tsx)、[system routes](../../windows/server/routes/system-routes.mjs)、[image settings routes](../../windows/server/routes/image-settings-routes.mjs) | 配置 ID、变更字段名称、安全参数与测试结果；离开未保存只记录放弃，不采集每次输入 | 配置选择/参数；密钥输入不进入正文档案，记录 credential_changed=true 即可 |
| 用量查看/刷新、凭据保存、模型比较筛选/排序/检查 | usage/fusheng/models/check；[用量 UI](../../web-ui/src/features/usage-monitor/components/UsageSummaryControl.tsx) | 查询开始/结果、数据时间、供应商状态、筛选动作；刷新去重 | 无正文；凭据排除 |
| 图片生成/参考图编辑、同会话继续修改 | [MCP](../../windows/server/image-generation/mcp-server.mjs)、[configured client](../../windows/server/image-generation/configured-image-client.mjs) | 用户提交→turn/tool→实际配置/规格→供应商→输出保存→媒体登记→图片加载结果；不记录图像二进制 | 用户聊天原文与工具最终 prompt 分开；工具 schema 要求原文不等于保证模型从未改写 |
| Lynn 仿拍工作台上传人设/参考、填写三类要求、选择规格、生成/恢复/下载 | [Negus 挂载](../../windows/server/routes/lynn-workbench-routes.mjs)；独立 repo `server/mobile-route.mjs` / `src/App.tsx` | 上传角色/顺序、jobId、202 接收、生成 ready/failed、local saveState、轮询恢复、img 加载/下载；需子应用内部接入 | prompt/description/requirements 三个原始字段；当前前端组装后只发一个 prompt，不能从合成串可靠还原 |
| 服务启停、构建发布、回退、健康检查/恢复、隧道启停 | [supervisor](../../scripts/negus-supervisor.mjs)、[frontend](../../scripts/negus-frontend.mjs)、[watchdog](../../scripts/negus-watchdog.mjs)、[tunnel](../../scripts/negus-tunnel.mjs) | CLI/system 操作者、维护 jobId、排空、候选/回退 releaseId、PID/退出、健康/公网状态；计划重启不等于完成 | CLI 参数只做白名单；访问 URL 的 token 排除 |

浏览器自然语言输入并非唯一交互。系统还需记录异步标题生成、队列自动发送、Goal 持续执行、Agent 分发、成长提案落盘、Artifact/PDF 生成、媒体保存、健康恢复、子进程重启和 MCP 调用。这些事件标 `actor=system/agent`，通过父操作关联；不追加“用户原文”。电脑控制工具记录调用类型、对象类别和结果，日志功能不额外采集屏幕或键盘内容。历史 Dream Skin 独立工具不是 Negus Web 操作，若仍维护，可接共享日志格式，不将其算为主系统已覆盖。

## 4. 关键链路与缺口

### 4.1 对话发送

```text
点击发送（记录原目标、原文、附件、选择配置）
  → 本地校验 / 本地命令分支
  → 创建草稿会话（若需要） / 应用待生效配置
  → HTTP 尝试 → 后端授权/维护门禁 → 读取/校验请求
  → 提交去重 → 定位会话/历史/实际供应商
  → RPC turn/start 或 steer 接收
  → 执行通知、工具、供应商结果 → 执行完成/失败/中断/未知
  → SSE 发布/补发或快照恢复
  → 客户端收到 → 状态应用 → 活动视图渲染/媒体加载
```

每一步有自己的 outcome。`http_finished`、`submission_accepted`、`execution_completed`、`ui_applied`、`ui_rendered` 禁止合并为一个 success。完成模型回复也不能保证用户要求的桌面区域被改好。

前端发送前出错、切换后错误退出、浏览器离线，后端可能完全没接到请求。只有 HTTP middleware 无法覆盖。后端 request-handler 在授权/维护门禁与路由外也有返回路径，接入必须覆盖这些路径及 response `finish/close`，不能只在 catch 里记日志。`finish` 说明响应已交给传输层，不证明客户端收到了。

### 4.2 SSE 与最终呈现

单聊 [useConversationEvents](../../web-ui/src/features/conversations/realtime/useConversationEvents.ts) 含重连、间隙和快照恢复。群聊 [useGroupEvents](../../web-ui/src/features/group-chat/realtime/useGroupEvents.ts) 重连约 4 秒，重连后读快照；阅读旧历史时会暂不插入新的公共消息。两种前端都有需要内部记录的忽略/失败分支。

未来记录 streamId、服务启动实例、事件范围、gap、快照恢复结果；保持现有 SSE 协议，日志不要求重建实时服务。只记执行起止和最终消息 ID，不逐 Token 落盘。最终状态应用与 React 提交后显示分别确认；图片/预览另记 load/error。非活动视图、后台标签页和虚拟列表之外的消息不能标为已展示；即使前台展示，也只能证明客户端渲染，不能证明人看过或理解。

### 4.3 独立应用与异步任务

Negus 对 Lynn 只做挂载与供应商连接注入。独立应用负责 UI、上传和 jobs；不能假设 Negus 中间件看到了内部步骤。当前源码接受两个参考图、规格、合成 prompt 和 jobId；返回 202 后异步生图，ready 后继续下载本地副本，saveState 可能失败。因此“生成好了”和“保存/页面图片好了”须独立记录。当前路由没有取消/删除任务接口，不把它们列为已支持。

建议通过挂载时注入同一 record 接口及父 action/job 关系，独立 UI 接入同一事件契约；不共享全部业务状态，不改成另一套队列。不改造该 repo 时，报告必须明确只覆盖 Negus 边界，不能宣称全系统已覆盖。

## 5. 最小可复用方案

### 5.1 两类数据，一个公共记录入口

建议一个共享服务，写两类本地追加文件；路径为方案示意，尚未创建：

```text
runtime/logs/<producer>/<date>-<segment>.jsonl      过程、结果、诊断
runtime/user-inputs/<producer>/<date>-<segment>.jsonl  提交原文、修订、来源
```

各进程写自己的分片，以 bootId/processInstance 区分，避免多个进程同时写同一条长记录造成交错。异步有界队列、按大小/日期轮转；底层文件权限限制，迁移不重复抓取已有全部历史。已有 console 逐步替换/收敛到共同接口，不同时保留一份相同正文在多处。

共享 API 职责限于 schema、白名单、脱敏、ID、持久化与批量查询导出。前端只有小型 action capture 与传输模块；业务模块明确标有意义的动作。请求包装层、后端 HTTP、RPC、SSE 和维护脚本提供公共阶段，避免每个按钮各写一套文件逻辑。HTTP body 只能读一次；原文字段在已有解析/业务边界显式提取。

不预设引入监控 SaaS、数据库、管理后台或 OpenTelemetry Collector。实现时可比较成熟 JSON logger（如 Pino）的异步输出/脱敏与 Node 原生方案；本轮只核对了本仓库能力，没有核实候选库当前官方源码/版本，不把“采用某库”写成定案。若原生方案需自行实现复杂可靠队列，应优先复用成熟写入能力，不能为少一个依赖制造更大维护成本。

### 5.2 关联字段

| 字段 | 含义与约束 |
| --- | --- |
| schemaVersion、eventId、producer、bootId、sequence | 可去重；跨重启/进程不把序号混在一起 |
| actionId、parentActionId | 一次用户意图及派生动作；群聊分发、自动标题等有父关系 |
| attemptId、requestId | 网络/上游每次尝试；网络重试使用原 action 和新 attempt |
| submissionId、queueItemId、threadId、conversationId、turnId、itemId、workId、roomId、agentId、jobId、artifactId | 优先保留现有业务 ID；按模块使用，不强迫每条都有全部字段 |
| time、receivedAt、durationMs | 客户端时间与服务接收时间分开；以 ID/序号及因果关系排序，不能仅靠手机时钟 |
| actor、browserId、pageSessionId、deviceKind | 区分 user/system/agent；共享访问 token 不能证明具体人身份，不记录 token 或凭据 hash |
| action、stage、outcome、errorCode、safeError、retryable | 稳定错误分类与阶段；unknown 与失败分开；stack 需脱敏且仅留诊断文件 |
| frontendBuildId、backendReleaseId、sourceRevision、runtimeVersion | 分开记录前端、运行快照、原生运行时与源码；脏工作区不能只写 HEAD 就称为运行版本 |
| target、requestedSettings、effectiveSettings、source | 对象与安全模型参数；区分用户选择、配置默认、缓存和实际执行；不记录整份配置校验值 |
| inputId、inputRevision、relatedInputId、outputRef | 正文/修订引用，日志主体不重复整段文本/模型输出 |

服务端生成自己的 event/request/boot 身份。浏览器传来的 ID 用于关联，必须校验格式、长度、归属和可接受字段，不能用客户端提供的字符串决定文件路径。客户端上传声称“后台成功”不得覆盖服务端事实。

`AsyncLocalStorage` 可帮助同一进程 HTTP 调用透传；队列、timer、子进程、MCP、重启恢复必须显式携带并在已有任务记录保存 action/input 引用。只有上下文变量不够。不要修改原生 JSON-RPC 协议随意塞入未知字段；在边界维护 RPC 请求到业务 ID 的关联。MCP stdout 保持纯协议，日志写文件或安全 stderr。

### 5.3 原文契约

每次用户明确提交时保存：inputId、动作、入口、原始字段、内容格式、附件引用、目标、修订关系、来源、提交结果引用。原文字段在 trim、拼接模板、slash 展开、区域上下文注入前捕获。富文本保存提交时编辑器导出的 Markdown，说明格式；不保证还原每个未提交按键或编辑器隐藏格式。

来源至少区分 `user_typed`、`selected_option`、`template_default`、`template_edited`、`system_augmented`、`agent_generated`、`forwarded_history`。Lynn 当前三个表单字段必须在前端组装前采集并传递，基础默认模板也要标来源；不能因为用户点了生成，就把整段默认模板归为用户亲自撰写。

聊天重试不复制一份新的正文；用户修改再提交则增加 revision 与 relatedInputId。队列执行、自动标题、Goal 继续运行、Agent fanout 只引用输入；历史转发引用原文来源与覆盖范围，不把历史每句重复记成新的要求。后台明确拒绝的合法需求也应保留提交状态，不丢掉失败时最有诊断价值的内容。

默认只提取业务白名单的需求字段，不保存密钥框、访问链接 token、Cookie、Authorization、完整环境变量或配置文件。用户如果把凭据直接写进自由文本，原样保存与凭据排除会冲突；建议明确采用“凭据片段替换、其余文字保留”，记录 redaction 标记。否则不能同时承诺绝对逐字原文和绝不存凭据。日志和语料导出均做字段审查，错误 message/stack/URL 也不能绕过脱敏。

过大/无法解析/未授权的恶意请求只记录拒绝类型和长度，不为“全部行为”无限制保存任意请求体。已进入前端正常提交链路的原文可在本地待传记录里保留；其大小上限应与业务允许提交大小一致。超限明确标 incomplete，不静默截断后仍声称原文完整。

### 5.4 前端本地操作、离线与日志故障

建议有一个受现有认证保护的客户端事件批量接收接口。批次按 eventId 确认真正持久化的项，前端收到确认后清理；失败在网络恢复/页面恢复时有界重试。退出页面的 sendBeacon 只是尽力传输，不能当作可靠送达。

浏览器待传缓冲使用 IndexedDB 等已有平台能力，有数量/字节/时限限制；正常业务请求可捎带本次 action 与 input 信息，减少额外请求。后端已记录的同一输入与后来补传按 inputId 合并，保留独立过程事件。禁用存储/配额不足时用有界内存，记录 storage_unavailable 与缺口统计；不能无限增长或阻塞使用。普通点击诊断可批量，明确提交原文应优先持久化。

初次打开时若 Cloudflare 已返回 530、JS 根本没有加载，前端采集无法运行。这时只能结合隧道/本地健康/边缘可得记录；用户清除浏览器数据且未补传，原操作也可能不可恢复。报告输出“证据不足/覆盖缺口”，不能凭没有后端记录断言用户没点发送。

建议日志写入失败不阻断聊天、停止或业务提交，但产生独立健康计数/安全 stderr 与 logger_gap；原文未落盘标 input_unavailable。这样的默认策略保护使用可用性，却无法保证每条在磁盘故障时都保留。若要求原文不保存就禁止发送，需作为产品决定另行确认，不暗中加入。

## 6. 如何查询、提取与诊断

先提供后台/CLI 查询导出能力，面向助手排障，无新前端入口。按 action/thread/submission/job、时间范围或错误阶段输出关联记录与明确缺失项；跨进程以因果边排序。原文导出 JSONL 为主：正文、格式、来源、版本、时间、目标、附件引用、提交结果，保留拒绝/未知状态。默认去除重试与派生提示的重复，仍可用引用查看尝试历史。

不把原生历史当作全量新日志迁移。旧会话需要另行导入时标 legacy_import，注明文本可能已 trim/增强、时间缺失和去重依据，不能伪造原始来源。日志清理与原文保留独立；导出后可用 inputId 回查业务记录，即使调试日志已到期也注明可用性。

本次没有开发喜好分析器，不自动写 USER_PROFILE 或员工记忆；保留来源才能让后续分析区分“用户明确偏好”“一次性指令”“选用默认模板”“助手的推断”。

| 历史案例/现象 | 新方案应给出的判断 | 证据边界 |
| --- | --- | --- |
| 气泡出现但未真正发送、发送后切到另一对话 | 找到原 action 的本地显示/退出原因和是否有 HTTP attempt，不以气泡判成功 | 历史转发中有此反馈和定位；本次未复现当前代码 |
| 共享配置凭据门禁/409 | 精确标配置解析/凭据访问失败及安全配置字段变化，不泛称“旧配置” | 交接有删除整份配置 fingerprint 门禁的修复记录，本次未重复执行 |
| 切供应商后的历史缺失 | 记录源/目标 provider、分页读取与迁移数量及结果；实际线程绑定可追溯 | 交接有修复记录；不把“模型回复”当历史迁移完整的验收 |
| 折扣供应商 503 | 分开 Negus HTTP 状态和 upstream 状态，定位到实际调用的 provider/model/turn | 交接有供应商失败验证，本次无新的供应商实测 |
| 手机“项目数据服务不可用 530” | 前端若已运行记网络/响应；结合 tunnel connector 与本地健康判边界，不当模型失败 | 交接定位过 Cloudflare 530/1033；首次未加载的采集限制仍存在 |
| “放一张圆形图片” | 记录本地执行与区域更新；没有上游调用是明确分支 | 当前 workspace 源码直接可证 |

## 7. 开发顺序与使用体验

按同一张覆盖清单逐阶段完成，任何一阶段完成都不称“全系统日志已完成”。每阶段用局部源码与真实业务验收，不顺手修桌面或 Agent 实验业务。

| 阶段 | 当前使用/排障体验 | 最小接入和逻辑 | 接入后的效果 | 风险 |
| --- | --- | --- | --- | --- |
| A：公共记录与单聊 | 只能看到片段错误，接收与执行混淆 | 公共 writer/schema/input extractor；HTTP 包装与门禁；message/Goal/user-input/queue；RPC 与执行终态；用现有 ID | 同一消息可追到原文、实际配置、执行结果；界面不增加调试信息 | 异步关联遗漏、秘密泄露、写入开销 |
| B：浏览器动作与呈现 | 本地失败没有后台证据，回复是否显示不清楚 | 共用 capture/batch；会话视图/缓存/SSE 恢复；React 提交/媒体 load；离线缓冲 | 分辨没提交、供应商失败、断线、状态未应用及页面未显示 | 回执误判、离线丢失、事件风暴 |
| C：其他 Negus 功能 | 群聊/员工/设置/成果各有记录，难串联 | 按表接群聊、员工、成长、Artifact、分享、项目管理、模型/用量、桌面、图片/MCP | 子工作与用户操作可关联；正文来源一致；前端本地修改也可查 | fanout 重复原文、默认模板被误归因 |
| D：独立应用与运行维护 | 图片生成/保存、公网/本地、计划/完成混淆 | Lynn 注入 recorder/原始字段；维护脚本共享格式；跨重启链路；日志轮转查询、原文导出 | 全覆盖范围可审计，并能准确报告没覆盖的边界 | 独立 repo 版本不一致、回退兼容、保留策略 |

实现前准备具体改动文件和范围。优先替换分散的记录方法，复用 HTTP/RPC/SSE/维护公共层；保留业务模块少量语义事件。不得全局 monkey patch fetch/console、复制原生会话存储或为每个功能新增独立日志数据库。

## 8. 验收矩阵

下列为未来开发验收，当前均未执行。测试应模拟真实边界故障，不能只是断言 logger 函数被调用。

| 场景 | 完成判定 |
| --- | --- |
| 正常单聊并收到回复 | 从 action/input 到 turn 终态和活动视图 final message 能查询，实际模型设置可核对 |
| 发后立即切换、同时另一对话发送 | 两个 action 分别归属原会话，无混用 ID；离开视图不虚报取消或已展示 |
| 前端校验失败/本地命令，无业务 HTTP | 后端最终可查本地动作、原因/效果、已提交原文；没有虚构 turn |
| 凭据不可用、403/503、上游超时 | 请求接收与执行失败分开；error stage 可定位；结果未知不记为成功/明确失败 |
| 提交响应丢失后重试 | 同 submission 不重复执行、不重复计新需求；不同 attempt 可查；日志补传幂等 |
| 编辑后重发、队列改写/删除/dispatch | 原文修订关系完整，删队列不删历史，自动 dispatch 不增加用户原文 |
| 原文有空白/换行/slash/区域信息/目标富文本 | 提交前导出与原文字段一致；系统增补独立；不从最终 prompt 逆向猜原文 |
| 交互选择、转发历史、默认模板、生图三字段 | 来源正确，选择内容与问题引用正确；派生/历史/助手文本不计为新写需求 |
| SSE gap、后台标签、阅读旧历史、虚拟列表 | received/applied/rendered 分开；恢复失败有记录；没有可见证据就不报“用户已看到” |
| 多 Agent、图片异步保存、Artifact/PDF | 每个子工作及结果关联父 action；生成、保存、媒体 load、发布成功独立 |
| 服务重启、RPC 子进程退出、队列恢复 | bootId 不混淆；已有 job/input 关联保留；无法确认的外部结果记 unknown，不自动重复付费 |
| 手机离线/530/页面首次无法加载 | 有本地记录时恢复补传；无采集能力时明确证据缺口；不要求前端凭空解释边缘故障 |
| 日志磁盘满、写入失败、浏览器存储受限 | 业务遵守约定的可用性策略；缓冲有界、丢失数量可查，不递归记日志或无限重试 |
| 凭据、token URL、错误 stack、未知字段 | 导出/文件中无测试秘密；路由归一化、白名单生效；未授权批量上传被拒绝且限额 |
| 数据增长、长流式回复、多媒体 Range/轮询 | 文件可轮转/清理，事件数量不按 Token/拖动帧增长；实测延迟/内存/磁盘再确定阈值 |
| 回退和查询旧 schema | 停用采集不破坏业务/历史日志；旧日志读取保持兼容，报告版本/缺口真实 |

上线仍需分别核对代码、自动测试、构建、服务加载的 release、真实浏览器/手机、真实供应商和用户体验。日志不替代业务故障修复，也无法补回过去没记录的事件。

## 9. 建议默认值与需要产品确认的事项

以下是方案建议，不是已确认配置：诊断日志先保留 30 天并设总字节配额；原文独立保留，初期不按诊断 TTL 删除；待传浏览器数据同样设配额和过期限制。具体容量按运行量实测，过期/轮转/配额淘汰都产生可查询缺口。不要自动把包含私人原文的 runtime 数据推到 GitHub。

技术负责：schema、关联、脱敏、写入/查询、并发/配额、兼容和测试，不需要用户决定这些实现细节。产品后续只需确认：记录哪些有意义的操作（当前建议已列出）、已提交原文的保留/删除预期、遇到保存故障时是否继续业务（建议继续并标缺口）。不增加确认弹窗或调试 UI。

结论：开发应以共享记录接口为基础，把现有真实业务 ID 串起来，补上前端本地动作与呈现证据，并在改写前保留原文。当前交付是研究与可实施方案；日志功能、原文提取工具及真实体验均尚未实现/验收。
