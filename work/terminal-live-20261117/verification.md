# FEAT-002 完成态被旧 live 覆盖：源码修复与自测

2026-11-17。结论：修复与隔离自测完成，待来源对话安排 DeepSeek 独立审核。未提交、推送、发布或重启 Negus，未截图、未发送真实测试消息。当前服务仍使用原发布快照。

## 根因复核与真实操作变化

方向一致，且以开工工作区为基线复现，而非回退 FEAT-001 修复。第一项已通过 bodyRevisions 消除纯 context_status 对 live 清理的阻碍；本项仍需处理正文 dirty/慢读时的独立执行态、新事件保护，以及目录无条件采用 live active。baseline-repro.log 得到 committed=completed、live=working、selectedActive=true、directoryProjectionActive=true。任务账本定向复核：现场 A 为 delegation/background/completed；现场 B 为 external/completed；见 incident-tasks.json。没有用局部任务列表推断所有后台任务都已结束。

用户操作与逻辑链：

- 用户打开员工任务，等待最终答复：修前旧 live 覆盖完成快照，标题/员工行仍显示运行；修后完成证据清除旧执行层，最终正文保留，标题和员工行空闲。
- 用户在慢读取期间收到上下文状态：context_status 只更新用量，正文不重读；即使另有真实正文失效，执行态仍独立按事件 epoch/seq、时间以及读取期间新 turn 证据合并。
- 用户在上一轮读取返回前开始下一轮：更新的同 epoch 事件或有依据的新 turn 保留 active，旧完成快照不误清。
- 完成 SSE 丢失，目录已 completed：目录完成态压过无更新证据的 live，并写回现有 Store；当前标题、员工行及发送/队列控制一致。浏览器测试实际点击发送（全 API 拦截），确认进入发送接口而非残留旧队列。
- 用户刷新、重连、恢复页面或加载缓存：权威终态到达后旧 live/缓存不复活运行。
- 外部来源对话 external 保持从任务 API/员工后台子项排除；真实 background 运行时计数，完成后 active 归零。
- 原任务连续无法核对：首轮 unknown/模糊异常计一次，连续三次后 interrupted 并保留最后实际错误；计数落盘，重启不清零。核对到真实 active 时清零连续失败数，继续观察真实任务，不伪造 completed。未新增状态或轮询。

## 本轮逐文件增量

相对开工工作区，不包含原 FEAT-001、FEAT-003 或 Mermaid 改动。精确差异见 changes.patch、numstat.json。

| 文件 | 新增/删除 | 原因 |
|---|---:|---|
| ui-feishu/shared/features/conversations/state/conversationStore.ts | 54/9 | 复用字段版本和事件证据；独立清理旧执行层，保存较新事件元数据，保留新 turn、流式和最终正文，防旧事件复活及慢读取覆盖目录完成态 |
| ui-feishu/src/conversationDirectory.ts | 16/8 | 目录终态优先于无更新证据的 live；选中与非选中共用规则；父行不再用 OR 将旧主对话 active 复活 |
| ui-feishu/src/usePageSnapshot.ts | 10/3 | 当前标题采用同一状态投影；目录终态写回现有 Store，使发送/队列控制与显示一致，不触发正文读取 |
| ui-feishu/kernel/task-kernel.mjs | 19/6 | 持久化连续失败数，三次上限，interrupted 收敛并保留错误；active 证据重置计数；重启保留耗尽决定 |
| ui-feishu/validation/conversation-summary.test.mjs | 88/6 | 完成态/新 turn/同 epoch 元数据/100~10000 上下文/正文 dirty/缓存目录/员工主行/慢读回归；旧测试补上其“更新活动”所需时间证据 |
| ui-feishu/validation/conversation-store-browser.test.mjs | 63/1 | 隔离 API fixture 的终态专项入口，覆盖标题、员工行、立即发送、目录完成、新 turn、恢复及缓存 |
| ui-feishu/validation/task-kernel.test.mjs | 42/0 | 重启前后累计失败、上限终止、错误保留、确认 active 后保持运行 |
| ui-feishu/validation/employee-task-extension.test.mjs | 38/0 | 调用实际 GET /api/tasks 路由，验证 recovering/completed external 过滤及 background 活动计数 |

业务代码 +99/-26；测试 +231/-7；合计 +330/-33。FEAT-002 item/updates 另追加当前授权、实现与验证记录，保留旧原话及历史状态。

## 命令与结果

使用现有 Node；Vite 仅作隔离测试源码服务器，未构建/替换线上 dist。浏览器所有 `/api/**` 与 EventSource 均由夹具拦截。运行副本 conversation-store.mjs 仅去掉原测试的截图语句，未调用截图。

```sh
NODE=/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$NODE --test windows/tests/context-management-service.test.mjs windows/tests/conversation-send-state.test.mjs windows/tests/conversation-loading.test.mjs windows/tests/conversation-batch.test.mjs windows/tests/conversation-controls.test.mjs windows/tests/conversation-source-revision.test.mjs windows/tests/page-snapshot-pending.test.mjs ui-feishu/validation/conversation-summary.test.mjs ui-feishu/validation/task-kernel.test.mjs ui-feishu/validation/native-task-runtime.test.mjs ui-feishu/validation/employee-task-extension.test.mjs ui-feishu/validation/group-task-service.test.mjs
$NODE ui-feishu/node_modules/typescript/bin/tsc -p ui-feishu/tsconfig.json --noEmit
NEGUS_TEST_TERMINAL_LIVE=1 $NODE work/terminal-live-20261117/conversation-store.mjs
$NODE ui-feishu/validation/conversation-refresh-policy-browser.test.mjs
$NODE work/terminal-live-20261117/conversation-store.mjs
$NODE work/context-storm-20261117/conversation-batch.mjs
$NODE work/terminal-live-20261117/baseline-repro.mjs
git diff --check
git diff --exit-code -- ui-feishu/shared/features/conversations/components/ConversationView.tsx ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts
```

- regression.log：200/200，通过；types.log：退出 0。
- terminal-browser.log：1000 context_status 慢读后完成态、最终正文、当前标题及员工行；目录单独完成后直接发送；旧完成快照保留更新 turn；刷新/重连/页面恢复及缓存 reload 通过，退出 0。
- storm-browser.log：20 对话预热，100、1000、10000 context_status 各档新增正文请求均 0；中英文输入、删除、光标、焦点及 DOM 身份稳定，longTasks=[]；标题元数据、真实消息、慢响应/同线程去重、终态与重复终态、409/手动恢复通过，退出 0。
- store-browser.log：发送确认/重复事件/连续同文、失败与占用附件持久化、缓存 A/B、快速切换、pending 迁移、运行时追加、队列/停止、模型、Goal/提问、历史分页与断线恢复通过，退出 0。
- batch-browser.log：首批十条、后续批次、失败保留、归档恢复通过，退出 0。
- public-tasks.log：实际任务扩展与 API 路由夹具通过；所有供应商请求由内存 client 处理。
- baseline-repro.log：修改前残留旧 live 的可重复证据。首次自测暴露的新发送确认兼容问题已修正；集成夹具缺 resolveRoute 的错误已补齐。最终测试日志以上述最终结果为准。
- workspace-status.txt、diff-check.log：工作区、受保护文件及格式检查证据。

## 覆盖边界与工作区

验证范围是源码单元、真实任务内核/路由配内存供应商、Chrome 无头浏览器配隔离 API，不是生产模型或手机公网验收。生产发布、生产交互及真实供应商端到端未执行，原因是本轮明确禁止发布/重启/真实发送；没有将测试通过称为运行服务已生效。DeepSeek 审核由来源对话后续安排，本执行者没有另行派工。

develop / dfe8bcf5213992adbf97cb643d80516d64119a7e。本地 origin/develop 引用与 HEAD 差异 0/0（未 fetch、未推送）。原 FEAT-001 context_status 修复、FEAT-001/002/003 文档与 Mermaid 未提交改动保留。受保护 ConversationView.tsx、useReturnToBottom.ts 零差异，无滚动/虚拟列表修改。未提交或操作 main。本项代码没有剩余失败测试；待办为来源对话独立审核与另获授权后的发布/线上验收。
