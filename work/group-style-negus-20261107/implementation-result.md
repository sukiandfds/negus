# 群聊消息区与输入框样式复用实施结果（2026-11-07）

## 范围与基线

- 分支：`develop`
- HEAD：`d10e477260faf272fe1deca42f35a282889d07e1`
- 需求依据：`docs/project-management/items/FEAT-002/item.md`、`FEAT-002/updates.md`
- 工作区原有未提交改动全部保留；未发布前端、未重启后端、未提交或推送。
- `ConversationView.tsx` 与 `JumpToLatest/useReturnToBottom.ts` 无工作区差异；首次定位、底部跟随、历史位置恢复及测量逻辑未改。

## 实际改动文件

- `ui-feishu/shared/features/group-chat/components/MessageTimeline.tsx`
- `ui-feishu/shared/features/group-chat/components/MessageTimeline.module.css`
- `ui-feishu/shared/features/group-chat/components/GroupComposer.tsx`
- `ui-feishu/shared/features/group-chat/components/GroupComposer.module.css`
- `ui-feishu/shared/features/group-chat/hooks/useGroupRoom.ts`
- `ui-feishu/shared/features/group-chat/realtime/useGroupEvents.ts`
- `ui-feishu/shared/features/group-chat/model/types.ts`
- `ui-feishu/src/ChatSkin.tsx`
- `ui-feishu/src/components/GroupWorkspace.tsx`
- `ui-feishu/validation/group-visual.fixture.tsx`
- `ui-feishu/validation/group-visual.test.mjs`
- `docs/project-management/items/FEAT-002/item.md`
- `docs/project-management/items/FEAT-002/updates.md`

删除：

- `ui-feishu/shared/features/group-chat/components/MemberProfileDrawer.tsx`
- `ui-feishu/shared/features/group-chat/components/MemberProfileDrawer.module.css`
- `ui-feishu/shared/features/group-chat/components/MentionMenu.tsx`
- `ui-feishu/shared/features/group-chat/components/MentionMenu.module.css`

任务相关前端代码相对 HEAD 的差异为 `+197/-1010`，净删 813 行；该统计包含工作区此前已完成的同需求样式改动。

## 实际复用

- 群消息先做最少的 `GroupMessage -> SessionMessage` 数据映射，然后直接渲染 `ConversationView.tsx` 导出的普通对话 `Message`。
- 正文、Markdown、图片、音视频和文件由普通消息内部的 `ContentRenderer` 显示。
- 消息操作由普通消息内部的 `MessageActions` 显示。
- Agent 运行状态通过普通 `Message.executionStatus` 交给 `ExecutionTimeline`，不再使用群聊自行包装。
- 消息布局、署名、时间、左右头像、气泡、正文和操作区由 `ConversationView.module.css` 与 `ChatSkin` 的同一套普通对话类名负责。
- 群滚动容器、回到底部和空状态通过 `composes` 复用 `ConversationView.module.css` 的 `scrollArea/jumpToLatest/state`。
- 输入框直接使用 `ConversationComposer.module.css` 的 `positioner/composer/footer/leadingControls/commandButton/spacer/sendButton/srOnly` 类名。
- 输入框继续直接复用 `AttachmentButton`、`AttachmentPreviews`、`SlashCommandMenu`、`QuoteDraft`、`useAttachmentDraft` 和 `useDismissibleLayer` 对应的现有能力。
- 群消息仍保留真实外层滚动节点、`data-message-id`、群历史游标和 `JumpToLatest` 连接，避免改变受保护滚动行为。

## 删除内容

- 员工胶囊条、在线状态、日期分隔、“点名了……”提示、排队汇总和员工头像详情入口。
- 群聊自绘的消息外壳、元信息、气泡、正文、Markdown、流式文本和消息操作 CSS。
- 群聊临时 `GroupExecution` 包装、引用块、Agent/发送失败重试按钮和独立产物审查区。
- 输入框的点名人员按钮与弹层、上下文提示按钮与弹层、点名回复提示，以及对应状态和菜单组件。
- 输入框复制到 `GroupComposer.module.css` 的 textarea、footer、按钮、发送按钮和移动端布局规则。
- `ChatSkin` 中对普通/群聊消息和输入框并联的群聊选择器。
- 仅由上述删除入口使用的 `MemberProfileDrawer`、`MentionMenu`、`retrySend` 和群 Artifact 实时事件状态。
- 底层 `@Agent` 文本语义、发送、附件和历史加载仍保留；只能通过普通文本输入使用。

## 验证

1. `pnpm --dir ui-feishu build`
   - 结果：失败，未进入 TypeScript 或 Vite 编译。
   - 原因：`ERR_PNPM_IGNORED_BUILDS: sharp@0.34.5`，`pnpm` 在执行项目脚本前被已有依赖脚本策略拦截。
2. `ui-feishu/node_modules/.bin/tsc -p ui-feishu/tsconfig.json && ui-feishu/node_modules/.bin/vite build --config ui-feishu/vite.config.ts`
   - 结果：通过。
   - TypeScript 无错误；Vite 转换 2130 个模块并生成生产产物。
   - 仅有既有 `@tiptap/react` 的 `"use client"` 忽略提示和大于 500 kB 的 chunk 提示。
3. `git diff --check`
   - 结果：通过。
4. `git diff --quiet -- ui-feishu/shared/features/conversations/components/ConversationView.tsx ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts`
   - 结果：通过，两个受保护文件无差异。

按“最多运行一次最相关测试/构建”要求，未启动浏览器验证服务，也未执行 `group-visual.test.mjs`。

## 剩余风险

- 未运行真实浏览器视觉对照；桌面/手机截图和最终像素验收仍待审核者执行。现有视觉夹具已改为比较普通/群聊消息文章类名、用户气泡和输入框外壳类名。
- 普通对话只有“用户/助手”两种消息形态；其他真人成员、系统消息在群聊中会折叠为助手样式，这是删除群聊专用展示后的预期限制。
- 引用原消息仍可作为输入内容发送，但点击消息操作中的“引用”后不会再出现群聊专属回复块或定位入口。
- Agent 失败重试按钮和独立产物审查区已从消息区移除；底层数据和接口未删除。
- 工作区仍有其他任务或既有未提交改动；最终提交需要按文件归属整理，本任务未提交。
