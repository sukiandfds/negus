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
