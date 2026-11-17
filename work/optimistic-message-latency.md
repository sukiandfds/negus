# Negus 乐观消息与整页更新延迟只读排查

排查时间：2026-11-12 18:09，Asia/Shanghai
范围：`/Users/hans/myproject/negus`，`develop`，HEAD `d60f32b3e0eea56a2751de4f1230d6cdac3f95f5`
授权边界：仅只读排查；未修改业务代码，未提交、推送、发布或重启，未发送真实用户消息，未创建测试对话。

## 结论

普通文字消息的乐观对象**不是等后端确认后才插入**。点击发送时，处理器先在 `sendDirectMessage` 中同步生成 `optimistic-*` 消息，调用 `ConversationStore.addMessage`，之后才等待模型设置和 `/api/session/message`。因此，1～3 秒延迟的主体是**消息已进入 store，但 React 主线程被其他全局更新占住，DOM 提交或首帧被推迟**；另有一个明确例外：“编辑已有历史消息后重新发送”会先等待服务端 revert，再插入乐观消息。

本次在实际构建和实际数据上复现出一条最主要的高频刷新链：当用户查看一个已完成对话、但另一条后台对话仍在运行时，浏览器在 6 秒内对后台活跃对话发出了 **122 次 `GET /api/session`（约 20 次/秒）**。每次返回都会进入共享 store、触发全页订阅、189 行会话目录计算、当前消息的 Markdown 重渲染，并可能触发完整缓存快照写入。CPU 降速 6 倍的浏览器测试中，出现 **2.156 秒和 4.405 秒的连续主线程任务**，输入框一次按键到下一帧达到 **2,176 ms**；这与用户描述的 1 秒常态卡顿及约 3 秒长尾处于同一量级。

线上与工作区当前实际运行的代码走同一条路径。旧发布快照和当前主 JS 在归一化 build ID 与懒加载 chunk 名后逐字节一致，CSS 哈希一致；相关后端发布快照与工作区文件哈希也一致。

## 1. 普通发送的真实用户流程

### 点击发送到首个乐观 DOM

1. 用户在输入框按 Enter 或点“发送”。`ConversationComposer.submit` 阻止重复提交，读取当前文本，在同一事件中先 `setText("")`，随后调用 `onSend`；普通纯文字此时没有附件上传等待（`ui-feishu/shared/features/conversations/components/ConversationComposer.tsx:229-287`，发送按钮入口 `:457-465`）。
2. `onSend` 进入 `useProjectConversations.sendMessage`。不是“重新编辑”时直接进入 `sendDirectMessage`（`useProjectConversations.ts:411-413`）。
3. `sendDirectMessage` 生成稳定 `submissionId` 和乐观消息，并在任何网络等待之前调用：
   - `selection.addOptimisticMessage(threadId, optimisticMessage)`；
   - `setLocalSendVersion(...)`（`useProjectConversations.ts:317-325`）。
4. `ConversationStore.addMessage` 把消息放入 `localPending` 并同步调用 `notify()`（`ui-feishu/shared/features/conversations/state/conversationStore.ts:237-243`）。`notify()` 增加 store version 并通知所有订阅者（`:100-102`）。
5. `useConversationSession` 通过 `useSyncExternalStore` 订阅 store（`ui-feishu/shared/features/conversations/hooks/useConversationSession.ts:35`），所以整棵上层应用进入 React 更新。
6. `ChatWorkspace` 通过 `mergeMessageList` 合并 `localPending` 和正式消息（`ui-feishu/src/components/ChatWorkspace.tsx:83-89`），`ConversationView` 再排序并渲染消息（`ConversationView.tsx:214-258,347-395`）。
7. 第一个可见 DOM 更新发生在上述 React commit 完成、包含 `data-message-id="optimistic-*"` 的元素被插入时；它与 `/api/session/message` 的响应、SSE `user_message_submitted` 都没有前置依赖。

浏览器隔离验证中，实际生产构建、一条 68 条历史的已完成对话、189 个目录行，非 GET 请求由 CDP 拦截并以合成响应替代，因此未向真实对话发送消息。隔离点击到乐观气泡 DOM 的时间为：

| CPU 降速 | 点击到 DOM | 点击到近似首帧 |
| --- | ---: | ---: |
| 1x | 29.7 ms | 44.1 ms |
| 4x | 50.7 ms | 54.7 ms |
| 6x | 73.3 ms | 79.1 ms |

该数据为本机无长任务占道时的基准。实际操作若正好撞上后台刷新或全量渲染，浏览器事件和 React 更新会排队，乐观对象仍在 store 中，但屏幕上的气泡要等长任务结束。

### 插入之后的状态变化

- 插入后立即设置 `deliveryState: "preparing"`；模型设置完成后改为 `"sending"`（`useProjectConversations.ts:321,359`）。这些是后续状态更新，不影响首次插入。
- `modelApi.update`、推理强度请求、`/api/session/message` 都在插入之后执行（`:341-360`）。
- 服务端收到请求后广播 `user_message_submitted`，再调用模型发送（`windows/server/routes/conversation-message-routes.mjs:96-124`）。前端按 `submissionId` 对账，并保留同一 React key（`useProjectConversations.ts:723-734`，`ConversationView.tsx:20-23`），正常路径不会再生成第二个气泡。
- 服务端的 `user_message_submitted`、正式历史合并和 SSE 到达是接替/校正乐观消息的后续链路，不是首个气泡可见的前提。
- 图片/文件发送例外：`draft.uploadAll()` 在 `onSend` 之前被 await（`ConversationComposer.tsx:260-274`）。附件上传期间还没有进入 `sendDirectMessage`，因此不会有乐观气泡。历史图片大请求的既有调研主要影响随后模型请求耗时，不等同于普通文字气泡插入耗时。
- 标题生成、模型调用和线程后续事件发生在消息已经插入之后，不构成普通文字气泡的首屏阻塞。

## 2. 实测结果

### 2.1 实际构建、实际数据的浏览器结果

环境：macOS 主机上的 Google Chrome 157 headless，临时浏览器 profile；实际连接本机发布实例；未使用用户浏览器登录态，只使用本机服务访问凭证；所有写请求均未通过验收夹具。按键和点击使用 CDP 的真实输入事件。

本机未降速时：

- 已完成 101 条消息对话，点击“对话详情”：`6.6 ms` 到 DOM 变更，`25.6 ms` 到近似首帧。
- 运行中对话，点击“对话详情”：`11.3 ms` 到 DOM 变更，`33.8 ms` 到近似首帧。
- 运行中对话输入 6 个字母：输入事件到下一帧约 `10.0–36.0 ms`。
- 68 条消息、189 个目录行、约 6,357 个 DOM 节点时，隔离发送气泡：约 `44.1 ms` 到近似首帧。

这些结果显示，空闲、无长任务时，发送、点击和输入本身并不必然慢约 1 秒。

CPU 降速 6 倍（低性能设备/高负载代理）时：

- 运行中对话，点击“对话详情”：`37.2 ms` 到 DOM 变更，`43.5 ms` 到近似首帧。
- 运行中对话输入：多数首帧 `22–172 ms`，一次落在长任务中达到 `2,176 ms`。
- 同一时段记录到 `2,156 ms` 和 `4,405 ms` 的连续主线程长任务。
- CPU Profile 显示，固定 10–11 秒窗口里会话行 `render`、`compactTime` 日期格式化、Markdown 解析及 React commit 是持续热点。

这证明“同一操作为什么有时约 1 秒、偶尔约 3 秒”：点击并不总落在同一个 16 ms 帧内。活动对话产生新数据时，点击可能恰好排在几十毫秒到数秒的主线程任务后面。

### 2.2 高频 `/api/session` 回路

实际浏览器停留在已完成对话 `01a1ca98-9a88-7833-8deb-b041b781f3ba`，另一条后台对话 `01a1cf29-7a73-7f73-acfe-1eed1d9e1b29` 正在运行。持续采样 6 秒，`Network.requestWillBeSent` 记录：

```text
GET /api/session 01a1cf29-7a73-7f73-acfe-1eed1d9e1b29
count=122
median=27 ms
max=34 ms
failures=0
```

即用户没有查看该运行中对话，页面仍约每秒读取它 20 次。另一次 15 秒采样记录 479 次 `/api/session`。

对应代码链路：

1. `usePageSnapshot` 把所有 `store.live` 中 active 的线程加入读取资格（`ui-feishu/src/usePageSnapshot.ts:68-78`）。
2. active 线程每轮都绕过“已观察且无变化”的短路。
3. 每个独立读取完成后递增 `wakeVersion`（`:145-157`），而 `wakeVersion` 是主 effect 依赖（`:170`），所以 effect 会再运行。
4. 返回的 session/status 又通过 `store.commit` 和 `setShown` 进入状态；`publish` 末尾还显式 `store.notify()`（`:101-130`）。
5. `store.commit` 更新会话并递增持久化版本（`conversationStore.ts:202-235`）；`usePageSnapshot` 的持久化 effect 依赖该版本（`ui-feishu/src/usePageSnapshot.ts:190-201`）。
6. 全局 `useSyncExternalStore` 使整页订阅者重渲染；`usePageSnapshot` 本身再重建 `display`、目录状态数组和当前快照（`:172-205`）。

这不是同步死循环，而是“网络完成 → commit/notify → effect 再调度 → 下一轮读取”的反馈链。服务器输出持续变化时，它近似轮询运行。

### 2.3 每次重渲染的共用前端成本

实际页面采样规模：

- 会话目录：189 个可见 `conversation-branch` / `contact-row`，DOM 共约 6,357 节点。
- 用户本地会话缓存：20 个正文记录、319 条消息。
- 本地浏览器 `localStorage` 中项目目录缓存约 `275,779` 字节。
- 本机会话版本索引：359 条有消息的会话、8,702 条消息索引记录，最多单线程 206 条消息。

共用路径：

- `FeishuApp` 顶层调用 `useProjectConversations()`，任何全局 store 通知都会重渲染整个 App（`ui-feishu/src/FeishuApp.tsx:42-45,194-202`）。
- `roster` 的 `useMemo` 依赖中包含每次重渲染都会新建的 `viewC.cachedSessions` Map，以及可能新建的 `viewC.session`，因此会反复重建完整目录和排序（`FeishuApp.tsx:132-149`）。
- `ConversationRows` 没有组件级 memo，每轮完整执行 189 行 JSX、时间格式化、预览和操作按钮构造（`ui-feishu/src/components/ConversationRows.tsx:15-39`）。
- `compactTime` 每次调用都会创建多个本地化日期输出；它是一个独立热点（`ui-feishu/src/presentation.ts:3-9`）。实测 189 行单轮：

| CPU 降速 | 当前 `compactTime` 中位数 | 复用 `Intl` 格式化器中位数 | 比例 |
| --- | ---: | ---: | ---: |
| 1x | 2.7 ms | 0.1 ms | 27x |
| 4x | 10.4 ms | 0.5 ms | 20.8x |
| 6x | 15.5 ms | 0.9 ms | 17.2x |

- `ConversationView` 每次 render 都重新遍历和排序消息、构建可见项（`ConversationView.tsx:214-258`）。
- `ContentRenderer` 对每条 Markdown 每次 render 都重新运行 `ReactMarkdown` + `remarkGfm`，没有 memo；插件数组也在 render 中创建（`ui-feishu/shared/features/conversations/rendering/ContentRenderer.tsx:180-188,245-247,287-321`）。
- 用真实结构调用实际 `ConversationView` 的服务端隔离渲染：68 条、约 12K 字符时中位约 `9.6 ms`；101 条约 `9.9 ms`。这是单线程 JS 解析成本，浏览器还要叠加 React commit、样式和布局；在长历史/代码块/图片场景会继续放大。

### 2.4 服务端同步与缓存成本

只读 HTTP 连续测试：

```text
GET /api/sessions?source=all
0.968 s / 0.895 s, 97,483 bytes, 200

GET /api/sessions?source=codex
0.892 s / 0.906 s, 97,483 bytes, 200

GET /api/project-directory
1.236 s / 1.228 s / 1.233 s, 497,813 bytes, 200

GET /api/session（当前运行对话）
冷/首轮约 28 ms，随后 19–39 ms；响应约 37–73 KB

GET /api/session（101 条旧对话）
冷约 204 ms；热约 23–33 ms；响应约 104 KB
```

链路：

- SSE 收到 `sessions_changed` 后，事件本身立即交给 `onEvent`；目录重新读取被 180 ms 去抖（`useConversationEvents.ts:122-171`）。
- `onSessionsChanged` 先通知正文刷新，再派发 `negus:directory-changed`，随后调用 `catalog.refreshSessions`（`useProjectConversations.ts:613-620`）。
- `useProjectDirectory` 监听同一事件，再请求完整项目目录（`shared/features/project-directory/hooks/useProjectDirectory.ts:15-28`）。
- `/api/sessions` 调用完整 `conversations.listSessions`，按供应商逐一读取/合并（`conversation-history-routes.mjs:156-188`；`conversation-service.mjs:149-163`；`provider-conversation-store.mjs:310-369`）。
- `/api/project-directory` 又调用 `conversations.listSessions`，并对员工主对话逐条调用 `findSession(..., { limit: 1 })`（`employee-project-directory.mjs:96-109,148-245,312-326`）。
- 输入/点击本身不会调用这些接口，但这些响应会在稍后同时落地，触发大对象替换和整页 render。请求为 0.9～1.2 秒时，用户感知会与“常约 1 秒”一致；若多个刷新波次及长渲染重叠，就会形成 3 秒级长尾。

另外，`usePageSnapshot` 的持久化 effect 在每次持久化版本变化时：

- 重建全部会话摘要；
- 把全部 `cachedSessions`、presentation 交给 `writeConversationSnapshot`；
- 在 `conversationSnapshot.ts:149-193` 中遍历所有缓存记录、为每条记录 `JSON.stringify` 比对，再排队写同一 IndexedDB。

本次浏览器中缓存为 20 条正文、319 条消息，但生产索引有 359 条有消息会话和 8,702 条消息；会话越多，这部分主线程与磁盘队列越重。它在首次乐观插入之后运行，不会直接阻止插入，却会持续拖慢输入、点击和后续内容更新。

## 3. “已插入但不可见”与“对象插入延迟”

### 已插入、可见延迟

普通末尾发送、未加载线程发送、新建 pending 线程后的首次 bubble 都属于这一类：对象在 `addMessage` 中同步进入 `localPending`，首个可见时间取决于：

- 点击事件何时获得主线程；
- 整页 React render/commit 何时完成；
- 是否撞上 active 线程轮询、目录请求、Markdown 重解析、快速连续 render；
- 浏览器首帧和样式/布局耗时。

这可由 store 已有 `optimistic-*`、但浏览器 Input 事件到首帧超过 2 秒的实测证明。发送接口并非必要条件。

### 插入本身延迟

以下路径确实在 `addMessage` 之前等待：

1. **编辑已有历史消息后重新发送**：`sendMessage` 先 `await conversationApi.revert(...)`，再清理/截断旧消息，最后才调用 `sendDirectMessage`（`useProjectConversations.ts:411-429`）。这一段 1～3 秒请求时，乐观气泡尚未插入。这是普通发送之外唯一明确的前置服务端等待。
2. **带图片/文件的发送**：先 `await draft.uploadAll()`，再执行 `onSend`（`ConversationComposer.tsx:260-274`）；上传期间没有消息气泡。
3. **快速连续发送且第一条仍在提交**：`submittingThreads` 在请求开始时加入线程，第二条 `sendDirectMessage` 在插入前直接返回 `false`（`useProjectConversations.ts:315-316`）。同时 `ConversationComposer.submittingRef` 到首条 `onSend` 完成后才释放（`:238,273,285`）。用户快速点第二下可能暂时看不到第二气泡，输入被恢复为草稿。
4. **新对话从 pending ID 迁移到真实 thread**：气泡先在 pending 线程同步出现，然后 `waitForThread` 返回真实 ID，代码先移除 pending 气泡再插入真实 thread（`:333-340`）。创建慢时可能出现一次重挂载/闪烁，但首个气泡并非等创建完成后才出现。

## 4. 场景对照

| 场景 | 用户操作 | 实际路径 | 首次气泡/可见结果 | 主要差异与证据 |
| --- | --- | --- | --- | --- |
| 空闲对话末尾发送 | 输入后点发送 | `submit → sendDirectMessage → addMessage`，然后模型/消息请求 | 插入先于请求；无拥挤时约 44 ms 首帧 | `useProjectConversations.ts:312-325`；隔离生产构建测得 |
| 任意后台对话运行中，再在当前空闲对话发送 | 当前页输入并发送 | 仍是直接发送，但共享 store 每轮刷新整页 | 对象立即插入，可见时间受全页长任务影响 | 6 秒内 122 次后台 `/api/session`，约 20 次/秒；输入曾 2,176 ms 才到下一帧 |
| 当前任务运行中继续输入 | 运行中输入并发送 | `submit → onQueue → waitForThread → followUpQueue.enqueue` | 先进入“等候中”队列气泡；派发后才进入正式时间线 | `ConversationComposer.tsx:272-274`；`useProjectConversations.ts:500-507`；`useFollowUpQueue.ts:49-60` |
| 编辑历史消息后重发 | 点历史用户消息编辑，再发送 | 先 `await conversationApi.revert`，再 `sendDirectMessage` | 乐观气泡等 revert 返回后才出现 | 明确的网络前置；`useProjectConversations.ts:411-429` |
| 线程尚未加载 | 打开未加载线程后立即输入发送 | 现有真实线程直接写入 local pending；不等待历史加载完成 | 可先看到气泡，历史读取完成后按 submission ID 合并 | `ConversationStore.get` 合并 pending（`:119-128`）；`mergeSessionRefresh` 保留未确认乐观项（`conversationMerge.ts:94-116`） |
| 新建 pending 线程发送 | 新建对话后立即发送 | pending ID 下先插入，`waitForThread` 后迁移到真实 thread | 先可见；创建慢时迁移可能造成短暂重挂载/闪烁 | `useProjectConversations.ts:333-340` |
| 切换对话后立即发送 | 从 A 切到 B，输入并发送 | 新 `selectedId`/`composerKey` 下走正常发送；共享流式事件仍可占主线程 | 数据已就绪时直接插入；后台刷新拥挤时可见延后 | `ChatWorkspace.tsx:46-48,155-164`；全局 store 重渲染 |
| 连续快速发送 | 第一条发送后马上再点发送 | 首条提交期间第二条被 `submittingThreads` 拒绝，不创建气泡；首条 accepted 后后续消息才走队列 | 第二下看起来没反应，需再发或等状态变化 | `useProjectConversations.ts:315-316`；`ConversationComposer.tsx:238,273-285` |
| 图片/文件发送 | 选附件后发送 | 先上传附件，再进入乐观消息创建 | 上传完成前没有气泡 | `ConversationComposer.tsx:260-274` |
| SSE 重连/事件缺口 | 网络切换、页面恢复、隧道断线 | 恢复会刷新正文并刷新目录 | 已有页面继续显示旧内容，恢复后的多个大请求和 render 可能造成长卡顿 | `useConversationEvents.ts:80-90,136-145,179-220`；`useProjectConversations.ts:743-760` |

## 5. 常态 1 秒与长尾 3 秒的触发条件

### 常态约 1 秒

- 至少一条非当前对话处于 `active`，后台模型持续产生 `item/completed`、状态或 context 变化。
- `usePageSnapshot` 将活跃线程持续列入读取资格，读完后递增 `wakeVersion`；实测约 20 次 `/api/session`/秒。
- 每次响应都触发 store 通知和根组件重渲染；189 行目录的日期格式化、目录重建、当前 Markdown 重解析共同占据主线程。
- `sessions_changed` 到来时，页面还会并行刷新约 0.9 秒的 `/api/sessions` 和约 1.23 秒的 `/api/project-directory`，其返回又引发状态替换。
- 所以发送对象可能在几毫秒内插入，用户却会在下一个可绘制帧才看到约 1 秒后的结果。

### 约 3 秒长尾

同一后台更新链连续叠加、或属于下列条件时，长尾会超过 1 秒：

- 多个 active 会话同时更新；每个 active 线程都可进入正文读取候选。
- 长对话、较多 Markdown/代码块、较多执行活动（当前运行状态曾携带 72 条 activity）导致单次 render 变大。
- 切换回/打开 68～206 条历史消息的会话，完整解析与消息 DOM 更多。
- SSE 重连、事件缺口、页面从后台恢复，同时触发正文恢复与目录刷新。
- 历史中编辑后重新发送，额外等待一次 `/api/revert`；或媒体发送额外等待上传。
- 首次打开或浏览器冷启动同时进行首屏同步、目录生成、缓存恢复与 IndexedDB 写入。
- 手机、远程隧道、低性能浏览器让相同 JS 工作从几十毫秒放大到数百毫秒；6x CPU 节流实测出现连续 2.156 秒和 4.405 秒长任务。

波动本身来自**调度碰撞**：点击、输入和乐观 commit 都是主线程任务；后台轮询、目录刷新、Markdown 和缓存序列化也是主线程任务。前一任务何时结束决定这次点击等待十几毫秒、约一秒还是数秒。

## 6. 线上版本与工作区对照

### 当前实际服务

- 后端 supervisor 当前 active release：`1794475480957-705e25f4`，2026-11-12 17:25:08 CST 启动。
- 实际后端进程参数 `--web-root /Users/hans/myproject/negus/ui-feishu/dist`。
- HTTP `/version.json` 返回 `feishu-mwdcdbzj`，构建时间 `2026-11-12T09:24:43.817Z`（17:24:43 CST）。
- workspace 与 active release 中的 `index-B8jOeI9l.js` SHA-256 均为 `d8448be82a1eb72af2561cece5e512b3dccd71468871f4138926e274f1922a1c`；CSS 哈希也一致。

### 上一份已记录发布快照

- `runtime/frontend-release.json` 仍记录 `feishu-mwc02n0u`，2026-11-11 18:52:43 CST。
- 对应 `runtime/frontend-build-1794394360451/assets/index-DAbUdfLN.js`。
- 将旧 bundle 中 `feishu-mwc02n0u`、旧 browser chunk 名替换为当前值后，与当前主 bundle 逐字节相同，SHA-256 同为 `d8448be8…22a1c`。
- CSS 文件哈希完全相同。懒加载 browser chunk 除第一行对主 bundle 的 import 名外内容一致。
- 因此旧记录快照和当前工作区在本次相关的发送、store、目录和渲染代码上相同；该问题不是近期分支差异造成。

### 后端

当前 active release 与工作区以下文件哈希逐一相同：

- `windows/server/routes/conversation-history-routes.mjs`
- `windows/server/conversation-service.mjs`
- `windows/server/provider-conversation-store.mjs`
- `windows/server/employee-project-directory.mjs`
- `windows/server/execution-tracker.mjs`

前端的 `ConversationRows.tsx`、`usePageSnapshot.ts`、`presentation.ts`、`ConversationView.tsx` 等本次相关文件相对 HEAD 无工作区差异，因此当前实际构建包含上述相同慢路径。

## 7. 最小修复优先级（本轮未实施）

### P0：先切断活动线程的高频正文读取与全页通知

建议文件及预计改动：

- `ui-feishu/src/usePageSnapshot.ts`：约修改 12–20 行。
- `ui-feishu/shared/features/conversations/realtime/useConversationEvents.ts`：约修改 5–12 行。
- 必要时 `ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts`：约修改 5–10 行。

最小方向：

- 非当前 active 线程只用 SSE 的 execution/status 更新目录状态；正文只在转入终态、明确 dirty、恢复/重连或低频兜底时读取，避免每个 `wakeVersion` 立即再拉一次。
- 对 progress 事件进行帧级合并；`sessions_changed` 的目录读取继续去抖，并禁止上一轮尚未完成时重复启动相同刷新。
- 将远程 store 更新与本地乐观更新分层：本地 `addMessage` 保持同步立即提交；远程非当前线程更新不应强制整页同步 lane。

预期用户变化：

- 当前页空闲或阅读历史时，不再因后台任务持续刷新而“整页慢半拍”。
- 点击发送到乐观气泡的目标是稳定在单帧到数帧；具体毫秒仍需实施后验证。

风险：

- 非当前对话的列表摘要会从“准实时”变为终态/短延迟更新；必须保留 SSE 运行指示和终态补读。
- 事件合并必须保持 `eventSeq` 顺序、当前轮隔离和重连恢复，不能丢掉终态或附件事件。

### P1：削减每次全页 render 的实际工作量

建议文件及预计改动：

- `ui-feishu/src/presentation.ts`：约 +6/-3 行，复用已缓存的格式化器或直接格式化日期，消除 189 行每次重复构造本地化日期输出。
- `ui-feishu/shared/features/conversations/rendering/ContentRenderer.tsx`：约 +3/-1 行，按消息对象 memo 化 Markdown 渲染；先确认所有更新都会替换消息对象或显式失效。
- `ui-feishu/src/components/ConversationRows.tsx`：约 +15/-10 行，按行 memo 或使用稳定行模型，避免非相关 store 事件重算所有行。
- `ui-feishu/src/FeishuApp.tsx`：约 +10/-5 行，稳定 `roster` 依赖，避免新 Map/同一 session 引用触发全量目录重建。

预期用户变化：

- 运行中查看其他对话时，列表和当前消息不再每轮全部重新解析；输入和点击保持响应。

风险：

- 比较器漏掉状态、标题、时间或归档字段会显示旧行；日期跨午夜缓存必须失效。
- memo 的 key 必须继续使用 `submissionId`，不能破坏乐观/正式消息原位交接。

### P2：把全量目录与缓存写盘改成增量和空闲执行

建议文件及预计改动：

- `windows/server/employee-project-directory.mjs`、`windows/server/routes/conversation-history-routes.mjs`：约 20–50 行，复用一次性聚合或在事件后短窗口内共享结果；避免目录接口再次完整扫描会话列表。
- `ui-feishu/src/usePageSnapshot.ts` + `ui-feishu/shared/features/conversations/data/conversationSnapshot.ts`：约 20–40 行，将全量快照写入合并到 idle/短去抖，并在流式期间只保存变化记录；终态、切换和卸载前强制 flush。

预期用户变化：

- `/api/sessions` 的约 0.9 秒和 `/api/project-directory` 的约 1.23 秒不再每波占住服务与浏览器；长尾明显收敛。

风险：

- 服务端短缓存必须按变更线程及时失效，否则状态/摘要陈旧。
- 延迟缓存写入可能丢失最后几毫秒状态，必须有终态和退出 flush；不能牺牲既有“已有缓存先显示”规则。

### P3：修正发送场景本身的特殊等待

建议文件及预计改动：

- 历史编辑重发：`useProjectConversations.ts` 约 8–20 行，先显示明确的“准备重发”乐观态，revert 失败时撤回并恢复输入。
- 快速连续发送：`ConversationComposer.tsx` 与 `useProjectConversations.ts` 约 8–20 行，首条提交期间将第二条纳入本地等候队列，或至少明确禁用发送按钮，避免静默拒绝。

预期用户变化：

- 历史中重发在点击后立即有可见反馈，不再等 revert。
- 快速连点不会再出现“第二下没反应”。

风险：

- 过早显示重发气泡会让用户误以为历史截断已经成功；失败必须无歧义回滚。
- 连发转队列必须沿用现有 `submissionId`、幂等和派发顺序，避免重复发送。

## 8. 证据与限制

临时夹具和测量脚本均在 `/tmp/negus-optimistic-fixture/`：

- `measure-live.mjs`：实际页面点击和输入延时。
- `measure-send-isolated.mjs`：实际构建中拦截所有非 GET API，测量乐观气泡 DOM。
- `measure-fixture.mjs`：实际 `ConversationView` 的隔离浏览器渲染。
- `network-rate.mjs`：实际页面的 `/api/session` 请求频率。
- `profile-live.mjs`：CPU profile 与 long task 采样。
- `bench-time.mjs`：189 行日期格式化对照。

真实用户设备无法直接复现，因为本轮不能操作用户当前浏览器、不能发真实消息，也不能停止当前后台任务。使用了真实构建、真实只读数据和 CDP 输入；6 倍 CPU 降速是压力代理，不等同于用户设备的绝对耗时。未降速的高性能主机没有复现出秒级长任务，说明慢、快两端受设备、后台任务和消息/目录规模决定。普通发送接口、媒体上传、SSE 重连和历史编辑的端到端网络时延未通过真实写请求测量；这些场景由代码调用顺序和只读接口数据界定。

本轮没有修改业务代码，没有发布、重启或提交。报告仅为只读排查结论。
