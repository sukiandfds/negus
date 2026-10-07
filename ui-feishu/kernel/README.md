# Negus 共用消息与任务内核

本目录不依赖 React、群聊页面或具体员工。群聊适配器位于 `../server/group-task-service.mjs`，员工主对话及独立任务对话适配器位于 `../server/employee-task-extension.mjs`。

## 已实现的产品行为

- 明确点名优先；未点名时按成员职责由模型选择一位现有员工。失败或返回非成员时交给现有接待成员（优先 negus助手，否则群中首位成员），不会创建可见的新助手。
- 消息先持久化接收记录，再返回；选人、启动执行随后进行。选人使用短请求，超时只影响选人并触发接待兜底，不是任务执行时限。
- 外派使用真正的工具调用，持久化后立即返回。任务有独立的现有会话绑定；来源员工可以结束本轮，结果回到来源会话继续处理。
- 同一执行会话串行，不同执行会话可以并行；允许多轮交接。相同 requestId 幂等，原样重复的交接链会提示读取已有结果，修订后的工作可以继续。
- 停止具体任务先记录请求，再等待真实运行时终态；停掉来源后，晚到结果不会再次唤醒它。全群停止不产生新的结果汇总执行。
- 重启先读取原会话及执行编号，不盲目重新开始。原执行仍存在则观察；已结束则恢复结果；确认空闲且原执行未完成则标为中断；不确定时保留待核对状态，并周期重查。
- 结果写入与续接使用持久化投递记录。群消息按任务 workId 去重，单聊按任务结果标记及现有发送队列核对。投递失败保留状态，可重试。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `message-routing.mjs` | 校验候选成员、点名优先、自动选择和兜底 |
| `message-inbox.mjs` | 接收日志、消息幂等发布、选人结果保存、重启补派 |
| `task-kernel.mjs` | 持久化任务、执行队列、外派关系、结果投递、停止和恢复 |
| `native-task-runtime.mjs` | 复用现有原生客户端，跟踪 thread/turn、隔离旧事件、核对丢失完成事件 |
| `task-tools.mjs` | 只绑定来源员工/任务的本机工具桥接，不暴露通用 API 凭据 |
| `task-tools-mcp.mjs` | `delegate_task`、`list_tasks` 工具协议 |

## 接入约定

`createTaskKernel({stateFile, runtime, deliver, validate, broadcast, log})` 返回 `enqueue`、`delegate`、`cancel`、`get/list`、`reconcile`、`retryDelivery` 和 `close`。

- `enqueue` 需要稳定的 requestKey、conversationId、agentId、lane，以及任务内容。返回代表已保存，不代表已完成。
- `runtime.execute(task, controls)` 执行新任务；`runtime.observe` 只核对原执行。通过 `controls.checkpoint` 在外部动作前保存必要编号，通过 `controls.started` 确认启动。`controls.signal` 用于停止。
- 运行适配器只能用 `completed/failed/interrupted` 表示已确认的终态；无法确认时返回 `unknown` 或抛出 `ambiguous` 错误。
- `deliver({id, task})` 必须按 id 去重。不能把向网络发出请求当成已完成投递。
- `validate` 由调用方核对可用员工和来源范围；内核不自行创建身份，也不扩大员工原有权限。
- 每个状态目录由一个后台实例持有。部署到新的运行环境时，应提供该环境自己的状态目录、现有员工注册表和原生客户端。

新 UI 通过 `../server/register.mjs` 在加载时接入这些适配器。接入点改变会明确报错，不会静默回到旧流程。原有文件不在磁盘上改写；旧后台调研记录仍可读取。

## 后端记录

日志使用 `scope=negus-tasks`，按 messageId、taskId、conversationId、agentId 关联选人、接单、执行、终态和结果投递。任务状态文件另外保存来源关系及原生 threadId/turnId。日志不记录工具桥接令牌。

## 验证

见 `../validation/TASK_KERNEL_RESULTS.md`。该文件区分自动测试、真实模型调用和界面检查。早期竞品研究的 62 条候选验收是更广的产品调研范围，不代表本次全部实施或通过。
