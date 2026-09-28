# FEAT-018 更新记录

### 2026-08-14 17:10 +08:00

- 状态：implementation_in_progress
- 基线：`081787798e211a5b2399d61e8a305261a7594b12`，分支 `codex/publish-current-panel`。
- 范围：按平台级 Goal 设计开发，不把当前项目路径写入 Goal 核心边界。

### 2026-08-14 18:00 +08:00

- 状态：implemented_uncommitted
- 后端：完成 Goal Store、生命周期服务、运行适配器、版本化 API 和组合根接线；服务持续运行时使用服务端超时计时器，未加入周期性检查器。
- 前端：单人对话与群聊共用 Goal Provider、SSE 事件订阅和 Goal 控制条；支持启动、状态、暂停/继续、编辑、清除和详情展开。
- 验证：Goal Store、Goal Service、Goal Routes 三组测试通过；Web UI TypeScript 检查通过。
- 待验证：生产 UI 构建、完整相关 Node 测试、真实服务启动和跨入口体验；当前未提交，不触碰用户既有未提交文件。

### 2026-08-14（能力入口校正）

- 移除未经确认的 AppShell 顶部 Goal 控制条及其占位行；无活跃 Goal 时不再占用单聊或群聊的消息空间。
- Goal 改为复用既有“能力菜单”，在单聊和群聊中统一提供 `/goal`、`/goal pause`、`/goal resume`、`/goal clear` 可调用入口。
- 保留平台级 Goal Provider、持久化 API 与 SSE 状态复用；本次仅更正入口层，不将 Goal 重新绑定到项目或群聊。
- 验证：Web UI TypeScript 检查、Vite 生产构建通过。

### 2026-08-14 19:35 +08:00

- 状态：implemented_pending_review
- 审查修复：生命周期改为运行时成功后落状态；员工中断核对精确 Turn；真实 Turn 终态自动回写 Goal、Task 和 Run。
- 数据保护：Task/Run 关系字段不能通过通用 PATCH 改写；容量满时保留运行中 Goal；失效的创建幂等映射不再返回空 Goal。
- 用户体验：多个 Goal 时不再自动选择列表第一项；命令可携带 Goal ID，输入区显示成功、失败和版本冲突。
- 仓库清理：移除误提交的 Playwright YAML 和截图，并加入忽略规则。
- 产品提交：`d755cad12e79d2ee11af1b28233dec82ad316297`。
- 验证：Windows Node 测试 `157/157`、`pnpm build:ui`、相关 MJS 语法检查和 `git diff --check` 通过。
- 待验收：未重启服务；真实 Goal 长任务、跨入口操作和移动端体验仍待用户验收。

### 2026-08-14 19:44 +08:00

- 边界修复：已暂停或等待的 Goal 在清除、状态互转和超时时不再重复调用运行时停止，避免精确 Turn 校验拒绝第二次中断后 Goal 状态卡住。
- 产品提交：`964ad4e6297c369b9bf8e856c98bd5e67b13382e`。
- 验证：Goal Service 聚焦测试 `10/10`、Windows Node 测试 `160/160`、相关 MJS 语法检查和 `git diff --check` 通过；本次后端边界补丁未重复构建 UI。
- 待验收：未重启服务；真实 Goal 长任务、跨入口操作和移动端体验仍待用户验收。

### 2026-08-14 21:42 +08:00

- 版本：`v0.2.0`，状态保持 `implemented_pending_review`。
- 方向纠正：删除 Negus 自建 Goal Store、Service、Runtime Adapter、API、Provider、命令拦截和生命周期操作，不再维护第二套 Goal 状态。
- 用户入口：单聊和群聊能力菜单只保留一个“Goal 目标模式”；`/goal <目标>` 通过现有消息通道交给 Codex 原生 Goal。
- 原生证据：历史 Negus Thread 已确认调用 `create_goal`，并由 `update_goal` 正常完成。
- 验证：Windows Node 测试 `146/146`、`pnpm build:ui`、修改后 MJS 语法检查和 `git diff --check` 通过。
- 待验收：当前服务尚未安全重启；重启后需要从能力菜单发起一个真实短 Goal，确认原生过程和完成结果。

### 2026-09-26 00:15 +08:00

- 用户授权完全对标本机 Codex，完成修改和测试。
- 基线 a3dd3f779649db3cb86bbf864d3c0d25f44c3488；保留原有未提交改动。
- 对标 Desktop 26.917.8451.0，实现原生创建、六状态摘要、编辑、停止暂停、响应顺序保护、长目标和员工路由。
- 50 项定向回归、构建、隔离浏览器以及真实浏览器原生目标完成清理链路通过。
- 已知严格对标差异与验证边界列于功能档案；不宣称完全一致，状态 handoff_pending。

### 2026-09-26 00:22 +08:00

- 补齐 Codex 恢复已暂停/受阻/用量受限目标询问，修正轮次间停止的前端调用。
- 最终构建与浏览器专项全部通过：直接创建、六状态、实时用时、编辑/替换取消、乱序响应、会话切换、重连、恢复询问、手机布局及错误显示；页面无异常。
- 后端 50 项回归、相关 MJS 语法检查及 diff --check 通过。正式后端尚未加载，本轮将使用项目规定的安全重启入口等待活动任务结束。

### 2026-09-26 后台完成与长目标显示回归

- 再查本机 Codex app-initial 的 thread/goal/updated：完成通知针对所属会话清理原生目标，不依赖当前选中会话。
- 修正 Negus 仅清理当前会话的问题，完成去重包含目标创建时间、更新时间及正文；后台完成不污染当前会话展示。
- 保留同一目标已展开的 displayObjective，避免后续原生事件及完成清理将正文退化成文件引用。
- pnpm build:ui 通过；Edge 浏览器专项通过，新增后台完成清理、同秒不同目标以及长目标完成正文保留用例。
- 运行服务仍为 PID 9100；已安排重启不等于部署完成。正式 HTTP/SSE、编辑器细节和历史恢复的完整对标仍待验证，目标保持进行中。

### 2026-09-26 目标侧栏与真实 HTTP/SSE 验证

- 对照本机 thread-goal-side-panel-content：保存成功保留编辑器，显示相对更新时间；还原回到保存正文。侧栏改为非模态，不锁定整个会话。
- 前端构建和 Edge 浏览器专项通过，新增保存后侧栏保持打开、刚刚更新、还原以及非模态断言。
- 新增 thread-goal.http-browser.mjs：在临时项目启动完整 remote-room-demo 服务入口，真实 HTTP/API、原生 EventSource 和真实 Codex，无 API/SSE 替身。
- 会话 01a0d96a-88e3-7b61-b1fe-e2b06186750d 验证通过：浏览器 /goal 不发普通消息，active -> complete -> cleared，后端目标 null，最后轮次结束、输入框空闲、完成摘要保留。截图 runtime/goal-http-complete.png。
- 正式端口 9360 仍为 PID 9100；上述是隔离实机全链路验证，不代表现有服务后端部署。富文本编辑、历史恢复、员工及跨供应商真实场景仍有未验收项。

### 2026-09-26 员工目标归属与正式服务装配

- 修复目标 API 在后台完成清理时读取当前页面 conversationId 的问题；按所属 Thread 保存请求会话上下文，原生员工目标事件附带拥有者 conversationId。
- 浏览器新增普通目标切换到员工页面后的清理隔离，以及后台员工目标携带原归属清理用例，全部通过。
- 首次真实员工测试发现正式服务创建 employeeRuntime 时漏传 execution，员工专属目标事件没有发送；补齐依赖后重测通过。
- 实机员工会话 01a0d96f-b47e-7730-ace0-2c40d970185e，conversation-eeb9e5b3-3a7f-4378-8ef9-1707f05af4c1：真实 HTTP/SSE 创建、带归属事件、完成清理和轮次结束输入框恢复全部通过。使用临时项目员工，未修改现有用户员工。
- 验证命令：NEGUS_GOAL_EMPLOYEE_TEST=1 配合 thread-goal.http-browser.mjs；50 项定向 Node 回归、UI 构建及浏览器专项通过。
- 继续查明 Codex completedThreadGoal 也传入最终回复操作区；目前 Negus 完成摘要仍在输入区，完整历史展示尚未对齐。正式 9360 部署、富文本编辑、跨供应商仍待完成。

### 2026-09-26 01:11 富文本与达成回复收尾

- 目标编辑器接入 Tiptap/ProseMirror Markdown：粗体、列表、链接、代码块恢复，格式化编辑后序列化保存为原生 Markdown；Ctrl/Cmd+Enter 保存，Enter 换行，保存不关闭、还原保留原目标。
- Codex 源码已确认回复操作区文案“已在 {totalTime} 内达成目标”；增加按完成时间与轮次状态匹配，防止附到后续轮次；支持原生实时回复和无普通文本的工具轮次。
- 实机截图发现 synthetic /goal 被排在回复后方，现使用 native-goal 来源标记参与正常时序排列。
- 56 项相关 Node 回归、UI 构建及富文本专项浏览器通过。真实 HTTP/SSE 会话 01a0d98c-0ee8-7dc1-bda7-97aa5ab23ad0：目标命令在前、完成回复在后、达成提示、原生清理、最终输入框空闲全部通过。
- 正式 9360 的唯一活动任务为当前排查线程；安全重启需等本轮结束。仍不将隔离实机测试视为正式部署验收。
- 严格剩余边界：重启后正式服务验收、跨供应商真实切换、历史刷新后完成结果持久还原、Codex 富文本所有快捷键/选择链接细节和移动真机均未全面验收。

### 2026-09-26 01:14 供应商切换实机验收

- NEGUS_GOAL_PROVIDER_TEST=1 实机通过：隔离项目从 current 切换到已配置 ccswitch_default，随后浏览器直接 /goal，不发送普通消息；原生完成、清理、输入框空闲、回复达成提示与顺序全部正常。
- 会话 01a0d98e-4747-7b42-b8fc-f3120ba04c4d。该验证覆盖本机两个运行通道，不代表所有外部供应商均支持原生 Goal。
- 再查本机 Codex：completedThreadGoal 在目标事件中写入会话状态，供回复操作区匹配；未找到重启后从持久目标历史重建该字段的依据，不将额外持久化误作已确认的 Codex 要求。
- 正式安全重启进程已确认存活等待（PID 5572），9360 仍为 9100。部署验证仍须待当前任务退出后检查，未宣称完成。

### 2026-09-26 01:17 正式服务验收完成

- 安全重启完成：9360 监听进程由 9100 更换为 33164；重启和验收工作进程均已退出。
- 正式服务自动验收 exitCode=0，独立会话 01a0d991-7b25-7793-9aef-daa5c1eaed22。实际 API 与原生 SSE，无传输替身：/goal 直接创建、active/complete/cleared、原生目标 null、轮次结束输入框空闲、回复达成提示与命令顺序通过。
- 证据 runtime/goal-deployment-verification.json、runtime/goal-deployment-verification.log、runtime/goal-http-complete.png。
- 本次修改、构建、回归与正式实机验证已交付；未提交版本库。不能把已通过场景扩展为所有 Codex 细节完全相同：手机真机、全部富文本快捷键、附件供应商执行、完整重启后历史恢复仍为未验证边界。
