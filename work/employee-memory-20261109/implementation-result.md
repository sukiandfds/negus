# 员工全局规则实现结果（2026-11-09）

当前为 develop 工作区源码，未提交、推送、发布或重启；未验证浏览器效果。现有未提交改动保留，受保护的对话滚动文件未修改。开始时 HEAD 为 `5d53cc71fc8828315d47b76240255ba4f3a0f48e`，develop 与 origin/develop 提交差距 0/0。

业务代码本轮增删 **+108/-47** 行；测试 **+75/-0** 行（按本轮改动计算，以下三份已有修改的文件排除了先前改动；文档与本结果文件不计入）。

| 文件 | 本轮新增/删除 |
| --- | ---: |
| ui-feishu/shared/features/employee-growth/components/EmployeeGrowthPanel.tsx | +17/-8 |
| ui-feishu/shared/features/employee-growth/data/employeeGrowthApi.ts | +2/-0 |
| ui-feishu/shared/features/employee-growth/hooks/useEmployeeGrowth.ts | +21/-2 |
| ui-feishu/shared/features/employee-growth/model/types.ts | +1/-1 |
| ui-feishu/src/components/ConversationDetails.tsx | +1/-1 |
| windows/scripts/remote-room-demo.mjs | +3/-0 |
| windows/server/background-tasks/service.mjs | +2/-2 |
| windows/server/employee-growth-service.mjs | +38/-17 |
| windows/server/employee-growth-store.mjs | +10/-0 |
| windows/server/employee-runtime-service.mjs | +2/-14 |
| windows/server/multi-agent-service.mjs | +2/-1 |
| windows/server/routes/employee-growth-routes.mjs | +9/-1 |
| windows/tests/employee-growth-project-directory.test.mjs | +75/-0（测试） |

沿用原成长存储的 pending/approved 状态及审批接口；消息请求 ID 去重，手动添加直接批准；停用和删除不加载。每轮从员工全局有效规则读取，启动时清理旧 AGENTS.md 托管规则块，避免旧文件造成停用规则继续生效或运行中读到新规则。普通任务完成不触发自动复盘；旧待审批与 Skill 审批保留。

验证：

- `node --test windows/tests/employee-growth-project-directory.test.mjs windows/tests/employee-runtime.test.mjs windows/tests/multi-agent-service.test.mjs`：45/45 通过。新增测试使用真实成长存储及模拟运行客户端覆盖普通消息、待审批、幂等、批准和三个入口读取，以及规则停用、删除和后台快照；尚未实测真实模型执行或浏览器。
- 在 `ui-feishu` 执行 `./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/vite build --config vite.config.ts`：通过；Vite 提示现有大于 500 kB 的 chunk 和依赖的 `use client` 指令被忽略。
- `git diff --check`：通过。
- 扩展执行 `node --test windows/tests/employee-growth-project-directory.test.mjs windows/tests/employee-runtime.test.mjs windows/tests/provider-conversation-store.test.mjs windows/tests/multi-agent-service.test.mjs`：64/67 通过，供应商切换相关 3 失败：`channel switching preserves the thread...` 缺少临时 `rollout.jsonl`；`sorts a switched channel...` 原对话记录校验失败；`failed sends keep the current choice...` 模型值 `current::gpt-bad` 与预期 `gpt-bad` 不一致。涉及已存在未提交更改的供应商会话代码，未在本轮修改或排查其根因。

剩余风险：指令识别采用明确前缀而非语义分类，覆盖不到未以约定前缀开头的表达，也可能把以这些词开头的普通句子视为建议；建议必须批准才生效。真实模型、浏览器操作和服务启动后的旧文件迁移尚未验收；关闭或删除后的三条链路逐项重新发起尚未全部自动验证，测试验证了共享规则源和后台后续读取。旧文件清理在下次服务启动时执行。

## 2026-11-09 DeepSeek 复核后的修复

以下修复增删行数相对于本轮修复开始时的工作区计算，不包含先前已存在的改动、文档或日志。业务代码 **+28/-20**，测试 **+73/-12**：

| 文件 | 本轮修复新增/删除 |
| --- | ---: |
| ui-feishu/server/register.mjs | +2/-2 |
| ui-feishu/server/employee-task-extension.mjs | +3/-3 |
| ui-feishu/server/group-task-service.mjs | +2/-2 |
| ui-feishu/shared/features/employee-growth/hooks/useEmployeeGrowth.ts | +4/-3 |
| windows/server/employee-growth-service.mjs | +15/-9 |
| windows/server/employee-runtime-service.mjs | +2/-1 |
| ui-feishu/validation/employee-task-extension.test.mjs | +16/-3（测试） |
| ui-feishu/validation/group-task-service.test.mjs | +15/-3（测试） |
| windows/tests/employee-growth-project-directory.test.mjs | +30/-5（测试） |
| windows/tests/employee-runtime.test.mjs | +12/-1（测试） |

生产注册为员工任务及群任务包装层传入同一成长服务；测试通过实际 `extendEmployeeTasks` 与 `createGroupTaskService` 模拟任务，检查普通群任务、群内后台任务、员工后台任务的启动上下文及停用后的下一轮读取。员工主对话使用真实成长存储和模拟客户端验证同一规则源。建议保存异常单独记录，不改变已接受的 turn 状态。单独“以后/今后”不触发；“记住/请记住”需分隔，支持“规则：”和明确的强指令组合。规则批准、停用、删除仅修改存储；启动时仍清理旧托管规则块。已保存事实及已批准 Skill 恢复进入上下文；未恢复自动复盘。通知异常不改变规则操作的返回状态，面板操作失败时恢复原状态并由现有刷新重新读取。

验证结果：

- `node --test windows/tests/employee-growth-project-directory.test.mjs windows/tests/employee-runtime.test.mjs windows/tests/multi-agent-service.test.mjs ui-feishu/validation/employee-task-extension.test.mjs ui-feishu/validation/group-task-service.test.mjs ui-feishu/validation/group-extension.test.mjs`：**71/71 通过**，输出见 `work/employee-memory-20261109/focused-tests-current.log`。
- 额外包含 `windows/tests/agent-tasks.test.mjs` 的测试集：**70 通过、1 失败**，该旧测试文件引用不存在的 `windows/server/agent-tasks/service.mjs`，在装载时失败；见 `work/employee-memory-20261109/focused-tests.log`。当前员工后台任务包装层测试已包含在通过的测试集中。
- `ui-feishu` 下 `./node_modules/.bin/tsc -p tsconfig.json --noEmit && ./node_modules/.bin/vite build --config vite.config.ts`：通过；构建仍有依赖 `use client` 和大 chunk 提示。
- 对当前员工运行时代码运行生产事件和供应商源码适配器：通过。`git diff --check`：通过。develop 与 origin/develop 提交差距 0/0。
- 上一轮额外供应商会话测试的 3 项失败见上文；本轮未重跑或修改供应商切换代码，无法断定其根因。

剩余风险：尚未验证真实模型、浏览器界面或部署后旧文件清理；规则建议使用前缀匹配，不能识别所有等价表达。成长存储沿用既有的内存先变更、随后持久化机制，底层持久化自身失败时的内存回滚不在本轮修复范围。本轮没有发布、重启、提交或推送，也没有修改受保护滚动文件。

## 2026-11-09 停用规则幂等与前端重新对齐

用户原话：

> “对同一规则的重复停用请求应幂等成功，返回当前 disabled 状态，而不是 409；正常首次停用、批准、拒绝、删除、查看能力不变。”
>
> “如果后端已实际 disabled 但请求失败，前端要立即重新读取/对齐该员工成长数据，不能继续显示旧‘已生效’；后续三条执行链应立即不再加载该规则。不要做无关视觉重构。”
>
> “对底层持久化失败保持原有真实错误，不把真正失败伪装成成功；只把‘已经是 disabled’的重复停用视为幂等成功。”
>
> “不提交、不推送、不发布、不重启。”

根因事实：原停用请求没有传递 `requestId`；存储对任何非 `approved` 状态再次停用都返回 409。前端停用失败后没有重读，因此后端已停用但响应丢失时继续显示旧“已生效”。原风控证据为 `/tmp/negus-review-idempotency.log`，其中 `disableAgain` 为 `statusCode: 409`。

本轮实现：

- 复用成长存储已有请求标识模式：停用 API、路由和服务均传递 `requestId`；前端为同一员工、规则和动作保留同一标识，直到收到成功响应或重新读取确认目标状态。
- 存储将规则状态写入串行化。对已经是目标状态的重复停用直接返回当前记录，不追加日志或广播；首次写入失败时恢复原状态、状态时间、请求标识和日志并继续抛出原错误，避免内存假成功。
- 前端停用成功和请求异常两条路径都立即读取 `/api/employee-growth`。读取确认 `disabled` 时清除该次错误、面板显示“已停用”；失败仍未对齐时保留真实错误。既有请求代次继续丢弃迟到的读取、轮询和 SSE 响应。
- 重新读取后的共享规则源在员工主对话、群会话和后台任务下一轮均不再含已停用规则；运行中的旧轮次快照保持不变。

本轮代码量按修复开始时工作区计算，不含先前员工规则实现、其他并发未提交改动、文档和日志。业务代码 **+54/-9**，测试 **+171/-2**：

| 文件 | 本轮新增/删除 |
| --- | ---: |
| ui-feishu/shared/features/employee-growth/data/employeeGrowthApi.ts | +1/-1 |
| ui-feishu/shared/features/employee-growth/hooks/useEmployeeGrowth.ts | +27/-4 |
| windows/server/employee-growth-service.mjs | +2/-2 |
| windows/server/employee-growth-store.mjs | +23/-1 |
| windows/server/routes/employee-growth-routes.mjs | +1/-1 |
| windows/tests/employee-growth-project-directory.test.mjs | +74/-2（测试） |
| ui-feishu/validation/employee-growth-idempotency.test.mjs | +88/-0（测试） |
| ui-feishu/validation/employee-growth.fixture.tsx | +4/-0（测试夹具） |
| ui-feishu/validation/employee-growth.html | +5/-0（测试夹具） |

验证结果：

- `node --test windows/tests/employee-growth-project-directory.test.mjs windows/tests/employee-runtime.test.mjs windows/tests/multi-agent-service.test.mjs ui-feishu/validation/employee-task-extension.test.mjs ui-feishu/validation/group-task-service.test.mjs ui-feishu/validation/group-extension.test.mjs ui-feishu/validation/employee-growth-idempotency.test.mjs`：**74/74 通过**，日志 `work/employee-memory-20261109/idempotency-focused-tests.log`。覆盖首次/同 requestId/新 requestId 重复停用、真实路由、并发持久化失败回滚、三条执行链下一轮不含规则，以及隔离 Vite + Chromium 中正常停用、响应丢失后重新对齐、迟到旧读取不覆盖最终状态、失败后再点复用同一 requestId。
- `ui-feishu` 下 `./node_modules/.bin/tsc -p tsconfig.json --noEmit`：通过，日志 `work/employee-memory-20261109/idempotency-tsc.log`。
- `ui-feishu` 下 `./node_modules/.bin/vite build --config vite.config.ts`：通过；保留既有 `use client` 被忽略和大于 500 kB chunk 提示，日志 `work/employee-memory-20261109/idempotency-build.log`。仅写工作区 `dist`，未发布。
- `git diff --check`：通过。`ConversationView.tsx` 与 `useReturnToBottom.ts` 无 diff；SHA-256 分别为 `431bef02bd4c1367956b4c1dddfc447c0a01036d6b8ea22b8ee307614b587cac`、`7d01c92055aaca35d61801c572717473d2e71ffa1f6f007acddc428c8eb0ef1a`。

当前状态：develop 工作区，HEAD `5d53cc71fc8828315d47b76240255ba4f3a0f48e`，与 `origin/develop` 差距 0/0。未提交、未推送、未发布、未重启，运行服务尚未加载本轮后端与前端代码。隔离浏览器测试只证明夹具中的交互链路，不代表生产登录态浏览器或真实模型效果。剩余风险是实际服务重启后仍应做一次真实页面停用/断网重试检查；本轮没有已知代码阻塞。

## 2026-11-09 删除失败审计字段回滚补修

来源：原风控任务增量复核后的本轮用户要求。用户明确要求：“持久化删除失败时，state、status、statusChangedAt、statusRequestId 及已有日志/变更记录全部恢复为删除前快照，不产生虚假审计记录；再次重试仍按幂等逻辑工作。” 同时要求 approved/disabled 两种场景逐项恢复、成功重试正确删除，并确保其他并发写入不相互覆盖。

复核证据：`/tmp/negus-review-rollback-metadata.log` 显示 disabled 规则删除失败后，`status` 已恢复为 `disabled`，但 `statusChangedAt` 和 `statusRequestId` 被删除；日志数量没有增加，上下文保持为空。

本轮实现：删除失败时不再分别修改 `status` 和删除审计字段，而是清空当前 proposal 的字段后整体写回删除前快照，因此原状态、审计时间、请求标识及其他已有字段一致恢复。失败删除写入的日志按其本次独立 ID 撤销；回滚时合并失败前日志与同期其他操作追加的日志，并继续遵守 500 条上限，避免并发日志被旧快照覆盖。成功删除、重复删除以及停用、批准、拒绝、添加逻辑未改。

本轮代码量按本次修复开始时工作区计算，业务代码 **+4/-1**，测试 **+60/-0**：

| 文件 | 本轮新增/删除 |
| --- | ---: |
| windows/server/employee-growth-store.mjs | +4/-1 |
| windows/tests/employee-growth-project-directory.test.mjs | +60/-0（测试） |

验证结果：

- approved 删除真实持久化失败：完整 proposal 和日志与删除前快照逐项相等，上下文仍含规则；恢复写盘后重试成功删除，再重复删除保持 `deleted` 且不追加状态日志。
- disabled 删除真实持久化失败：`status=disabled`、原 `statusChangedAt`、原 `statusRequestId` 及完整 proposal 与删除前快照逐项相等，上下文仍为空；并发追加日志在失败后保留，并在成功重试后落盘，失败删除自己的日志和 requestId 不进入持久化文件。
- `node --test windows/tests/employee-growth-project-directory.test.mjs windows/tests/employee-runtime.test.mjs windows/tests/multi-agent-service.test.mjs ui-feishu/validation/employee-task-extension.test.mjs ui-feishu/validation/group-task-service.test.mjs ui-feishu/validation/group-extension.test.mjs ui-feishu/validation/employee-growth-idempotency.test.mjs`：**76/76 通过**，日志 `work/employee-memory-20261109/rollback-metadata-tests.log`。
- `ui-feishu` 下 `./node_modules/.bin/tsc -p tsconfig.json --noEmit`：通过，日志 `work/employee-memory-20261109/rollback-metadata-tsc.log`。
- `git diff --check`：通过。受保护的 `ConversationView.tsx`、`useReturnToBottom.ts` 无 diff。

当前状态：仍为 develop 工作区源码，未提交、推送、发布或重启；运行服务尚未加载本轮存储修复。没有已知代码阻塞，等待原风控任务对本次审计字段回滚结果做增量复核。
