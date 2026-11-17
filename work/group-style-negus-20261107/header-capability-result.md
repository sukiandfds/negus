# 群聊页头能力与技能面板修复结果（2026-11-07）

## 基线与边界

- 工作目录：`/Users/hans/myproject/negus`
- 分支：`develop`
- HEAD：`d10e477260faf272fe1deca42f35a282889d07e1`
- 需求依据：`docs/project-management/items/FEAT-002/item.md`、`docs/project-management/items/FEAT-002/updates.md`
- 保留工作区全部既有未提交改动。
- `ConversationView.tsx`、`JumpToLatest/useReturnToBottom.ts` 及对话滚动、首次定位、历史恢复逻辑均未修改。
- 未发布前端、未重启后端、未提交或推送。

## Diff

本轮直接改动：

- `ui-feishu/shared/features/group-chat/components/GroupComposer.tsx`
  - `SlashCommandMenu` 原无条件渲染，现包在 `capabilityOpen` 条件内。
  - 初始状态保持 `capabilityOpen=false`。
  - 现有能力按钮切换、选择命令后关闭、`useDismissibleLayer` 的点击外部关闭和 Escape 关闭逻辑全部保留。
- `ui-feishu/src/components/GroupWorkspace.tsx`
  - 通过 `ChatHeader.actions` 增加分享、重命名、详情三个同顺序 `icon-button`。
  - 增加与普通对话相同的 `rename-bar` 内联表单，保存调用 `onRename(name)`。
  - 页头名称优先使用父级已更新的 `room.name`，避免群快照暂时落后导致重命名成功后标题仍显示旧值。
  - 增加 `GroupDetails`，复用 `detail-panel/profile-card/detail-stats`，展示真实群名、所属项目、Agent 数、成员数和当前消息数，并提供关闭按钮。
  - 内容区改为普通对话相同的 `chat-content-row + chat-primary` 结构，使右侧详情面板使用既有布局。
- `ui-feishu/src/FeishuApp.tsx`
  - 解析当前 `groupRoom`，群聊页头把 `groups.update(roomId,{name})` 作为真实重命名回调。
  - 分享按钮打开现有 `ShareConversationDialog`；群聊状态下标题使用 `groupRoom.name`，标题栏文案为“分享当前群聊”。
  - 分享弹窗继续使用当前浏览器 URL；进入群聊时 URL 已包含 `view=group&roomId=<roomId>`，因此分享链接对应当前群聊。
- `ui-feishu/validation/group-workspace.fixture.tsx`
  - 为新增的必要回调补充类型正确的空实现，保持现有夹具可构建。
- `docs/project-management/items/FEAT-002/item.md`
- `docs/project-management/items/FEAT-002/updates.md`

可用 diff 命令：

```text
git diff -- ui-feishu/shared/features/group-chat/components/GroupComposer.tsx ui-feishu/src/components/GroupWorkspace.tsx ui-feishu/src/FeishuApp.tsx ui-feishu/validation/group-workspace.fixture.tsx
```

注意：上述文件同时包含此前尚未提交的群聊样式改动，diff 不会只显示本轮页头修复。

## 用户可见行为

1. 首次进入群聊时，技能面板不再出现在输入框上方；点击底部闪光按钮才展开。
2. 技能面板可再次点击按钮收起；点击面板外或按 Escape 关闭；选择命令后关闭。
3. 群聊标题右侧按普通对话顺序显示分享、重命名、详情图标。
4. 分享打开现有二维码与链接弹窗，标题显示当前群名，链接保留当前群聊路由。
5. 重命名打开与普通对话相同的内联表单；保存调用群聊 `PATCH /api/group/rooms`，成功后 `groups.rooms` 更新并驱动页头和列表标题刷新；空名称禁用保存，失败时保留表单并显示错误。
6. 详情在右侧打开现有风格的 `detail-panel`，显示群名、项目、Agent 数、成员数和当前加载消息数；面板可再次点击详情图标或面板关闭按钮收起。

## 验证

最终源码构建检查：

```text
ui-feishu/node_modules/.bin/tsc -p ui-feishu/tsconfig.json && ui-feishu/node_modules/.bin/vite build --config ui-feishu/vite.config.ts
```

结果：通过。

- TypeScript 无错误。
- Vite 转换 2130 个模块并完成生产构建。
- 仅有既有 `@tiptap/react` 的 `"use client"` 忽略提示和大于 500 kB 的 chunk 提示。

额外静态检查：

- `git diff --check` 通过。
- 源码搜索确认 `SlashCommandMenu` 由 `capabilityOpen ?` 条件包裹。
- 源码搜索确认 `ChatHeader` 实际收到 `actions={...}`，包含 `Share2`、`Pencil`、`PanelRight`。
- 受保护文件无工作区差异。

没有另外运行浏览器测试或全量测试。

## 剩余风险

- 未做真实浏览器截图验收；构建已覆盖类型和打包，交互路径由现有 `useDismissibleLayer`、`ShareConversationDialog`、`groups.update` 与共享 `ChatHeader` 实现。
- 详情中的消息数使用当前群快照已加载消息数，避免在未读取全部分页时伪装成全量统计。
- 群聊文件页签仍未接入，与本轮右上角三图标无关。
