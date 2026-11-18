# FEAT-002 群聊协作修复交接

结论：两项已确认问题已在工作区修复，144/144 定向 Node 测试、桌面/手机 SSE 浏览器夹具、TypeScript 和 diff 检查通过。运行服务没有加载本次修改；没有提交、推送、发布、重启、真实消息发送或截图。独立 DeepSeek 审核交由来源对话安排。

基线：develop / dfe8bcf5213992adbf97cb643d80516d64119a7e。交付时 HEAD 与本地 origin/develop 引用差异 0/0（未 fetch）。原 context_status、旧 live 完成态、Mermaid 及 FEAT-001/002/003 文档改动全部保留。本项仅追加 FEAT-002 记录，业务未触及原有脏文件或受保护滚动文件。

## 用户操作前后

- 修前：您不点名提问→运营管理接待→中间说明只进入折叠 delta，完整 commentary 不进群记录→运营调用派工工具遇到 Unauthorized→产品/研发/风控没有任务和群内回复。您执行中补充要求虽已进入原 turn，最终回复仍引用最初消息。
- 修后：您不点名提问→仍由既定接待者响应→每条 completed commentary 独立存入房间并经原 SSE/Message 展示→正式工具携本轮来源凭据按职责派工→受派员工执行、发中间回复和最终回复。刷新/重连复用房间记录；同 item 不重发；停止/失败不删已经显示的中间回复。补充仍 steer 原 turn，最终回复关联最后已接收的本轮补充，不新增提示文案。
- 未点名路由、明确 @、群共享上下文窗口、员工父行、外部任务过滤和后台执行者不得再次派工均维持既有规则；没有强制全员参与。

## 根因与认证证据

1. `group-task-service` 仅广播 `item/agentMessage/delta`，没有处理 completed commentary；房间和前端还把同 workId 全部当成一条最终结果。现在房间持久化 workId/itemId/phase，中间回复和最终结果身份分开；已有历史核对回调可补回遗漏，无新轮询。
2. 群任务每轮 `tools.config(task.id)` 生成独立 capability，交付时 `tools.release(task.id)` 释放。长期员工 thread 仍加载着旧 MCP 进程；原生已加载 thread 的 resume 不应用新 MCP 配置，于是下轮工具仍带旧 token 到同一个房间 endpoint，`scopes.get(token)` 为空，HTTP 401 `Unauthorized`。这发生在 invoke 之前，并不是 manager/researcher 的角色权限拒绝。

历史只读证据 `historical-evidence.json`：指定房间 6 员工、12 消息、5 个 manager 任务、6 commentary；两次失败为 2026-11-16T15:18:16.786Z `list_tasks` 和 15:21:38.413Z `create_background_task`。五个任务沿用同一 manager thread；首轮在 15:15:23.160Z 已交付。原生 logs_2.sqlite 同时段检索 Unauthorized/stderr/already-loaded 非 feedback 日志为 0 条；错误是 MCP 工具内容中的 HTTP JSON 响应，不是 MCP 进程 stderr 异常。历史 token 不读取、不复制、不输出。

`native-probe.mjs` / `native-probe.log`：独立临时 CODEX_HOME、真实本机原生 app-server，没有 turn/start 或模型请求；仅注入隔离 assistant 历史 fixture 以产生可恢复 rollout。已加载 resume 传入禁用 handoff 配置后，工具仍存在；unsubscribe/resume 后工具消失，断言通过。已释放 capability 真实 HTTP 请求返回 401，同 endpoint 新 capability 返回 200 且 source=second，证明 endpoint 可达，故障落在旧 token/scope 绑定。未使用用户 cookie、登录态或普通消息接口。

修复仅限群任务恢复路径：读取旧状态，遇 active/非终态则拒绝卸载；确认空闲后 unsubscribe，再用本轮 config resume。同 thread/history 保持，已释放 token 不复活，不把旧 token 重新绑定到新 actor。后台工具依旧禁用。delegate 来源补齐真实 actor，后台 registerSession 仍为 createdBy=assistant。

## 本项逐文件差异

| 文件 | 原因 | 新增/删除 |
|---|---|---:|
| ui-feishu/server/group-task-service.mjs | 完整中间回复、群 MCP 配置刷新、来源 actor、补充消息关联 | +36/-6 |
| ui-feishu/kernel/native-task-runtime.mjs | 在现有历史核对和同步终态返回时调用可选 onHistory；其他调用者不变 | +5/-1 |
| windows/server/group-room-store.mjs | 持久化 commentary item 身份，避免同 workId 吞掉中间/最终消息 | +5/-1 |
| ui-feishu/shared/features/group-chat/data/groupMessageState.ts | 同任务不同 item 独立去重 | +2/-1 |
| ui-feishu/shared/features/group-chat/data/groupSnapshot.ts | commentary 不表示任务已完成，刷新继续恢复占位 | +2/-2 |
| ui-feishu/shared/features/group-chat/model/types.ts | 已有 GroupMessage 增加 itemId/phase | +2/-0 |
| ui-feishu/shared/features/group-chat/realtime/useGroupEvents.ts | SSE/重连不因中间消息终止活动任务 | +3/-3 |
| ui-feishu/validation/group-collaboration.test.mjs | 隔离群服务、真实 stdio MCP/HTTP 权限、任务与回群、停止失败重连 | +142/-0 |
| ui-feishu/validation/group-commentary-browser.test.mjs | 实际共享 SSE/群组件，桌面手机显示、刷新、重连、顺序与去重 | +55/-0 |
| docs/project-management/items/FEAT-002/item.md | 追加本轮授权并替代旧提示建议，不覆盖历史原话 | +6/-0 |
| docs/project-management/items/FEAT-002/updates.md | 追加实现、证据和未发布状态 | +7/-0 |

业务合计 7 文件 +55/-14，净增 41；测试 2 文件 +197；文档只统计本轮追加，未混入此前改动。work 下保留调查脚本、脱敏证据和测试日志，不计业务行数。

## 验证命令与结果

统一 Node：`/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。在安装目录执行以下 Node 参数：

```sh
--test ui-feishu/validation/group-collaboration.test.mjs ui-feishu/validation/group-task-service.test.mjs ui-feishu/validation/group-extension.test.mjs ui-feishu/validation/native-task-runtime.test.mjs ui-feishu/validation/task-kernel.test.mjs ui-feishu/validation/employee-task-extension.test.mjs windows/tests/group-room-store.test.mjs windows/tests/group-routes.test.mjs windows/tests/message-handoff.test.mjs windows/tests/agent-publication.test.mjs windows/tests/task-attribution-projection.test.mjs windows/tests/execution-tracker.test.mjs
```

144/144 通过，0 跳过：`regression.log`。覆盖同员工任务顺序、不同员工并发、停止、续派、历史恢复、普通 commentary/最终回复、真实消息与任务署名投影、群路由及群记录。新增案例通过真实 stdio MCP 调用 list_tasks/create_background_task/delegate_task；researcher/developer/reviewer 各自成功派工和回群，source.actor 正确，登记为 assistant；群外员工、跨群续派/跨 endpoint token 被拒绝；后台仍禁用派工；已有 active thread 不被卸载。初跑新测试过早断言 token 释放，收到有效的“来源任务已经结束”拒绝；改为等待交付状态 delivered 后，复验及最终合集通过（不是放宽拒绝规则）。

```sh
ui-feishu/node_modules/typescript/bin/tsc -p ui-feishu/tsconfig.json --noEmit
work/group-collaboration-20261117/native-probe.mjs
ui-feishu/validation/group-commentary-browser.test.mjs
```

- TypeScript exit 0：`typescript.log`。
- 原生协议探针 exit 0：`native-probe.log`。
- 浏览器使用本轮临时 Vite 127.0.0.1:5197（`node node_modules/vite/bin/vite.js --config vite.config.ts --host 127.0.0.1 --port 5197 --strictPort`，cwd ui-feishu）；所有 API 为内存 fixture，实际 `publishProjectStream`→群 SSE handler→Message。1280/390 两宽度通过、无页面错误、无截图：`browser.log`。初版 fixture 的 EventSource stub 与生产共享 SSE 转换不匹配，已改为实际共享 SSE 入口；不涉及产品逻辑修改。
- `git diff --check` exit 0。

## 覆盖边界与待完成项

源码、原生配置恢复语义、真实任务工具协议、隔离群持久化、浏览器显示已验证。用户禁止真实消息、发布和重启，因此没有供应商实际生成或运行服务端到端验收，也不回填真实房间旧的六条 commentary。当前房间历史保持原样。独立 DeepSeek 审核由来源对话继续；审核后若需线上生效，须另获发布/重启授权。
