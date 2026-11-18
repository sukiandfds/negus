# FEAT-002 查询工具选择修复验收

基线：develop / dfe8bcf5213992adbf97cb643d80516d64119a7e。本地 HEAD 与本地 origin/develop 引用差异 0/0（未 fetch）。未提交、推送、发布、重启、截图或发送真实测试消息。待来源对话安排 DeepSeek 审核。

根因：computerInstructions 原来无查询/界面选择前置条件，node_repl 优先、工具发现、先截图均为泛化要求；旧后台 workerInstructions 仅用 basePrompt 覆盖 developer instructions，未继承 computer 规则。

用户操作前后：输入“查项目日志/API/Git/服务状态”，原提示易引向发现电脑工具→截图→识别坐标；新提示要求直接 shell/只读文件/API→返回可核对数据。输入“检查真实页面显示/操作界面”，仍可用 computer，先说明界面必要性，保留权限检查、截图后核验和授权边界。

逐文件本项增减：
- windows/server/computer-control/runtime.mjs：+5/-3，集中定义查询选择并限定现有界面规则。
- windows/server/background-tasks/service.mjs：+2/-1，只给旧后台覆盖提示接入共用函数，不改任务业务。
- windows/tests/query-tool-choice.test.mjs：+65/-0，实际组装前台、全部员工、当前和旧后台提示，校验决策契约及安全边界。
- docs/project-management/items/FEAT-002/item.md：+7/-0，追加本轮授权与实现状态，保留旧原话。
- docs/project-management/items/FEAT-002/updates.md：+8/-0，追加验证与未发布状态。
生产代码合计 +7/-4；含测试和需求记录合计 +87/-4，不含本证据目录。

生成链路：
- app-server-conversation-store.getUserProfilePrompt → loadUserProfilePrompt → computerInstructions（有/无画像均测试）。
- employee-runtime-service → employeeTurnInstructions → computerInstructions（loadEmployeeDefinitions 加载 6 位实际员工）。
- employee-task-extension.taskInstructions/runtimeOptions → employeeTurnInstructions → computerInstructions（员工后台、普通对话后台 resume/turn 均测试；新建线程也复用同一 taskInstructions）。
- background-tasks/service.workerInstructions → computerInstructions（旧后台 resume/turn 均测试，新建会话复用 workerInstructions）。
14 份实际生成 developerInstructions 原文与通过记录：generated-prompts.json。查询矩阵：项目文件、代码、日志、API、Git、服务/运行状态 → 直接数据；必须图形操作、真实页面视觉验收、界面独有步骤 → computer 并说明理由。测试检查提示契约，不模拟模型推理。

Node：/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node（以下 NODE 指此绝对路径）。

执行命令及结果：
```
NEGUS_QUERY_POLICY_EVIDENCE="$PWD/work/query-tool-choice-20261117/generated-prompts.json" "$NODE" --test windows/tests/query-tool-choice.test.mjs windows/tests/computer-control.test.mjs
# 6/6，targeted-tests.log；工具列表、只读 HTTP、MCP 配置，未调用截图/桌面动作。
"$NODE" --test windows/tests/employee-runtime.test.mjs windows/tests/employee-default-model.test.mjs windows/tests/employee-growth-project-directory.test.mjs windows/tests/background-task-model-policy.test.mjs windows/tests/background-task-health.test.mjs ui-feishu/validation/employee-task-extension.test.mjs
# 72/72，regression-tests.log；隔离临时目录及模拟 client，无真实消息。
"$NODE" --check windows/server/computer-control/runtime.mjs
"$NODE" --check windows/server/background-tasks/service.mjs
"$NODE" --check windows/tests/query-tool-choice.test.mjs
git diff --check
# 全部通过。
```

覆盖边界：验证源码生成的提示及现有 MCP/员工/任务回归；不包含真实供应商模型的工具选择、真实 UI 视觉验收及运行服务加载。本任务明确禁止真实测试消息、截图和发布重启，因此没有执行这些步骤。未修改 TypeScript、滚动、发送或群聊业务。computer MCP 配置与员工职责文件原样保留。

工作区保护：baseline.json 保存原有 tracked 差异文件的 SHA-256；FEAT-002 两份 .before 保留任务起点内容，新增记录只追加；其他原有 tracked 改动哈希一致。原有 untracked 文件未写入或删除。
