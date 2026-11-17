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

### 2026-11-14 群聊任务服务关闭后不再写入房间状态

- 状态：已实现，待评审（PR）；未发布、未重启。
- 根因：`native-task-runtime.mjs` 的 `detach()` 只把运行中任务标记结束，不等待已在执行的事件处理（如 `turn/started` 后 `room.updateAgent`）。`task-kernel.mjs` 的 `close()` 也不等待，于是关闭返回后仍会写 `room.json`，与后续清理竞争，出现 ENOENT/ENOTEMPTY 和测试进程不退出。另外 `group-task-service.test.mjs` 中一个用例先登记删除目录、后登记关闭服务，清理顺序颠倒。
- 修改范围：`detach()` 返回等待各任务在途事件处理的 Promise，`close()` 予以等待；结束后不再接收新事件，因此只等待已开始的处理。测试用例改为先关闭服务与房间再删除目录。
- 验证：`group-task-service.test.mjs` 顺序 10 次与 8 路并发 40 次全部 0 退出、约 1 秒（修改前约每 10 次出现一次失败或挂起）；`ui-feishu/validation` 全套 5 次均约 3 秒结束，134 通过，14 失败与修改前一致（浏览器/测试服务/环境依赖）；`task-kernel`、`native-task-runtime`、`result-delivery` 37/37；`windows/tests` 563 通过、0 失败。`kernel-source-manifest.json` 中两文件哈希在修改前即与 HEAD 不符且无读取方，未更新。

### 2026-11-16 群聊与普通对话体验差异登记

- 状态：仅需求文档更新；问题已登记，尚未授权或实施代码修改。
- 本次更新：在 `item.md` 的 FEAT-002 原条目末尾追加 `roomId: project-room:project:business:phonecameradata` 的群聊体验记录，保留用户原话，区分已证实事实、待证据项和最小后续顺序；未新增重复需求清单，也未覆盖既有决定。
- 已登记核心事实：房间配置 6 位员工、持久化 12 条消息、3 条助手回复及 5 个任务均来自运营管理；运营管理原生会话的 6 条 commentary 未进入房间；群聊未复用普通对话已完成 commentary 的独立消息落库与展示链路；群内派工返回 `Unauthorized`；执行中补充没有“已加入当前执行”提示，最终回复只关联初始派工消息。
- 边界：不把该房间的员工集中现象外推至所有群，不在缺少 stderr 证据时认定认证失败原因，不把滚动问题写成已确认 bug。
- 代码与运行状态：业务代码 0 行；未发布、未重启、未提交。工作区其他既有未提交改动保持原样。
- 验证：仅针对本次两份文档运行 `git diff --check`，结果通过。

### 2026-11-16 后台代理查询工具选择问题登记

- 状态：仅需求文档更新；问题已登记，是否修改全局提示词、员工职责及具体落点待后续执行任务决定，本问题未修复。
- 本次更新：在 `item.md` 的 FEAT-002 原条目末尾追加后台代理过度使用 computer 和截图的问题登记，保留用户原话及技术研发反馈中的规则原话，不新增重复需求清单。
- 问题性质：工具选择错误，不是 computer 能力不足；目标是减少慢路径和误操作，不新增工具。项目文件、代码、日志、API、Git 和运行状态应使用现有 shell 或只读文件能力；computer 仅用于必须操作图形界面、真实页面视觉验收或只能通过界面完成的步骤，并说明使用理由。
- 开放决定：本次没有修改全局提示词或员工职责文件，也没有确定规则落点；后续仍须由明确执行任务完成实施与验证。
- 验收方向：简单文件查询直接走命令；日志和 API 查询不截图；确需 UI 验证时允许 computer 并有明确理由；真实浏览器和界面测试能力保持可用。
- 代码与运行状态：代码及提示词配置 0 行；未发布、未重启、未提交。工作区其他既有未提交改动保持原样。
- 验证：仅针对本次两份文档运行 `git diff --check`。

### 2026-11-16 完成态被旧 live 状态覆盖

- 状态：已定位为既有前端状态合并/目录投影 BUG，并登记为待修复；业务代码 0 行。未发布、未重启、未提交、未发送测试消息，工作区其他既有未提交改动保持原样。
- 用户反馈原话：`这个明明完成了，还是显示助手正在运行`；另要求沿用原问题记录修复后不再出现 `你的状态还是显示‘正在处理后台任务’，这个问题怎么反反复复？？？`，并明确要求 `把修复这个问题也列入需求表`。
- 现场：conversationId=`handoff-05bb309bd4f097df68f9f962adf8289f`，threadId=`01a1e502-3baf-7770-b262-5bbb5c3e7467`；对应 task `a3f85cd1-9d6f-4fde-be41-a2a653fb5466` 为 background，已完成。另一个 task `21e34d04-3b2f-4655-9356-df939fc895f1` 为 external，查询时 recovering，现为 completed。
- 已核实：补充线程最终消息已持久化；execution 为 completed/inactive，turnId 一致，durationMs=238449，lastProbeAt=null；员工状态和 `/api/project-directory` 父行均为 idle，任务子项为 completed。`21e34d04...` 已被 `/api/tasks` 的 public 投影排除，不会直接计作后台任务。
- 已复现根因：慢读期间 `context_status` 增加 revision；读取返回 terminal 快照时 revision 已不相等，`ConversationStore.commit()` 不清理旧 live active。随后 `snapshotStatusByThread()` 无条件采用 live active，覆盖目录 completed，生成“助手正在运行”或“正在处理后台任务”。隔离内存复现结果包含 `livePresent=true`、`storedActive=true`、投影 working。
- 同场区分：完整任务账本当时还有真实 background 任务 running，不能把那段“正在处理后台任务”直接归因于 external 追踪记录；external 被排除于后台任务目录的现有规则需要保留。
- 独立风险：`needs-reconciliation` 带证据时每 15 秒回到 `recovering` 重试，无次数上限；本次 external 已正常收敛，未发生无限重试现场。
- 最小方案：修正 terminal snapshot 对旧 live execution 的清理，并让目录 terminal 状态压过无更新证据的 live active；保留确有更新证据的新 active。给恢复核对设置有限次数，耗尽后使用现有 `interrupted`。补单元和浏览器验收，覆盖 completed 即空闲、慢读/重连/缓存不复活、external 不显示后台任务、真实运行不误清、recovering 不无限重试。
- 当前版本：运行快照 `1794475480957-705e25f4`；只读健康检查为 healthy。文档修改尚未由任何功能代码生效。
- 验证：仅针对本次两份文档运行 `git diff --check`，结果见本次交付。

### 2026-11-17 完成态与有限恢复核对源码修复（审核通过并发布）

- 用户本轮明确授权实际修复；沿用本项 11 月 16 日问题，保留历史“暂缓”和登记记录，不增加其他功能。
- Store 独立按事件证据合并执行状态；目录完成态压过无更新证据的 active，标题、员工父行与发送控制共用完成态；较新的同 epoch/新 turn 保持活动。保留 bodyRevisions/fieldRevisions，不恢复正文请求风暴。
- needs-reconciliation 连续失败上限三次，计数持久化，耗尽进入 interrupted 并保留实际错误；真实运行证据清零失败次数。external 的公开任务与目录排除规则未改。
- 本项业务 +99/-26，测试 +231/-7。200 项相关测试、TypeScript、完成态专项及既有浏览器回归、diff 检查通过；三档 context_status 均零正文请求，受保护文件零差异。
- [证据、逐文件原因、命令与覆盖边界](../../../../work/terminal-live-20261117/verification.md)。DeepSeek 独立审核 PASS，无阻断、中或低风险问题；已随受控发布加载到运行快照。

### 2026-11-17 群聊协作差异源码修复（审核通过并发布）

- 已完成 commentary 复用房间消息持久化、SSE 和普通 Message；以 workId/itemId 去重，中间回复不误结束运行占位，停止/失败仍保留。复用原生已有历史核对补回遗漏，不新增轮询。
- 根因：群服务只转发 delta；长期原生线程已加载时 resume 不替换 MCP 配置，已交付任务释放 token 后下轮仍用旧凭据。群路径确认旧执行结束后 unsubscribe/resume 安装本轮能力；来源 actor、群作用域、后台禁止再次派工保持。
- 补充消息保存 messageId/turnId，最终回复关联本轮最后已接收补充；不新增文案、组件或 CSS，不修改受保护滚动。
- 证据、逐文件增减、测试命令与边界见 `work/group-collaboration-20261117/report.md`。DeepSeek 独立审核 PASS，无阻断或中风险问题；仅记录中段历史补录顺序的低风险边界。已随受控发布加载到运行快照。

### 2026-11-17 后台查询工具选择源码修复（审核通过并发布）

- 根因：共用 computer 提示未区分查询与界面操作，且旧后台执行者覆盖提示仅包含 basePrompt。
- 修改：computerInstructions 集中定义直接数据查询/必要界面的选择和理由要求；既有 node_repl、permissions/screenshot 操作规则限定为界面步骤；旧后台服务复用该函数。无工具、MCP 配置、UI 或任务业务变更。
- 验证：提示契约和 computer MCP 6/6；员工运行时、员工定义、成长提示、后台模型/健康及任务扩展回归 72/72；14 份实际生成提示覆盖 6 类查询和 3 类必要界面场景；MJS 语法与 git diff --check 通过。
- 证据：`work/query-tool-choice-20261117/` 中的 generated-prompts.json、targeted-tests.log、regression-tests.log、verification.md。测试为隔离组装/协议验证，没有真实模型消息、截图或 UI 操作，真实模型选择行为留待授权运行验收。
- 状态：DeepSeek 独立审核 PASS，无阻断或中风险问题。14 份实际生成提示覆盖前台、6 位员工和后台新建/resume/turn；已随受控发布加载到运行快照。既有未提交改动按修改前 SHA-256 核对保留。

### 2026-11-17 本轮四项修复交付状态

- 后端受控重启 jobId `1794850200246-69963` 已完成，结果 started，运行快照 `1794850193600-27e8db44`、pid `70019`。
- 重启快照构建并生效的前端为 `feishu-mwjjgqj6`（2026-11-16T17:29:58.826Z），公网 `/version.json` 已核对一致。
- watchdog 返回 backend/frontend/tunnel healthy；运行快照中的本项群聊、任务内核、上下文与工具选择文件同工作区 SHA-256 一致。
- 仍需用真实公网手机输入、真实群聊中间回复/派工和真实后台代理查询做发布后验收；隔离测试不替代真实供应商端到端结论。

### 2026-11-17 员工主对话完成后状态回落复核

- 用户反馈原话：`完成后仍显示正在主对话工作`；本次进一步明确撤销短延迟自动核对方案，要求按 Provider 客户端事件过滤根因修复，禁止新增定时器或轮询。
- 根因证据：`340baaa` 的 `ui-feishu/server/employee-provider-integration.mjs` 将订阅改为比较 `threadClients` 与当前 `runtimeClient` 对象；迁移后同一 Thread 的当前 Provider 完成事件会在入口被错误丢弃。`1b2ac07` 已删除该过滤并在 `employee-runtime-service.mjs` 增加主线程与 turnId 校验；`55f293b` 随后把运行时逻辑直接落入源码。
- 修复前体验：最终答案已显示后，员工目录和主对话仍显示“正在主对话工作”，要等下一次发送才触发已有空闲核对；旧 Provider 晚到事件也可能干扰状态或正文。
- 修复后体验：当前 Provider 的当前 turn 完成事件立即让员工回到空闲；其他 Provider 的旧 turn completed、delta 和 final answer 因 turnId 不匹配被丢弃；新 turn 可建立自己的 turnId；无 turnId 的 completed 保留兼容回落；最终答案先到、completed 后到仍会立即回落。
- 本轮改动：生产逻辑沿用当前 `dfe8bcf` 的正确实现，无定时器或轮询新增。`ui-feishu/validation/employee-provider.test.mjs` 补充旧 Provider 不同 turnId 的 delta 被拒绝、旧 final answer 被拒绝、当前 Provider final answer 被接受且随后 completed 立即 idle 的断言。
- 验证：`windows/tests/employee-runtime.test.mjs` 33/33、`ui-feishu/validation/employee-provider.test.mjs`、`ui-feishu/validation/realtime-regression.test.mjs` 及相关 MJS 语法、`git diff --check` 结果见本次交付。
- 状态：当前工作区基线为 `develop / dfe8bcf`，与任务描述中的 `340baaa` 不一致；本次按实际工作区继续并保留全部既有改动。未提交、未推送、未发布、未重启，运行服务未由本轮加载验证。


### 2026-11-17 四项真实使用问题源码修复与定向自测

- 用户本轮明确授权修复；原话、现状及有效决定追加在同条目 item.md，既有记录和已发布改动保留。
- 覆盖压缩活动时间、普通及员工主对话打开用量校准、员工页新建普通对话、跨设备完成目录同步；员工历史用量复用既有只读供应商历史路径，目录落盘后再失效，失败补读有界。
- 185 项定向单测通过；隔离浏览器四项操作及缓存/发送回归通过；100/1,000/10,000 状态事件零新增正文请求。精确命令、增减、保护检查及证据见 [验证记录](../../../../work/four-usage-fixes-20261117/verification.md)。
- 状态：仅 develop 工作区修改与自测；未提交、推送、发布、重启、截图或发送真实消息；运行服务没有因本轮加载新代码。来源对话后续安排 DeepSeek Flash High 独立验收；真实公网、手机和供应商端到端留到发布后。


### 2026-11-17 第二轮：独立审核 FAIL 后三个漏项补修

- 按用户限定仅补分页缓存上下文校准、同毫秒压缩序号和目录可恢复错误重试；不重做已通过四路主体，保留既有改动。
- 本条目对应原话、有效决定与保留范围已追加在item.md。115项定向单测及四项浏览器、100/1,000/10,000纯状态事件零正文请求通过；完整命令、统计和最终检查见 [本轮验证记录](../../../../work/four-usage-fixes-20261117/verification.md#第二轮补修独立审核-fail-后)。
- 上轮185项通过记录保留为历史局部证据，独立审核FAIL结论不覆盖或改写为PASS；本轮补修由来源对话复审。未提交、推送、发布、重启、截图或发送真实消息。

### 2026-11-17 快速追加与响应前审批两个发布阻断

- 用户明确只修两个发布阻断，最小改动，不新增状态表、队列或轮询；保留工作区其他改动，不提交、不发布、不重启。
- 修复后体验：快速完成期间立即追加第二条会按原生线程状态走一次新的 `turn/start`，`turn/steer` 明确返回原 turn 已结束时也只安全重试一次；确实有另一活动 turn 时仍按真实占用返回。审批、requestUserInput 或 elicitation 早于 `turn/start` 响应时先按本次 submission 缓冲，确认 turnId 后回放，正文正常显示并最终 idle；旧 turn/旧线程审批不回放。
- 测试：employee-runtime 38/38、employee-provider 13/13、realtime-regression 10/10；相关 MJS 语法与 `git diff --check` 通过。新增覆盖快速追加、ended-steer 两次分支、approval 与 requestUserInput 早到全链、旧审批拒绝，并保留 steer、无 turnId completed、重启恢复回归。
- 状态：仅 develop 工作区修改与隔离协议/适配测试；未提交、推送、发布或重启，运行服务未加载本修复。证据见 [验证记录](../../../../work/runtime-release-blockers-20261117/verification.md)。

### 2026-11-17 风控复核后的两个状态覆盖竞态

- 用户明确只补迟到旧审批/补充输入和 steer response 覆盖等待两项，不提交、发布或重启。
- 等待类事件现在先校验 active、current.turnId 与事件 turnId；旧 turn、idle 和已绑定后的无 ID 等待事件在进入 execution 前拒绝。递交中的无 ID 等待事件确认后注入 turnId 回放，另一等待文案不被覆盖。
- steer 响应只在 submitted/working 发布 working；已有 waiting phase 仅补 confirmedTurnId，保留 label 与 active。随后 final/completed 正常回到 idle。
- 测试：employee-runtime 38/38、employee-provider 13/13、realtime-regression 15/15，合计 66/66；MJS 语法与 `git diff --check` 通过。新增覆盖 active 旧 ID/无 ID 等待拒绝、idle 旧审批不重新点亮、无 ID 早到 buffer 注入、两条 steer waiting 全链，并保留快速追加、早到 full output、无 ID completion、steer、restart 和普通对话回归。
- 状态：仅 develop 工作区修改与隔离协议/适配测试；未提交、推送、发布或重启，运行服务未加载本修复。证据见 [验证记录](../../../../work/runtime-release-blockers-20261117/verification.md#风控复核后的两个状态覆盖竞态)。

### 2026-11-17 失败、旧响应与 close 状态覆盖

- 用户限定只补三条路径：不同 turnId 旧响应、steer 普通/网络失败、close 后 continuation；不提交、发布或重启。
- steer 请求前保存 phase/label/detail/active/turnId。失败后同 turn 恢复 snapshot，不同 turn 显示 authoritative occupied，inactive 进入 idle，unknown 保留 snapshot。旧响应清空 buffer 后以明确错误退出，不再落通用 catch。
- close 后异步返回、catch、状态发布和回放均有门禁；只清理 buffer/submission，不写员工或 execution，不补正文。turn/start 失败原有安全语义保留。
- 测试：employee-runtime 38/38、employee-provider 13/13、realtime-regression 23/23，合计 74/74；MJS 语法与 `git diff --check` 通过。新增覆盖两种 waiting 的旧响应、普通与网络失败保留 waiting、authoritative 异 turn/inactive/unknown、close 后返回不回放；既有快速追加、早到 output/waiting、无 ID completion、restart、目录和普通对话回归通过。
- 状态：仅 develop 工作区修改与隔离协议/适配测试；未提交、推送、发布或重启，运行服务未加载本修复。证据见 [验证记录](../../../../work/runtime-release-blockers-20261117/verification.md#失败旧响应与-close-状态覆盖)。

### 2026-11-17 steer 失败时保留请求后实时等待

- 用户限定只修 steer 发出后才进入 waiting、随后失败又被旧 working snapshot 覆盖的时序问题；不提交、发布或重启。
- steer same-turn-active 和 authoritative-unknown 分支现在先看实时状态；同 turn 已 waiting 时保留 phase、label、active 与 turnId。没有新 waiting 时仍恢复请求前 working snapshot；异 turn occupied、inactive idle、close 行为不变。
- 测试：employee-runtime 38/38、employee-provider 13/13、realtime-regression 27/27，合计 78/78；MJS 语法与 `git diff --check` 通过。新增覆盖普通/网络/unknown 三条请求后 waiting 链路、无 waiting 的 working 对照，并验证 waiting 后 final/completed 正常 idle。
- 状态：仅 develop 工作区修改与隔离协议/适配测试；未提交、推送、发布或重启，运行服务未加载本修复。证据见 [验证记录](../../../../work/runtime-release-blockers-20261117/verification.md#steer-失败时保留请求后实时等待)。

### 2026-11-17 群聊多人协作路由与问号状态答复源码修复

- 根因：群聊入口未点名时只生成运营任务，模型没有明确协作触发边界，实际可自行运行工具而漏掉 `delegate_task`；“？”也被当作普通模型任务。候选修复还把历史消息带入协作判断，并过早发布分工，模型失败时会留下虚假安排。
- 回炉修复：逐字请求“安排更新 iPhone 18pro 系列的数据。几个人相互做好自己职责合作完成。我要看等效光圈的对比。”原先会按固定 fallback 选产品分析+风控并漏掉技术研发。现在当前消息中的更新数据、页面/网站、构建、发布、上线、接口、可视化、图表、对比等实现信号强制包含技术研发；该原始消息实际创建产品分析+技术研发任务。“几个人一起看看这个”这类无岗位请求只创建运营澄清任务，不凭空创建员工任务。
- 保持：仅按当前消息识别，明确 `@` 不触发自动分工；运营使用现有 `delegate_task`，对应员工任务全部落账后才幂等发布分工。成功轮次或终态恢复核对遗漏任务时由同一内核补齐，计划不向子任务传播且计划内结果不生成 continuation。简单单岗位、停止/继续、commentary、认证刷新和恢复保持原链路。问号直接读取现有任务账本答复，不创建新任务。
- 验证：逐字原始消息与通用无岗位请求均走真实群路由、任务服务、stdio MCP 工具链；定向 28/28；相关任务、群记录、commentary、停止、续接、认证、重启和消息投影回归 155/155；需求记录 5/5；TypeScript、MJS 语法和 diff 检查通过。证据见 [本轮验证记录](../../../../work/group-collaboration-routing-20261117/verification.md)。
- 质量复核补修：裸“数据/字段/数据库/缓存/页面数据处理”不再触发产品分析；数据库头像字段和首页数据修复走真实群路由/任务服务时只产生运营任务，没有 researcher 子任务。逐字 iPhone 18 Pro 仍产生产品分析＋技术研发，无岗位“几个人一起看看”仍只澄清。
- 状态：候选已实现并完成定向自测，待风控质量复核。仅 develop 工作区源码、员工提示词、测试和文档修改；未提交、推送、发布、重启，未发送真实群消息，运行服务未加载本修复。

### 2026-11-17 Codex 原生子代理状态与来源署名需求补齐

- 用户指出：Codex 原生子代理不会进入员工列表的后台任务状态；子代理中的员工派工仍显示为用户名义。
- 需求缺口：FEAT-001 只定义了“Codex 子代理”来源标签，FEAT-002 的员工状态汇总未包含原生子代理，也没有定义子代理首条派工消息必须显示来源员工。
- 新增要求：员工发起原生子代理或 Negus 后台任务后必须进入对应员工的状态/子项；首条派工消息显示来源员工，真人消息仍显示用户；无法确认来源时不得回退或猜测为用户。
- 本轮实现：新增可信父线程解析，仅将员工主对话、员工群会话及其中多层原生父链下的 native child 归入员工目录；普通 fork、未知父和循环不投影。运行中沿用现有“正在处理后台任务”与“正在进行 N 项工作”，完成后按 execution 回落，不新增任务或状态存储。前端口径补修中，native child 使用 `role:"standard"`，员工群会话继续使用 `role:"project"`，避免真实用户入口误显示“正在群聊工作”。
- 来源体验：打开原生子代理时，首条 userMessage 在左侧显示发起员工姓名、`authorId/authorName/displaySourceAgentId`；后续真人消息保持用户身份。未知来源显示“来源待确认”，普通 fork 不做来源伪装。分页中段不会把后续真人输入误标为首次派工。
- 验证：定向 31/31，群聊、目录、任务内核、来源版本和 provider 回归 202/202，员工状态、实时与执行跟踪回归 123/123；真实前端目录投影 45/45，直接使用后端目录输出验证 active native child 的父员工显示“正在处理后台任务”、完成时空闲，群会话 child 仍归属员工。TypeScript、相关 MJS 语法、`git diff --check` 和受保护文件零差异通过。证据见 [验证记录](../../../../work/native-subagent-projection-20261117/verification.md)。
- 状态：仅工作区源码、测试和需求记录修改；未提交、推送、发布、重启，未发送真实消息或修改运行历史。运行服务未加载本修复，独立质量复核由来源助手安排。

### 2026-11-17 子代理完成后自动唤醒来源员工

- 用户反馈员工执行一段时间后无反馈、页面长时间空白，并纠正运行记录应显示北京时间。
- 已核实：员工 17:21:43 结束父回合；子代理 17:25:33 完成；系统只记录子代理通知，父会话没有自动续跑；用户在 17:40:16 再次发言后才恢复，空白 18 分 33 秒。
- 要求已登记在 `item.md`：子代理完成、失败或请求决策时自动唤醒来源员工；接手后持续反馈阶段；目录状态贯穿执行；后台链路自动继续质量、发布和验收；用户可见时间统一北京时间。
- 本轮只更新需求记录，没有修改业务代码或运行服务。

### 2026-11-17 原生子代理用户体验对齐后台任务

- 用户指出原生子代理与 Negus 后台任务的体验差异较大，并明确要求继续加入需求表。
- 已登记统一标准：复用现有员工目录、任务列表和会话入口；显示同一来源、阶段、进度和结果；完成后自动唤醒来源员工并继续质量、发布和验收；刷新、重连、重启后保持唯一父子归属且不重复执行。
- 底层继续保留 Codex 原生线程，用户层复用 Negus 后台任务现有状态和通知体验，不新增第三套任务或状态存储。
- 本轮只更新需求记录，没有修改业务代码或运行服务。

### 2026-11-17 严重派工问题：路由、启动确认与后台入口优先

- 保留用户三项原话及本轮真实事件：原生子代理 `/root/accept_and_publish_today` 创建后因 vip 分组无 deepseek-flash 渠道报 503；助手核对启动前就结束回复；没有先发现 Negus 后台任务入口。
- 在同一 FEAT-002 条目登记优先处理要求：正确渠道/分组、真实启动确认后再结束前台回合、优先 Negus 后台任务、启动失败主动反馈并续接已授权目标；模型替换仍遵守用户授权。
- 验收覆盖正确分组、503、立即失败、启动超时、后台工具可用/未接入、结果自动回传与重连幂等；不新增平行任务账本，不借用用户身份派工。
- 本轮仅更新需求与目录导航，业务代码和运行服务未改动。文档验证见本轮项目管理测试及 diff 检查结果。

### 2026-11-17 派工渠道、启动确认与后台入口优先候选修复

- 根因：原生子代理继承了 `vip` 分组却指定 `deepseek-flash`，实际返回“分组 vip 下模型 deepseek-flash 无可用渠道”；Negus 任务工具此前在队列落盘后立即返回，没有等待真实原生启动事件。
- 修复后体验：用户要求后台执行时，助手先使用 Negus 后台任务入口；工具在创建前解析实际可用渠道并固化模型、渠道和思考等级，创建后等待真实 `task_started` 或终态。只有 `startup.confirmed=true` 才显示已经开始；失败、渠道错误、等待调度和超时分别显示真实状态。
- 普通对话派工补修：真实调用现网 Negus 工具时复现“员工不存在：(空)”，原因是员工层级校验把普通来源当成空员工。现在普通对话可直接通过 `delegate_task` 交给明确员工，保留 `assistant:<threadId>` 来源身份、目标员工身份和目标渠道；普通对话本身不再被强制要求是员工。
- 实现复用：`employeeTaskRoute()` 复用现有 Provider 路由；任务内核新增基于既有启动事件的等待入口；员工直聊、普通对话和群聊任务工具共用，不新增任务账本、轮询、UI 或状态存储。全局、员工和群聊提示词明确优先 Negus 后台任务，原生子代理只作检查后的回退。
- 验证：任务内核/员工交接/渠道策略 42/42，群聊协作与原生运行时 44/44，维护提示/消息交接/署名投影 21/21，群路由/群记录/原生工具 27/27；MJS 语法和 `git diff --check` 通过。新增覆盖真实启动、启动失败、等待超时、显式渠道保留、群聊实际 DeepSeek 路由和普通对话直接交给指定员工。证据见 [验证记录](../../../../work/dispatch-startup-routing-20261117/verification.md)。
- 风控质量助手独立验收：PASS（候选源码），可进入提交。复跑 42/42、44/44、21/21、27/27、项目管理 5/5，MJS 语法、`git diff --check` 和受保护滚动文件零 diff 均通过；确认普通对话向指定员工直接派工、任务幂等和结果回传。运行快照 `1794907134870-68e43b7f` 的核心文件 SHA-256 与工作区不同，现网仍加载旧逻辑。
- 状态：候选源码、测试和需求记录已修改并通过独立质量验收；未提交、推送、发布或重启。提交后需执行受控后端重启，才能让普通对话派工和启动确认在现网生效。

### 2026-11-17 配置驱动的派工模型回退

- 用户纠正原话：“1.不应该固化，而是我们应该有配置文件，写清楚什么配置渠道有什么模型，派任务时参考一下。2.不是返回错误，而是尝试用别的渠道和模型”。该纠正替代固定实际 route 和首选渠道缺模型时直接报错的旧实现。
- 新增 `runtime/model-routing.json`，按顺序列出渠道和模型；`windows/server/model-routing.default.json` 提供默认配置。派工读取该文件，先尝试目标模型在首选渠道，再尝试同一模型的其他渠道，随后尝试其他模型；刷新失败继续使用已有目录。
- 任务保存 `taskRouting`，包含请求模型、首选渠道、实际渠道、实际模型、尝试列表和回退原因。最近发生渠道模型失败的组合在后续派工中跳过，避免反复进入已知不可用组合。
- 验证：任务内核/员工交接/渠道策略 43/43，群聊与原生运行时 44/44，维护提示/群路由/项目管理等 53/53；MJS 语法和 `git diff --check` 通过。真实本机目录验证 vip 请求 `deepseek-flash` 时自动选择 DeepSeek 渠道并记录“同模型改用其他渠道”。证据见 [验证记录](../../../../work/dispatch-startup-routing-20261117/verification.md)。
- 状态：候选源码与测试已修改，等待风控质量助手针对配置化回退重新验收；已发布快照 `1794917696362-f61034db` 不包含本次纠正。

### 2026-11-17 配置化派工风控 FAIL 补修

- 首次风控任务 `dd7ae4cb-46d1-4577-a77c-151395964e08` 返回 FAIL：配置默认模型没有生效、历史失败组合永久跳过后续成功、全部候选失败时缺少尝试明细。
- 补修后默认模型完全读取 `defaultModel`；每个渠道模型组合只参考最新终态，后续成功清除旧失败；全部失败时错误正文和结构化 `details` 同步包含尝试列表；未显式指定思考等级时使用配置值。
- 普通对话、员工和群聊任务均直接断言持久化的 `taskRouting`；任务工具 HTTP 错误断言返回结构化尝试记录。
- 验证：任务内核/员工交接/渠道策略 45/45，群聊与原生运行时 44/44，维护提示/群路由/项目管理等 53/53；真实本机 Provider 目录继续验证 vip 到 DeepSeek 的同模型回退。证据见 [验证记录](../../../../work/dispatch-startup-routing-20261117/verification.md)。
- 状态：补修源码与测试完成；第二次风控任务 `aa73945e-8aa1-43e6-85b5-59fbef1e36f3` 已真实启动并确认执行模型 `deepseek-flash`、思考等级 `high`。运行快照 `1794917696362-f61034db` 不包含本次纠正。

### 2026-11-17 第二回风控 FAIL 补修

- 第二次风控任务 `aa73945e-8aa1-43e6-85b5-59fbef1e36f3` 返回 FAIL：401、429、超时等失败没有避开原渠道；群聊首条员工任务未在入队前执行配置路由，也未持久化 `taskRouting`。
- 补修后渠道失效类型覆盖 401/403/408/409/42x/5xx、超时、限流、网络和认证错误，最新成功仍清除旧失败。
- 群聊首条、原任务结束后的重试和补充新建任务都在入队前调用同一 `employeeTaskRoute()`，持久化实际渠道、模型、思考等级和 `taskRouting`。
- 验证：新增 401/429/超时回退和“群聊 A 缺模型、B 有同模型”场景；任务批次 45/45，群聊批次 45/45，其余回归 53/53。证据见 [验证记录](../../../../work/dispatch-startup-routing-20261117/verification.md)。
- 第三次风控任务 `1a89479b-76dd-4596-920c-466376b02ab0` 返回 FAIL：群聊持久化渠道 B 但实际客户端和运行态回写 A；口令式认证失败未参与失效判断。补修后群聊任务路由无条件覆盖运行时员工配置，已有线程跨渠道时复用迁移机制，转移失败立即终止；认证口令式错误纳入失效范围。最新回归 45/45、46/46、53/53；第四次风控任务 `69d92ee0-3468-4703-bc76-3f2fe00a535c` 已真实启动。

### 2026-11-17 第四回风控 FAIL 补修与第五回 PASS

- 第四次风控任务 `69d92ee0-3468-4703-bc76-3f2fe00a535c` 返回 FAIL：`无效 token`、`未认证` 仍会选择失效组合；员工任务对话自动生成的 followup 只有 runtime 路由，任务顶层缺少 `modelProviderId`、`model`、`reasoningEffort` 和 `taskRouting`。
- 补修后认证错误覆盖无效令牌、未认证、身份验证失败和凭据无效；followup 从来源任务继承完整路由并写入任务顶层与 runtime，任务列表、磁盘记录和实际执行 client 使用同一渠道、模型和线程。
- 第五次风控任务 `07b563d5-fd4d-4797-a792-139d9750c0a3` 返回 PASS。独立探针验证 7 种失败共 14 次换路、14 次成功恢复；followup 实测同一 thread、turn、渠道与模型。指定回归 45/45、46/46、53/53，合计 144/144；受保护滚动文件零 diff，`git diff --check` 通过。
- 状态：候选源码、测试和需求记录已通过独立质量验收，可进入选择性提交和受控重启；运行快照 `1794917696362-f61034db` 尚未加载本次修复。证据见 [验证记录](../../../../work/dispatch-startup-routing-20261117/verification.md)。

### 2026-11-17 后台任务内置路由配置路径与启动等待计时器修复

- 状态：已实现，待评审（PR）；未发布、未重启。
- 根因1：`74e4024` 中 `background-tasks/model-policy.mjs` 查找内置 `model-routing.default.json` 时多上溯一级，指向 `windows/model-routing.default.json`，实际文件在 `windows/server/`。没有本机 `runtime/model-routing.json` 的环境（CI、新安装）中所有后台任务报“任务模型路由配置缺失”，CI Static checks 因此 11 项失败。改为 `../model-routing.default.json`。
- 根因2：同提交新增的 `task-kernel.mjs` `waitForStart` 超时计时器调用了 `unref()`。调用方正在等待该 Promise 时，若无其他句柄，进程提前结束、Promise 不再完成；`task-kernel.test.mjs` 第6项因此挂起，其后14项被取消。计时器有上限且在开始/终态时清除，改为保持引用。
- 验证：`windows/tests` 599 通过、0 失败、2 跳过；`task-kernel.test.mjs` 20 项不再被取消；任务相关6个文件连续6次仅出现既有偶发失败“timed reconciliation…”（`da47256` 上同样偶发，未改动）；TypeScript `--noEmit`、`git diff --check` 通过。

### 2026-11-17 空闲线程残留未完成 turn 时员工不再永久“被占用中”

- 状态：已实现，待评审（PR）；未发布、未重启。用户在本次对话中确认推送此修复。
- 根因：`df69859` 让 `readAuthoritativeStatus` 只要历史中存在 `inProgress` turn 就判为运行中，即使 Codex 明确返回线程 `idle`。重启等情况下残留的未完成 turn 因此被当成运行中：每次发送都对已失效 turn 执行 steer，失败后再次读到同一残留 turn，员工停在“被占用中”，所有消息失败，空闲校正也无法恢复。`native-task-runtime.mjs` 已将“idle + 未完成 turn”视为原执行已不在运行。
- 修改范围：`employee-runtime-service.mjs`。仅当 Codex 未提供线程状态时才以未完成 turn 判断运行中；线程确为运行中时仍从未完成 turn 取 turnId。新增回归测试：idle 线程 + 残留 inProgress turn 时连续两次发送均走 `turn/start` 并进入 working（修改前该测试失败）。
- 验证：`windows/tests` 600 通过、0 失败、2 跳过；`realtime-regression`、`employee-provider` 40/40；`git diff --check` 通过。

### 2026-11-17 中文指令引导词后的全员请求漏派

- 用户原话：“现在 negus 有问题。我需要你们协作，快速修复。先每个人都出来打招呼”；随后要求修复。
- 根因：前后端广播正则只识别句首或分隔符后的广播词，“先每个人都出来打招呼”中的“每个人”前是“先”，因此未命中；群消息保存后 `targetAgentIds` 为空。
- 实现：两个路由的同义判断允许广播词前出现 `先/请/让` 指令引导词；明确 `@` 仍优先，普通消息仍不广播。
- 验证：定向测试覆盖完整复现句、前后端路由、群接口持久化全体目标及既有回归；其余提交、推送、重启和线上验证结果以本轮交付答复为准。

### 2026-11-18 群聊消息更新时闪屏

- 用户原话：“现在群聊，更新消息，群聊一直闪屏”。
- 根因：群任务从 `pending-任务ID` 占位切换为正式消息时更换 React key，DOM 节点被删除重建；每条新消息又触发完整房间列表请求，消息列表全部重渲染。
- 实现：占位与最终消息使用稳定 key 并原地更新；已有消息仅在内容或流式文本变化时重渲染；群消息只本地更新活动时间，`sessions_changed` 才刷新房间列表。
- 验证：修改前占位节点复用断言失败；修改后桌面和手机夹具均无节点替换、无空白帧、顺序稳定、非内容状态更新滚动位移为 0。群消息期间房间请求不增加，元数据事件仍刷新。原群聊、刷新、重连、停止、跨群隔离、TypeScript 和 `git diff --check` 通过；受保护滚动文件未修改。提交、前端发布和线上生效核对结果见本轮交付。
- 复核补充：员工群消息后紧接的 `sessions_changed(source:"group", roomId)` 会绕过已合并的活动时间并重拉房间列表。现仅跳过这一伴随通知；5 组真实配对事件的房间请求保持初始 1 次，无 `source` 的元数据事件仍刷新为 2 次。
- 风控 BLOCK 补修：活动时间改为每个 `roomId` 独立定时合并，两个群在 180ms 内先后更新时都不会丢失；消息 key 为中间回复增加 `item:<itemId>` 命名空间，`itemId="final"` 不再与最终回复冲突。修改前两处测试分别复现活动时间停在旧值和 3 次 React 重复 key 错误；修改后两群时间均正确、请求数保持 1，两条中间回复加最终回复顺序正确、重复 key 为 0、占位节点原位复用。
- 刷新竞态补修：`useGroupChats` 按 `roomId` 保存已观测最新活动时间，延迟刷新响应应用时保留较新时间，其他房间字段照常更新；服务器返回更晚时间仍可覆盖。修改前 01:05 被旧响应回退为 01:00，修改后保持 01:05，乙群刷新字段应用，后续 01:06 正常更新。
