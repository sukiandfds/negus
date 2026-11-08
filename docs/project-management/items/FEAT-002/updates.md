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
