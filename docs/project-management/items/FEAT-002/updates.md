# FEAT-002 更新记录

### 2026-10-04 17:31 +08:00 | 产品员工后台调研代码完成，待体验验收

- 沿用现有员工与会话目录，接入独立任务、直接补充／停止、主对话空闲后回报。实现和验证统一见 [功能档案](../../../negus-knowledge/features/feature-records/FEAT-002-group-multi-agent.md#2026-10-04-v045产品员工后台调研试点)。
- 对照 OpenMausBot、nanobot 源码和 OpenClaw 文档，补齐持久化后立即接单、后台初始化。77 项相关自动化测试、1 项本机原生工具加载验证、TypeScript 和隔离前端构建通过；未重启部署、未提交推送，真实供应商与浏览器体验未验收。

### 2026-08-17 11:10 +08:00 | 员工项目群聊会话产品定义

- 确认归属：员工直属单聊及员工参与每个项目群聊的长期会话始终属于员工自己的项目；工作项目只拥有公共群聊记录和目标文件，不得收纳员工 Runtime Thread。
- 确认会话：一个员工在一个项目群聊中对应一个长期会话；首次调用不自动加入此前全部群聊，后续调用补入该员工上一次回复之后的新内容。
- 确认结果：最终回复只生成一次，同一结果保留在员工会话并原样发布到工作项目群聊。
- 当前边界：项目群聊归档、删除或员工退出暂不联动处理员工会话。
- 后续方向：每日群聊压缩、员工复盘、通用/项目经验和雷点沉淀，以及中止时发布有价值的过程文本。
- 实现状态：本次仅更新产品定义和文档约束，代码归属问题尚未修复，未进行构建、重启或运行验收。

### 2026-08-10 | 员工页成长闭环与审批重试保护

- 用户可见变化：进入独立员工项目页后，可以在同一页面看到最近成长事实、待审批建议，并直接批准或拒绝；审批中的旧轮询或 SSE 结果不会把页面状态改回去。
- 实现：`employee.html`/`employee.js` 接入 `/api/employee-growth` 读取、事件刷新和审批；成长存储在写入失败时回到可重试的 `pending` 状态，React 与独立员工页都使审批期间的旧读取失效。
- 验证：待完成 `pnpm build:ui`；未启动或重启服务，未做浏览器运行态验收。
- Git：`uncommitted`，未提交、未推送。

### 2026-08-10 | Agent 切换读取保护

- 用户可见变化：切换 Agent 后，“本次成长”只显示当前 Agent 的事实和建议，不会被上一个 Agent 的迟到轮询或 SSE 读取结果覆盖。
- 实现：`useEmployeeGrowth` 为每次读取建立请求代次，并将轮询和事件刷新绑定到当前 Agent 的 `AbortController`；旧响应只丢弃，不改变审批和后端存储。
- 验证：`pnpm build:ui`、`git diff --check` 通过；未启动或重启服务，未做浏览器运行态验收。
- Git：`uncommitted`，未提交、未推送。

### 2026-08-09 12:59 +08:00

- 技术验收：在 `http://127.0.0.1:9460/?token=agent-share-demo` 的桌面视口完成一轮“带到群聊”操作；分享按钮保持可见，目标群列表要求用户点击确认，发送后单聊显示“已发送”。
- 移动端验收：使用 `390x844` 视口重复流程；目标群选择框完整位于屏幕内，群选项可点击，发送后返回单聊并显示“已发送”，分享按钮仍可见。
- 运行态证据：群聊快照从 55 条增至 56 条，新增一条消息的 `authorId/agentId=manager`，正文与选中 Agent 回复一致；本轮没有触发其他 Agent。
- 验证：Agent 定向测试 13/13 通过，`pnpm build:ui` 通过，`git diff --check` 通过；全量 Windows Node 测试 121 项中 120 项通过，唯一失败仍是既有 `conversation-routes.test.mjs` 广播 mock 参数断言。
- 状态：`code_ready_pending_user_review`；技术验收完成，仍待产品侧按 11 项标准确认并决定是否签收。

### 2026-08-09 02:02 +08:00

- 入口兼容补齐：分享能力现在同时覆盖 `/` 和仍可用的 `/group.html`，避免从历史群聊入口进入时缺少“带到群聊”；保留单聊原有分支/发送行为，并在 `App.tsx`、`ConversationView.tsx`、`MessageActions.tsx` 和会话数据层补齐 direct Agent/share 参数。
- 验证：`pnpm build:ui` 通过；全量 Windows Node 测试 116 项中 115 项通过。唯一失败仍是既有 `windows/tests/conversation-routes.test.mjs` 广播参数断言，本轮没有修改该路由；`git diff --check` 通过。
- 运行态：9460 的目标群列表接口返回 200；重复提交既有 `requestId` 返回 `deduplicated: true` 且群消息数量不增加。为避免中断已有活动任务，本次静态入口补丁未强制重启 9460；根入口当前可用，`/group.html` 的补丁将在下一次受控重启后生效。
- 当前人工验收边界：接口、原文/身份、目标群隔离、幂等和旁路不调度已由定向测试与运行态检查覆盖；电脑和手机的最终点击体验仍由用户按 11 项标准检查。

### 2026-08-09 技术实现完成 +08:00

- 状态：code_ready_pending_user_review
- 本轮用户可见变化：群内 Agent 详情保留原抽屉，并提供“发消息”入口进入该 Agent 的完整单聊；已完成的 Agent 回复操作区在“从这里继续”旁新增“带到群聊”，点击后必须由用户选择目标群，发送后仍停留在原单聊并显示结果。
- 旁路实现：保留单聊原有分支/发送逻辑；在 `web-ui/src/features/conversations/**` 与 `App.tsx` 接入 direct Agent 路由和消息操作位，在独立 `web-ui/src/features/agent-sharing/` 提供分享 UI、目标群选择和反馈。
- 服务端复用：复用现有会话读取、群消息持久化、Agent 身份和 SSE 广播；新增 Agent/Runtime 会话绑定、群目录、纯发布服务和 `requestId` 幂等记录。发布服务不依赖 `multiAgent.enqueueDiscussion`，因此不会自动唤醒其他 Agent、创建任务或联动进度。
- 内容边界：服务端重新读取被选中的已完成 Agent 回复，只带文字/Markdown 原文；附件、图片、Artifact 和工具过程不复制；目标群由用户点击确认，原文不编辑、不预览、不二次总结。
- Runtime 边界：当前仅注册 Codex Adapter；绑定记录使用 `agentId + runtimeKind + runtimeSessionId`，旧 `threadId` 仅作为 Codex 兼容入口，未来可增加 OpenClaw/Hermes Adapter，不把 Agent 身份写死为 Thread 或 Project。
- 验证：`node --test windows/tests/agent-publication.test.mjs windows/tests/agent-share-routing.test.mjs windows/tests/group-room-store.test.mjs windows/tests/group-routes.test.mjs windows/tests/request-handler-routing.test.mjs` 全部通过；覆盖双群选择只写目标群、原文/身份、失败、幂等和不调度。`pnpm build:ui` 通过。全量 Windows 测试为 114 通过、1 个既有 `conversation-routes.test.mjs` 广播参数断言失败，本轮未修改单聊路由。
- 运行态：9460 演示服务已按最新代码重启，入口为 `http://127.0.0.1:9460/?token=agent-share-demo`；9360 原服务未重启。桌面和手机宽度选择面板、发送状态和旁路入口沿既有视口检查通过。
- 明确未做：未接入 OpenClaw/Hermes、未新增 Runtime 设置、未新增摘要编辑/来源链接/项目进度/总监绑定/自动协作/群聊管理；当前演示数据实际只有一个可用群，双群准确性通过隔离目录测试验证。

### 2026-08-08 22:33 +08:00

- 状态：ready_for_technical_handoff
- 本次产品决定：本轮只开发“将 Agent 单聊中的一条已完成摘要回复，原文带到用户明确选择的现有群聊”。用户从群聊 Agent 详情进入现有单聊，沿用现有上下文让 Agent 生成摘要，再从该回复已有的消息操作二级菜单选择新增的“带到群聊”。
- 用户操作规则：系统不得根据用户此前所在页面猜测目标群；Agent 按普通员工理解，用户必须从现有群聊中明确选择一个目标。摘要不编辑、不预览、不再次生成，发送后只在目标群新增一条由该 Agent 发出的消息。
- 复用范围：共用现有电脑/手机 Negus、群聊、Agent 详情、“发消息”、单人对话、上下文、助手回复操作、“开启新分支”和群消息发送反馈；“开启新分支”保留原行为。
- 新开发范围：消息菜单新增“带到群聊”、最小目标群选择、摘要文字与 Agent 身份发送到目标群、阻止该消息自动触发其他 Agent，以及电脑和手机验收。
- 明确不做：不建一人公司群聊，不绑定三位总监，不增加摘要编辑或来源链接，不自动讨论或建立任务，不联动项目进度，不新增群聊管理和权限，不接入或展示其他模型、CLI、OpenClaw、API 或运行服务。
- 长期背景：每个 Agent 未来可能使用不同模型或不同底层服务，甚至不使用 Codex；该方向已记录，但不进入本轮开发。
- 产品纠偏：记录了本轮未先核对真实页面、误称电脑限定、把已有 Agent 展示当新增、过早扩展三总监绑定、默认目标群、摘要编辑、来源跳转和运行服务展示等错误；这些错误曾迫使用户重复纠正并延迟交接，现以 `item.md` 的本轮开发交接章节为唯一范围依据。
- 文档基线：`434cb404169e018d64474ab3f76566c8ebaf5608`
- 用户可见的预计效果：用户不再手动复制摘要并粘贴到群聊；选择目标群后，摘要会以该 Agent 本人的一条消息出现在指定群中，其他群和其他 Agent 不受影响。
- 下一步：技术总监按 `item.md` 的流程、范围和 11 项验收标准完成最小开发，不继续扩展产品设计。

### 2026-08-06 23:24 +08:00

- 状态：code_ready_pending_user_review
- 本次更新：把单人对话和群聊从两个独立网页入口改为同一个 React 应用内切换。单人对话与群聊首次挂载后分别保留自己的状态；切换不再销毁原页面、重新创建整套应用或重新打开另一张 HTML 页面。
- 用户影响：点击“对话/群聊”时不再整页刷新；返回单人对话后，当前 Thread、页面状态和输入草稿不会因为切换被主动销毁。群聊使用自己的轻量本地快照并在后台预取，进入时优先显示已有内容，再后台同步最新数据。
- 布局变化：群聊接入与单人页相同的 `AppShell`、WindowBar、78px 顶部区域、侧栏宽度、内容宽度和手机 `visualViewport` 处理。群聊成员和 Agent 列表放入群聊自己的侧栏内容，不再使用独立三栏页面挤压消息区。
- 维护边界：两边共同调用公共外壳、视口处理和导航能力；单人对话继续独立维护 Thread/Turn/发送/流式状态，群聊继续独立维护 Room/Agent/消息/快照。群聊代码没有进入或改写单人对话核心状态。
- 兼容处理：历史 `/group.html` 入口继续可用，但加载后使用同一个应用；项目管理入口仍保持独立，不扩大本次范围。
- 验证：`pnpm build:ui` 通过；定向 `git diff --check` 通过；当前服务 `/` 与 `/group.html` 均返回 HTTP 200。未运行全量测试、未重启服务、未做自动化视觉测试。
- Git：产品完整提交 `21d3671f5cb4a761ef14a374e6405acb2f911bf1`，当前分支与 `origin/codex/publish-current-panel` 一致。
- 下一步：由用户直接在手机和电脑上检查首次进入群聊、往返切换、返回位置、输入草稿和键盘布局；发现具体异常后只修对应边界，再进入 M2。

### 2026-08-06 22:59 +08:00

- 状态：in_progress
- 本次更新：完成 M1 的第一组代码改动。群聊发送请求增加 `clientMessageId`；服务端对同一成员的同一客户端消息进行幂等写入并分配持久 `sequence`；前端发送后立即插入临时消息并清空输入框，SSE 或接口正式消息到达时按消息 ID/客户端 ID 原位对账；请求失败时只撤回对应临时消息。
- 用户影响：文本消息不再必须等服务器响应后才出现在群里；接口重试不会再次创建同一条正式消息或重复启动同一轮 Agent 讨论；正式消息按服务端顺序显示。附件上传仍需在消息提交前完成，不属于本次速度改动。
- 兼容处理：前端允许当前运行中的旧后台暂时不返回 `clientMessageId`，接口响应后仍会合并临时消息和正式消息，避免在受控重启前长期留下两条。
- 额外修复：群聊状态文件恢复时不再丢弃只有附件、没有文字的消息。
- 验证：`node --test windows/tests/group-room-store.test.mjs windows/tests/group-routes.test.mjs windows/tests/multi-agent-service.test.mjs windows/tests/artifact-service.test.mjs` 8/8 通过；相关 Node 语法检查通过；`pnpm build:ui` 通过；定向 `git diff --check` 通过。
- 未验证：没有启动或重启服务；服务端幂等逻辑尚未加载到当前进程；没有进行真实手机、多网页、断线重连和请求超时验收。因此 M1 仍为部分实现，不能标记完成。
- 下一步：受控重启并验收 M1；通过后进入 M2，将内存讨论队列升级为可恢复的 Task、AgentRun 和 ActivityEvent 账本。

### 2026-08-06 22:48 +08:00

- 状态：planned
- 本次更新：根据用户确认，把 FEAT-002 的目标收敛为“单机多模型、多 Agent 协作地基”。用户从一个群聊入口发送消息；项目经理默认接收并判断直接回答、创建任务或请求补充信息；用户明确 `@` 时由目标 Agent 直接响应；被安排的 Worker 完成后在群内汇报结果。多电脑协作仅保留扩展可能，Orca 暂不作为初版底座或强依赖。
- 计划评估：原计划总体方向合理，但不能直接开工。必须把消息幂等/顺序、任务账本、AgentRun、可恢复状态、上下文任务包、重复回复控制、停止/重试/审批和真实用户场景验收提前纳入。否则只能证明“模型被调用”，不能证明群聊协作可靠。
- 计划调整：M0 目标基线；M1 消息可靠性；M2 Task/AgentRun/ActivityEvent；M3 项目经理路由；M4 `@Agent`；M5 Worker 任务包与群内汇报；M6 项目经理汇总与冲突；M7 继续/停止/重试/审批；M8 Runtime/Provider 扩展；M9 真实场景验收与文档交付。
- 用户影响：初版完成后，用户不需要自己判断应该调用哪个模型；普通消息由项目经理判断，明确点名时直接找到对应 Agent；任务、进度、结果和交付物都能在原群聊中追踪，刷新或重连不应造成重复、乱序或任务消失。
- 主要风险：当前原型的执行队列仍主要在内存中，Agent 调度仍以有限轮次讨论为主，尚无正式 Task/AgentRun 账本；服务重启恢复、重复事件幂等、统一汇报和高风险审批尚未实现。当前计划已将这些列为正式阶段门。
- 证据：`windows/server/group-room-store.mjs`、`windows/server/multi-agent-service.mjs`、`docs/negus-knowledge/features/feature-records/FEAT-002-group-multi-agent.md`、`docs/negus-knowledge/records/P0_INCIDENT_REVIEW_2026-07-29_ORCA_ROUTE2_SCOPE.md`。
- 基线：`product_base_commit=d5b39e8be1e6273299d3606eef3d1153ba001f3e`；本次只更新项目管理记录，尚未产生产品代码提交或审计提交。
- 下一步：等待用户确认本计划后，建立 FEAT-002 实施基线，先做 M1 消息可靠性与 M2 任务账本，不先增加 Agent 数量、不先接入 Orca 或多电脑调度。

### 2026-08-06 18:00 +08:00

- 状态：direction_updated
- 本次更新：记录群聊按真人在线情况分流的初步规则。多人在线时，用户使用 `@` 调用助手；只有一个真人在线时，由整理和分派型小助手负责路由，未明确指定时默认由项目经理 Agent 回复。项目经理分发任务后，各 Agent 需要在群内提供进度，用户可以针对特定对话继续追问。
- 用户影响：用户不必在单人使用群聊时手动判断应该找哪个 Agent；多人协作时仍保留明确点名和可见的角色分工。
- 待确认：整理和分派型小助手与项目经理 Agent 的具体边界、多人在线的判定方式、Agent 进度展示形式和对话级连续追问入口。
- 用户原话：`没想好。初步想的是：1.群里有其他真人在线时，用@调用助手。2.群聊只有一个真人在线时，1.小助手负责分配给对应的人来进行回复。2.默认项目经理回复。项目经理分发任务后，各个助手要给出进度。然后可以针对特定对话继续进行对话。。先记下来，推送一下吧。之后再说`

### 2026-08-03 10:00 +08:00

- 状态：direction_updated
- 本次更新：确认“高能力项目经理 + 低成本专业 Worker + 按需审查”的分层 Agent 方向；上下文使用任务摘要和关键证据，不默认复制完整群聊。
- 用户影响：后续群聊可按任务难度调用不同 Agent，用户主要与项目经理对接，同时能够旁观、介入和中止 Worker 协作。
- 待确认：截图中的 `gpt-5.6-luna` 未在本机当前配置中找到，但不能据此判断不存在；实施前核对当前 Codex Agent schema、模型来源与真实调用。
- 证据：`docs/negus-knowledge/features/feature-records/FEAT-002-group-multi-agent.md` 的 `FEAT-002-I08` 与 v0.4.1 时间线。

### 2026-07-28 15:47 +08:00

- 状态：pending_review
- 本次更新：保留真实群聊和四个 Agent，后续先对齐单人 Codex 的可靠消息、过程、恢复和失败反馈。
- 用户影响：群聊仍处于基础体验完善阶段，多 Agent 讨论规则暂不扩展。
- 证据：`docs/negus-knowledge/features/feature-records/FEAT-002-group-multi-agent.md`

### 2026-08-09 12:21 +08:00

- 状态：`code_ready_pending_user_review`。本轮完成最小 Agent/Project/Thread/Runtime 边界：Agent 以稳定 `agentId + conversationId` 归属单聊；Project 关系只保留接口边界，未扩展完整 Task/组织模型；Runtime `threadId` 仅作可替换会话引用，群聊执行 Thread 与 Agent direct 单聊 Thread 隔离。
- 单聊隔离：Agent 详情的完整单聊使用独立 direct Runtime Thread；legacy 群聊 Thread 只保留历史引用，不迁移群上下文；本地 append-only JSONL 是单聊记录的优先来源，Runtime 不可用时仍可读取和分享已保存原文。
- 分享闭环：React 单聊回复操作区复用分支按钮位置新增“带到群聊”入口；用户必须从可发送 Negus 群聊列表明确点击一个目标，即使只有一个群也不自动猜测。发送文字/Markdown 原文，以该 Agent 身份显示；`requestId` 幂等，一次操作只产生一条消息，不自动调度其他 Agent。
- 验证：12 个 Agent 定向测试通过；`pnpm build:ui` 通过；12 个 Node 语法检查通过；全量 Windows Node 测试 117 项中 116 项通过，唯一失败为既有 `conversation-routes` 广播 mock 断言，未改该既有测试。
- 未启动服务、未提交 Git；电脑和手机的最终 11 项用户验收仍待用户执行。`product_commit` 与 `docs_commit` 保持 `pending`，不虚构提交 SHA。
### 2026-09-14 23:30 +08:00

- 状态：implemented_pending_review
- BUG-002-UI-01：群聊首次快照请求失败且浏览器没有已保存成员身份时，连接恢复提示会与“进入项目群”模态框同时渲染；模态框没有取消或刷新入口，用户无法从群聊界面恢复。
- 修复：`GroupApp` 仅在已有群聊快照时打开成员加入弹窗；无快照时保留 `RefreshNotice` 的刷新入口。已有缓存快照时仍允许正常加入。
- 用户可见变化：连接失败时先看到“项目群暂时未连接”和“刷新网页”，不会被成员名称弹窗遮挡。
- 验证：`pnpm build:ui` 通过；`git diff --check` 通过。未启动服务，未做真实浏览器断线验收。
- 基线：`0353352ba24e6e18a040437e5ba4bb28a1cef805`；本次仅修改前端条件渲染与对应记录。

### 2026-11-04 群聊成品开发中

- 状态：开发未完成，不是验收候选。基线 `2d32c4a54ba93052a29a6e67d5884a6192620a2d`；保留既有用户 goal 和验收记录。
- 已改本地身份、群时间格式、运营默认接待、群内平级工具交接与署名；正式后台/续派、状态恢复、视觉对照等尚未完成。未修改受保护滚动及测量逻辑，未发布。
- 验证：TypeScript、隔离 Vite 构建及两个群服务 Node 测试通过；未做真实浏览器测试。详情与未完成项见 `/tmp/negus-group-implementation.md`。

### 2026-11-04 群聊续作

- 群来源后台任务与续派、来源回报、状态投影、消息样式复用及免误广播已接线；隔离 mock 与浏览器验证证据见 `/tmp/negus-group-implementation.md`。
- 受影响 Node 测试31项、TypeScript、隔离构建及双端浏览器测试通过。真实供应商工具权限、续派重启恢复及真实附件仍缺关键证据，当前不是完整验收候选；未发布。

### 2026-11-04 候选阻断续查

- 群后台显式禁用继承的派工 MCP；隔离原生 app-server 的工具列表对照与恢复测试通过。已发送续派启动恢复、held/steer 及停止未确认场景新增测试，避免持续读取历史。
- 隔离完整后端桌面及手机打开群，真实上传附件并显示成功；真实供应商助手来源闭环仍受本会话无正规后台工具入口阻断。详细命令、证据及缓存差异见 `/tmp/negus-group-implementation.md`；未发布。

### 2026-11-04 前台接手与定向复验

- 按用户原话由前台亲自收尾开发；原 Terra 已收到停止开发与交接要求，DeepSeek 沿用原任务独立验收。
- 前台补充复杂事项按需确认的既有提示词（替换1行），并在恢复测试中加入失败队列清理断言。群服务、员工与任务内核34/34通过：`/tmp/negus-group-root-final-core.log`；失败队列探针与回归分别见`/tmp/negus-group-root-recovery-check.log`和`/tmp/negus-group-root-failed-queue-test.log`。
- 当前完整工作区含普通20对话修改，业务+347/-301（净增46），测试+719/-18；含未跟踪共享helper和测试。统计为此刻候选，最终冻结时再核对。手机样式独立复验已通过；完整页面对照及真实后台执行链继续验收，尚未发布。

### 2026-11-04 完整页面对照差异修复

- DeepSeek 完整页面发现昵称时间竖排、附件卡和运行态不一致。前台改用同行元信息，附件直接调用普通对话 ContentRenderer，运行态直接调用 ExecutionTimeline；删除群专用流式光标样式。未改滚动处理。
- TypeScript通过，新构建`/tmp/negus-group-root-final-ui`，构建日志`/tmp/negus-group-root-final-ui-build.log`；已交原DeepSeek任务复核同一8张完整页面。旧准备快照1793802029744-0d8f66df已过时，正式发布前必须重新prepare。

### 2026-11-04 已确认缓存与即时补充候选

- 群员工运行中复用turn/steer，沿用任务与thread；输入先登记并以submissionId核对重试，附件缺失明确失败。群服务8项通过：`/tmp/negus-group-immediate-steer.log`。
- 缓存去掉80条裁剪和384K写入限制，保留已加载消息与状态；默认读取60条。缓存业务5增22删，页大小2行替换。加载回归14/14，含120条保留和状态恢复：`/tmp/negus-group-cache-retention.log`。仍使用localStorage，配额失败保留旧缓存并记录错误，浏览器和独立验收继续。

- 即时补充重试补充：原turn历史确认未包含该submission且已结束时，允许同员工后续任务接收；requestKey维持幂等。定向测试1/1：`/tmp/negus-group-steer-finished.log`，群服务原8项复验通过：`/tmp/negus-group-steer-recheck.log`。已交DeepSeek定向审核。

### 2026-11-04 即时补充与缓存独立验收结果

- DeepSeek任务结果`3a7c965e-783d-4293-9ee0-1d1870266e5b`定向通过：同Thread/turn立即补充、重复请求幂等、附件恢复重试、终态核对后续作；缓存120条且超过384KiB完整保留，后续60条不裁旧历史，消息与活动状态恢复及跨群隔离通过。
- 报告`/tmp/negus-group-final-review.md`已核对SHA-256为`257d6daa77e7f05575493a4ddead4977d4bee96d36c802545a05b7289f886806`。配额失败保留旧快照、控制台记录；页面提示和存储介质差异继续按用户要求最终核对。
- 最新源码TypeScript与Vite构建通过，产物`/tmp/negus-group-review-latest-ui`，日志`/tmp/negus-group-review-latest-build.log`。已沿用原DeepSeek任务补派完整桌面/手机缓存及真实浏览器配额验收，submissionId为`handoff:0361b91ec77eb769fb7426877cfaf916`。未重复已通过的定向测试，未发布。

### 2026-11-06 群列表刷新缓存
- 按本次“这些问题都修复好、保留既有缓存/加载/展示链路”的授权，useGroupChats复用现有createCachedResource恢复群列表，删除空列表初始化及挂载方取消共享请求的控制器。群正文useGroupRoom和按房间快照机制保持。
- 原生子agent真实Chrome覆盖首次成功缓存、断网刷新群列表/群正文与已加载历史；全局外壳入口及更新确认一并通过。本轮仅工作区修改，未发布。完整证据与代码量统一见FEAT-001本日条目及work/cache-startup-2026-11-06/代码逻辑与验收.md。

### 2026-11-07 群聊消息区对齐普通对话样式

- 用户原话：“现在群聊并没有完全沿用我们普通对话和后台任务的通用样式而是有很多其他的东西。我想请你联合其他员工，多做一份新的样式，完全对上我们后台任务和普通对话的样式，直接复用。不必考虑群聊的可用性和功能，我只需要一个新样式先对齐。”
- 用户可见变化：群聊消息区移除员工胶囊条、日期分隔、额外点名提示和居中排队提示；消息署名、时间、气泡、正文、Markdown、消息操作区及手机间距改用普通对话共享样式。输入框继续沿用普通对话外壳，仅保留群聊必需的附件、能力、点名和上下文入口。
- 实现：`GroupWorkspace`删除仅由员工胶囊条触发的点名状态；`MessageTimeline`复用既有 `ContentRenderer`、`ExecutionTimeline`、`MessageActions` 和普通对话 CSS 类。实际业务差异4文件 +17/-81，净删64行。
- 验证：群聊视觉夹具在`1280x900`和`390x844`下与普通对话用户气泡逐项相等，截图`/tmp/negus-group-group-desktop.png`、`/tmp/negus-group-background-desktop.png`、`/tmp/negus-group-group-mobile.png`、`/tmp/negus-group-background-mobile.png`；`group-workspace.test.mjs` 1/1通过，TypeScript和Vite生产构建通过，`git diff --check`通过。受保护的滚动与首次定位文件未修改。
- 发布：前端受控发布版本`feishu-mw60x2gu`，构建时间`2026-11-07T06:29:46.002Z`；`runtime/negus-frontend-result.json`为`published`且`backendRestarted=false`。线上完整登录态浏览器复核尚未执行。

### 2026-11-07 群聊消息头像与运行状态样式补齐

- 用户反馈：“样式不对”，并附手机群聊截图。截图表现为本人消息没有右侧“我”头像、昵称时间留在左侧，Agent 消息没有左侧头像，“正在处理任务”被额外包在深色消息气泡里。
- 修正：群聊消息复用普通对话的左右头像位置和配色，本人昵称、时间与气泡统一右对齐；Agent 运行状态直接显示在昵称时间下方，不再套消息气泡。删除失效的 roster 选择器，避免其映射成 `undefined` 后污染群消息内边距；头像配色抽取为共享函数，普通对话与群聊共用。
- 验证：`group-visual.test.mjs` 在`1280x900`和`390x844`验证本人/Agent头像、本人元信息右对齐、运行状态不在气泡内及用户气泡样式一致；TypeScript、`group-workspace.test.mjs`和`git diff --check`通过。受保护滚动与首次定位文件未修改。
- 发布：前端受控发布版本`feishu-mw69w01l`，构建时间`2026-11-07T10:40:52.756Z`；线上`390x844`实际群聊复核头像、右对齐、运行状态和无横向溢出均通过，页面无脚本错误；`backendRestarted=false`。

### 2026-11-07 群聊名称和员工改为可选

- 用户可见变化：创建群聊只要求选择所属项目；名称留空时创建为“未命名群聊”，员工可以一个都不选，也可以选择任意员工（包括运营管理）。
- 实现：`CreateGroupDialog`删除默认运营管理和名称校验；`group-extension`删除服务端名称拒绝、强制运营管理和启动时自动补运营管理逻辑。空名称统一落为“未命名群聊”，其余创建幂等及历史恢复链路保持。
- 验证：`node --test ui-feishu/validation/group-extension.test.mjs` 1/1通过，覆盖空名称、零员工创建及历史恢复。
- 当前仅工作区源码已修改，前端未发布、后端未重启，运行服务尚未加载本改动。

### 2026-11-07 修复普通对话归档后列表行残留

- 用户反馈：点击归档后普通对话图标和摘要先变化，但行不消失，并可能恢复归档前内容；群聊若有相同列表状态链路也可能出现同类问题。
- 根因：归档先移除会话数据、稍后才写入已归档状态，期间列表会补造缺 session 的占位行；旧会话列表响应或缓存还可能把该会话回填，导致内容和样式恢复。
- 修复：移除会话时同步写入已归档状态，成功时再次确认并中止旧列表刷新；恢复失败时回滚归档状态；列表生成统一过滤已确认归档但仍在旧 `sessions` 中的条目；主对话也读取目录自身 `archived` 状态，避免补造占位行。
- 群聊补充：列表刷新增加请求版本，旧响应不能覆盖新的重命名/归档结果；归档当前群聊后关闭群聊页面，地址回退只会选择未归档群。
- 验证：`node --test ui-feishu/validation/conversation-summary.test.mjs` 17/17通过，TypeScript及`git diff --check`通过。

### 2026-11-07 群聊消息区和输入框直接复用普通对话

- 用户澄清：“这一步只是要求样式对齐。请你和审核者澄清。复用样式来对对齐。如果群聊有的功能，原来的样式没有，则说明需要删除这部分的代码。”并要求最小修改、直接删除没用逻辑。
- 消息区现直接把 `GroupMessage` 映射为 `SessionMessage` 后渲染普通对话导出的 `Message`，正文、附件、操作区、执行状态和布局 CSS 均由该共享组件负责；输入框直接使用 `ConversationComposer.module.css` 的同一组类名，并继续复用附件、能力菜单和引用控件。
- 删除员工胶囊条、日期分隔、点名提示、作者详情抽屉、回复定位、失败重试按钮、独立产物区、输入框点名人员弹层、上下文提示弹层及对应状态；移除群聊消息 DOM/CSS 和输入框结构 CSS 副本。
- 验证：直接调用工作区已有 `tsc` 与 `vite`，TypeScript 和前端生产构建通过；`git diff --check`通过。`pnpm --dir ui-feishu build`因既有 `sharp@0.34.5` 的依赖脚本策略在进入编译前被拦截。按用户“最多运行一次”限制未再运行视觉测试。
- 未发布前端、未重启后端、未提交或推送。详细结果见 `work/group-style-negus-20261107/implementation-result.md`。

### 2026-11-07 群聊页头能力与技能面板修复

- 用户反馈：进入群聊后技能面板一直展开，右上角缺少普通对话已有的分享、重命名和详情图标。
- 修复：技能菜单改为仅在能力按钮展开时挂载，保留选择、点击外部和 Escape 关闭；群聊页头补上与普通对话同顺序、同图标的三个按钮和现有 `rename-bar` 交互。分享弹窗读取当前群标题和当前群聊路由；重命名调用 `groups.update(room.id,{name})`；详情面板显示真实群名、项目、Agent 数、成员数和当前消息数，并可关闭。
- 验证：直接调用工作区已有 `tsc` 与 Vite，TypeScript 和生产构建通过；`git diff --check`通过。受保护滚动文件未修改。未发布、未重启、未提交或推送。
- 详细 diff、UX 与证据见 `work/group-style-negus-20261107/header-capability-result.md`。

### 2026-11-08 员工同时进入员工目录和项目目录

- 用户可见变化：“工作伙伴”和“项目”都显示同一批员工；项目入口使用员工已有头像、状态、主对话和子会话，点击进入原员工单聊。
- 实现：复用员工目录生成的项目对象，仅增加项目视图映射；“员工”和“项目”目录不再受会话来源筛选影响，“全部”仍只保留一次员工记录。项目员工入口允许在尚无主线程时打开员工单聊。
- 路径与权限保持不变：员工工作根目录仍是 Negus 项目根目录，保留整机完整访问；员工私有提示词与上下文目录不变。
- 审核补修：员工项目展开后的子项同时包含该员工的群会话与后台任务，群会话按归档状态过滤且不进入“全部”的额外员工入口。DeepSeek 只读增量复核通过，无必要修复项。
- 验证与生效：`tsc --noEmit`、`conversation-summary.test.mjs` 17/17、`git diff --check` 及生产构建通过；前端已发布为 `feishu-mw7jsm4o`，`backendRestarted=false`。

### 2026-11-09 员工入口工作状态汇总

- 用户可见变化：员工在群聊或后台任务里工作时，员工入口也会显示正在工作，不再只有主对话运行时才显示。
- 实现：`employee-project-directory.mjs` 复用已有主对话、群会话和后台任务状态生成一个员工汇总状态；员工父行直接使用该状态，普通对话的“助手正在运行...”回退保持不变。
- 验证：`project-identity-store.test.mjs` 7/7、`conversation-summary.test.mjs` 20/20、TypeScript 和 `git diff --check` 通过；独立复核发现的多项工作文案和“全部”列表主行遗漏均已修复并复审通过。
- 发布：前端已发布；后端受控重启任务 `1794222109367-3156` 成功加载 release `1794222084522-e673a6cb`，进程 PID `3212`，线上 `/api/version` 返回 `feishu-mw95if0w`。

### 2026-11-09 员工全局规则源码实现

- 用户确认主对话明确记忆指令先生成待审批建议，详情面板可手动添加、查看、停用和删除；仅员工全局，普通对话和任务结束不自动提炼。
- 复用成长存储与审批，三条执行链按轮读取有效规则；清除旧托管规则文件块以避免与规则状态及运行快照冲突。保留已有待审批和 Skill 审批能力。
- 定向 Node 测试 45/45、UI TypeScript 和生产构建、`git diff --check` 通过；额外供应商会话测试存在 3 项失败，详情与限制见 `work/employee-memory-20261109/implementation-result.md`。未做浏览器验收、未发布、未重启、未提交推送。

### 2026-11-09 员工全局规则复核修复

- 生产员工任务与群任务包装层注入同一成长服务；记忆建议异步保存并隔离失败；仅识别明确前缀；规则状态操作不再写旧托管文件；恢复已保存事实和已批准 Skill 的上下文。
- 当前生产相关 Node 测试 71/71、UI TypeScript 与生产构建、`git diff --check` 通过。额外旧 `agent-tasks.test.mjs` 引用已不存在的模块而无法运行；上轮供应商切换 3 项失败未在本轮重跑。详情见 `work/employee-memory-20261109/implementation-result.md`。未发布、重启、提交或推送，未进行浏览器或真实模型验证。

### 2026-11-09 停用规则幂等与前端重新对齐

- 用户可见变化：首次停用后如响应丢失或再次操作，不再看到 409；面板在停用成功或请求异常后立即重读服务端状态，并在后端已 disabled 时显示“已停用”。旧轮询或 SSE 响应不会覆盖较新的对齐结果。
- 后端：停用路由传递并使用 `requestId`；重复 disabled 状态返回成功且不重复写日志或广播。规则状态写入串行化，底层持久化失败继续返回原错误并回滚内存状态。
- 执行上下文：重新读取确认 disabled 后，员工主对话、群会话和后台任务的后续轮次不再加载该规则。
- 验证：相关 Node 与隔离浏览器回归 74/74 通过，UI TypeScript、生产构建和 `git diff --check` 通过；详情见 `work/employee-memory-20261109/implementation-result.md`。
- 状态：仅 develop 工作区文件已修改；未提交、推送、发布或重启，运行服务尚未加载，未做真实模型或生产浏览器验收。

### 2026-11-09 删除失败审计字段回滚补修

- 修复：删除规则持久化失败时恢复完整 proposal 快照，`status`、`statusChangedAt`、`statusRequestId` 等字段逐项回到操作前；只撤销失败删除自己的日志，保留并发追加的日志。
- 保持：成功删除、重复删除幂等以及停用、批准、拒绝、添加行为不变；未增加新状态系统。
- 验证：approved/disabled 删除失败回滚、并发日志保留、成功重试和重复删除回归通过；相关 Node/UI 测试 76/76、TypeScript、`git diff --check` 通过。证据见 `work/employee-memory-20261109/implementation-result.md`。
- 状态：仅 develop 工作区文件已修改；未提交、推送、发布或重启，运行服务尚未加载，等待原风控任务增量复核。

### 2026-11-10 员工主对话完成后状态不回落

- 用户反馈：员工主对话已经显示完整最终答案并保存消息后，员工目录和主对话详情仍持续显示“正在主对话工作”；用户要求完成后立即空闲，该状态只能代表真实运行，马上发送下一条消息时可重新进入运行。
- 根因：最近 Provider 迁移适配按 `threadClients` 客户端对象身份过滤订阅事件，当前 Provider 真实完成事件可能被入口丢弃；正文正常完成，但员工运行时没有收到当前轮次完成，直到下一次发送才回落。
- 修复前体验：用户看到最终答案后仍看到“正在主对话工作”，容易误以为模型仍在运行；状态要等再次发送消息才恢复。
- 修复后体验：当前 Provider 的当前轮次完成后立即回到空闲，无需下一条消息；空闲态旧 started、旧线程和旧轮次事件不会重新点亮或清除新任务；快速追加消息仍沿用原 turn，正文和完成状态连续；即使模型极快，started、delta、final 和 completion 全部早于 `turn/start` 响应，也会在响应确认后按原序显示一次，不会出现“已提交→空闲但没有答案”；无 turnId 正文不会混入正文，无 turnId 完成仍兼容回落，并使员工状态与共享 execution 同时进入 completed/inactive；马上发送下一条消息可正常重新显示运行。
- 实现：恢复所有已订阅 Provider 客户端事件进入统一员工协议处理。`employee-runtime-service.mjs` 在 submitted、空 turnId 阶段将 possible-current started、delta、final 和带 turnId completion 深拷贝到本次 `sendLocks` 发送对象，无 turnId completion 最多兼容保存一个。响应确认 turnId 后先绑定 working，只按到达顺序回放 matching turnId 事件；无 matching 带 ID completion 时才补一个无 turnId completion。回放直接进入正常 `handleProtocolMessage`，`acceptsProtocolMessage` 在 initial early 阶段拒绝 execution，在 replay 阶段放行当前事件。正式 execution 接线对合法无 turnId completion 生成仅用于 tracker 的深拷贝，用当前 active 或 confirmed turnId 补齐两个 turn ID 字段；原始员工消息和 completion payload 不修改，拿不到 ID 时不向 execution 投递，带 ID 与无 ID 同时存在时带 ID 优先且总 completion 一次。steer 不缓冲并保留原 turnId。读取活动线程时用 `thread/read includeTurns:true` 恢复未完成 turnId，无法取得时进入安全中断态。send 成功、失败和 service close 都清理缓冲。未新增跨事件状态 Map、定时器、轮询或延迟核对，未修改目录组件、消息正文、`ConversationView.tsx`、`useReturnToBottom.ts`。
- 验证：`windows/tests/employee-runtime.test.mjs` 31/31、`ui-feishu/validation/employee-provider.test.mjs` 13/13、`ui-feishu/validation/realtime-regression.test.mjs` 7/7，三文件组合 51/51；相关 MJS 语法及 `git diff --check` 通过。覆盖普通与早到无 turnId completion 的员工/execution 双状态同步、无 ID 与 matching ID completion 同时存在时总 completion 一次、无 confirmed ID 时安全失败且不静默清 execution、started/delta×2/final/completion 全部早于 start 响应的真实适配和 execution 链路、响应前无正文/execution 正文广播、响应后按原序各一次；以及深拷贝、旧 turn 丢弃、steer、失败提交不跨下一轮泄漏、活动线程 turnId 恢复、安全中断和目录 working→idle。无 turnId completion 无法与旧 Provider 无标识迟到事件严格区分，为兼容边界。证据见 [verification.md](../../../../work/employee-status-completion-20261110/verification.md)。
- 状态：仅 develop 工作区源码、定向测试和 FEAT-002 记录已修改；未提交、推送、发布或重启，运行服务尚未加载本修复，未做真实 Provider 生产复现。

### 2026-11-10 产品分析岗位职责与沟通方式

- 用户反馈：产品分析不符合产品角色的沟通和工作方式，体验太差。要求把其原话中的高效沟通、用户体验优先、集中式问题提纲、问题数量提示、相关问题成组开发、复用优先和减少冗余信息加入岗位职责。
- 修复前体验：产品分析只有宽泛的“调研、核实、比较方案”说明，容易先讲技术方案或过程，问题零散，没有明确按用户真实页面和操作结果组织汇报。
- 修复后体验：产品分析先核查当前用户流程，再直接说明需要用户回答的问题数量并给出集中提纲；只问会改变产品结果的事项。确认后按依赖顺序组织相关小改，优先复用并删除重复逻辑；汇报先讲用户操作和前后反馈，再讲核心逻辑、改动量和风险。
- 实现：更新 `employees/researcher/employee.json` 的岗位职责和 `employees/researcher/system-prompt.md`，保留用户原话并转成可执行工作规则；FEAT-002 记录用户原话和当前有效决定。
- 状态：职责文件已修改；需后端重启后加载。当前员工状态修复仍在进行，避免提前加载混合改动，本次未重启、未发布。

### 2026-11-11 未点名消息接待兜底与任务回报测试恢复

- 用户可见变化：没有运营管理的群里发未点名消息，不再出现红色“消息未能交给员工”，改由 negus助手或群内第一位员工接待；零员工群可以发消息，显示“已记在群里…”。决定依据与待确认点见 item.md 同日小节。
- 修改：`group-task-service.mjs` 接待员工按群成员选择、零员工直接记录；`task-routes.mjs` 去掉零员工 409 并返回 `listening`。源码净增约 6 行。
- 测试：新增 1 项覆盖零员工、仅研发、研发+negus助手、negus助手+运营管理四种群；修复前该项失败，修复后通过。`result-delivery.test.mjs` 夹具缺少 `bindRuntime` 导致 10 项全失败并卡住整套测试，补齐后 10/10 通过；删除引用已移除模块 `windows/server/agent-tasks/service.mjs` 的两份旧测试。
- 验证：全新克隆（无本机提示词文件）下 `windows/tests` 542/558（+08:00 时区 544/558），`ui-feishu/validation` 129/140 且不再卡住；TypeScript 与 Vite 构建通过；`git diff --check` 通过。隔离实例（临时目录、临时端口、临时 HOME 与 CODEX_HOME、指向本机关闭端口的占位 DeepSeek 渠道）真实启动后经 HTTP 验证：零员工群创建 201、发送 202 且 `listening:true`、快照含该消息且无失败消息；同一探针在基线上返回 409。
- 未验证：真实供应商回复、真实浏览器、手机；剩余失败为依赖部署机 Playwright 路径的浏览器测试及与本次无关的既有用例。
- 状态：仅工作区修改，未提交、未推送、未发布、未重启；运行中的正式服务未加载。

### 2026-11-11 空闲员工误显示“正在主对话工作”

- 用户反馈：员工回答完成后仍显示“正在主对话工作”，要求确认显示条件和是否存在隐藏后台任务。
- 实际数据：后端员工状态为 `idle / active=false / turnId=""`；主线程和群会话均无运行中 turn；任务存储中没有该员工排队、执行或恢复中的任务。
- 根因：前端员工目录把 `statusByThread[threadId]` 的“状态对象存在”误当成“正在运行”，没有读取其中的 `active` 布尔值；因此已回落的空闲状态仍触发“正在主对话工作”。
- 修复：员工聚合状态改为只读取 `statusByThread[mainThreadId]?.active`，与目录主对话状态和后台任务聚合规则一致。
- 验证：新增空闲 live status 回归；`ui-feishu/validation/conversation-summary.test.mjs` 32/32 通过，`git diff --check` 通过。前端已发布构建 `feishu-mwc02n0u`，线上服务返回的版本与发布结果一致；本次不需要后端重启。当前源码尚未提交或推送。

### 2026-11-11 行动依据与语境确认门槛

- 用户反馈：助手和员工把半句话、质疑或问题描述当成执行指令，过早派工、修改或撤回，造成 token 浪费和越权操作。
- 修复前体验：用户问“为什么”或指出未经授权，系统可能直接开工或反向撤回；讨论与执行没有清晰边界。
- 修复后体验：讨论、诊断、修改、派工、撤回、发布分别判断。讨论和质疑只回答；执行前必须确认目标、现状、范围、不做事项、完成标准和授权，信息不足时先提问并等待。
- 实现：更新用户画像、所有助手共用的 `basePrompt`、`AI_ASSISTANT_WORK_RULES.md` 和员工派工提示词；任何副作用行动必须能追溯到本轮明确指令或已确认方案，历史授权不得扩展到新的动作类型。群后台任务和 agentless 后台任务也继承同一 `basePrompt`；PM-004 补充当前澄清，明确旧敏捷开发授权不覆盖新的发布、重启、派工或撤回。
- 状态：文件和需求记录已修改，独立复核发现的实施遗漏已补齐；用户已明确要求重启后端，待重启前独立复核完成后执行，当前尚未重启。

### 2026-11-11 开发需求表状态校正

- 状态：in_progress
- 本次更新：根据现行代码重写条目的当前状态，区分已实现的群聊、员工任务、未点名接待兜底、零员工群和员工规则，与仍待用户确认的群共享上下文、接待顺序及员工详情页重设计。
- 用户影响：需求表不再把完成的群聊核心描述成原型阶段，也不会把尚未确认的方案当成最终规则。
- 证据：`docs/project-management/INDEX.md`、`ui-feishu/validation/group-task-service.test.mjs`。

### 2026-11-11 新版真实模型与群聊链路验收

- 状态：in_progress（核心链路本轮通过）
- 运行版本：受控重启到 `develop / 55f293bb`，发布快照 `1794409080769-f1f4cefc`，后端、前端和公网隧道健康。
- 员工状态：技术研发收到真实 DeepSeek 请求后进入 `working`，完成后自动回到 `idle`，最新回复为“状态测试通过”。
- 模型切换：切到 `deepseek-v4-pro/high` 后，原始会话记录中的该轮 `turn_context` 和 `world_state` 均为 `deepseek-v4-pro`；随后切回 `deepseek-flash/high`，下一轮原始记录也确认为 `deepseek-flash`，没有残留待切换配置。
- 群聊接待：在 `negus 项目群` 发送未点名消息，由运营管理接待并回复“群聊接待测试通过”；任务为 completed，结果 delivered。
- 群聊点名与回传：发送 `@技术研发` 消息，由技术研发回复“群聊任务测试通过”；任务为 completed，结果 delivered。
- 未覆盖：Mac 当时锁屏，没有执行浏览器视觉与点击检查；测试消息保留在真实员工会话和 `negus 项目群` 中。
- 证据：`work/requirements-audit-20261111/verification.md`。

### 2026-11-12 16:52 +08:00

- 状态：in_progress
- 本次更新：记录 Codex 自动恢复后员工仍显示“进行中”的问题暂缓修复，先观察最新合入版本的实际效果。
- 用户原话：“2.先不修。稍后修。”
- 用户影响：本次不增加员工恢复状态修复；最新 PR #2 合入后仍可能看到该问题，待稍后单独处理。
- 证据：当前对话；`docs/project-management/items/FEAT-002/item.md`。
