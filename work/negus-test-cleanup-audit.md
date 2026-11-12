# Negus 后端 570 项测试清理审计

日期：2026-11-12
范围：`windows/tests/*.test.mjs`，共 76 个测试文件、当前 Node 运行时 570 项
当前结果：562 通过、7 失败、1 跳过

## 结论

没有发现 570 项中大面积“不清不楚”或应直接删除的测试。当前能确认的清理项分三类：

1. **明确删除 3 项**：错误访问令牌限速及其可信代理测试。用户已明确该功能暂不需要。
2. **产品已退役、应随功能代码一起清理 3 项**：Codex Dream Skin 注入相关测试。产品定义规定换肤逐步退出，但先核对共用脚本和 CI 依赖，不能只删测试、保留无需求代码。
3. **只改预期或修测试夹具，不删除 5 项**：1 项生图尺寸旧预期、1 项 PWA 环境缺口、1 项前端测试依赖缺失、2 项跨渠道夹具缺文件。

剩余 2 项失败对应真实产品问题，必须保留测试并修代码：

- 当前模型和上次成功模型在运行时事件后仍可能混用。
- 已有图片补充消息的未加载原生对话仍会直接报错。

除以上项目外，没有找到因最新产品定义或用户澄清而应直接删除的其它测试。尤其不能删除“legacy”名称的升级兼容、归档、旧数据读取、Windows DPAPI、PWA 离线、桌面旧区域迁移等测试；它们保护已有数据和兼容边界。

## 审核方法

- 枚举全部 76 个 `*.test.mjs` 文件、558 处静态 `test()` 声明，并按循环展开核对实际 570 项。
- 对每个文件单独运行 Node 测试，汇总测试数、通过、失败与跳过，见文末清单。
- 对照当前用户澄清、`PRODUCT_DEFINITION.md`、`PROJECT.md`、`docs/project-management/INDEX.md` 和对应 FEAT/PM 条目。
- 检查失败原因与测试源码，不以“测试失败”本身作为删除理由。
- 本轮没有删除测试、修改源码或改变服务。

## 明确可删除：错误令牌限速

`windows/tests/access-control.test.mjs` 有以下 3 项：

- `wrong guesses are throttled per client address and recover after the window`
- `forwarding headers from an untrusted peer cannot dodge the lockout`
- `a trusted ingress identifies each client from its forwarding headers`

依据：`docs/project-management/items/FEAT-006/item.md:19-23` 明确记录用户决定“错误令牌限速暂不实现”，不累计错误次数、不返回 429、不增加可信代理配置。

处理建议：删除这 3 项时同步删除 `createAccessGuard`、代理地址解析和 `request-handler` 中只为限速服务的接线；保留 token 精确比较、Cookie 交换、错误令牌拒绝和访问链接测试。

## 产品退役后的清理候选：Codex Dream Skin

相关测试：

- `windows/tests/renderer-inject.test.mjs`：测试 Dream Skin CSS 与渲染注入。
- `windows/tests/injector-bootstrap.test.mjs`：测试 Dream Skin 早期注入、Shell 守卫和 watcher 代次。
- `windows/tests/injector-one-shot.test.mjs`：测试通用 injector 的 verify/once/remove；是否需要保留取决于旧 Windows 注入协作面板是否仍属于产品。

依据：

- `docs/negus-knowledge/product/PRODUCT_DEFINITION.md:37`：Codex Dream Skin 逐步退出产品范围。
- `PROJECT.md:8,16,93-94`：换肤是历史来源，不删除前的共用依赖。
- `docs/project-management/items/PM-003/item.md:20`：用户原话明确“旧 Codex Dream Skin 换肤工具……不太需要相关代码了，可能要逐步删除”。

处理建议：先确认 `injector.mjs` 是否还被旧 Windows 协作面板使用。`renderer-inject` 与 `injector-bootstrap` 应随 Dream Skin 代码一起删除；`injector-one-shot` 在旧协作面板退役后同步删除。相关 Windows CI 清单也必须同步更新。

## 剩余失败项处置

### 应改测试预期：1 项

- `lynn-workbench-routing.test.mjs`：`shared fast client requests URL output and preserves image order without downloading in edit()`
- 实际发送 `3840x1632`，测试仍期望 `4K:2.35:1`。
- `docs/negus-knowledge/features/feature-records/FEAT-015-image-generation-and-automation-workbench.md:57,61` 明确规定 `2.35:1 + 4K` 归一化为 `3840x1632`。
- 保留测试，更新供应商请求断言。不要删除该测试，因为它同时验证 URL 返回和参考图顺序。

### 应修测试环境：3 个失败入口

- `conversation-file.test.mjs`：测试的 `caches` 夹具只有 `match`，没有 `caches.open`。补全 Service Worker 夹具，不删除。
- `heartbeat-message.test.mjs`：导入路径 `ui-feishu/node_modules/esbuild/lib/main.js` 在当前 pnpm 安装中不存在，应在文件加载前失败。改为从 UI 工程依赖解析 esbuild，不删除心拍渲染测试。
- `provider-conversation-store.test.mjs` 两项跨渠道测试：夹具返回 `rollout.jsonl` 路径但没有创建该文件，且另一项因此报“原对话记录校验失败”。补齐真实文件与索引元数据，不删除。

### 应修产品或运行时：2 项

- `conversation-send-state.test.mjs`：`lastSuccessfulSettings` 应为 `group::saved`，实际变成 `wrong`。这直接违背用户确认的两个模型状态必须分离，保留并修实现。
- `conversation-service-media.test.mjs`：图片用户消息和结果消息已经存在，只是原生 Thread 没有 turn；当前直接报 `fresh thread has no persisted turns`，没有合并补充消息。该对话不是真正空对话，保留并修读取合并。

## 不应因最新澄清而删除

- `conversation-controls.test.mjs` 的空原生正文 3 项：当前已按“有本地历史读历史、两边都空才空对话”通过，保留。
- `conversation-controls.test.mjs` 和 `conversation-readonly-aggregate.test.mjs` 的当前模型测试：已改成 `current` 裸模型名，保留。
- `provider-conversation-store.test.mjs` 的失败发送保留上次成功设置：保留，这是两个状态分离的核心回归。
- 自动标题和空会话短编号测试：用户决定暂不改变“新对话 · 编号”，保留。
- `conversation-controls.test.mjs` 的跨项目拒绝测试：用户暂不将跨项目待回答输入列为异常并要求后续对齐；在边界重新定义前保留现有限制，不能删除测试制造安全空白。
- `conversation-controls.test.mjs` 的历史读取失败传播测试：它是服务层错误证据，未来接入后台使用日志时需要保留真实错误来源；不应因为“不向用户显示技术错误”而删除。
- `model-provider-service.test.mjs` 的 Windows DPAPI 测试：macOS 上跳过，但项目仍保留 Windows 路径，不能按当前服务器平台删除。
- 所有带 `legacy` 名称的测试：多数验证旧数据、旧 Thread、旧模型路由或升级迁移。产品要求已有历史和配置不被破坏，因此不能仅因名称含 legacy 删除。

## 结构性判断

以下文件看起来覆盖相近主题，但验证层次不同，不能直接判为重复：

- `conversation-controls`、`conversation-routes`、`conversation-loading`、`conversation-batch`、`page-snapshot-pending`、`shared-cache`：分别覆盖原生会话、路由、读取调度、批次发布、状态合并和通用缓存。
- `employee-runtime`、`group-room-store`、`group-routes`、`multi-agent-service`、`agent-publication`：分别覆盖员工运行、公共记录、HTTP 路由、执行服务和结果发布。
- `model-provider-service`、`provider-conversation-store`、`cc-switch-config-service`、`conversation-controls`：分别覆盖渠道能力、会话路由、共享配置和端到端会话行为。

这些文件可以通过共享测试工具缩小重复准备代码，但没有找到可以删掉整组而不同时减少用户行为保障的测试。

## 名称不清楚但不应删除的测试

- `lynn-workbench-routing.test.mjs`：功能已经改为 Negus Image，测试实际覆盖当前快速生图客户端。应改名或改写描述，不能因为名称仍是旧 Lynn 而删除；依据 `docs/project-management/items/FEAT-015/updates.md:54-55`。
- `multi-agent-service.test.mjs`：名称沿用早期群聊叫法，但源码仍由当前群聊请求入口使用；其中“点名、上下文、排队、中断、员工发布”都是现行行为。可改名，不能删除。
- `agent-publication`、`agent-share-routing`：名称像旧 Agent 入口，实际覆盖当前员工/助手结果发布和分享路由；不能按名称判断失效。
- 多个 `legacy-*` 测试：名称只说明被测数据或兼容路径旧，用户数据和历史 Thread 仍需保留；应保留测试并在必要时改描述。

## 最新用户澄清与测试映射

| 澄清 | 对应测试处理 |
| --- | --- |
| 错误令牌限速暂不需要 | 删除 3 项限速测试及实现 |
| 跨项目待回答输入暂不列为异常，后续对齐 | 不删除现有跨项目拒绝测试，等边界重新定义 |
| 自动恢复后的员工状态先不修 | 保留现有普通执行/退出测试，不新增该缺口测试 |
| 空原生正文有历史就回退，两边都空才空 | 3 项测试已改为通过，保留 |
| 当前模型裸名，其他渠道保留前缀 | 旧断言已更新，保留 |
| 上次成功模型与当前/待选模型是两个状态 | 保留并继续验证，修剩余 `wrong` 失败 |
| 新对话未发送不建真实 Thread | 保留 `pending:*` 与迁移测试 |
| 不修改“新对话 · 编号”显示 | 保留自动标题和短编号测试 |
| 技术错误进入后台日志，不直接展示内部错误 | 保留服务层错误传播测试，日志实现后调整前端边界 |

## 测试文件清单

下表为逐文件实际运行结果；未列出的删除建议均表示保留：

| 文件 | 测试数 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| access-control | 7 | 7 | 0 | 0 |
| agent-publication | 12 | 12 | 0 | 0 |
| agent-share-routing | 3 | 3 | 0 | 0 |
| app-server-stream-performance | 5 | 5 | 0 | 0 |
| artifact-service | 3 | 3 | 0 | 0 |
| attachment-input | 6 | 6 | 0 | 0 |
| background-task-health | 2 | 2 | 0 | 0 |
| background-task-model-policy | 5 | 5 | 0 | 0 |
| cc-switch-config-service | 14 | 14 | 0 | 0 |
| cloudflare-connection | 6 | 6 | 0 | 0 |
| codex-thread-history | 4 | 4 | 0 | 0 |
| complete-message-ordering | 4 | 4 | 0 | 0 |
| completed-goal | 4 | 4 | 0 | 0 |
| computer-control | 5 | 5 | 0 | 0 |
| content-blocks | 13 | 13 | 0 | 0 |
| context-management-service | 8 | 8 | 0 | 0 |
| conversation-batch | 9 | 9 | 0 | 0 |
| conversation-controls | 39 | 39 | 0 | 0 |
| conversation-file | 2 | 1 | 1 | 0 |
| conversation-forward | 9 | 9 | 0 | 0 |
| conversation-loading | 14 | 14 | 0 | 0 |
| conversation-readonly-aggregate | 2 | 2 | 0 | 0 |
| conversation-routes | 18 | 18 | 0 | 0 |
| conversation-send-state | 12 | 11 | 1 | 0 |
| conversation-service-media | 10 | 9 | 1 | 0 |
| conversation-source-revision | 3 | 3 | 0 | 0 |
| conversation-version-store | 4 | 4 | 0 | 0 |
| desktop-automations | 2 | 2 | 0 | 0 |
| desktop-current-tasks | 7 | 7 | 0 | 0 |
| desktop-layout | 9 | 9 | 0 | 0 |
| desktop-shapes | 5 | 5 | 0 | 0 |
| employee-default-model | 2 | 2 | 0 | 0 |
| employee-growth-project-directory | 15 | 15 | 0 | 0 |
| employee-runtime | 33 | 33 | 0 | 0 |
| execution-tracker | 27 | 27 | 0 | 0 |
| fusheng-usage-service | 2 | 2 | 0 | 0 |
| group-room-store | 17 | 17 | 0 | 0 |
| group-routes | 9 | 9 | 0 | 0 |
| heartbeat-message | 1 | 0 | 1 | 0 |
| image-contract | 6 | 6 | 0 | 0 |
| image-generation-mcp | 11 | 11 | 0 | 0 |
| image-metadata | 1 | 1 | 0 | 0 |
| image-runtime | 2 | 2 | 0 | 0 |
| image-settings | 5 | 5 | 0 | 0 |
| injector-bootstrap | 1 | 1 | 0 | 0 |
| injector-one-shot | 1 | 1 | 0 | 0 |
| jsonl-conversation-media | 6 | 6 | 0 | 0 |
| lynn-workbench-routing | 2 | 1 | 1 | 0 |
| maintenance-instructions | 3 | 3 | 0 | 0 |
| message-handoff | 14 | 14 | 0 | 0 |
| model-catalog | 5 | 5 | 0 | 0 |
| model-defaults-store | 1 | 1 | 0 | 0 |
| model-provider-service | 18 | 17 | 0 | 1 |
| multi-agent-service | 21 | 21 | 0 | 0 |
| negus-deployment | 4 | 4 | 0 | 0 |
| negus-service-control | 5 | 5 | 0 | 0 |
| negus-service-lock | 3 | 3 | 0 | 0 |
| negus-supervisor | 4 | 4 | 0 | 0 |
| page-snapshot-pending | 9 | 9 | 0 | 0 |
| project-activity-index | 4 | 4 | 0 | 0 |
| project-identity-store | 8 | 8 | 0 | 0 |
| project-management | 5 | 5 | 0 | 0 |
| project-status-service | 7 | 7 | 0 | 0 |
| provider-conversation-store | 27 | 25 | 2 | 0 |
| queued-model-selection | 4 | 4 | 0 | 0 |
| realtime-hub | 5 | 5 | 0 | 0 |
| renderer-inject | 1 | 1 | 0 | 0 |
| request-handler-routing | 4 | 4 | 0 | 0 |
| rollout-file | 2 | 2 | 0 | 0 |
| service-worker-update | 2 | 2 | 0 | 0 |
| shared-cache | 10 | 10 | 0 | 0 |
| task-attribution-projection | 3 | 3 | 0 | 0 |
| thread-goal-objective | 2 | 2 | 0 | 0 |
| thread-goal-routes | 5 | 5 | 0 | 0 |
| web-output-service | 4 | 4 | 0 | 0 |
| web-version | 3 | 3 | 0 | 0 |

## 最终建议

先删除错误令牌限速的 3 项测试和实现，这是唯一由当前用户决定直接判定无需求的一组。Dream Skin 的 3 个测试进入“随旧代码删除”清单，删除前核对共用 injector 和 Windows CI。其余 564 项不在产品定义层面删除；其中 5 项改预期或夹具，2 项修真实产品逻辑。

## 2026-11-12 执行记录

- 已删除错误令牌限速相关 3 项测试；精确 token/Cookie 鉴权 4 项保留并通过。
- 已删除 `renderer-inject.test.mjs`、`injector-bootstrap.test.mjs`、`injector-one-shot.test.mjs`，并移除 Windows 测试脚本中的对应调用。
- 测试文件由 76 个减为 73 个，实际测试由 570 项减为 564 项，共删除 579 行测试/测试脚本代码。
- 完整后端结果：564 项，556 通过、7 失败、1 跳过；失败集合与清理前相同。
- 服务实现代码、运行快照、前后端进程未改；未发布、未重启。
