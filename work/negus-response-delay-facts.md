# Negus 整页响应与乐观消息延迟事实说明

- 记录日期：2026-11-12
- 项目目录：`/Users/hans/myproject/negus`
- 分支：`develop`
- 排查时 HEAD：`d60f32b3e0eea56a2751de4f1230d6cdac3f95f5`
- 问题版本提交：`2ea73e84e256c6687871f6ef857e2da51156daba`
- 当前线上前端版本：`feishu-mwdcdbzj`
- 当前线上后端发布快照：`1794475480957-705e25f4`

本文只记录用户实际反馈、实际测量结果、实际代码路径和 Git 历史。本文不提供修复方案，不扩充原因分析。

## 1. 用户实际反馈

用户最初反馈：

> 就是我现在的乐观消息，感觉“不够实时”，我点击发送之后差不多1秒对话框才看到。请你排查

用户补充长尾延迟：

> 有时候还更久，要3s

用户补充受影响范围和交互差异：

> 也有可能和页面内容更新的相关部分有关。然后中途插入消息的也请一起排查，好像体验不太一致。

> 补充一下，感觉是整个页面反应都慢半拍，无论是点击，还是输入框打字输入，还是内容更新。

用户要求追溯版本：

> 这个逻辑是什么时候做的？以前的版本有这个问题吗？看一下什么时候的GitHub提交引入的。

## 2. 验证环境与范围

本次排查使用以下环境：

- 实际 Negus 生产构建；
- 实际本机发布实例；
- 实际只读会话数据；
- macOS 上的 Google Chrome 157 headless；
- 临时浏览器 profile；
- 通过 CDP 发出实际点击和键盘输入事件；
- 所有非 GET 请求由验收夹具拦截，没有向真实对话发送测试消息；
- 没有创建真实测试对话；
- 没有修改业务源码、发布前端或重启后端。

浏览器采样分别使用正常 CPU、4 倍 CPU 降速和 6 倍 CPU 降速。6 倍降速属于压力条件，不是用户设备的实测参数。

线上页面 `/version.json` 返回：

- build ID：`feishu-mwdcdbzj`
- 构建时间：`2026-11-12T09:24:43.817Z`
- 换算北京时间：`2026-11-12 17:24:43`

工作区与当前发布资源中，主 JS 文件 `index-B8jOeI9l.js` 的 SHA-256 均为：

```text
d8448be82a1eb72af2561cece5e512b3dccd71468871f4138926e274f1922a1c
```

主 CSS 哈希一致。上一份发布快照 `feishu-mwc02n0u` 的主 bundle 在归一化 build ID 和懒加载 chunk 名称后，与当前主 bundle 逐字节一致。

## 3. 普通文字消息的发送路径

### 3.1 代码执行顺序

用户按 Enter 或点击“发送”后：

1. `ConversationComposer.submit` 阻止重复提交，读取当前文本，先清空输入框，再调用 `onSend`。
2. 普通纯文字发送进入 `useProjectConversations.sendMessage`，随后进入 `sendDirectMessage`。
3. `sendDirectMessage` 生成 `submissionId` 和 `optimistic-*` 消息。
4. 在任何短信网络请求之前，代码调用：

   - `selection.addOptimisticMessage(threadId, optimisticMessage)`
   - `setLocalSendVersion(...)`

5. `ConversationStore.addMessage` 把消息放入 `localPending`，并同步调用 `notify()`。
6. `notify()` 增加 store version，并通知 store 的全部订阅者。
7. `useConversationSession` 通过 `useSyncExternalStore` 订阅该 store。
8. `ChatWorkspace` 合并 `localPending` 与正式消息，`ConversationView` 再排序并渲染消息。
9. 服务端 `/api/session/message`、模型设置、SSE `user_message_submitted`、标题生成和模型调用都在乐观消息插入之后执行。

相关代码位置：

- `ui-feishu/shared/features/conversations/components/ConversationComposer.tsx:229-287`
- `ui-feishu/shared/features/conversations/components/ConversationComposer.tsx:457-465`
- `ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts:312-360`
- `ui-feishu/shared/features/conversations/state/conversationStore.ts:100-102`
- `ui-feishu/shared/features/conversations/state/conversationStore.ts:237-243`
- `ui-feishu/shared/features/conversations/hooks/useConversationSession.ts:35`
- `ui-feishu/src/components/ChatWorkspace.tsx:83-89`
- `ui-feishu/shared/features/conversations/components/ConversationView.tsx:214-258`
- `ui-feishu/shared/features/conversations/components/ConversationView.tsx:347-395`

### 3.2 无主线程拥挤时的实际测量

使用实际生产构建、一个含 68 条消息的已完成对话、189 个目录行进行隔离发送测试：

| CPU 条件 | 点击到乐观气泡进入 DOM | 点击到近似首帧 |
| --- | ---: | ---: |
| 1 倍 | 29.7 ms | 44.1 ms |
| 4 倍降速 | 50.7 ms | 54.7 ms |
| 6 倍降速 | 73.3 ms | 79.1 ms |

该测试中，所有非 GET 请求均被拦截。没有向真实对话提交消息。

## 4. 整页响应和内容更新采样

### 4.1 页面规模

实际采样页面包含：

- 189 个可见 `conversation-branch` 或 `contact-row`；
- 约 6,357 个 DOM 节点；
- 本地会话缓存 20 个正文记录、319 条消息；
- `localStorage` 中项目目录缓存约 275,779 字节；
- 本机会话版本索引 359 个有消息的会话、8,702 条消息索引记录；
- 单个线程最多记录 206 条消息。

### 4.2 运行中对话的后台请求

浏览器停留在已完成对话：

```text
01a1ca98-9a88-7833-8deb-b041b781f3ba
```

另一条后台对话处于运行状态：

```text
01a1cf29-7a73-7f73-acfe-1eed1d9e1b29
```

对该运行中对话的 6 秒持续采样结果：

```text
GET /api/session 01a1cf29-7a73-7f73-acfe-1eed1d9e1b29
count=122
median=27 ms
max=34 ms
failures=0
```

6 秒内共 122 次请求，平均约每秒 20 次。另一次 15 秒采样记录 479 次 `/api/session` 请求。

### 4.3 只读接口耗时

连续 HTTP 测试结果：

```text
GET /api/sessions?source=all
0.968 s / 0.895 s
97,483 bytes
200

GET /api/sessions?source=codex
0.892 s / 0.906 s
97,483 bytes
200

GET /api/project-directory
1.236 s / 1.228 s / 1.233 s
497,813 bytes
200

GET /api/session，当前运行对话
冷/首轮约 28 ms
随后 19–39 ms
响应约 37–73 KB

GET /api/session，101 条旧对话
冷约 204 ms
热约 23–33 ms
响应约 104 KB
```

### 4.4 点击、输入和帧时间

正常 CPU 条件下：

- 已完成 101 条消息的对话，点击“对话详情”到 DOM 变化：`6.6 ms`
- 已完成 101 条消息的对话，点击到近似首帧：`25.6 ms`
- 运行中对话，点击“对话详情”到 DOM 变化：`11.3 ms`
- 运行中对话，点击到近似首帧：`33.8 ms`
- 运行中对话输入 6 个字母，输入事件到下一帧：约 `10.0–36.0 ms`

6 倍 CPU 降速条件下：

- 运行中对话，点击“对话详情”到 DOM 变化：`37.2 ms`
- 运行中对话，点击到近似首帧：`43.5 ms`
- 多数输入事件到下一帧：`22–172 ms`
- 一次输入事件到下一帧：`2,176 ms`
- 同时段记录到连续主线程长任务：`2,156 ms` 和 `4,405 ms`

CPU Profile 中实际记录到持续热点：

- 会话行 `render`
- `compactTime` 日期格式化
- Markdown 解析
- React commit

### 4.5 日期格式化的对照结果

对 189 行目录执行时间格式化对照：

| CPU 条件 | 当前 `compactTime` 中位数 | 复用 `Intl` 格式化器的中位数 |
| --- | ---: | ---: |
| 1 倍 | 2.7 ms | 0.1 ms |
| 4 倍 | 10.4 ms | 0.5 ms |
| 6 倍 | 15.5 ms | 0.9 ms |

这组数据只记录两种调用的耗时，不包含修复决定。

### 4.6 隔离渲染结果

用真实结构和实际 `ConversationView` 做服务端隔离渲染：

- 68 条消息、约 12K 字符：中位数约 `9.6 ms`
- 101 条消息：中位数约 `9.9 ms`

上述数值只包含该隔离环境的 JavaScript 渲染执行时间，不包含浏览器布局、样式和整页其他 React 工作。

## 5. 已观察到的页面更新链路

采样期间记录到以下调用和数据顺序：

1. `usePageSnapshot` 从 `store.live` 中取得 active 线程。
2. `active` 线程被加入正文读取资格。
3. active 线程在已观察判断中绕过无变化短路。
4. 独立读取完成后，`wakeVersion` 增加。
5. `wakeVersion` 是主 effect 的依赖。
6. 返回的 session/status 通过 `store.commit`、`setShown` 和 `store.notify()` 进入状态。
7. store 通知触发通过 `useSyncExternalStore` 订阅的页面更新。
8. `FeishuApp` 顶层调用 `useProjectConversations()`。
9. `roster` 会重建目录和排序。
10. `ConversationRows` 对目录行执行 JSX、时间格式化和预览构造。
11. `ConversationView` 重新遍历和排序消息。
12. `ContentRenderer` 对 Markdown 重新运行 `ReactMarkdown` 和 `remarkGfm`。

相关代码位置：

- `ui-feishu/src/usePageSnapshot.ts:68-78`
- `ui-feishu/src/usePageSnapshot.ts:101-157`
- `ui-feishu/src/usePageSnapshot.ts:170`
- `ui-feishu/src/usePageSnapshot.ts:172-205`
- `ui-feishu/shared/features/conversations/state/conversationStore.ts:143-162`
- `ui-feishu/shared/features/conversations/state/conversationStore.ts:202-235`
- `ui-feishu/src/FeishuApp.tsx:42-45`
- `ui-feishu/src/FeishuApp.tsx:132-149`
- `ui-feishu/src/FeishuApp.tsx:194-202`
- `ui-feishu/src/components/ConversationRows.tsx:15-39`
- `ui-feishu/src/presentation.ts:3-9`
- `ui-feishu/shared/features/conversations/rendering/ContentRenderer.tsx:180-188`
- `ui-feishu/shared/features/conversations/rendering/ContentRenderer.tsx:245-247`
- `ui-feishu/shared/features/conversations/rendering/ContentRenderer.tsx:287-321`

## 6. 目录刷新和缓存处理的实测事实

SSE 收到 `sessions_changed` 后：

- 事件交给 `onEvent`；
- 目录重新读取使用 180 ms 去抖；
- `onSessionsChanged` 通知正文刷新，并派发 `negus:directory-changed`；
- `catalog.refreshSessions` 被调用；
- `useProjectDirectory` 监听同一事件并请求完整项目目录。

相关代码位置：

- `ui-feishu/shared/features/conversations/realtime/useConversationEvents.ts:80-90`
- `ui-feishu/shared/features/conversations/realtime/useConversationEvents.ts:122-171`
- `ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts:613-620`
- `ui-feishu/shared/features/project-directory/hooks/useProjectDirectory.ts:15-28`
- `windows/server/routes/conversation-history-routes.mjs:156-188`
- `windows/server/conversation-service.mjs:149-163`
- `windows/server/provider-conversation-store.mjs:310-369`
- `windows/server/employee-project-directory.mjs:96-109`
- `windows/server/employee-project-directory.mjs:148-245`
- `windows/server/employee-project-directory.mjs:312-326`

`usePageSnapshot` 的持久化 effect 在持久化版本变化时执行以下操作：

- 重建全部会话摘要；
- 将全部 `cachedSessions` 和 presentation 交给 `writeConversationSnapshot`；
- 遍历缓存记录；
- 对每条记录执行 `JSON.stringify` 比较；
- 排队写入同一 IndexedDB。

相关代码位置：

- `ui-feishu/src/usePageSnapshot.ts:190-201`
- `ui-feishu/shared/features/conversations/data/conversationSnapshot.ts:149-193`

## 7. 高频刷新逻辑的 Git 历史

### 2026-11-01：统一会话状态和批量同步

提交：

```text
2f7372027005566c706cd0d3ea2cfd85e4b236ac
refactor: unify conversation state and batch synchronization
2026-11-01 23:55:01 +0800
```

该提交把会话读取接入统一的 `ConversationStore`，建立批量同步、`observed` 签名和完成后的 `wakeVersion` 唤醒。

### 2026-11-03：独立会话读取和完成唤醒

提交：

```text
070e81e4d26bf9a40eb8c52b366fd1515f2e405e
fix: preserve current conversation and background task improvements
2026-11-03 09:53:22 +0800
```

该提交加入：

- `independentReads`；
- 非初始批次时逐会话独立读取；
- 每个独立读取完成后执行 `wake(value => value + 1)`；
- `wakeVersion` 作为主 effect 依赖；
- 发布完成后调用 `store.notify()`。

### 2026-11-04：只读取当前打开的对话

提交：

```text
2d32c4a54ba93052a29a6e67d5884a6192620a2d
Preserve current conversation updates and pause bulk history prefetch
2026-11-04 20:34:53 +0800
```

该提交把读取范围改成：

```js
const entries = rows
  .filter(row => row.threadId === c.selectedId)
  .map(row => {
    // ...
  });
```

该版本的代码中，后台非当前对话不进入正文读取集合。

### 2026-11-06：恢复最近 20 条并加入所有活跃线程

提交：

```text
d10e477260faf272fe1deca42f35a282889d07e1
chore: 保存当前开发版本并记录移动端缓存体验问题
2026-11-06 14:34:23 +0800
```

该提交把 2026-11-04 的“只读取当前对话”改成：

```js
const eligible = new Set(rows.slice(0, 20).map(row => row.threadId!));
if (c.selectedId) eligible.add(c.selectedId);
for (const id of store.live.keys()) {
  if (store.get(id).executionStatus.active) eligible.add(id);
}
const entries = rows.filter(row =>
  eligible.has(row.threadId!) &&
  (
    !observed.current.has(row.threadId!) ||
    store.dirty.has(row.threadId!) ||
    store.get(row.threadId!).executionStatus.active
  )
);
```

该提交同时把发布结果的 priority 改为全部 `priority: true`，并把持久化 effect 的依赖从：

```js
[shown, c.selectedId, store.getPersistSnapshot()]
```

改成：

```js
[shown, c.sessions, c.selectedId, store.getPersistSnapshot()]
```

Git 远程分支记录显示，该提交包含在：

- `origin/develop`
- `origin/pr-2`

紧邻该提交之前的版本，即 `2d32c4a`，只读取当前对话。包含所有活跃线程强制读取资格和 active 绕过已观察判断的版本，从 `d10e477` 开始。

## 8. 其它实际存在的预先等待路径

### 8.1 编辑历史消息后重新发送

代码先执行：

```js
await conversationApi.revert(...)
```

然后清理旧消息并调用 `sendDirectMessage`。在这段请求返回前，不会生成新的乐观气泡。

相关位置：

- `ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts:411-429`

### 8.2 图片和文件发送

`ConversationComposer` 先执行附件上传：

```js
await draft.uploadAll()
```

上传期间没有创建乐观消息气泡。

相关位置：

- `ui-feishu/shared/features/conversations/components/ConversationComposer.tsx:260-274`

### 8.3 首条仍提交时发送第二条

第一条消息发送后，线程进入 `submittingThreads`。第二条消息在该状态下调用 `sendDirectMessage` 会返回 `false`，不会创建第二个气泡。

相关位置：

- `ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts:315-316`
- `ui-feishu/shared/features/conversations/components/ConversationComposer.tsx:238`
- `ui-feishu/shared/features/conversations/components/ConversationComposer.tsx:273-285`

### 8.4 新建 pending 对话后的首次发送

乐观消息先显示在 pending 线程。`waitForThread` 返回真实 thread ID 后，代码先移除 pending 消息，再插入真实 thread 消息。

相关位置：

- `ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts:333-340`

## 9. 当前版本状态

本次负责的记录已随以下提交推送到 GitHub：

```text
2ea73e84e256c6687871f6ef857e2da51156daba
chore: 保存当前版本并标记整页响应延迟问题
KNOWN ISSUE VERSION
```

提交正文记录了当前版本存在整页响应延迟，并明确写明该提交保存的是可复现的问题版本，不代表问题已修复。

截至本说明生成时：

- 本地 `develop` 与 `origin/develop` 均指向 `2ea73e8`；
- 没有发布新的前端构建；
- 没有重启后端；
- 线上前端仍为 `feishu-mwdcdbzj`；
- 线上后端仍为发布快照 `1794475480957-705e25f4`。

## 10. 验证记录

相关定向测试：

- 项目管理测试：5/5 通过；
- access-control 测试：4/4 通过；
- request-handler-routing 测试：4/4 通过；
- 上述合计 13/13 通过；
- TypeScript `tsc -b` 通过；
- `git diff --check` 通过。

完整后端测试：

- 总数：564；
- 通过：556；
- 失败：7；
- 跳过：1；
- 失败集合与测试清理前相同。

## 11. 本次未执行的测量

以下项目没有在本次排查中执行：

- 没有操作用户当前浏览器；
- 没有向真实用户对话发送测试消息；
- 没有执行真实 `/api/session/message` 写请求；
- 没有执行真实图片或附件上传；
- 没有停止当前后台任务；
- 没有在用户实际设备上取得 CPU 和帧时间数据；
- 没有发布前端；
- 没有重启后端。

6 倍 CPU 降速数据来自浏览器压力测试，不是用户设备参数。

## 12. 证据文件

完整排查报告：

```text
work/optimistic-message-latency.md
```

临时测量脚本：

```text
/tmp/negus-optimistic-fixture/measure-live.mjs
/tmp/negus-optimistic-fixture/measure-send-isolated.mjs
/tmp/negus-optimistic-fixture/measure-fixture.mjs
/tmp/negus-optimistic-fixture/network-rate.mjs
/tmp/negus-optimistic-fixture/profile-live.mjs
/tmp/negus-optimistic-fixture/bench-time.mjs
```
