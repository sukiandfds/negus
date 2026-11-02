# FEAT-001 更新记录

### 2026-08-02 11:39 +08:00

- 状态：pending_review
- 本次更新：按 Codex/Happy 的事件快路径与权威快照恢复模式整理弱网发送、停止确认、完成后过程折叠和思考程度显示；跨设备终态与流式交接记录为 I24。
- 用户影响：等待手机长任务真实体验确认。
- 证据：`docs/negus-knowledge/features/feature-records/FEAT-001-single-codex-web.md`

### 2026-08-02 18:00 +08:00

- 状态：pending_review
- 本次更新：新增 FEAT-001 条目专属过程索引，区分标题/内容渲染特例与已升级到 `PROC-019`、`PROC-020`、`PROC-022` 的跨功能问题。
- 用户影响：后续复盘单人 Codex 时，可以先看本条目的影响，再跳转到通用运行规则，不需要重复阅读完整事故记录。
- 证据：`docs/project-management/items/FEAT-001/process.md`、`docs/negus-knowledge/features/DEVELOPMENT_COMMON_MISTAKES.md`

### 2026-08-03 11:32 +08:00

- 状态：paused
- 本次更新：完成实时事件、长会话读取、Codex 原生读取能力和最小回归测试缺口审计。确认 `thread/read` 本身没有分页参数，当前 `limit/before` 只在本项目内存切片；同时确认 primary/fallback 双读、重复详情刷新和 Turn 事件隔离不足是后续修复重点。代码修复暂缓，避免中断现有功能。
- 用户影响：当前页面行为不变；旧性能问题已有可追踪的根因和修复边界，后续可在不混入 UI 或新功能的情况下单独修复。
- 后续方向：旧问题进入待修复状态；新功能先做需求、模块归属、接口和验收标准准备，不立即实现。
- 证据：远程分支 `codex/remote-work-web-reliability` 提交 `deaa5c5999d96c0e3a01cd53669a315ba663823b`；`docs/negus-knowledge/audits/architecture/REALTIME_CONVERSATION_ARCHITECTURE_AUDIT_2026-08-03.md`；`docs/negus-knowledge/audits/architecture/CODEX_NATIVE_READ_AND_REGRESSION_REVIEW_2026-08-03.md`

### 2026-08-03 20:42 +08:00

- 状态：paused
- 本次问题：服务重启后，旧 Thread 仍显示“Codex 自动恢复失败”，页面无法区分历史恢复失败和当前服务状态。
- 根因：`execution-runs.json` 中的非 active `systemError` 在启动时被原样恢复；原有启动归一化只处理 `active: true` 的任务。
- 修复：启动加载时仅将标签为“Codex 自动恢复失败”的历史终态归一化为“项目服务已重启，上一任务已中断”，并清空残留流式文本；不修改对话内容，不伪造任务成功。
- 用户影响：重启后该对话显示上一任务已中断，用户可以重新发送，不会一直卡在自动恢复失败。
- 验证：`node --test windows/tests/execution-tracker.test.mjs windows/tests/conversation-controls.test.mjs windows/tests/jsonl-conversation-media.test.mjs`（24/24）；`pnpm build:ui`；`git diff --check`；本机 `/api/execution-status` 已返回 `interrupted`。
- 证据：`windows/server/execution-tracker.mjs`；`windows/tests/execution-tracker.test.mjs`；Git：`uncommitted`。

### 2026-08-04 09:27 +08:00

- 状态：in_progress / P0 regression
- 本次更新：逐字保存用户连续报告的三条真实手机使用反馈和记录要求，并关联截图；不以助手概括替代用户原话。
- 用户影响：当前产品提交存在消息顺序错误、新发送消息不能立即跨 Web 设备显示、最终光标持续闪烁和同一助手答案重复显示，不能视为可交付。
- 代码范围：本次没有修改代码、没有启动或重启服务。
- 产品基线：`63e8f948b8058d8236e7a4672b5c1f8bdbf8eb70`
- 证据：`docs/project-management/items/FEAT-001/process.md#2026-08-04--feat-001-p05--regression--p0--active`

### 2026-08-04 09:55 +08:00

- 状态：in_progress / code_ready_for_runtime_review
- 本次更新：修复 `FEAT-001-I25` 四项 P0 回归。统一本机乐观消息和跨设备 SSE 消息的提交身份；会话刷新按返回时最新缓存合并并拒绝旧版本；最终答案完成持久化交接后移除流式副本，终态未交接草稿停止闪烁光标。
- 用户影响：重启加载新后端后，发送消息应立即在本机及其他 Web 设备各出现一次；慢会话刷新或加载旧页不再用旧内容覆盖最新消息；助手完成后只保留一份答案且没有持续闪烁光标。
- 验证：Windows Node 测试 `84/84`；`pnpm build:ui`；后端语法检查；`git diff --check`；构建产物确认包含 `user_message_submitted`。
- 运行边界：按用户要求未启动或重启服务；当前运行后端仍是旧代码，本轮不宣称真实手机或跨设备验收通过。
- 证据：`web-ui/src/features/conversations/hooks/useConversationSession.ts`；`web-ui/src/features/conversations/components/ConversationView.tsx`；`windows/server/routes/conversation-routes.mjs`；`windows/tests/conversation-routes.test.mjs`。

### 2026-08-06 | 状态同步

- 状态：pending_review
- 本次更新：根据提交 `ddf43a6c406d010357dce7ebdc133b97de66b5b9` 更新当前结论。加载完成前不展示旧快照；刷新、重开和快照恢复进入统一加载门；加载较早消息使用可见消息锚点恢复阅读位置，并移除会反复改变布局的补偿循环。
- 用户影响：相关代码已经开发并提交，当前不再列为待开发；剩余是用户确认最新构建下的刷新、重开、历史滚动、跨端消息和长任务体验。
- 证据：`web-ui/src/App.tsx`、`web-ui/src/features/conversations/components/ConversationView.tsx`、`web-ui/src/features/conversations/hooks/useConversationSession.ts`、`web-ui/src/features/conversations/hooks/useProjectConversations.ts`。

### 2026-08-10 | 会话切换定位修复

- 状态：pending_review / uncommitted
- 用户问题：会话来回切换时定位不准，切回来后可能跳到不对应的位置。
- 根因：`ConversationView` 只按线程保存绝对 `scrollTop`；虚拟列表中的 Markdown、代码、图片和执行过程高度变化后，同一像素位置不再对应同一条消息，切换瞬间旧滚动监听也可能把位置记到错误线程。
- 实现：保存当前可见虚拟项的消息锚点及相对偏移；恢复时先定位锚点，再按当前测量结果校正，找不到锚点才使用原始像素位置；滚动监听改读当前会话引用。
- 用户影响：切换会话再切回时，应回到之前看到的消息附近，不改变消息内容和执行状态。
- 验证：`pnpm build:ui`、`git diff --check` 通过；未启动或重启服务，未做浏览器运行态验收。
- Git：`uncommitted`，未提交、未推送。

## 2026-10-30 需求澄清维护

- 在 item.md 登记用户缓存同步原话、有效要求、不得恢复的误解和待确认边界；未将助手的跨对话更新建议写成用户决定。
- 本次只维护需求依据，未修改缓存业务。核对历史提交 1b92069、305dd3d、6cad74b、8946b80；未来修改须验收缓存、列表、正文和状态一致性。

### 后续逐项确认

- 收录用户最近10条批次、超时、点开对话、发送排序、助手回复与批次范围的逐字澄清，及“所有和对话有关内容”的范围原话。
- 将此前不同对话独立发布建议标为已替代；保留点开独立发布仅为后续考虑，未虚构超时秒数。
- 本次仅更新需求记录，不修改业务代码、不发布或重启。

### 2026-10-30 按确认规则实施（等待独立验收）

- 用户本次原话：`/goal 你先把我们的缓存的需求开发好吧，你亲自来，好了之后让terra实测验证，发布，推送。`
- 删除 FeishuApp 逐条预读入口，以 usePageSnapshot 作为对话显示的批次提交入口；固定最近10条优先、其余随后；整条对话字段与正文一起发布，保留本地发送气泡。
- 复用现有10秒读取超时（实现选择，不是用户指定秒数）；失败对话保留旧缓存并在现有错误区域显示，控制台结构化记录 threadId、原因、时间。
- 缓存新增对话关联显示信息；历史编辑回退使旧批次失效，避免恢复已裁剪消息。未修改滚动定位/跟随/测量代码。
- 浏览器测试发现 liveTranscript 只按字数判断消息更新，同长度新文字仍显示旧文字；删除该不完整判断，改按完整消息内容复用缓存，新增回归。
- 验证：102项相关自动测试中101通过、1项跳过；独立隐藏浏览器通过首批/后批、切换保留缓存、状态等待、失败保留/日志，以及现有发送/编辑/压缩提示回归。证据 `/tmp/negus-cache-delivery-tests.log`、`/tmp/negus-batch-test.log`、`/tmp/negus-batch-failure-test.log`、`/tmp/negus-cache-workspace-test.log`。测试脚本入库，临时日志不是永久证据。
- VIP Terra high 验收线程 `01a188c7-01e6-7da0-b21b-509373220cbc`；只读审查与隐藏浏览器实测候选前端，禁止自行发布；报告 `/tmp/negus-terra-cache-review.md`。当前业务修改未发布，待核对验收结果。

### 2026-10-30 独立验收发现与修复

- VIP Terra high 实际会话上下文再次核对：`ccswitch_vip-1790618576587::gpt-6.1-terra`，线程 `01a188c7-01e6-7da0-b21b-509373220cbc`。
- Terra 在隐藏浏览器发现切换期间借用了上一条的模型；改为只读该线程已展示缓存，缺失元数据不借其他线程。随后复验缓存正文不提前穿透，整批完成后该线程模型/强度/上下文一起出现。
- 空员工/项目入口没有线程可读：复用目录合并入口展示空入口；已有主线程的关联信息仍等批次，归档/删除旧条目不保留。
- Terra 发现刷新按钮仍调用原始刷新、未清理失败批次记录；改为共用快照刷新入口，旧批次失效后重读。独立复验失败项请求从1次变2次、错误清除且新标题出现；入库浏览器回归增加该断言。
- 独立验收已有证据：缓存模型/强度/上下文/目标与正文一起更新；超时保留旧内容、迟到不直接覆盖；连续含图片发送到历史接管不丢失不重复；空列表新建发送；归档恢复。真实后端页面核对仍在进行，尚未发布。
- 不新增独立需求清单。后续维护不得用原始读取缓存替代已提交显示缓存，也不得让刷新按钮绕过共同入口。
- 真实94条会话验收暴露后批读取并发过高；批次读取改为最多4条对话同时进行，仍整批发布，不将限流误改成逐条显示。新增94条用例验证并发上限及 `[10,84]` 两次发布；4项批次测试全通过，失败刷新浏览器回归再次通过。真实后端复验仍是发布门槛。

### 2026-10-30 发布验收完成

- 删除触发空转的时间戳比较：读取检查时间变动不算新消息，真实列表活动时间、正文及状态内容仍触发更新。真实后端94条会话验证最终出现无事件、无请求、无在途的窗口；不再持续空转。
- 已确认归档结果与目录统一使用 catalog 的归档记录；旧目录不能把归档项加回，恢复后保留其余对话。入库浏览器测试已覆盖该场景以及易变检查时间不触发重读。
- Terra 最终结论：本次单聊缓存可进入受控发布；记录见 [独立验收](verification-2026-10-30.md)。群聊独立链路不在本次实现/验收范围。旧会话因已归档、占用、未加载而返回的实际错误保留提示与缓存，不冒充成功。
- 前端受控发布 workerPid 42616，成功时间 `2026-10-29T18:19:43.234Z`（北京时间10月30日02:19），版本 `feishu-mvtvbe70`。未重启后端。
- 内网及公网 `/api/version` 均核对为同一新版本；生产静态页面隐藏浏览器打开真实对话，显示5条消息、无页面脚本异常。证据 `/tmp/negus-cache-live-smoke.log`、`/tmp/negus-cache-live.png`。
- 本轮最终相关检查：TypeScript、4项批次测试、浏览器批次/错误重试/时间戳空转/归档恢复回归通过；此前102项检查中101通过、1跳过。未修改受保护滚动逻辑。

## 2026-10-30 公网收发优先验收

- 用户本轮要求：“看看最新改动 确保Negus正常运行 功能先不管 先保证能公网发消息”。基线 `d07b40a`，仅修影响收发显示的等待，不调整已确认的批次展示或滚动规则。
- 修复：同一批共享10秒截止时间，避免大量慢会话按并发槽位累加超时；单条对话同步不等待无关的全局目录请求。
- 验证：批次定向测试6项通过；受控前端构建发布成功，公网版本 `feishu-mvua56u9`，后端PID31514未重启。真实公网浏览器在测试会话发送并直接看到 `NEGUS_PUBLIC_RECOVERY_OK`，未刷新；日志 `/tmp/negus-public-final.log`，截图 `/tmp/negus-public-1030.png`。从打开页面到回复可见约66秒，收发已通但首次加载仍慢，不宣称性能问题全部解决。测试会话已归档。
- 其他旧会话的占用、归档和缺失错误保留，按本轮范围不扩展修复。

## 2026-10-31 回退后第一步候选（未发布）

- 按用户授权恢复实际前端备份 `feishu-mvtrmdhe`，内网及公网 `/api/version` 均200且版本一致；保留原代码、现行发布备份和聊天数据，未重启后端。
- 第一条确认后在 develop `3bfed65` 上修改：缓存保留同步签名，未变化的已缓存对话不因页面刷新全量重读；按列表前10条确定优先范围，合并后再显示；选中对话复用已有读取，删除额外预读/等待和独立种子缓存。
- 读取配置不再 resume；跨配置只读方法不恢复写入者；员工直接读取职责配置；查看上下文不触发自动压缩，正常运行事件仍负责自动压缩。模型设置更新直接返回已确认设置。没有改滚动、定位或虚拟测量。
- 未开始读取的条目保留到后续读取，不冒充超时；列表仅显示错误数量，具体原因在对话错误及带 threadId 的日志中保留。
- 验证：61项相关测试通过；隐藏浏览器覆盖缓存立即显示、前10条共同展示、切换不穿透、失败缓存保留与刷新恢复、页面刷新不重读未变化缓存，以及归档恢复；TypeScript通过。证据 `/tmp/negus-cache-step1-tests.log`、`/tmp/negus-cache-step1-browser.log`、`/tmp/negus-cache-step1-failure.log`。浏览器为候选页面受控响应验证，不是生产全功能验收。
- 本步候选未发布、未提交推送。线上保持用户确认的回退版本，不将昨晚混合提交重新整体上线；后续逐项核对需求后再安排发布。

### 2026-10-31 第一阶段已发布

- 用户明确授权“上线吧”。隔离启动发现员工配置源码适配仍匹配旧 resume 语句，已删除旧适配并沿用已保存/待选配置；5项员工供应商适配测试通过，第二次发布预检通过。
- 受控重启任务 `1793440824932-83889` 已完成，首次启动成功；后端发布 `1793440806860-510e07db`，PID 83896，完成时间北京时间18:00:47。
- 内网、公网 `/api/version` 均返回200及 `feishu-mvw8coq4`，前后端最新候选已生效。保留回退版本，未推送GitHub。

### 2026-10-31 普通新建/分支统一登记（待重启，按用户要求暂缓）

- 基线 develop `3bfed65` 加现有已发布工作区改动；保留所有已有修改。本步只修改 provider-conversation-store.mjs 创建登记部分，复用 routes 文件，无新存储。
- 提取共用 registerSession，删除新建/分支各自写入保存逻辑；分支补齐 createdBy、summary、forkedFromId，避免父对话待选配置误作分支实际模型。
- 定向供应商/对话控制测试通过，新增覆盖落盘、服务实例重建、正确供应商读取及父对话待切换配置隔离。日志 `/tmp/negus-registration-step1.log`。
- 按用户要求未重启、未发布、未推送；当前网页暂不体现本步后端变更。未修改员工分支、后台任务或滚动代码。

### 2026-10-31 员工分支登记（待重启）

- 核对员工职责、主对话绑定、供应商及 pendingModelSettings：保留员工主对话与普通分支区别，只将 fork 返回值送入上一小步 registerSession。主服务注入现有登记函数，未新增保存位置或读取分支。
- 业务修改3个文件；登记依赖缺失在原生 fork 前拒绝，避免产生未登记分支。共用入口等待路由文件就绪。
- 员工、供应商、运行时适配测试通过，新增验证分支登记实际模型/供应商、普通对话类型、父对话关联及员工主线程/身份不变。证据 `/tmp/negus-employee-fork-registration.log`。
- 沿用用户要求，未重启、未发布、未推送。前一步及此前其他工作区改动均保留。

### 2026-10-31 员工后台任务统一登记（待重启）

- 在已有 employee-task-extension 复用 registerSession；新任务明确保存 assistant 来源、实际配置与摘要；保存任务检查点时同时记录思考强度，恢复使用保存的配置。
- 新建与恢复共用登记及绑定步骤；已有供应商登记不覆盖。恢复时修复缺失关联，沿用原线程，不重新创建/发送。业务仅修改 employee-task-extension.mjs、register.mjs，无新存储。
- 定向任务与供应商测试通过；新回归覆盖缺失登记/绑定恢复、供应商与模型沿用、无 thread/start 或 turn/start。证据 `/tmp/negus-task-registration.log`。
- 按用户要求暂不重启、不发布、不推送；保留其他已有工作区改动。

### 2026-10-31 旧终态任务缺失关联修复（待重启）

- 业务代码 employee-task-extension.mjs 本步新增6行、删除0行（含1行注释）；启动补全终态任务原绑定，已有相同绑定跳过，排除 external/followup。
- 回归复用已有恢复测试增加 completed 场景，核对原 conversationId/threadId，且不调用任何原生请求；任务扩展测试8项全部通过，证据 `/tmp/negus-completed-task-binding-test.log`。
- 本步目标为消除采样5条任务的缺失关联404，后续重启后核对正文及其他资源，再计入失败总数下降结果。
- 按用户要求不重启、不发布、不推送；当前线上行为未切换。下一项只分析读取配置时触发迁移前置检查的错误。

### 2026-10-31 配置只读检查修正（待重启）

- 本步 app-server-conversation-store.mjs 增加4行、删除2行，净增2行；仅非只读调用验证迁移所需文件。保留历史成功配置的提取，不删 rememberPreviousSettings。
- conversation-controls.test.mjs 新增20行（含空行）回归：无 rollout 的旧线程可读取模型、不接管；真正切换仍报409。两组相关测试38项通过，证据 `/tmp/negus-read-settings-check.log`。
- 运行态尚未切换；按用户要求不重启、不发布、不推送。前两项采样目标合计减少7条关联/配置错误，实际总数待发布后验收。
- 下一项只分析3条仅有目录摘要的“新对话”：无 resumeInfo 路径、正文404，列表通过 routes.summary 补入。建议使用已有归档入口整理这3条残留空记录，不删除新会话列表补全逻辑，不新增业务代码，未执行归档。

### 2026-10-31 三条残留记录已归档（立即生效）

- 三次 POST /api/session/archive 均202，随后查询活动列表，三个ID均已移除。证据 `/tmp/negus-archive-empty-records.json`。业务代码新增0行、删除0行；未重启、未发布、未推送。
- 后续分析：剩余4条原采样均为 goal/get 的 thread not found；本次3条普通对话正文200（161/154/5条消息），goal503。先保持原错误，不以空目标冒充读取成功，也不通过查看接管对话。

### 2026-11-01 同步转圈提示（未发布）

- 本步3个业务文件：usePageSnapshot.ts +5/-1、ConversationList.tsx +2/-1、ChatWorkspace.tsx +3/-1，合计+10/-3，净增7行；文档另计。复用现有 syncing 字段及动画，列表和对话共用同一状态；错误保留时继续转圈。
- TypeScript --noEmit 检查通过。未修改缓存内容/批次读取、发送、排序、滚动；按用户要求不重启、不发布、不推送，运行页面尚未切换。
- 下一项只分析：输入框的 inputDisabled 将 recovering/unknown 与编辑禁用绑定；解除该显示层限制即可允许同步时输入，保留上传、归档及原发送处理。待用户确认再修改。

### 2026-11-01 同步期间输入解锁（未发布）

- 业务1个文件 ConversationComposer.tsx：增加1行、删除2行，净减1行；去掉恢复中/状态未知对输入及提交入口的禁用，不改发送回调。
- TypeScript --noEmit 通过；核对文本框及发送按钮共用 inputDisabled，移除条件覆盖两处。未发布、未重启、未推送，线上尚未生效。
- 下一小步建议：转圈在最近10个对话批次完成后结束，避免等待列表更后面的全部对话；失败继续转圈。复用现有 priority 和批次发布回调，预计仅 usePageSnapshot.ts 净增约2～4行，待确认后修改。

### 2026-11-01 转圈完成时机（未发布）

- 仅 usePageSnapshot.ts 本步增加5行、删除2行，净增3行；优先条目成功集合随现有批次发布推进，后续非优先成功批次不再延长提示；错误保留时继续转圈。
- TypeScript --noEmit 通过；核对优先集合为空、首批成功、首批失败及首批未启动条目转入后批的分支。尚未发布，未重启、未推送。
- 下一步建议分析并修正列表摘要与正文批次取值不一致：列表使用批次开始的摘要，正文使用读取完成的详情；复用已读取的 ready.session 同步对应摘要，预计1个业务文件、净增约3～6行；目录摘要优先级须一并核对，当前未改。

### 2026-11-01 列表与正文同批摘要及发布

- 本步业务2文件：usePageSnapshot.ts +9/-1，conversationDirectory.ts +1/-1；合计增加10行、删除2行，净增8行。比初估多1文件，原因是项目/员工目录仍可覆盖已提交摘要，需同步移除该覆盖。未增加数据请求或存储。
- 类型检查及两组无头浏览器测试通过；验证缓存、首10条共同发布、转圈时机、失败持续转圈及刷新恢复、摘要来自正文、后批隔离、归档恢复。证据 `/tmp/negus-summary-batch-browser.log`、`/tmp/negus-summary-batch-failure.log`。浏览器测试本步增加4行。
- 重启前公网HTTP200。prepare 已验证候选1793471732910-ea044acd及回退1793456768668-a02204fe，日志 `/tmp/negus-sync-release-prepare.log`。
- 本次前端发布成功：feishu-mvwqryu5，2026-10-31T18:35:56.966Z，后端未随前端发布重启；随后按授权安排受控后端重启，最终结果需按本次jobId核对。未提交或推送。

### 2026-11-01 修正旧错误导致持续转圈

- 原因：display.syncing 将全量 shown.errors.size 并入条件，后续旧对话任一失败会无限延长转圈。只将当前最近10个对话的错误并入，其他错误照常展示。
- 本步业务仅 usePageSnapshot.ts：增加3行、删除1行，净增2行。新增后批失败浏览器场景，验证首10个成功停止转圈且后批错误仍显示；证据 `/tmp/negus-first-ten-spinner-check.log`。首批失败继续转圈/刷新恢复证据 `/tmp/negus-first-ten-failure-spinner-check.log`。
- 按授权发布前端，不重启后端；生效版本待本次发布结果核对后补记。

- 本次前端发布已成功：feishu-mvwr2b80，2026-10-31T18:43:59.493Z；公网 /api/version HTTP200 且版本一致；backendRestarted=false。两组浏览器验证通过。

### 2026-11-01 旧对话配置复用只读历史（发布准备）

- 本步2个业务文件：app-server-conversation-store.mjs +12/-2，jsonl-conversation-store.mjs +2/-1，合计+14/-3，净增11行；共用 readSettingsThread，复用历史索引，无新存储。删除两处读取配置对原生已加载线程的强制依赖（替换原调用）。
- 新增回归通过真实 JSONL 索引验证旧线程配置、上次成功设置、缺失记录保持错误、真正切换仍走原逻辑、无 resume/turn/start；3组44项测试通过，证据 `/tmp/negus-unloaded-settings-tests.log`。
- 异常线程01a18a5f-6fca-7242-8193-198271053636真实保存文件验证成功读取gpt-6-astra/low，原生调用仅thread/read，证据 `/tmp/negus-unloaded-settings-real.json`。
- 重启前公网200、前后端健康；本次仅后台读取修复，需受控重启加载源码。目标接口仍待后续处理，当前对话转圈需该项也通过后结束。未提交或推送。

- 2026-11-01 运行复验：job1793473312885-96130 已一次启动成功，运行版本1793473276394-9bffe7ee。异常线程配置接口HTTP200，gpt-6-astra/low已生效；goal接口仍503 thread not loaded，本步配置修复未改goal读取。

### 2026-11-01 未加载目标只读修复（发布准备）

- 3个业务文件，目标文件新增共用只读方法，普通/员工复用；复用现有goalAttachmentRoot定位各供应商Codex目录，没有新增存储或配置。移除普通Goal读取对已加载线程的依赖，改用已有只读项目校验。
- 45项普通/员工测试、2项目标及数据库测试通过，证据 `/tmp/negus-goal-read-tests.log`、`/tmp/negus-goal-db-tests.log`；覆盖有目标、无目标、首次无数据库、额度状态及时间转换、其他错误不掩盖，不resume/turn/start。
- 真实异常线程只读goals_1.sqlite返回goal:null，原生调用仅goal/get。前端无需修改；线上后端需重启加载。候选及回退快照预检日志 `/tmp/negus-goal-read-prepare.log`，本次最终结果按jobId核对。未提交推送。

- 本步业务实际增加24行、删除5行，净增19行，3个文件；共用方法新增19行，其余为调用替换。重启前公网200，前后端健康；prepare候选与回退验证通过后安排受控重启。

### 2026-11-01 切换选择不重复读取原对话

- usePageSnapshot.ts：按线程保留最后源视图，替换“当前选中则有视图、切走即为空”的比较。业务代码新增4行、删除1行，净增3行。
- conversation-batch-browser.test.mjs：新增8行，验证切走t0后不重复请求其上下文；原有首10批次、后续批次、缓存刷新、归档恢复同时通过。
- 验证：TypeScript无输出通过；无头浏览器通过，证据 /tmp/negus-cache-selection-check.log。未改超时、服务器版本判断、发送或滚动。
- 生效：前端已发布 feishu-mvxduqc4，公网 /api/version 返回200且版本一致；backendRestarted=false，后端未重启。

### 2026-11-01 同步逻辑删减

- 本轮相对修改前：usePageSnapshot.ts新增15行、删除19行，净删4行、674字符；未新增测试代码。与前次净增3行合计，业务代码净删1行。
- 删除重复排序，真实对话筛选共用一次；删除不可达分支和多余转接；列表运行状态、压缩阶段、目标直接使用本批成功结果，去掉被其覆盖的重复来源。
- 验证：TypeScript通过；无头浏览器常规场景通过，证据 /tmp/negus-cache-prune-check.log；失败恢复场景通过，证据 /tmp/negus-cache-prune-failure-check.log；前端已发布 feishu-mvxedqkj，backendRestarted=false。

### 2026-11-01 读取前变化标记

- 业务6文件：新增27行、删除8行，净增19行。共用conversationSourceRevision，使用文件设备/身份、大小、修改及变更时间生成摘要标记；不修改消息活动时间。
- 原生列表按标记复用尾部摘要，JSONL列表复用已有stat生成相同标记；列表相等判断纳入标记，配置/工具记录等写入即使不改变最后消息时间也会触发同步。
- usePageSnapshot沿用已有批次，完整服务器摘要及标记与成功缓存一致时复用正文；其他状态/配置请求保留。缓存标记只写详情，不混入列表摘要；缺少标记时沿用原读取。没有新增接口、轮询、计时器或独立加载流程。
- 验证代码：新增58行、删除2行，净增56行，覆盖未变化不打开历史文件、无新消息时间的Desktop写入、原生/JSONL标记一致、仅状态变化正文0请求、标记变化触发正文更新，以及既有缓存/批次/归档场景。
- 服务端41项通过：/tmp/negus-source-revision-tests.log；常规浏览器通过：/tmp/negus-source-revision-browser.log。失败恢复复验通过：/tmp/negus-source-revision-failure-browser.log；TypeScript检查通过。
- 生效状态：仅修改源码，不重启、不发布；线上仍为上次前端feishu-mvxedqkj及原后端。新标记需后端加载新源码后生效。

### 2026-11-01 旧气泡修复与合并发布

- 本次业务2文件：usePageSnapshot.ts +7/-6，conversationMerge.ts +6/-3，合计新增13、删除9、净增4行。共享sameSubmission，缺失编号从本地既有ID恢复；移除快照本地气泡的无条件累积，缓存清理复用mergePendingOptimisticMessages。
- 新增测试文件page-snapshot-pending.test.mjs，覆盖替换、正式接收跨批次保留、撤回、缺字段缓存及重复文字两次发送。25项针对性测试通过，证据 /tmp/negus-ghost-repair-tests.log；TypeScript通过。
- 本次同时发布上一轮变化标记业务6文件净增19行；两步业务合计净增23行。
- 重启前公网/后端/前端健康检查通过，公网200。快照准备日志 /tmp/negus-ghost-release-prepare.log；候选1793513491258-7fdc5738及回退1793506597394-00d3740c已隔离验证。浏览器批次/归档恢复验证通过，证据 /tmp/negus-ghost-batch-browser.log；前端已发布feishu-mvxfnj4u（2026-11-01T06:12:20.306Z），后端受控重启接续安排，结果以本次jobId为准。

### 2026-11-01 删除本地消息时间排序例外

- conversationMerge.ts业务新增0行、删除1行；2条既有测试断言调整为时间顺序，验证消息时间更早时排在之前，发送确认后仍只留正式记录，相同文字不同编号仍保留。
- 相关测试通过：/tmp/negus-message-time-order.log。前端已发布feishu-mvxkfoju，公网版本核对一致、HTTP200；不重启后端。

### 2026-11-01 解除剩余历史阻挡实时更新

- usePageSnapshot.ts新增14行、删除0行；首批提交后当前源变化时中止旧代次并启动下一轮，旧代次finally不得释放新代次运行锁，保留并发限制及批次一致更新。直接删除running保护会开启重叠轮次，故保留保护并缩短占用范围。
- 浏览器新增专用验收分支：保持t11历史读取阻塞，t0发来新回复后正文先显示，t11仍保留旧标题。证据 /tmp/negus-unblock-live.log；TypeScript通过。原缓存、首10个共同提交、剩余批次、归档恢复回归通过，证据 /tmp/negus-unblock-regression.log。前端已发布feishu-mvxkp46y，backendRestarted=false；公网/api/version核对一致、HTTP200。

### 2026-11-01 单对话合并读取（待部署）

| 文件 | 本次新增 | 本次删除 | 修改效果 |
| --- | ---: | ---: | --- |
| windows/server/routes/conversation-routes.mjs | 13 | 2 | 现有session入口按需一次返回六项；复用普通/员工读取、鉴权和分页；允许跳过未变化正文 |
| ui-feishu/shared/features/conversations/data/conversationApi.ts | 11 | 1 | 共用超时与取消读取封装，增加带类型的合并读取调用 |
| ui-feishu/src/usePageSnapshot.ts | 8 | 17 | 删除六路分散调用，沿用批次提交及既有正文合并方法，保留较新正文版本 |
| 业务合计 | 32 | 20 | 净增12行；不改选中对话实时源、发送、重试和滚动 |

- 后端15项测试通过，新增2项覆盖普通/员工完整返回、未变正文不读取、单项失败不得部分成功；证据 /tmp/negus-one-request-routes.log。
- TypeScript通过。既有无头浏览器测试适配合并返回并通过：首10个一起展示、正文与状态不提前穿透、状态变化一次请求且不读正文、正文变化更新、缓存刷新及归档恢复；证据 /tmp/negus-one-request-browser.log。后端测试+41/-0，浏览器测试+10/-4；测试合计新增51、删除4行。
- 源码已修改并验证，未重启、未发布，线上仍保持原运行版本。下一项仅分析多份缓存的职责与可删重复部分，未实施。

### 2026-11-01 单对话合并读取发布安排

- 用户授权：“先发布我看看效果。要重启的话小心重启。不要的话就不重启。”本次后端接口需重启加载。
- 发布前watchdog确认后端、前端、公网健康，HTTP200；prepare候选1793524235937-01e85aa8及回退1793513491258-7fdc5738隔离预检通过，证据 /tmp/negus-one-request-prepare.log。
- 前端发布结果published，版本feishu-mvxm14wz，2026-11-01T09:10:52.856Z，backendRestarted=false；随后交给supervisor受控重启，最终结果按本次jobId查询，scheduled不计作后端已生效。

### 2026-11-01 正文缓存版本校验

- 业务7文件，新增43行、删除13行，净增30行：前端传递缓存版本；服务端只读获取对话所属供应商历史文件版本，读取前后核对，版本变化或取不到时读取正文；读取中版本变化报错保留旧内容。含生图补充记录时读取完整正文。员工历史使用现有绑定只读，不恢复或创建线程。
- 定向服务端测试41项，覆盖普通/员工版本一致、变化、缺失、旧请求、读取中变化、补充记录及员工不启动线程；证据 /tmp/negus-revision-tests.log。浏览器批次和正文复用回归 /tmp/negus-revision-browser.log，TypeScript通过。发布结果与后端本次jobId以实际状态为准。
- 发布前公网及前后端健康检查通过，HTTP200；候选1793526327684-be6032c0及回退1793524235937-01e85aa8隔离预检通过，日志 /tmp/negus-revision-prepare.log。前端版本feishu-mvxn9x3l于2026-11-01T09:45:42.174Z发布；后端受控重启另行安排，以本次jobId的最终结果核对生效。

### 2026-11-01 单聊状态统一（进行中）

- 页面展示层正文原在 `shown.cachedSessions` 和 `shown.threads` 各保存一份，现仅保留前者；展示信息在 `threads` 中继续保存。`usePageSnapshot.ts` 本阶段新增7行、删除5行，净增2行。
- TypeScript、批次及待发送消息8项测试通过；无头浏览器批次、切换、缓存恢复和归档恢复回归通过，证据 /tmp/negus-committed-dedup-browser.log。
- 统一仓库、点击读取、发送和实时事件接入、临时ID迁移及完整验收仍在进行中；本阶段未发布，不视为该需求已完成。
- 继续阶段：conversationSnapshot.ts 新增21行、删除4行，写入及读取旧缓存时移除乐观气泡与流式文字；存在移除内容时标记需重新读取，保留正式消息。缓存测试新增35行，7项测试及TypeScript通过；整页浏览器批次、切换与归档恢复通过，证据 /tmp/negus-cache-overlay-browser.log。本阶段累计业务新增28行、删除9行，测试新增35行；仍未发布。
- 后续核查：持久化列表摘要移除意外带入的消息数组，缓存测试增加断言；本阶段累计业务新增29行、删除9行，测试新增36行。归档错误独立清理曾验证后移除，留待统一状态入口处理，避免添加重复逻辑；最终浏览器回归 /tmp/negus-unified-cache-stage-browser.log。统一仓库和完整验收仍未完成，未发布。
- 新增可单独启用的浏览器验收 `NEGUS_TEST_BATCH_CLICK=1`：批次提交后点击已加载对话，要求无六项详情请求。当前执行失败，实际出现六项请求，证据 /tmp/negus-committed-click-test.log；保留为后续迁移的验收标准，未发布。
- 失败及被占用的临时气泡保留到缓存，包含错误和附件；其他临时气泡仍不持久化，恢复后重新核对正式消息。10项缓存与合并测试、TypeScript通过；浏览器实际发送失败并刷新后仍显示消息和错误，证据 /tmp/negus-failed-refresh-browser.log。图片附件字段的刷新恢复由缓存测试覆盖。累计相对本阶段起点业务新增30行、删除9行，测试新增71行。点击无重复读取的验收仍失败，统一入口未完成，本阶段未发布。

### 2026-11-01 点击与批次共用同一仓库（完成源码验收，未发布）

- 移除正文、上下文、运行状态、Goal、队列及问题的独立缓存/选择读取；现有聚合读取直接提交统一仓库，页面与目录共用事件入口。保留批次展示、加载中发送、临时ID迁移、失败附件恢复、分页及归档；截短旧缓存首次强制补读，避免相同版本跳过正文后缺失历史。
- 相对本轮开工工作区：业务18文件 +546/-1108，净删562行；测试5文件 +423/-93，净增330行。需求表及逐文件证据见 item.md 本轮实施节、`/tmp/negus-unified-delta.json`，不计此前已有修改。
- 本地验收：42项状态/加载/批次/缓存及14项Goal/转发/实时测试通过，TypeScript和临时目录生产构建通过。浏览器验收包括六项详情零请求、失败/占用图片刷新保留、切换确认、连续同文、临时ID与URL、队列/停止/模型/Goal/问题、加载中发送、分页、归档、重连、重复事件及旧缓存；证据 `/tmp/negus-unified-browser.log`、`/tmp/negus-unified-click.log`。批次/失败/实时抢先场景日志见 item.md。
- 原有40个修改/未跟踪路径全部保留，范围外差异与开工一致，受保护滚动文件不变，后端本轮无新增修改；`git diff --check`通过。按用户最新“先不发布”，未执行 rebuild、重启、提交或推送；仅源码及本地验证完成，线上版本未变。

### 2026-11-01 流式同步与旧浏览器夹具收尾（仅开发）

- 共用仓库对纯streamingText、streamingItemId和commentary变化只通知本地展示，不标记聚合同步；正式状态变化仍同步。页面只覆盖同一活动轮次的流式字段，批次提交保留当前文字；删除commentary触发列表刷新的重复入口。
- workspace-browser改为session聚合响应，状态与上下文按对话ID共用，删除六接口旧夹具；配额错误事件及聚合响应使用同一数据。
- 相对本步开工：业务3文件 +21/-9，净增12行；测试夹具1文件 +11/-9，净增2行；此前统一状态开发加本步业务累计净删550行。需求表已追加本步有效决定，差异统计 `/tmp/negus-stream-finish-delta.json`。
- 用户提供的前阶段验收为116/116及浏览器/TypeScript通过。本步遵守最新分工，不运行测试、不构建、不发布、不重启；未提交、未推送，线上保持原版本。

### 2026-11-01 排队接受后等待时钟清理（待发布验收）

- 接受记录从队列hook移入共用仓库，接受事件立即清除已提交队列；工作台、操作读取与批次提交共用发送编号过滤，防止延迟旧队列恢复等待时钟，保留已接受消息气泡。
- 业务2文件 +14/-8，净增6行；本步无测试代码改动。统一状态及收尾累计业务净删544行；差异 `/tmp/negus-queue-clock-delta.json`。
- 按本步明确要求，仅运行workspace-browser：7/7通过，等待时钟清除项通过，failures及页面errors为空；证据 `/tmp/negus-queue-clock-workspace.log`。未构建、未发布、未重启、未提交或推送，线上仍为原版本，候选代码可进入发布验收。

### 2026-11-01 统一状态发布验收

- 用户要求测试并发布。验收中发现不同对话使用相同发送编号时，队列接受记录会互相影响；`conversationStore.ts` 按对话和发送编号共同识别，业务修改4行替换4行。原有跨对话队列接收测试复验通过。
- 定向77项测试和TypeScript通过，日志 `/tmp/negus-publish-check-tests.log`；点击已加载对话无六项请求通过 `/tmp/negus-publish-check-click.log`。修复后无头浏览器验证通过：发送确认时切换、连续同文、失败和占用的图片刷新、临时ID迁移、队列及停止、模型和Goal、未加载时发送、历史及重连（`/tmp/negus-publish-final-store.log`）；工作台7项通过（`/tmp/negus-publish-final-workspace.log`）。
- 对比当前运行快照1793526327684-be6032c0，已修改的后端文件与运行版本一致；本次只发布前端，不重启后端。最终以前端本次发布结果为准。
- 前端发布成功：`feishu-mvxwpug3`，2026-11-01T14:10:01.847Z；公网 `/api/version` 返回HTTP200及相同版本，watchdog确认前后端与公网健康。后端未重启；未提交、未推送。

### 2026-11-01 过期读取与失败重试

- 业务2文件新增22行、删除12行，净增10行：沿用批次队列，在其他历史读取后最多重试失败项两次；超时或整轮取消时向实际读取传递取消信号；失败仍保留缓存和错误，成功后清除；旧代次和被中止的读取不得写入候选内容。
- 测试2文件新增30行、删除8行；67项回归及TypeScript通过。浏览器验证失败两次自动恢复并清除错误、旧历史阻塞时当前对话新回复、点击已加载对话无重复请求、切换及缓存回归；证据 `/tmp/negus-batch-retry-auto.log`、`/tmp/negus-batch-retry-live.log`、`/tmp/negus-batch-retry-click.log`、`/tmp/negus-batch-retry-browser.log` 和 `/tmp/negus-batch-retry-regression.log`。
- 本次仅前端变化，发布结果以本次前端任务为准；不重启后端。
- 前端版本 `feishu-mvxx53a5` 于2026-11-01T14:21:53.280Z发布；公网 `/api/version` 返回HTTP200及相同版本，watchdog确认前后端和公网健康。后端未重启，未提交或推送。
- 发布复核发现：最近10条内某对话重试两次仍失败后，后台已停止自动重试，但刷新按钮持续转圈。`usePageSnapshot.ts` 改为只在仍有待完成或待重试项目时显示同步中，最终失败仍保留缓存和错误；业务修改 +2/-2。浏览器验收增加“重试耗尽后停止转圈”断言，测试 +4。
- 修正后TypeScript、批次单测8/8通过；正常批次、自动重试恢复、重试耗尽、旧历史阻塞时当前回复刷新及点击已加载对话无重复请求均通过，页面异常为空。证据 `/tmp/negus-retry-spinner-final-*.log`。本次发布结果以修正后的前端任务为准。
- 修正后前端发布成功：`feishu-mvxxfhdb`，2026-11-01T14:29:57.464Z；本地 `/api/version` 返回相同版本，watchdog确认后端、前端和公网隧道健康，实际页面加载正常且无页面异常。后端未重启，未提交或推送。
# 2026-11-01 等候消息直接发送的显示交接

点击“直接发送”立即将等待气泡交给普通对话列表；服务器返回接收后按发送编号交接，发送失败恢复等待气泡并显示错误。复用普通消息合并和展示、现有队列与发送确认，不改滚动。

本次业务修改3文件，新增22行、删除7行；浏览器回归新增30行、删除1行。TypeScript检查通过，18项消息交接及发送状态测试通过，工作台浏览器回归7项通过，覆盖延迟确认、编号交接、失败恢复与重试。前端已发布 `feishu-mvxyn584`，公网版本接口HTTP 200且版本一致；watchdog检查前后端与公网健康，后端未重启。

### 2026-11-01 旧对话空正文第一阶段修复

- Git 核对：`findSession` 的原生读取和仅在异常时执行 JSONL fallback 的结构始于 `651e86c`；JSONL 单文件读取自 `3d8ac7e` 起未处理 `history_base`；跨 Provider 首次命中 fallback 始于 `b657929`。近期 `sourceRevision` 和提交保护改动没有新增“原生空正文直接返回”的分支。
- 业务修改 `app-server-conversation-store.mjs` 6 行：原生读取成功且消息为空、且非 cursor 分页时，仅调用当前 store 的 `historyFallback`；回退确有条目时返回历史，否则保留原空会话。异常 fallback 和 `session:null` 复用语义不变，不进行跨 Provider 搜索。
- 测试新增原生空正文同店回退、同店确认为空、原生异常继续回退三个场景；`conversation-controls.test.mjs` 34/34 通过。`git diff --check`通过。
- 后端受控重启 job `1793547402189-25694`，release `1793547397132-263dc0f3`，PID `25760`，结果 `started`；watchdog确认后端、前端、公网隧道健康。
- 公网修复前两个示例分别为0条；修复后 `01a17e34...` 和 `01a18536...` 首屏均返回60条。iPad视口实际打开两者均显示60篇文章，页面异常为空；9秒初测未完成，15秒后显示。
- 公网全量只读抽样：95个普通对话中82个正文非空、5个为空、8个请求错误。5个空正文正好是3个配置占位和2个未处理父历史的空fork；8个错误为原有4个404及4个超时，不与本步混归因。
- 待后续：fork父历史组合、前端空结果保护和跨Provider所有者统一仍保留。未提交、未推送；前端未重建。

### 2026-11-02 运行中追加消息的时间

- 业务8文件 +39/-20，净增19行；测试5文件 +75/-3。事件时间从当前供应商 JSONL 的 `item_completed` 按正式编号或发送编号及轮次匹配，未匹配不猜测；前端复用合并逻辑保留本地时间，服务器返回时间优先，旧缓存经服务器格式版本标记成功补读后复用。
- 97项定向测试、TypeScript与工作台浏览器7项通过；覆盖重复消息、重复事件、临时气泡交接、缓存升级、发送失败和重试。真实公网会话抽样120条，候选事件读取对应两条原本无时间的消息，分别得到 `2026-11-01T15:43:23.838Z` 和 `2026-11-01T15:43:33.799Z`；其他消息的文字匹配替代风险抽样为0。浏览器为本地候选夹具，最终线上效果以发布后复核为准。
- 已预检候选 `1793552059493-93f75bbe` 和回退 `1793547397132-263dc0f3`；前端已发布 `feishu-mvy2lutw`，公网版本接口 HTTP 200 且版本一致。后端重启任务需按本次 jobId 复核。

### 2026-11-02 B1A 纯删减（未发布）

- 删除无生产消费者的 GET 读取计数和失效增量客户端路径；保留完整正文及分页、服务端版本装饰、前端旧内容版本保护，删除仅针对失效机制的测试内容。修改前日志见 item.md 的 B1A 节。
- 相对本批开工工作区：业务5文件 +6/-95，测试2文件 +1/-15，文档2文件 +15/-0；保留开工前准备批的文档改动。差异及逐文件统计分别为 `/tmp/negus-director-20261102/batch-01.diff`、`/tmp/negus-director-20261102/batch-01-numstat.txt`。
- 批次、消息交接、会话加载和版本存储测试34/34通过，TypeScript `--noEmit` 通过；日志 `/tmp/negus-director-20261102/batch-01-tests.log`、`/tmp/negus-director-20261102/batch-01-typescript.log`。文件已改，前端未发布生效；本批无后端修改或待重启的后端改动，不重启、不提交、不推送。真实浏览器和用户验收未进行。
- 总监后续核对：B1A 前端已生效，buildId `feishu-mvy4wn0n`，时间 `2026-11-01T17:59:15.723Z`，`backendRestarted=false`；本地与公网 `/api/version` 均 HTTP 200 且同版本。此为总监提供的核对结果，本次未重复请求。

### 2026-11-02 B1B 后端读取保护（待受控重启）

- 聚合读取在上下文、Goal、待确认问题完成后再核对来源版本；原生空正文的同店历史回读失败直接上报，不重复回读，真实空值及原生读取异常回退保持原有行为。
- 相对本批开工工作区：业务2文件 +7/-4，测试2文件 +59/-1，文档2文件 +15/-0；保留B1A及准备批既有改动。差异及统计：`/tmp/negus-director-20261102/batch-02.diff`、`/tmp/negus-director-20261102/batch-02-numstat.txt`。
- 路由、会话控制及加载相关测试65/65通过，四个改动的 MJS 文件 `node --check` 通过；日志 `/tmp/negus-director-20261102/batch-02-tests.log`、`/tmp/negus-director-20261102/batch-02-check.log`。后端源码已改，待最后受控重启，运行态及用户体验未验收；本批不发布、重启、提交或推送。B1A 前端发布结果待总监另行核对。

### 2026-11-02 B1C 失败气泡缓存保护（未发布）

- 当前和最近对话的本地失败/占用气泡在条数及字符预算裁剪中保留原对象和顺序；预算不足时只淘汰可补读历史，不可裁时保留旧快照、返回失败并记录不含内容的错误。存储写失败同样返回失败。
- 相对本批开工工作区：业务1文件 +49/-22，测试1文件 +85/-0，文档2文件 +15/-0（含总监提供的 B1A 生效证据）；保留此前所有改动。差异及统计：`/tmp/negus-director-20261102/batch-03.diff`、`/tmp/negus-director-20261102/batch-03-numstat.txt`。
- 相关快照及待发送测试22/22通过，TypeScript `--noEmit` 通过；日志 `/tmp/negus-director-20261102/batch-03-tests.log`、`/tmp/negus-director-20261102/batch-03-typescript.log`。本批前端文件已改、未发布生效；B1B 后端仍待最后受控重启，未进行浏览器及用户验收，不发布、重启、提交或推送。

### 2026-11-02 B1C 校正与 B2 开发中（未验收）

- B1C 复核补上当前对话至少保留一条消息的预算边界；单条普通消息超限时返回失败并保留旧快照，相关回归通过。B1C 校正源码未发布。
- B2 已修改持久化 revision 与调度依赖，相关单元测试24/24、TypeScript 和差异检查通过；浏览器夹具三次均未观察到流式文字进入可见活动轮次，零额外写盘/请求、真实变化、抢占及重试尚未完成验收，B2 不标记完成。日志 `/tmp/negus-director-20261102/batch-04-unit.log`、`/tmp/negus-director-20261102/batch-04-typescript.log`、`/tmp/negus-director-20261102/batch-04-stream.log`。
- 相对本批开工工作区：业务3文件 +20/-9，测试3文件 +79/-1，文档2文件 +15/-0；差异和统计为 `/tmp/negus-director-20261102/batch-04.diff`、`/tmp/negus-director-20261102/batch-04-numstat.txt`。转发目录复用与隐藏 composer 暂缓；未发布、重启、提交或推送，B1B 后端待最后受控重启。

### 2026-11-02 B2 定向验收完成（未发布）

- 总监确认上一轮流式文字可见断言不适用于既有展示；测试只读状态仓库确认20次分散 delta 已处理且多次通知，期间快照写入及详情请求均为零，真实变化仍更新，已加载对话点击零详情读取。
- 既有浏览器夹具默认批次、剩余历史阻塞时新变化抢占、失败后两次重试恢复均通过；默认夹具补齐真实服务端的 `historyFormatVersion: 1` 后保留原刷新复用断言。日志 `/tmp/negus-director-20261102/batch-05-{stream,default,preemption,retry}.log`；前次单元24/24及 TypeScript 证据保留在 `batch-04-*`。
- 相对 B2 开工工作区（含 B1C 末条修正）：业务3文件 +20/-9，测试3文件 +94/-1，文档2文件 +25/-0；本次仅改测试夹具和文档。B2 前端源码已改、未发布；B1B 后端待最后受控重启。未请求真实供应商，不发布、重启、提交或推送。

### 2026-11-02 总监验收与前端生效

- 总监独立复核累计业务差异，DeepSeek 同一只读对话终审未发现阻止交付的业务缺陷。受保护的两个滚动入口 SHA-256 与开工完全一致；暂缓项保持原实现。业务10文件 +80/-128，测试7文件 +239/-17，分别净删48行和净增222行。
- 已有有限重试耗尽夹具通过：保留旧缓存和错误、结束转圈，手动刷新恢复。证据 `/tmp/negus-director-20261102/batch-06-exhausted.log`；此前三次流式可见断言失败及其原因保留历史记录，不作为通过证据。
- 受控前端发布实际完成于 `2026-11-02 02:20:27 +08:00`，版本 `feishu-mvy5nwlv`，未重启后端。02:20:51 核对本地和公网 `/api/version` 均200且版本相同；证据 `/tmp/negus-director-20261102/frontend-02-result.json`。B1C/B2 前端已生效，B1B 后端待最终受控重启；未进行真实供应商生成或人工体验验收。
- 后续仅追加本轮真实发布、分支同步及重启结果，不再修改业务；预计文档2文件再新增约8至15行。提交和同步使用 `develop`，`main` 保持不动；候选和回退快照准备通过后再安排唯一一次最终后端重启，scheduled 与实际 started 分开记录。

### 2026-11-02 重试耗尽与累计收尾

- 原有 `NEGUS_TEST_BATCH_FAILURE=1` 浏览器夹具通过：失败对话保留缓存和错误，有限重试耗尽后停止转圈，手动刷新后恢复；页面异常为空。证据 `/tmp/negus-director-20261102/batch-06-exhausted.log`。
- 本次文档2文件 +34/-0，未改业务或测试；相对基线累计文档2文件 +132/-0，累计完成项、暂缓表及运行状态见 item.md。B1A 前端已发布 `feishu-mvy4wn0n`，B1C/B2 待总监发布，B1B 待最后受控重启；未发布、重启、提交或推送。

### 2026-11-02 最终运行核验与交付

- 重启任务 `1793557396941-34317` 实际于02:23:39（+08:00）完成，`started`、attempts=1，PID34375，运行快照 `1793557365332-a72d04b2`；未触发回退，旧快照 `1793552059493-93f75bbe` 仍为受控回退版本。
- 08:57核对本地及公网 `/api/version` 均200、版本同为 `feishu-mvy5qxll`；watchdog确认后端、前端、隧道健康。两个后端修改文件与运行快照逐文件哈希相同；证据 `/tmp/negus-director-20261102/final-runtime-result.json`。内核仍为原版本，未升级0.166；滚动保护入口哈希与开工一致。
- 关键验证按批通过34项、65项、24项（存在重复覆盖，不相加为独立用例）；TypeScript及生产构建通过。浏览器夹具覆盖20次流式零额外写盘/详情请求、真实变化继续同步、已加载点击零详情请求、默认批次、过期剩余读取、有限重试恢复及耗尽停转圈/手动刷新。未发送真实供应商生成请求，未用夹具代替人工体验验收。
- 业务提交 `615690e9b2f5a231281bb43b3d678b4b167283ca` 已推送并核对远端develop一致；本次只追加最终记录。相对基线 `253e379` 去重共19文件：业务10文件 +80/-128（净删48），测试7文件 +239/-17，文档2文件 +150/-0；总计 +469/-145。暂缓事项、原因和后续决定见item.md表格；无新UI，实际体验变化为减少流式重复持久化、保护失败附件/原因，并把历史回读失败明确呈现为同步失败而非假空正文。
### 2026-11-02 后台来源与派工署名澄清记录

- 修改前：用户正在逐项确认后台对话体验；本步只把本次原话和有效决定补入现有条目。预计文档2文件新增约30至45行，不改业务代码、不发布或重启。
- 交互范围：统一登记各种来源的后台对话；原生子代理使用特殊标签；助手派工及追加气泡显示来源助手名称、位于左侧。预计效果是后续开发与验收有明确依据，本步不改变线上体验。
- 实际只更新文档2文件，新增28行、删除1行；已核对原话与摘要分开、保留历史和滚动保护。差异格式检查通过；未改业务或测试、未发布、未重启，线上行为不变。

### 2026-11-02 实施批 A：后台入口登记

- 群聊独立后台线程复用统一登记及绑定，保存实际 Provider、模型、强度和助手来源；普通群聊线程不强制登记。旧后台入口传助手来源和强度。登记失败后保存已建线程，重建服务时补登记并仅在有明确未启动标记时首次启动，不重建线程或重发已有 turn。
- 相对批 A 开工工作区：业务5文件 +30/-11，测试2文件 +95/-2，文档2文件 +17/-0；总监已有需求澄清保留。定向测试22项通过，追加的重建恢复和旧入口2项通过，最终群聊定向2项通过；日志 `/tmp/negus-director-20261102/implementation-batch-a-tests.log`、`implementation-batch-a-recheck.log`、`implementation-batch-a-final.log`。MJS 语法及差异检查通过。
- 后端源码已改，待总监最后安排受控重启，未运行态验收。显式 DeepSeek 不能被已有 VIP 默认策略覆盖仍待下一批；普通来源派工、逐条署名、原生子代理投影及两条已知线程的定向修复均未实施。未修改运行数据、发布、重启、提交或推送。

### 2026-11-02 实施批 BC1：消息账本字段

- 员工账本归一化保留发送编号与可信展示来源；原生 `userMessage.clientId` 映射为发送编号，署名只接受服务端显式提供的关联，不读取消息自带作者字段。
- 相对 BC1 开工：业务1文件 +7/-1，测试1文件 +21/-0，文档2文件 +9/-0。定向测试1/1通过，源码语法及差异检查通过；日志 `/tmp/negus-director-20261102/implementation-bc1-tests.log`。现有 runtime 已透传 `turnOptions`，未修改；真实 native `clientId` 往返尚未验证，不能仅凭本地夹具宣称闭环。普通来源派工、实际 actor 接入及原生子代理投影仍待后续；后端未重启、未发布。

### 2026-11-02 实施批 BC2a：普通来源底层契约

- kernel 仅对明确 `source.kind=conversation` 的入队允许无员工 ID；现有 MCP 后台创建工具可传显式 Provider、模型和推理强度。定向 kernel 回归1/1、语法和差异检查通过，证据 `/tmp/negus-director-20261102/implementation-bc-2a-tests.log`。
- 这是底层子批，不是 B/C 完成交付。普通对话 capability/adapter、实际路由与 followup、逐条 actor 和原生往返确认仍未接入；后端源码未重启生效，未发布。

### 2026-11-02 实施批 BC2：普通来源派工及逐条署名

- 普通主对话经现有 `negus_handoffs` capability 进入同一 task kernel：服务端核实已登记 thread、活动 turn 和来源 Provider；显式 Provider/模型/强度优先于 VIP 默认。无员工来源不伪造绑定；后台执行者不得再派工。任务登记、目录及 `/api/tasks` 共用现有路径。
- 首发与追加要求在任务记录中保存稳定 submission 与可信助手身份；原生回读仅按 `clientId` 匹配，真人同 turn 输入不贴助手标签。追加沿原线程进入既有 queue：活动 turn 使用 steer，终态使用新 turn 观察；重复请求只核对已有 queue/原生历史，不盲重发。结果通知沿原 delivery 去重并标记执行助手。登记待完成的已建线程恢复时不再次创建线程。
- 定向服务/群聊测试14/14、共享 kernel 测试11/11通过；隔离临时 Codex Home、本地不可达模型端点的当前 0.165 协议探针确认 `turn/start.clientUserMessageId` 回读为 `userMessage.clientId`，没有真实供应商调用。TypeScript、语法、`git diff --check` 通过。日志：`/tmp/negus-director-20261102/implementation-bc2-final-tests.log`、`implementation-bc2-kernel.log`、`implementation-bc2-native.log`、`implementation-bc2-ts.log`、`implementation-bc2-diffcheck.log`；累计差异见 `implementation-bc2-cumulative.diff` 和 `implementation-bc2-cumulative-numstat.txt`。
- 相对 BC2 开工、从既有 A/BC1/BC2a 差异扣除：业务9文件 +183/-48，测试1文件 +161/-5，文档2文件 +11/-0；累计去重数以最终 numstat 为准。既有浏览器夹具验证带 `displaySourceAgentId` 的用户协议消息呈左侧助手气泡，真人消息保持右侧，日志 `implementation-bc2-ui.log`；运行态仍待受控发布/后端重启。两条已知历史线程的定向登记及可证历史署名须总监在发布后执行，未修改在线数据；D1 原生子代理投影不在本批。

### 2026-11-02 总监定向核验：版本读取失败

- 实际复现：正文版本不可读时，仅署名版本被返回为可复用标识；下一次请求可能跳过正文读取。路由改1行，仅在原生正文版本有效时组合署名版本。
- 关键回归3/3通过：助手报告的等候/发送署名一致且忽略真人伪造字段、署名变化才重读、正文版本不可用时继续读正文。队列编号校正已由Sol同时完成，本次总监未重复修改。实际业务1文件 +1/-1、测试1文件新增59行；证据 `/tmp/negus-director-20261102/implementation-director-projection-{before,tests}.log`。后端尚未重启。

### 2026-11-02 实施批 BC3：审阅阻断修正

- fresh 普通线程在 `thread/start` 注入 MCP 能力并绑定真实 thread ID，已有线程只在 `thread/resume` 注入；`turn/start` 不再收到不支持的 config，员工 managed 创建不套普通能力。助手 followup 以原生 `clientId` 与持久 input 精确对应，才按原 delivery 回源一次；真人私聊续轮不回源。普通来源 actor ID 为 `assistant:<sourceThreadId>`，结果作者为实际执行助手。旧后台首发/通知沿已有 task ID 与稳定 dispatch ID 装饰，未知 ID 不贴标签。
- followup input 先保存 actor，queue item 以 held 状态落盘；接受标记持久化后释放。明确未入队可用同 submission 重试；已接受但 queue 已消失只查原生历史，未知不盲重发。活动线程仍走现有 steer，无新执行器。定向测试：MCP 2/2、普通/queue/恢复 7/7、旧后台 1/1；TypeScript、语法、diff 检查通过。证据 `/tmp/negus-director-20261102/implementation-bc3-mcp.log`、`implementation-bc3-followup.log`、`implementation-bc3-legacy.log`、`implementation-bc3-ts.log`。
- 相对 BC3 开工、按 BC2 保存的累计 numstat 对照：业务7文件 +86/-9，测试3文件 +65/-0，文档2文件 +10/-0。群聊独立任务首发稳定署名已在 BC2；群聊工具尚无可信的助手 followup 输入账本，不能仅凭消息属于同一 turn 推断发送人，后续署名不算完成。当前无发布或重启，历史两线程修复仍待总监后续受控执行，D1 未实施。

### 2026-11-02 按用户限时停止

用户要求“给你5分钟弄不完别弄了”。本轮完整交付尚缺两条历史线程安全补登、最终生产构建和正式发布核验，无法在限时内保证完成，已停止开发任务和临时验证服务，不安排发布或重启。群聊服务与专属测试恢复本轮基线；未获授权的群聊扩展和不适合在线执行的补登脚本已移出工作区，仅在 /tmp/negus-director-20261102/withdrawn-group-scope 保留追溯。

现有改动保留为未交付草稿，未提交、未推送。定向回归110项首次109通过；唯一失败为新增子代理字段的旧预期，补齐后该文件37项通过。浏览器夹具实际断言助手左/真人右、队列署名及原生任务标签通过（final-ui.log）；两个保护文件哈希与基线一致，diff检查通过。线上仍为旧版本，不将源码或局部测试通过记为交付。
### 2026-11-02 消息交接收尾验证（本次主对话）

用户重新授权两项完整开发。发送事件带既有排队编号，ConversationStore 保存排队/发送尝试关联，接受先到及旧批次后到不恢复等待气泡；延迟映射到达时保留已接受正文，正式历史也可确认交接。移除接受时用旧 committed 队列覆盖 live 队列的更新。ChatWorkspace 先放等待消息再合并正式记录，保留正式时间/助手署名；不按文字去重，不改变发送/重试协议与滚动测量。业务5文件本次 +41/-9，测试2文件 +45/-2（均不包含前轮署名/后台改动）。

消息交接及加载单测26/26通过，工作台浏览器7/7通过（新增submitted/accepted先于队列映射、延迟旧队列、助手署名断言），既有conversation-store浏览器7组通过（同文两次、失败附件、切换/重载及运行中队列）。TypeScript与diff检查通过，两个滚动保护文件与HEAD无差异。证据 `/tmp/negus-handoff-{unit,types,workspace,store-browser}.log`。前端已于13:03:01受控发布 `feishu-mvysm8h4`，backendRestarted=false，本地/api/version为200且版本一致；后台新事件字段及补登/子代理修复待本轮统一重启后真实验收，不将前端发布等同两项已完成。

本次统一候选已准备：`1793595790314-01e46644`，可恢复版本 `1793592398300-7e47643f`，隔离准备通过，日志 `/tmp/negus-two-requirements-prepare.log`。重启后先核对本次status/result，再执行 `/tmp/negus-director-20261102/finish-background-registration.mjs` 和 `verify-live-handoffs.mjs`；后者保存request/thread/task身份，超时续跑不得重复创建。真实验收后再提交同步develop并核对健康，当前目标保持进行中。

### 2026-11-02 原生子代理归属过滤定向修复

只读核验：真实 native child `01a19a65-c6ca-7840-863a-16aeeed2d88b` 的原生 `source.subagent.thread_spawn.parent_thread_id` 指向 `01a199c7-a3fe-70b1-9161-1960ac80c287`；父 route 为 `current`，child 原生文件位于已知隔离 Provider；线上 `/api/session` 暂仍 404。业务仅改 `provider-conversation-store.mjs` 的列表 owner 判定，允许 current 父与唯一具体 Provider child 关联，明确不同父 Provider 或多 Home 同 ID 时拒绝；同一 owner 用于打开。相对开工业务1文件 +15/-7，测试1文件 +32/-0，文档2文件实际计数见本批证据。定向测试2/2、`git diff --check` 通过，保护文件哈希未变。已 `prepare` 候选 `1793592398300-7e47643f`，fallback/active `1793591345542-a235c150`；候选运行文件与 active 仅此业务文件不同。未重启、未发布，线上效果待总监受控切换后核验。

定向复验：总监已受控重启 `1793592398300-7e47643f`，但线上 `/api/sessions` 和目录仍缺真实 child，直达仍404。实际两个指定 Home 的 `thread/list` 即使传全部 `subAgent*` 均未返回该 child，而 child Provider 的 `thread/read` 可读原生 source、parent 与 path。补用现有具体 Provider JSONL 项目 header 索引投影子代理，与 native list 合并后沿原 owner 校验。相对本批开工业务3文件 +21/-3、测试1文件 +25/-0；定向测试3/3、语法和 diff check 通过。用真实 routes/Provider 的修改后只读服务实例验证 list 返回该 child、owner 为实际 Provider、findSession 打开同一原线程。新候选 `1793593573715-9652a1b7` 已 prepare，fallback 为当前运行 `1793592398300-7e47643f`；未重启，线上尚未生效。详见 `/tmp/negus-director-20261102/native-owner-hotfix-followup-evidence.json`。

### 2026-11-02 本轮收尾：已知历史线程在线补登（修改前）

用户重新授权“请你把我的两个需求都开发完整好。最小代码改动，多复用已有代码逻辑。”现象：已有 Terra 对话登记为 current/缺助手来源，DeepSeek 对话未登记而不可见。停服直写脚本不能与运行中内存路由安全共存；改为现有鉴权任务路由调用活跃 Provider store 的参数化补登方法，先从指定 Provider 只读核验原线程及设置，再复用 registerSession，保留既有元数据并拒绝并发变化/跨具体 Provider 覆盖；不创建线程、不发送消息。预计业务3文件 +约35/-0、测试1文件 +约45/-0。未知历史消息无精确派工身份不猜；首发/续派新路径沿现有 task.inputs。子代理已有真实只读验证及3项定向测试复用，不重复运行。

本批结果：业务3文件新增28行（Provider store 18、任务扩展5、现有鉴权路由5），测试1文件新增29行；既有改动全部保留。定向回归1/1覆盖空路由补登、current错误归属修正、最新模型/强度和自定标题保留、具体Provider冲突、并发变化拒绝，原生适配器仅提供只读方法因而不会创建或发送。日志 `/tmp/negus-director-20261102/background-registration-tests.log`，语法和差异检查通过。补登后广播现有sessions_changed。已准备 `/tmp/negus-director-20261102/finish-background-registration.mjs`，由总监重启加载后执行，核验两条旧对话的来源/Provider/目录/打开及两条真实child的sessions/目录/tasks标签/打开。此刻仅源码完成，未修改线上数据、未发布或重启。旧桥接脚本没有保存可核对的原生派工消息ID；按已确认规则，旧消息身份不猜测，新派工及续派继续按task.inputs稳定ID标注。

补登并发复核：将预期路由快照比较移到registerSession内部、await ready之后与赋值同一同步段，关闭检查后微任务间隙；最终本批业务3文件 +31/-1，测试1文件 +29/-0。未知Provider由model-provider-service.resolveRoute明确400拒绝；readOnly经过thread/read/JSONL fallback而非resume。另交付真实首发/续派验证脚本 `/tmp/negus-director-20261102/verify-live-handoffs.mjs`，用独立验收主对话实际调用现有MCP工具、后台短回复、沿原task/thread续派，核对首次和追加署名及真人消息不误标；持久保存验收thread/task/requestId，重复执行复用已提交请求。尚未运行，安排统一重启后执行，不能将脚本准备计为真实验收通过。

### 2026-11-02 两项需求最终上线验收

- 受控重启任务 `1793595832491-51720` 于13:04:14一次成功，运行版本 `1793595790314-01e46644`，未回退。重启尚scheduled时一次补登请求落到旧服务404，未写入；核对本次started后再执行成功。验收必须先核对当前jobId/release再调用新版入口，旧result不能作为已生效证据。
- 两条既有Terra/DeepSeek线程通过活跃服务安全补登，实际Provider和“来自助手”正确，列表/目录可见且原线程可打开。两条原生child在sessions、项目目录和tasks中均可见且可打开。证据 `background-live-completion.json`。
- 真实DeepSeek来源主对话通过MCP创建后台task `27b8a77d-4b06-4a1a-bd84-b29da8264ede`；首次和followup均实际运行、回读署名正确，沿用同一线程，真人补充没有助手身份。证据 `live-handoffs-evidence.json`，均位于 `/tmp/negus-director-20261102/`。
- 真实页面验收补齐当前Feishu列表/标题的原生标签：业务6文件 +9/-6，直接复用ConversationOrigin，无新组件和控制。13:30:48前端发布 `feishu-mvytlyvz`，不重启后端。浏览器确认两条派工气泡为左侧来源助手、真人为右侧“我”；后台列表出现Codex子代理标签，点击进入原线程，页面异常0。证据 `live-browser-evidence.json`、`live-attribution.png`、`live-native-task-list.png`。旧组件夹具不能替代当前用户入口，验收应从实际导航路径打开页面。
- 消息交接单测26/26、工作台浏览器7/7、共享store浏览器7组通过；接受先到/旧快照、正常steer同turn、同文两次、失败及附件保留均有覆盖。TypeScript、构建、diff检查通过。两个受保护滚动文件未改；无群聊扩展、内核升级或子代理额外控制。后端/前端/公网健康，公网HTTP200。
- 相对本轮基线944179d，累计业务31文件 +480/-103，测试12文件 +581/-9，文档2文件；含上午已有改动，不与凌晨19文件维护混算。当前两项实现及运行验收已收口。旧桥接消息无可靠身份的历史保持原样，不猜署名；不属于新派工署名失效。

### 2026-11-02 真实署名缺口复核（未完成）

- 运行 API 全量读取旧 DeepSeek `01a19839-dee3-76d0-b842-fbf737fe99bc` 和开发 `01a1983a-77e7-7ea3-9592-e522e6cce926`，分别17和20条 UserMessage 无 submission/作者；`/api/tasks` 均无对应 task。原始 bridge `agent-turn.mjs` / `research-turn.mjs` 未传 clientUserMessageId，也未保存 turn/start 返回 ID；JSONL 虽有 turn 和 item，缺少可将具体请求唯一关联到该 item 的返回证据。`developer-steer.mjs` 可见调用返回 no active turn，不能作为成功追加证据。此前将旧消息排除在失效之外的结论不成立，问题仍未修复。
- 原生 child `01a19a9b-a906-7522-ba06-fc61353d662d` 完整 JSONL 有来自 `/root` 的3条 `agent_message`，ID 分别为 `amsg_01a19a9b-a939-78b1-b66d-365c65effca3`、`amsg_01a19aa0-2aa3-7b21-bbf6-425ceb13126c`、`amsg_01a19aa2-481c-7e20-9db0-5b5fd9153f53`；均含 encrypted_content。原生 `thread/read` 无这些 items，Negus 全量会话仅1条消息、无 user，因而首次及追加均未显示，不能用 recent10 说明身份正确。
- 本任务真实 MCP 派工 `1718b252-e6d8-48c8-a9a5-e283de521e82` 的运行 API 返回 submissionId、`gpt-6-astra` 和 `assistant:01a19a93-16c3-7012-83e1-2630f7658e1e`，对应 task.inputs；先前独立测试首发、续派、真人及页面截图证据为 `/tmp/negus-director-20261102/live-handoffs-evidence.json`、`live-browser-evidence.json`、`live-attribution.png`，不替代本次旧线程验收。
- 未修改业务代码或运行数据，未发布、重启、提交；没有修复任何旧记录。需找到保留请求返回 turn/item 的可信记录后通过运行服务复用 actor 账本定向补标；原生消息需可读取的受支持接口或发送时可信捕获，不能从 encrypted_content 恢复正文。本次未验证刷新/重开后的修复，也无可执行发布脚本。

### 2026-11-02 同目录写锁冲突修复（待运行生效）

基线 develop/b678d5e81b7f43aefb214bc07cbfc7062d71c3c1。业务2文件 +10/-3 行，复用默认连接、会话与既有 pending 切换收口逻辑。新增2项回归：同目录不新建进程、不改配置、不关闭借用连接；持久化 pending 别名切换直接发送并清理 pending，不释放/重抢锁、不重复订阅。模型供应商与会话路由测试30通过、1项原有平台测试跳过；两文件语法和 git diff --check 通过。证据：/tmp/negus-writer-tests.log。既有两份文档未提交改动保留。本次源码完成，未重启，线上尚未生效。

同次补充验证：conversation-controls 37项通过，合计67通过、1项原有跳过。2026-11-02 14:51 +08:00 已执行受控 prepare，候选 `1793602282055-d89d225f`、回退 `1793595790314-01e46644`，命令成功返回 prepared；两份后端候选文件与工作区逐字节一致。status 确认 active 仍为旧版本，尚未重启或切换服务，等待用户重启授权。准备记录：runtime/negus-release-prepared.json。

### 2026-11-02 插入消息排序修复

同轮次本地消息被轮次开始时间替代排序时间，导致服务器接受前后位置跳动。业务 conversationMerge.ts 新增2行，测试 conversation-loading.test.mjs 新增三阶段位置回归，旧代码失败、修改后通过。相关27项测试通过；发布结果另记。此前占用修复已核对本次 jobId `1793602901070-55141` state=started，active=`1793602282055-d89d225f`，2026-11-02T07:02:33.648Z 生效。

发布验收：TypeScript及差异检查通过；`node scripts/negus.mjs rebuild` workerPid=56080，本次 frontend result 于2026-11-02T07:51:10.754Z 返回 published，buildId=`feishu-mvyymh7w`，backendRestarted=false。本地 version.json 返回200且与结果一致；watchdog 后端/前端/隧道均healthy（隧道HTTP200）。额外未认证公网 version.json 请求返回403，不以该请求证明公网版本。修复源码已在前端生效；未更改滚动逻辑。

### 2026-11-02 第一条加载缓存审计

基线 `253e379181b0b9ac3a412783c60e8d62b75c469d` 与当前最新代码对比，第一条相关9文件去重为 +137/-93。核对确认：旧的 `conversationReads.ts` 已删除且无残留调用；正文、上下文、状态、队列和待确认问题通过现有会话视图读取；最终 `sourceRevision` 在慢读取结束后重新核对；晚到旧请求不能覆盖当前对话；失败/占用消息按预算保留；缓存写失败保留旧快照。

定向加载、缓存、路由和历史读取测试 54/54 通过，覆盖晚到请求、失败回读、缓存版本变化、失败附件保留、裁剪预算及快照写失败。审计同时确认任务署名与原生子代理元数据属于加载和缓存数据，不应迁出；但 `ConversationStore` 中 `localPending`、`sendingQueue`、`acceptedSubmissions`、`queueDispatches` 仍需在其他功能审计中核对是否存在重复身份状态。本次仅记录，不改业务代码、不发布、不重启。

### 2026-11-02 其余功能代码审计

- 插入消息排序：`conversationMerge.ts` 相对基线为 +2/-29；新增条件仅处理“本地消息已有 turnId、尚无原生 itemIndex”的中间阶段，原生顺序号到达后回到服务端顺序。旧 `mergeSessionDelta` 已无调用方并删除。`conversation-loading.test.mjs` 13/13通过。
- 供应商同目录写入：`model-provider-service.mjs` 在同 `CODEX_HOME` 时复用默认 writer；`provider-conversation-store.mjs` 在 provider/current 指向同一 client 时复用 current store，别名切换不释放或重新恢复。供应商、会话路由和目录相关测试59/59通过，1项Windows专用测试跳过。
- 任务来源、追加、恢复与消息交接：`employee-task-extension.test.mjs`、`task-kernel.test.mjs`、`task-attribution-projection.test.mjs`、`message-handoff.test.mjs`、`agent-publication.test.mjs` 合计53/53通过。身份仅按 submission/client ID 精确匹配；held queue、活动 steer、终态新 turn、未加载线程 resume、commentary/final/无答复区分均有覆盖。
- 后台目录、子代理、当前任务与列表刷新：元数据由后端透传到现有目录、来源标签和任务组件；真实消息时间用于排序，同 thread 去重。项目目录、桌面当前任务及会话摘要定向测试通过。
- 未发现重复执行器、第二条正文缓存或第二套任务状态机。当前主要结构风险是 `ConversationStore` 的四种在途状态以及 `employee-task-extension.mjs` 的职责集中，尚无证据表明可直接删除；后续只允许在这两个边界内按现有测试收敛，不能继续新增并行的状态。
- 已知缺口：任务摘要不可读取时缺少安全的排序时间回退；旧历史无可信 submission/actor 时不能补署名；维护 job 与原任务仍无精确关联。以上均不由本轮猜测补齐。
- 本轮仅修改文档；`git diff --check`通过，未发布、未重启、未提交或推送。
