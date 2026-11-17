# 快速追加与响应前审批两个发布阻断

## 结论

两个发布阻断均已在工作区源码修复，相关真实适配链路测试通过。当前可以交风控审查；未提交、未发布、未重启，运行服务尚未加载本次代码。

工作区基线：`develop / dfe8bcf`。原有未提交改动均保留，受保护滚动文件无差异。

## 用户操作变化

快速追加：

- 修改前：员工刚回答完，页面状态尚未回落时立即发送第二条；第二条准备期间旧 turn 结束，代码若继续发送 `turn/steer`，可能显示“被占用中”，但第二条没有执行。
- 修改后：发送前读取原生线程状态；原 turn 已结束时，第二条以相同输入、附件和 `clientUserMessageId/requestId` 发送一次 `turn/start`，最终显示并收到结果。若前一次 `turn/steer` 明确返回原 turn 已结束，只在确认没有其他活动 turn 后安全重试一次；已有其他活动 turn 时保留“被占用中”。

响应前审批或补充输入：

- 修改前：审批、`requestUserInput` 或 elicitation 早于 `turn/start` 响应时，状态先进入等待但 turnId 尚未建立；随后正文与 completed 被拒绝，界面可能一直等待。
- 修改后：这些事件先进入本次 submission 的既有缓冲，不提前进入 execution tracker。确认 turnId 后先绑定，再按到达顺序回放；审批可短暂显示等待，随后正文正常显示，员工与 execution 最终回到 idle。旧 turn、旧线程事件不会回放。

## 核心实现

- `sendMessage` 在请求发出前读取员工当前状态和原生 `thread/read` 权威状态；权威状态为 inactive 时选择 `turn/start`。
- 明确的原 turn 已结束 409 先重读权威状态；无活动 turn 时复用同一输入与 request id，只重试一次 `turn/start`；已有其他活动 turn 时不重发。
- 409 的最终状态由权威状态决定；权威状态 inactive 时不再永久显示 occupied/active。
- approval、`requestUserInput`、elicitation 与既有 early started/delta/final/completion 使用同一个按 submission 的 early-events 缓冲。
- turn/start 响应绑定允许 active 且 turnId 为空；已有不同 turnId 时丢弃旧响应及缓冲。
- 原生权威状态识别补充 `inProgress` 对象状态和未完成 turn，避免 active turn 被误判为已结束。
- 未新增状态表、队列、轮询或定时器。

## 文件与增删

本次任务新增/修改段落：

- `windows/server/employee-runtime-service.mjs`：+79/-18。
- `windows/tests/employee-runtime.test.mjs`：+105/-0。
- `ui-feishu/validation/realtime-regression.test.mjs`：+76/-2。
- `docs/project-management/items/FEAT-002/item.md`：追加问题原文、有效决定和用户体验。
- `docs/project-management/items/FEAT-002/updates.md`：追加交付状态和测试证据。
- 本文件：验证记录。

上述 runtime 与 employee-runtime 测试文件的当前工作区总差异还包含任务开始前已有的未提交改动；本轮只在其上增加上述阻断修复相关段落。

## 测试

最终命令与结果：

```text
node --test windows/tests/employee-runtime.test.mjs
tests 38 / pass 38 / fail 0

node --test ui-feishu/validation/employee-provider.test.mjs
tests 13 / pass 13 / fail 0

node --test ui-feishu/validation/realtime-regression.test.mjs
tests 10 / pass 10 / fail 0
```

合计 61/61 通过。原始输出见：

- `employee-runtime.log`
- `employee-provider.log`
- `realtime-regression.log`

新增覆盖：

- 第二条准备期间第一步完成，最终不出现错误 occupied，同一 requestId 只走一次 `turn/start`。
- `turn/steer` 明确返回原 turn 已结束，无其他活动 turn 时用同一 input 和 requestId 改走一次 `turn/start`。
- `turn/steer` 明确返回原 turn 已结束，但已有另一活动 turn 时不重发，按真实 occupied 返回。
- approval 早于 turn/start 响应，response 后 final + completed：正文一次，员工与 execution 最终 idle。
- requestUserInput 早于 turn/start 响应，同一链路正常收敛。
- 旧 turn 和旧线程 approval 不进入员工等待态、不回放。
- 既有早到带 ID 全链、steer 正常、无 turnId completed、运行中线程恢复及重启相关回归继续通过。

## 语法、差异与保护

以下命令均通过：

```text
node --check windows/server/employee-runtime-service.mjs
node --check windows/tests/employee-runtime.test.mjs
node --check ui-feishu/validation/employee-provider.test.mjs
node --check ui-feishu/validation/realtime-regression.test.mjs
git diff --check
```

输出见 `syntax-and-diff.log`。

受保护文件检查：

```text
ui-feishu/shared/features/conversations/components/ConversationView.tsx
ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts
```

两份文件相对 HEAD 无差异，输出为空，见 `protected-files.log`。

## 风险与边界

- 没有真实 Codex/DeepSeek 供应商消息、手机页面或运行服务发布后验收；本轮按授权只做源码、隔离协议与真实适配链路测试。
- 权威状态读取失败时，明确的原 turn 已结束 409 不会盲目重发；仍按现有 occupied 语义处理，避免重复执行。
- 没有新增持久化恢复机制；重启恢复继续复用仓库既有原生线程检查与回归覆盖。

## 状态

- 已实现：工作区源码和测试。
- 已验证：61 项定向测试、相关 MJS 语法、`git diff --check`、受保护文件零差异。
- 未发布、未重启、未提交、未推送。
- 当前可交风控审查，不能据此声称运行服务已生效。

## 风控复核后的两个状态覆盖竞态

### 结论

风控指出的两项状态覆盖竞态已在工作区修复：

- 迟到旧审批、旧 elicitation 或已绑定后的无 ID 等待事件，不再点亮 idle/completed 员工，也不覆盖已有 waiting 文案。
- `turn/steer` 响应不再用 working 覆盖响应前已经进入的 waitingOnApproval/waitingOnUserInput，只补 confirmedTurnId。

当前可再次交风控审查。未提交、未发布、未重启。

### 用户操作变化

- 修改前：员工已经完成或正在等待另一种输入时，迟到 approval/elicitation 仍可能把状态点亮或换掉；steer 处理中先出现“等待补充信息/等待原生审批”，接口响应后又被改回“正在处理”。
- 修改后：旧 turn、旧线程、idle/completed 和已绑定后的无 ID 等待事件被直接拒绝，不进入 employee 或 execution；steer 返回后原等待 phase、label 和 active 保持不变，final/completed 到达后正常 idle。

### 本轮实现

- 等待类事件在 execution 前校验 employee active、current.turnId 和事件 turnId。
- 无 turnId 等待事件只在 submitted 空 turnId 的本次 submission 缓冲；confirmedTurnId 后回放时注入 `turnId` 与 `turn.id`。
- submitted 之外的已绑定无 ID 等待事件拒绝；旧 turnId 拒绝；idle/completed 拒绝。
- 员工已经处于 waitingOnApproval/waitingOnUserInput 时，不接受另一等待 phase 覆盖原 phase 和文案。
- steer 响应只在 submitted/working 发布 working；waiting 状态仅补 turnId；不同 turnId 仍按旧响应竞态丢弃。

### 本轮文件增删

- `windows/server/employee-runtime-service.mjs`：+33/-20。
- `ui-feishu/validation/realtime-regression.test.mjs`：+131/-2。
- FEAT-002 `item.md`、`updates.md` 和本验证记录：追加本轮决定、体验、测试和未发布状态。

### 本轮测试

```text
node --test windows/tests/employee-runtime.test.mjs
tests 38 / pass 38 / fail 0

node --test ui-feishu/validation/employee-provider.test.mjs
tests 13 / pass 13 / fail 0

node --test ui-feishu/validation/realtime-regression.test.mjs
tests 15 / pass 15 / fail 0
```

合计 66/66。新增覆盖：

- active current turn 收到旧 turnId approval/elicitation 后，员工和 execution 状态均不变；已绑定后的无 ID 等待事件同样拒绝。
- 已有 waitingOnUserInput 时，同 turn 的后到 approval 不覆盖 waiting phase、文案或 execution。
- idle/completed 收到旧 approval 后不重新点亮员工或 execution。
- 无 turnId approval 在 turn/start 响应前缓冲，确认后注入 current turn ID，员工和 execution 各显示一次 waiting。
- steer 响应前进入 waitingOnUserInput，响应后保留 phase/label/active 并补 turnId；随后 final/completed 回到 idle。
- steer 响应前进入 waitingOnApproval，同一链路通过。
- 既有快速追加、早到 full output、无 ID completion、steer 正常、重启恢复和普通对话回归全部通过。

最终 MJS 语法、`git diff --check` 和受保护文件零差异检查见同目录日志。

### 本轮状态

- 已实现：工作区源码和测试。
- 已验证：66 项定向测试、相关 MJS 语法、`git diff --check`、受保护文件零差异。
- 未提交、未推送、未发布、未重启。
- 可再交风控审查，不能据此声称运行服务已生效。

## steer 失败时保留请求后实时等待

### 结论

风控剩余的时序阻断已修复：`turn/steer` 发出后才进入 waiting，随后失败时，实时 waiting 不再被请求前 working snapshot 覆盖。当前可再交风控审查；未提交、未发布、未重启。

### 用户操作变化

- 修改前：员工原本工作中，追加消息发起 steer 后模型开始请求审批或补充信息；若 steer 普通/网络失败，代码恢复旧 working snapshot，刚显示的等待状态被覆盖。
- 修改后：same-turn-active 或 authoritative-unknown 失败分支先读取实时状态；同 turn 已 waiting 时保留 waiting phase、文案、active 和 turnId。没有新 waiting 时仍恢复原 working，异 turn/inactive/close 语义不变。后续 final/completed 正常回到 idle。

### 本轮实现

- steer same-turn-active 分支在恢复 snapshot 前调用实时 status 检查。
- authoritative unknown 分支同样先检查实时 waiting。
- 仅当 live active、turnId 等于 requestSnapshot.turnId，且 phase 为 waitingOnApproval/waitingOnUserInput 时跳过 restore。
- different active turn 仍优先显示 authoritative occupied；inactive 仍 idle；close 门禁未改。

### 本轮文件增删

- `windows/server/employee-runtime-service.mjs`：+6/-0。
- `ui-feishu/validation/realtime-regression.test.mjs`：+82/-0。
- FEAT-002 `item.md`、`updates.md` 和本验证记录：追加本轮决定、体验、测试和未发布状态。

### 本轮测试

```text
node --test windows/tests/employee-runtime.test.mjs
tests 38 / pass 38 / fail 0

node --test ui-feishu/validation/employee-provider.test.mjs
tests 13 / pass 13 / fail 0

node --test ui-feishu/validation/realtime-regression.test.mjs
tests 27 / pass 27 / fail 0
```

合计 78/78。新增覆盖：

- turn/steer 发出后收到 requestUserInput，普通失败且 authoritative 同 turn active：员工与 execution 保持 waitingOnUserInput、label、active、turnId，随后 final/completed 回 idle。
- 同一链路改为 approval + 网络失败：保持 waitingOnApproval。
- authoritative unknown：仍保留请求后实时 waitingOnUserInput。
- 对照：steer 期间没有 waiting，same-turn active 普通失败仍恢复原 working snapshot。
- 既有 74 项、快速追加、早到 output/waiting、无 ID completion、restart、目录和普通对话回归全部通过。

最终 MJS 语法、`git diff --check` 和受保护文件零差异检查见同目录日志。

### 本轮状态

- 已实现：工作区源码和测试。
- 已验证：78 项定向测试、相关 MJS 语法、`git diff --check`、受保护文件零差异。
- 未提交、未推送、未发布、未重启。
- 可再交风控审查，不能据此声称运行服务已生效。

## 失败、旧响应与 close 状态覆盖

### 结论

风控剩余的旧响应、steer 失败和 close 三条状态覆盖路径已修复。当前可再交风控审查；未提交、未发布、未重启。

### 用户操作变化

- 修改前：等待审批或补充信息时再次发送，旧 turnId 响应或 steer 普通/网络失败可能把状态改成 failed、occupied 或 inactive；运行时关闭后迟到的响应仍可能发布状态或回放正文。
- 修改后：旧响应明确结束本次 continuation，员工和 execution 保持原 waiting/working；steer 失败按原生权威状态恢复 waiting/working、显示真实 occupied、进入 idle，或保留快照；关闭后只清理本次提交，不再发布状态或显示正文。

### 本轮实现

- 请求前保存 phase、label、detail、active、turnId。
- 不同 turnId 的旧响应先清空 early buffer，再抛出“响应属于其他任务”；该错误标记为状态已处理，通用 catch 不再发布 occupied/failed。
- steer 失败读取 authoritative：
  - 同 turn active：恢复请求前 snapshot。
  - 不同 turn active：发布 occupied 和 authoritative turnId。
  - inactive：发布 idle。
  - unknown：恢复 snapshot。
- 原 turn 已结束的 409 仍保留既有“无新 active turn 时重试一次 turn/start”行为；turn/start 失败沿用原安全语义。
- close 后的发送异步返回、catch、状态发布和回放均有门禁；`publishStatus` 在 closed 时直接跳过员工与 execution 广播，finally 只清理 submission/buffer。

### 本轮文件增删

- `windows/server/employee-runtime-service.mjs`：+87/-2。
- `ui-feishu/validation/realtime-regression.test.mjs`：+167/-0。
- FEAT-002 `item.md`、`updates.md` 和本验证记录：追加本轮决定、体验、测试和未发布状态。

### 本轮测试

```text
node --test windows/tests/employee-runtime.test.mjs
tests 38 / pass 38 / fail 0

node --test ui-feishu/validation/employee-provider.test.mjs
tests 13 / pass 13 / fail 0

node --test ui-feishu/validation/realtime-regression.test.mjs
tests 23 / pass 23 / fail 0
```

合计 74/74。新增覆盖：

- waitingOnUserInput 收到不同 turnId 的 steer response：员工与 execution 保持 waiting、label、active 和 current turnId，无正文回放。
- waitingOnApproval 通过同一旧响应链路。
- waitingOnUserInput 下 steer 普通失败、authoritative 同 turn active：保持 waiting。
- waitingOnApproval 下 steer 网络失败、authoritative 同 turn active：保持 waiting。
- steer 失败、authoritative 另一 turn active：员工与 execution 显示 occupied 和另一 turnId。
- steer 失败、authoritative inactive：员工与 execution idle。
- steer 失败、authoritative unknown：保留 waiting snapshot。
- close 前已发起 send，响应后返回：发送被拒绝，员工与 execution 状态不再变化，early buffer 的 final/completed 不回放。
- 既有快速追加、早到 output/waiting、无 ID completion、steer 正常、restart、目录和普通对话回归全部通过。

最终 MJS 语法、`git diff --check` 和受保护文件零差异检查见同目录日志。

### 本轮状态

- 已实现：工作区源码和测试。
- 已验证：74 项定向测试、相关 MJS 语法、`git diff --check`、受保护文件零差异。
- 未提交、未推送、未发布、未重启。
- 可再交风控审查，不能据此声称运行服务已生效。
