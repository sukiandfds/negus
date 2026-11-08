# 群聊样式对齐方案审核与验收（2026-11-07）

## 范围与边界

- 角色：独立只读审核与验收；不修改业务代码，不发布，不重启，不提交或推送。
- 分支与基线：`develop`，HEAD `d10e477260faf272fe1deca42f35a282889d07e1`，跟踪 `origin/develop`。
- 需求依据：[FEAT-002 item](../../docs/project-management/items/FEAT-002/item.md)、[FEAT-002 updates](../../docs/project-management/items/FEAT-002/updates.md)、[AGENTS.md](../../AGENTS.md) 与 [AI 助手工作规则](../../AI_ASSISTANT_WORK_RULES.md#需求原话与澄清2026-10-30)。
- 用户本轮有效要求：群聊先做一套与普通对话、后台任务一致的样式并直接复用；不考虑群聊短期可用性；普通样式没有的群聊专用功能应删除；最小代码修改；不做过多验证；审核方检查方案并对照实现验收。
- 保护边界：不修改 `ConversationView.tsx` 的首次定位、底部跟随、历史阅读位置恢复和测量逻辑；不修改 `JumpToLatest/useReturnToBottom.ts` 涉及的上述行为。当前工作区这两个文件无差异。
- 已有未提交改动全部保留。本审核只新增本文档。

## 验收结论

**问题结论：视觉核心已接近目标，但“直接复用、删除群专用代码”尚未完全满足，需最小修复后再验收。**

实现已有真实复用，不应概括为“只合并选择器”：`MessageTimeline` 直接使用共享的 `ContentRenderer`、`ExecutionTimeline`、`MessageActions`、`JumpToLatest` 和时间格式化；`GroupComposer` 使用共享附件组件、能力菜单、引用组件；`ChatSkin` 统一了两种页面的大量外观。

但消息行外壳仍由 `MessageTimeline` 自行拼装，`ChatSkin` 又通过普通/群聊选择器并联补齐头像、元信息、气泡和操作区。这只能证明视觉结果接近，不能证明群聊直接使用普通对话的消息组件。输入框外壳也有大段从 `ConversationComposer.module.css` 复制的结构规则，并保留普通输入框没有的点名按钮、上下文文字入口和回复提示。

现有截图 `/tmp/negus-group-group-desktop.png`、`/tmp/negus-group-background-desktop.png`、`/tmp/negus-group-group-mobile.png`、`/tmp/negus-group-background-mobile.png` 显示用户气泡、头像、署名、时间和左右位置已基本一致；现有群聊视觉测试也只比较用户气泡，并检查头像、本人对齐和运行状态是否在气泡外，不能替代对组件和 CSS 复用方式的验收。

## 用户现在看到什么，目标是什么

| 区域 | 改动前 / 当前用户可见现象 | 审核目标 |
| --- | --- | --- |
| 消息列表 | 员工胶囊条、日期分隔、“点名了……”、排队汇总等群聊专用视觉；当前实现已删除这些项 | 只保留普通对话的时间顺序消息列表，不出现群聊额外装饰 |
| 单条消息 | 当前实现已有左右头像、署名、时间、用户蓝色气泡和 Agent 深色气泡；但仍由群聊消息行自行组装 | 普通对话与群聊使用同一个消息行组件，群聊只做数据映射 |
| 正文和附件 | 已复用 `ContentRenderer`，Markdown、图片、音视频和文件外观一致 | 继续直接使用，不再保留群聊 Markdown/附件样式副本 |
| 运行状态 | 已直接使用 `ExecutionTimeline`，不再包在消息气泡内 | 由普通消息组件按其现有位置承载，删除群聊临时包装层 |
| 输入框 | 外壳已接近普通对话，但仍显示群聊专属 `@` 按钮、“上下文”文字入口、点名回复提示等，并有复制 CSS | 主输入外壳和底部控件样式直接使用普通对话 CSS 类；删除普通对话没有的群聊视觉入口 |
| 群聊页外壳 | 已复用 `ChatHeader`、`chat-primary`、`chat-messages`、`chat-composer` | 保持现状；仅清理不再使用的群聊状态和参数 |

## 普通对话与群聊的实际链路

普通消息链路：

`ConversationView` 排序和分页 → 导出组件 `Message` → 署名/时间/气泡外壳 → `ContentRenderer` / `MessageActions` / `ExecutionTimeline` → `ConversationView.module.css` → `ChatSkin`

群聊现状链路：

`useGroupRoom` 快照与群序列分页 → `MessageTimeline` → 自行绘制 `article/messageContent/messageMeta/messageBubble/messageActions` → 内层复用 `ContentRenderer` / 部分 `ExecutionTimeline` / `MessageActions` → `MessageTimeline.module.css` 的 `composes` → `ChatSkin` 将普通与群聊选择器并联

断点位于消息外壳：内层渲染已共享，外层仍有两套实现和两套选择器。

普通输入链路：

`ConversationComposer` 状态和交互 → `ConversationComposer.module.css` 的 `positioner/composer/textarea/footer/button` → 共享附件、能力、模型、上下文控制 → `ChatSkin`

群聊输入现状链路：

`GroupComposer` 群聊状态和交互 → 仅 `composerArea`、`composer` 通过 `composes` 复用普通外壳，`textarea/footer/commandButton/sendButton` 等仍复制规则 → 群聊专属点名、上下文、回复提示 → `ChatSkin` 并联选择器

## 最小可执行复用方案

### 1. 消息行改为直接使用普通对话组件

只修改 `MessageTimeline.tsx`、`MessageTimeline.module.css` 和必要的 `GroupWorkspace.tsx` 数据传参：

1. 从 `ConversationView.tsx` 导入已导出的 `Message` 组件；不再修改 `ConversationView.tsx`。
2. 在群聊数据边界将 `GroupMessage` 映射成 `SessionMessage`：本人消息映射为 `user`，Agent、其他成员和系统消息映射为 `assistant`；保留 `authorName`、`createdAt`、`text`，附件映射成 `ContentBlock`。
3. 将普通消息的操作按钮参数直接传给 `Message` 已有的 `MessageActions` 链路；Agent 运行中直接传 `executionStatus`，删除 `GroupExecution` 包装。
4. `MessageTimeline` 只保留真实群聊差异所需的外层滚动容器、群历史游标、空状态和 `JumpToLatest` 连接；不得改动受保护的首次定位、底部跟随、历史位置恢复和测量逻辑。
5. 删除群聊自绘的消息行 CSS、元信息、气泡、操作区和文本样式；不得继续用普通/群聊选择器并联来模拟组件复用。

这是本任务的主要阻塞项，也是最小方案中唯一需要改变 DOM 结构的改动。

### 2. 输入框直接复用普通对话的结构 CSS

`GroupComposer` 继续独立持有群聊发送状态是必要的，但表现层按以下方式收缩：

1. 直接导入 `ConversationComposer.module.css`，让 `.composerArea`、`.composer`、`.footer`、`.leadingControls`、`.settingsControls`、`.commandButton`、`.sendButton`、`.spacer` 等使用同一批类名，或使用只做别名转发、不复制声明的 `composes`。
2. 删除 `GroupComposer.module.css` 中重复的 textarea、footer、按钮、发送按钮和移动端网格规则；只保留群聊专属弹层定位与确实无法映射的少量规则。
3. 删除普通输入框没有的第二个 `@` 按钮、“上下文”文字入口和输入框上方的点名回复提示。`@Agent` 仍可作为普通文本输入，服务端语义不需要删除。
4. 附件、能力菜单、引用、上传取消和停止按钮继续使用现有共享组件；不新增群聊专用视觉。

### 3. `ChatSkin` 只修饰共享类名

完成上面两步后，群聊 DOM 已带有普通消息和普通输入框的类名。`ChatSkin` 只保留一套共享类名规则，删除针对群聊消息行、群聊输入框的头像、气泡、元信息、操作区和尺寸补偿分支。尤其删除已失效的 `.markdown`、`.messageMeta strong` 等群聊选择器。

这一步不是继续“合并选择器”，而是移除在直接复用完成后已无必要的群聊外观实现。

## 必须直接复用的组件与样式

| 能力 | 权威实现 | 群聊处理 |
| --- | --- | --- |
| 普通消息外壳 | `ConversationView.tsx` 导出的 `Message` | 直接导入；群聊仅映射数据 |
| 正文、Markdown、图片和附件 | `ContentRenderer` / `MarkdownContent` | 通过 `Message` 使用，删除群聊正文 CSS 副本 |
| 消息操作 | `MessageActions` | 通过 `Message` 或同一实例使用 |
| 执行状态 | `ExecutionTimeline` | 通过 `Message.executionStatus` 使用 |
| 消息布局 CSS | `ConversationView.module.css` | 随 `Message` 生效，不再并联群聊消息选择器 |
| 输入外壳 CSS | `ConversationComposer.module.css` | 直接导入同一类名，删除复制声明 |
| 附件、能力、引用 | `AttachmentDraft`、`SlashCommandMenu`、`QuoteDraft` | 保持直接复用 |
| 页面容器 | `ChatHeader`、`chat-primary`、`chat-messages`、`chat-composer` | 保持直接复用 |
| 日期格式与头像颜色 | `formatConversationTimestamp`、`avatarColor` | 保持单份实现 |

## 应删除的群聊专用逻辑

当前实现已正确删除：

- 员工胶囊条及 `agentPresence`、`onMentionAgent`。
- 日期分隔及 `formatDayLabel`、`localDateKey` 的群聊消息分组。
- “点名了……”和居中排队汇总。
- 运行状态外层的群聊消息气泡包装。

审核要求继续删除：

- 群聊自绘的消息行、元信息、气泡、操作区、Markdown 和流式文本 CSS。
- `GroupExecution` 临时包装；改由普通 `Message` 的 `executionStatus` 驱动 `ExecutionTimeline`。
- 普通消息没有的引用块、重试按钮、产物评审、消息作者详情入口等群聊专用展示；保留对应底层数据不影响本轮样式验收，但不继续在消息行复制 UI。
- 群聊输入框第二个点名按钮、“上下文”文字弹层、输入框上方回复提示及对应状态。
- `GroupComposer.module.css` 中与普通输入框重复的结构 CSS。
- `ChatSkin` 中已失效或只为群聊补丁存在的选择器。

不应删除：

- 群数据游标、历史加载、`JumpToLatest` 和底部跟随连接。它们不制造普通对话没有的视觉，且属于受保护行为。
- 群发送、附件和停止的真实底层能力；只移除额外视觉入口。

## 对当前实现问题的判定

1. **未通过：消息组件没有直接复用。** `MessageTimeline` 仍自定义消息外壳，`ChatSkin` 是选择器并联。现有截图测试只验证像素和少数组件位置，不能证明组件共享。
2. **未通过：输入框结构 CSS 仍重复。** `GroupComposer.module.css` 复制了 textarea、footer、按钮、发送按钮和移动端布局；这违背最小修改和直接复用。
3. **未通过：仍保留群聊专属输入视觉。** `@` 按钮、上下文文字入口和回复提示不在普通输入框中，按用户澄清应删除。
4. **需要清理：失效选择器。** `MessageTimeline.module.css` 已没有 `.markdown`、`.systemMessage`，`ChatSkin` 和 `MessageTimeline.tsx` 仍引用 `group.markdown` / `styles.systemMessage`，会生成 `undefined` 类名或无效果规则。

上述问题的修复不需要改动 `ConversationView.tsx`、`useReturnToBottom.ts` 或普通消息的分页、定位、跟随和测量逻辑。

## 关键检查与证据

- 已读源码：`ConversationView.tsx`、`ConversationComposer.tsx`、两者 CSS、`MessageTimeline.tsx`、`MessageTimeline.module.css`、`GroupComposer.tsx`、`GroupComposer.module.css`、`GroupWorkspace.tsx`、`ChatSkin.tsx`、`MessageActions`、`ContentRenderer`。
- 已查看现有证据：桌面与手机群聊/普通对话对比截图各两张。
- 当前源码差异中，群聊样式相关业务改动为 `MessageTimeline` +45/-79、`MessageTimeline.module.css` +11/-34、`GroupWorkspace` +2/-3、`ChatSkin` +8/-9、`GroupComposer.module.css` +1/-1；新增共享头像颜色模块。
- 受保护文件 `ConversationView.tsx`、`JumpToLatest/useReturnToBottom.ts` 均无工作区差异。
- 只计划运行一次最相关关键检查：群聊视觉测试。其结果见下方“单次检查结果”。

## 单次检查结果

待执行。

## 风险

- 将 `GroupMessage` 映射为 `SessionMessage` 后，普通对话只区分用户和助手，其他真人成员、系统消息的视觉语义会折叠；这是允许删除群专用功能的直接结果，应明确告知用户。
- 归档、引用、产物评审和重试等群功能若从消息行移除，短期群操作能力会下降；用户已明确本轮优先样式一致，不等于长期删除底层数据。
- 群历史分页、消息定位和底部跟随依赖现有 DOM 的 `data-message-id` 与外层滚动节点。改为 `Message` 时必须保留这些连接，且不可为对齐样式触碰受保护行为。
- 现有视觉夹具覆盖范围有限。只补一条能区分“直接复用类名/组件”的断言，避免把截图相等误当作实现方式相等。
- 工作区同时包含群菜单、归档 API 与其他任务的未提交改动，最终提交必须按文件归属单独整理，不能整包归入样式任务。

## 快速只读复核：群聊更多菜单同步

该附加复核同样只读，不发布、不重启、不运行测试。结论为“有问题”：

- 归档当前群聊后，[FeishuApp.tsx](../../ui-feishu/src/FeishuApp.tsx:190) 仅清空 `roomId`；`legacyGroup` 仍为真，[回退 effect](../../ui-feishu/src/FeishuApp.tsx:99) 会把 `groups.rooms[0]` 重新打开，且没有过滤已归档群。URL 还会保留 `view=group&roomId=...`，刷新可重新进入；手机布局状态也未复位。最小修复是归档当前房间成功后统一清理路由、关闭群回退并回到列表，回退只允许活动群。
- [group-extension.mjs](../../ui-feishu/server/group-extension.mjs:73) 对 `name: null` 会保存成 `"null"`，对 `archived: "false"` 会转成 `true`；非对象请求体也可能在 [路由](../../ui-feishu/server/group-extension.mjs:93) 抛 500。最小修复是严格校验对象、可选名称必须为字符串、可选归档状态必须为布尔值。
- [ConversationActions.tsx](../../ui-feishu/src/components/ConversationActions.tsx:12) 的 `onArchive` 没有异步返回类型，[点击](../../ui-feishu/src/components/ConversationActions.tsx:118) 不等待；调用方又用 `void` 丢弃 Promise，群归档失败时没有可见反馈。最小修复是等待回调并展示失败。
- 归档群仍可从归档列表打开，[GroupWorkspace.tsx](../../ui-feishu/src/components/GroupWorkspace.tsx:25) 没有使用 `room.archived` 限制发送。归档若表示不可继续使用，需要最小禁用输入；若只表示隐藏，必须明确记录此语义。
- [ConversationList.tsx](../../ui-feishu/src/components/ConversationList.tsx:49) 只有在“全部/后台”筛选传入置顶回调，项目筛选中的普通对话和群聊都没有置顶。两者一致，不是群聊单独缺口；只有产品要求项目筛选也置顶时才补。
- 群聊复制 ID 使用 `roomId: ...` 合理；群聊没有普通对话的 `threadId`。转发和“复制当前对话”已隐藏，应登记为待产品定义的剩余能力，不能宣称已完全同步。
- 菜单复用、可见项和定位方式总体合理。持久化串行写入没有明显并发覆盖错误，但现有测试没有在 PATCH 后重新加载目录验证恢复；最小补测为“改名并归档后重建目录再断言”。
