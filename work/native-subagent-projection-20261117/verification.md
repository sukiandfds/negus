# Codex 原生子代理员工投影与来源署名验证

## 用户可见结果

- 员工发起 Codex 原生子代理后，员工目录和现有任务子项会把它显示为后台工作；单项显示“正在处理后台任务”，多项显示“正在进行 N 项工作”，完成后回到当前主对话状态。
- 该状态通过真实 `buildConversationDirectory` 口径计算：即使 native child 的父线程是员工群会话，子代理本身仍按后台任务行处理，不会把员工父行误显示为“正在群聊工作”。
- 打开原生子代理历史，首条派工消息显示发起员工姓名与身份；后续真人输入仍显示为用户。来源无法确认时显示“来源待确认”，普通 fork 不伪装为子代理。
- 刷新、重连和重启后从当前会话父链重新投影，同一线程只显示一次。未知父和循环保持原样，不猜测员工。

## 实现

- `windows/server/native-subagent-source.mjs`：纯父线程解析；接受员工主线程、员工群会话和任意层 native parent 链，拒绝普通 fork、未知父和循环。
- `windows/server/employee-project-directory.mjs`：复用 `conversations.listSessions`、既有员工绑定和 execution 状态，把已归因 native child 以 `role:"standard"` 加入员工现有任务子项，并从业务项目列表去重；员工群会话继续使用 `role:"project"`。
- `ui-feishu/server/employee-task-extension.mjs`：为原生子代理首条 userMessage 注入可信员工署名；未知来源使用待确认身份；分页中段不误标后续真人消息；actorRevision 包含原生来源身份。
- `windows/server/routes/conversation-routes.mjs`：普通/原生子代理历史读取复用统一对话来源装饰入口。
- `windows/server/routes/conversation-history-routes.mjs`：首次加载只计算一次最终版本；初始版本读取失败时返回新历史，不因不可确认的前后版本差异返回 409。
- `windows/server/jsonl-conversation-store.mjs`：历史回退保留 `nativeSubagent` 与 `parentThreadId`。

本轮相关差异：

- 生产代码：+177/-19，其中新增 `native-subagent-source.mjs` 52 行。
- 测试：+230/-2。
- 合计：+407/-21。

## 测试

```sh
node --test \
  ui-feishu/validation/employee-task-extension.test.mjs \
  windows/tests/project-identity-store.test.mjs \
  windows/tests/task-attribution-projection.test.mjs \
  windows/tests/conversation-source-revision.test.mjs
# 31/31

node --test \
  ui-feishu/validation/group-collaboration.test.mjs \
  ui-feishu/validation/group-task-service.test.mjs \
  ui-feishu/validation/group-extension.test.mjs \
  ui-feishu/validation/native-task-runtime.test.mjs \
  ui-feishu/validation/task-kernel.test.mjs \
  ui-feishu/validation/employee-task-extension.test.mjs \
  windows/tests/group-room-store.test.mjs \
  windows/tests/group-routes.test.mjs \
  windows/tests/message-handoff.test.mjs \
  windows/tests/agent-publication.test.mjs \
  windows/tests/task-attribution-projection.test.mjs \
  windows/tests/execution-tracker.test.mjs \
  windows/tests/project-identity-store.test.mjs \
  windows/tests/conversation-source-revision.test.mjs \
  windows/tests/provider-conversation-store.test.mjs \
  windows/tests/desktop-current-tasks.test.mjs
# 202/202

node --test \
  windows/tests/employee-runtime.test.mjs \
  ui-feishu/validation/realtime-regression.test.mjs \
  ui-feishu/validation/employee-provider.test.mjs \
  ui-feishu/validation/conversation-summary.test.mjs
# 123/123

node --test ui-feishu/validation/conversation-summary.test.mjs
# 45/45；测试内部先调用后端 createEmployeeProjectDirectory，
# 再把真实输出交给前端 buildConversationDirectory
```

TypeScript `--noEmit`、相关 MJS 语法、`git diff --check` 通过。`ConversationView.tsx` 与 `useReturnToBottom.ts` 工作区零差异。

## 覆盖边界

- 覆盖直接员工主线程父 owner、员工群线程父 owner、多层 native parent、未知父、普通 fork、首条派工署名、后续真人输入、分页中段、后端到前端的真实后台状态投影、完成后空闲、刷新去重和旧状态不复活。
- 使用现有目录工厂、历史装饰函数和路由版本链，不使用仅前端 fixture。
- 未创建真实供应商原生子代理，未发送真实消息，未修改运行历史，未做浏览器视觉验收。

## 交付状态

当前 HEAD `da47256`，分支 `develop`。本轮未提交、未推送、未发布、未重启；运行服务尚未加载本轮源码。

前端口径补修证据：

- `frontend-directory-projection.log`：真实 `buildConversationDirectory` 45/45。
- `employee-regression.log`：员工状态与前端目录组合回归 123/123。
- `collaboration-regression.log`：群聊与目录相关回归 202/202。
- `typescript.log`：无输出，TypeScript `--noEmit` 通过。
