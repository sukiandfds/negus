# FEAT-002 群聊多人协作路由与问号状态答复验证

## 基线与边界

- 基线：`develop / da472564fe9456593bd37c65954013a048c04730`，与 `origin/develop` 相同。
- 保留全部既有 `work/` 未跟踪验证目录。
- 受保护文件 `ui-feishu/shared/features/conversations/components/ConversationView.tsx`、`ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts` 零 diff。
- 未提交、未推送、未发布、未重启，未发送真实群聊消息，未修改运行中的群历史。

## 实现覆盖

- 明确多人协作或至少两个岗位信号：仅按当前消息识别，运营提示包含固定 requestId/员工/职责；模型通过现有 `delegate_task` 创建员工任务。历史多人消息不会污染后续简单消息。
- 实现能力信号：当前消息出现更新数据、页面/网站、构建、发布、上线、接口、可视化、图表、对比时强制包含技术研发。逐字 iPhone 18 Pro 请求实际创建产品分析+技术研发任务，不再固定补产品分析+风控。
- 通用协作：当前消息只有“几个人/合作/分工”但没有实际岗位信号时，不机械创建 researcher/reviewer；只创建运营任务并要求澄清具体工作和岗位。
- 分工发布时机：对应员工任务全部落账后才发布运营署名说明；运营启动失败时不会留下虚假“已分工”。正常完成、直接返回终态和遗漏完成事件后的权威 history 恢复共用同一发布/补派路径。
- 运营成功轮次漏派：使用同一 `createTaskKernel.delegate` 补齐缺失岗位；已有同岗位子任务时不补，重复终态事件不多建，`continuation/delegation/followup` 不再次展开。
- 简单单岗位消息不走分工；明确 `@` 路由保持原样，即使正文包含多人、多岗位词汇；不命中岗位的 grok 不被拉入。计划内委派即使模型传入 `notifySource=true` 也不生成结果 continuation，计划不会传播到子任务。
- 仅“?”/“？”直接读取现有任务账本，显示当前或最近任务、负责人、状态；无任务或群内没有员工时请求澄清，不创建模型任务。
- 员工结果仍通过现有 task delivery 写回群消息，使用员工本人 `agentId`、姓名和原 commentary/SSE 链路。

## 测试命令与结果

统一 Node：`/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。

定向：

```sh
"$NODE" --test ui-feishu/validation/group-collaboration.test.mjs ui-feishu/validation/group-task-service.test.mjs
```

结果：28/28 通过，0 失败。覆盖逐字 iPhone 18 Pro 请求包含技术研发、通用无岗位请求不虚构员工、真实群路由、真实 stdio MCP `delegate_task`、分工发布时机、模型漏派补建、遗漏完成事件的 history 恢复、重复终态去重、越界派工拒绝、员工本人回群、简单任务短路径、历史多人消息隔离、问号状态答复（含零员工群）、明确 `@` 优先、停止与认证刷新。日志：`technical-review-targeted.log`。

相关回归：

```sh
"$NODE" --test ui-feishu/validation/group-collaboration.test.mjs ui-feishu/validation/group-task-service.test.mjs ui-feishu/validation/group-extension.test.mjs ui-feishu/validation/native-task-runtime.test.mjs ui-feishu/validation/task-kernel.test.mjs ui-feishu/validation/employee-task-extension.test.mjs windows/tests/group-room-store.test.mjs windows/tests/group-routes.test.mjs windows/tests/message-handoff.test.mjs windows/tests/agent-publication.test.mjs windows/tests/task-attribution-projection.test.mjs windows/tests/execution-tracker.test.mjs
```

结果：155/155 通过，0 失败，0 跳过。日志：`technical-review-regression.log`。

静态检查：

```sh
"$NODE" ui-feishu/node_modules/typescript/bin/tsc -p ui-feishu/tsconfig.json --noEmit
"$NODE" --check ui-feishu/kernel/message-routing.mjs
"$NODE" --check ui-feishu/server/group-task-service.mjs
"$NODE" --check ui-feishu/validation/group-collaboration.test.mjs
git diff --check
```

结果：全部 exit 0；TypeScript 日志：`technical-review-typescript.log`。

需求记录读取：

```sh
"$NODE" --test windows/tests/project-management.test.mjs
```

结果：5/5 通过。日志：`technical-review-project-management.log`。

## 对照证据

- `technical-review-targeted.log` 含 iPhone 18 Pro 逐字请求创建 researcher/developer、`coordination_clarification` 不创建员工、真实 `delegate_task` 用例通过、history 恢复与最终 28/28。
- `technical-review-regression.log` 含上述路径、原生任务停止/重启恢复和 155/155 汇总。
- 运行服务没有加载本次源码；真实供应商聊天、真实公网页面和发布后效果不在本轮执行。

## 代码边界

- `employees/manager/system-prompt.md`：+3/-0。
- `ui-feishu/kernel/message-routing.mjs`：+67/-0。
- `ui-feishu/server/group-task-service.mjs`：+133/-15。
- `ui-feishu/validation/group-collaboration.test.mjs`：+231/-7。
- 没有新增 UI、状态表、队列或并行任务系统；复用现有群任务账本、stdio MCP、员工身份、commentary 和 SSE。
