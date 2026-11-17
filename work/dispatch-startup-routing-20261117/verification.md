# 派工渠道、启动确认与 Negus 入口优先验证

## 现场根因

- 2026-11-17 19:49 的原生子代理使用 `vip` 分组和 `deepseek-flash`，真实错误为 `503 Service Unavailable: 分组 vip 下模型 deepseek-flash 无可用渠道（distributor）`。
- 子代理工具先返回任务名称，实际执行者随后失败；来源对话没有取得启动确认就结束回合。
- Negus 现有后台任务入口能够读取模型目录，但上一版把首选渠道直接固定到任务，缺少可编辑的渠道—模型路由配置，也没有在首选渠道缺模型时自动尝试其他渠道和模型。

## 修复

- `runtime/model-routing.json` 是派工路由配置，列出渠道优先级和每个渠道的模型；`windows/server/model-routing.default.json` 提供新安装默认值。
- `selectTaskRoute()` 先尝试目标模型在首选渠道，再尝试同一模型的其他渠道，随后按配置顺序尝试其他模型；仍无候选时继续使用模型目录中未列出的动态渠道。共享配置刷新失败时继续使用已有目录并记录警告。
- 目标组合最近出现渠道或模型失败时，后续派工跳过该组合并尝试其他配置；任务记录保存 `taskRouting`，包含最终渠道、模型、尝试列表和回退原因。
- 风控 FAIL 后补修：每个渠道模型组合只参考最新终态，后续成功会清除先前失败；默认模型改为读取配置 `defaultModel`；全部候选失败时错误正文和结构化 `details` 同时返回尝试列表；未显式指定思考等级时使用配置值。
- 第二回风控 FAIL 后补修：401、403、408、409、42x、5xx、超时、限流、网络和认证失败都纳入渠道模型失效判断；后续成功仍清除旧失败。群聊首条、重试和补充的新建任务在入队前统一执行渠道模型选择，并持久化 `modelProviderId`、`model`、`reasoningEffort` 和 `taskRouting`。
- 第三回风控 FAIL 后补修：`authentication failed`、`鉴权失败`、`token expired` 等认证失败文本也参与失效判断。群聊运行时无条件应用任务自身的渠道、模型和思考等级；已有员工线程跨渠道时复用 `migrateGroupAgentThread` 转移原线程，转移失败则终止本次任务，不再回退到员工原渠道。新线程启动和运行检查点同时使用任务实际渠道。
- 第四回风控 FAIL 后补修：`无效 token`、`未认证`、`身份验证失败`、令牌或凭据无效等认证错误参与失效判断；员工任务对话自动生成 followup 时，从来源任务继承 `modelProviderId`、`model`、`reasoningEffort` 和 `taskRouting`，同时写入任务顶层和 runtime，任务列表、磁盘记录与实际执行使用同一路由。
- 后台任务和员工交接创建后等待真实 `task_started` 或终态，默认最多 15 秒。工具返回 `startup.confirmed`、实际状态、线程、turn、渠道、模型、思考等级和错误。
- 普通对话的 `delegate_task` 不再要求来源对话本身是员工；真人在普通对话中要求交给明确员工时，由普通来源直接创建到目标员工，同时保留 `assistant:<threadId>` 来源身份。
- 启动等待超时保留 `queued/starting` 真实状态，不把任务登记冒充已启动；渠道错误和启动失败直接返回错误。
- 全局提示词和员工/群聊派工提示明确要求先发现并优先使用 Negus 后台任务；原生子代理仅作为检查后的回退，并遵守同一路由配置。

## 用户操作结果

- 用户要求后台执行后，助手调用 Negus 后台任务入口，任务使用实际可用渠道启动；只有取得 `startup.confirmed=true` 才回复“已经开始执行”。
- 首选渠道没有目标模型时，任务自动使用同一模型的其他渠道；同模型也不可用时，按配置继续尝试其他模型。只有全部候选失败才显示最终错误。
- 启动失败时返回 `failed` 和错误内容；等待调度超时时返回 `queued` 或 `starting`，用户看到准确状态。
- 相同 `requestId` 重试仍返回同一任务，不重复创建。

## 验证

- `node --test ui-feishu/validation/task-kernel.test.mjs ui-feishu/validation/employee-task-extension.test.mjs windows/tests/background-task-model-policy.test.mjs`：45/45。
- `node --test ui-feishu/validation/group-collaboration.test.mjs ui-feishu/validation/group-task-service.test.mjs ui-feishu/validation/group-extension.test.mjs ui-feishu/validation/native-task-runtime.test.mjs`：46/46。
- `node --test windows/tests/maintenance-instructions.test.mjs windows/tests/message-handoff.test.mjs windows/tests/task-attribution-projection.test.mjs windows/tests/group-routes.test.mjs windows/tests/group-room-store.test.mjs ui-feishu/validation/group-native-tools.test.mjs windows/tests/project-management.test.mjs`：53/53。
- 使用真实本机 Provider 目录做只读路由检查：请求 vip 渠道的 `deepseek-flash` 时，选择 DeepSeek 渠道的 `deepseek-flash`，`taskRouting.reason` 为“同模型改用其他渠道”，跳过原因为 vip 模型目录不含该模型。
- 新增覆盖：配置渠道顺序、配置默认模型、同模型切换渠道、其他模型回退、最新成功清除旧失败、401/429/超时/口令式认证失败回退、全部失败错误明细、HTTP 工具错误透传、配置思考等级、普通/员工/群聊三类 `taskRouting` 持久化、群聊首任务 A 缺模型时入队前选择 B、群聊 `getClient`/运行态/`thread/start` 全部使用 B、已有线程迁移到 B、刷新失败继续使用缓存、启动事件前保持 `starting`、等待超时保持 `queued`。
- MJS 语法检查和 `git diff --check` 通过。
- 第四回风控 FAIL 增补后，任务内核/员工交接/渠道策略 45/45，群聊与原生运行时 46/46，维护提示/群路由/项目管理等 53/53，合计 144/144。

## 状态

第四次风控任务 `69d92ee0-3468-4703-bc76-3f2fe00a535c` 返回 FAIL，指出“无效 token”“未认证”未触发换路，员工 followup 未在任务顶层持久化路由。两项已补修并通过直接回归。

第五次风控任务 `07b563d5-fd4d-4797-a792-139d9750c0a3` 返回 PASS：独立探针验证 7 种失败共 14 次均跳过失效组合，后续成功记录恢复原组合；员工 followup 的磁盘记录、任务列表、runtime 与实际 client 使用同一渠道、模型和线程。指定回归 144/144，受保护滚动文件零 diff，`git diff --check` 通过。

当前源码与需求记录已完成独立质量验收，可进入选择性提交和受控重启。运行快照 `1794917696362-f61034db` 仍是本次配置化回退改动之前发布的版本；提交并重启后需核对新版本及真实派工结果。
