# 新后台任务目录同步修复验证（2026-11-09）

当前为 `develop` 工作区源码，基线 HEAD `5d53cc71fc8828315d47b76240255ba4f3a0f48e`。保留全部既有未提交改动，包括员工规则幂等审计字段修复；本轮未提交、推送、发布或重启，未做浏览器运行态验收。风控复核任务 `4c5f4b80`、`56c98975` 与 `dda1cd34` 指出的缺口均已补修。

## 证据与根因

- 用户截图：`runtime/uploads/61b3c2bef0febfad9d36f1abc6f6dd1f554e2c591fa631072e55ffd1523a7b18__IMG_2167.png`。
- 截图显示“来自助手”旧任务持续存在，员工“产品分析”父行已更新到 23:38 且显示“正在处理后台任务”，但新线程 `01a1c0f0-d87c-73c3-99b5-3c7dbcd6d4fd` / `handoff-a384e87138066c9940e3df30e879e513` 不在 children。
- 最终只读核对 `runtime/ui-feishu/employee-tasks/tasks.json` 时，同一任务已于 23:44:02（+08:00）进入 `completed`；截图时的 `active=true` 与之后完成状态均应由同一目录项保留和更新。
- 因此不是来源筛选或任务归属问题。现有 `useProjectConversations.ts` 的 `onSessionsChanged` 会派发 `negus:directory-changed`，`useProjectDirectory.ts` 会以 `invalidate=true` 刷新；父行已有最新状态也证明目录已刷新。
- 首轮修复只解决了新项可见，但 `mergeDirectoryProjects` 仍用正文成功集合决定项目状态和条目合并。正文失败时，目录已经更新为 completed/failed/systemError，界面仍保留 running 的 `active=true`，员工父行也继续滞后。
- 正确边界：目录是列表状态和即时摘要的权威来源，正文读取只负责消息正文。正文成功集合不能参与目录项目、任务行状态的取舍；选中线程实时状态仍由现有 `statusByThread` 优先覆盖。

## 修改

本轮相对修复开始时的工作区计算：

| 文件 | 增/删 | 说明 |
| --- | ---: | --- |
| `ui-feishu/src/conversationDirectory.ts` | +0/-4（风控补修相对首轮） | 删除合并函数对正文成功/候选集合的依赖；最新目录字段覆盖旧缓存 |
| `ui-feishu/src/usePageSnapshot.ts` | +0/-0（风控补修相对首轮） | 调用点适配两参数纯函数；既有立即合入逻辑保留 |
| `ui-feishu/validation/conversation-summary.test.mjs` | +72/-0（风控补修相对首轮） | 补齐目录状态和正文读取完整顺序回归 |

风控补修代码/测试合计 +72/-4（净增68行）；增量来自完整顺序回归，业务合并实现净减4行。受保护文件未修改：

- `ConversationView.tsx`：`431bef02bd4c1367956b4c1dddfc447c0a01036d6b8ea22b8ee307614b587cac`
- `useReturnToBottom.ts`：`7d01c92055aaca35d61801c572717473d2e71ffa1f6f007acddc428c8eb0ef1a`
- 两者当前哈希与 `HEAD` 内容一致，`git diff --quiet` 返回 0。

## 验收映射

1. 初始目录无新任务；出现 running 且正文失败时，任务行仍出现且 `active=true`，员工父行同步运行。
2. 同一线程目录更新 completed、正文仍失败时，任务立即 `active=false`，员工父行同步非运行；目录 title/latestMessage/lastActivityAt 均更新。
3. 目录更新 failed、systemError 时立即进入非运行状态，不保留 `助手正在运行...`；目录原始 `status.phase` 保留。
4. 正文随后成功时补消息和摘要，目录状态不回退；只有一处任务行。
5. 同一线程重复目录项只保留一行；归档任务不进入活动列表；移除后即使有旧正文缓存也不复活。
6. 选中线程由 `statusByThread` 提供的实时 running 状态继续优先于非运行目录状态。
7. 现有 180ms realtime 会话事件合并和 `createCachedResource` 的失效排队继续复用；重复失效回归通过。

## 风控 `56c98975` 补修

- 标题：目录 `entry.title` 始终优先于 session 旧标题，正文成功前、成功后均保持最新目录标题；session 只提供消息与摘要。
- 实时状态：新增 `snapshotStatusByThread` 并由 `usePageSnapshot` 实际调用。它读取真实 `ConversationStore` 的 committed/live：未 committed 的 selected 或 active live 状态进入目录；selected 实时状态始终优先；非 selected 的非活动 live 状态移除覆盖并回落目录。
- 员工父行：员工父行同时聚合目录项目状态与活动子任务状态，未 committed 的选中 live running 任务也会让父行运行。
- 真实接线：测试使用实际 `ConversationStore` 写入 live patch，再调用 hook 同款状态选择函数，没有手工构造 `statusByThread` 来证明新增行为。

本轮相对开始时：`conversationDirectory.ts` +15/-1，`usePageSnapshot.ts` +1/-2，`conversation-summary.test.mjs` +45/-0；合计 +61/-3（净增58行）。

新增验收：

1. 目录标题“任务系统异常”在正文成功前、成功后均不变成线程 ID/旧标题。
2. 未 committed 的 selected live running 经真实 `ConversationStore` 同时让任务行和员工父行 active。
3. selected live completed/failed 压过目录中仍为 running 的状态。
4. 非 selected live terminal 不进入覆盖映射，任务行采用最新目录状态。

## 验证

- `node --test ui-feishu/validation/conversation-summary.test.mjs windows/tests/shared-cache.test.mjs`：41/41 通过，日志 `focused-tests.log`。
- `ui-feishu` 下 `./node_modules/.bin/tsc -p tsconfig.json --noEmit`：通过。
- `ui-feishu` 下 `./node_modules/.bin/vite build --config vite.config.ts`：通过；仅有既有 `use client` 指令和大 chunk 提示。
- `git diff --check`：通过。

## 断线恢复终态回对齐（2026-11-10）

用户复现：thread `01a1c0d8-eff4-7b52-aade-e15d421a206f`，conversationId `handoff-d9eb734d977b16e426298c84a6382c80`。后端 `/api/session?view=1` 为 `completed/active=false/hasFinalAnswer=true`，目录同为 completed，任务记录 `94cd28e2...` 为 completed；浏览器保留 stale running。

实现：

- `useProjectConversations` 的 recovery 入口并发刷新 sessions/directory 与当前 selected thread 的 `loadSession({recovery:true})`；同 thread 重复恢复复用单个 Promise。
- `useConversationEvents` 将窗口 focus 加入既有可见/pageshow/online 恢复入口。
- `ConversationStore` 只让活跃快照叠加 live streaming；completed/failed/interrupted/systemError 使用后端终态，清除 stale streaming/activities，正文 final answer 正常保留。
- 真实 hook 测试通过 `useConversationEvents` 捕获的实际 recovery 回调驱动真实 `ConversationStore`，覆盖 stale active→backend completed、duplicate recovery 合并、backend working 保持 active。

本轮相对开始时：`useProjectConversations.ts` +17/-2，`useConversationEvents.ts` +2/-0，`conversationStore.ts` +1/-1，`conversation-summary.test.mjs` +33/-0，`conversation-send-state.test.mjs` +92/-0；合计 +145/-3（净增142行）。

验证：

- `node --test ui-feishu/validation/conversation-summary.test.mjs windows/tests/shared-cache.test.mjs`：41/41 通过，`focused-tests.log`。
- `node --test --test-name-pattern="realtime recovery rechecks" windows/tests/conversation-send-state.test.mjs`：新增真实接线用例 1/1 通过，`realtime-recovery-test.log`。
- 完整 `conversation-send-state.test.mjs`：12项中11通过、1失败。失败项是未触及的既有 `last successful settings survive runtime events and local model choice wins a late batch`，位于 `useContextManagement` 路径；恢复用例单独通过。未将该旧失败计为本次通过。
- TypeScript `--noEmit`、Vite 生产构建、`git diff --check` 通过；受保护文件仍无差异。

## 剩余风险

- 尚未发布当前前端，因此线上页面仍运行旧构建；浏览器中的状态切换时延、任务页切换和正文补齐需发布后验收。
- 正文读取失败时任务行使用目录摘要和状态；正文可能在现有重试规则内暂缺，但不阻断状态更新。
- 断线恢复后的真实浏览器终态刷新仍未验收；现有定向测试覆盖 hook 接线、请求合并与 store 终态行为。

## 风控 `dda1cd34` 终态残留补修（2026-11-10）

阻断 1：

- 根因：`snapshotStatusByThread` 无条件加入 committed active。断线期间没有终态 live 事件时，旧 committed active 覆盖了最新目录的 completed/failed/systemError。
- 修复：真实 live 全线程优先，selected live 最后覆盖；无 live 的 committed 只在目录缺失，或目录仍 active 且 turnId 一致时补充。旧 committed active 不再覆盖目录终态。

阻断 2：

- 根因：员工父行直接使用目录 `project.status.active`。selected live terminal 已使任务 inactive，但 project status 仍 running 时父行继续显示后台运行。
- 修复：父行聚合映射后的主对话、群任务和后台任务有效状态，不再直接信任 project.status。任一有效 active 才运行；全部子任务终态且主对话 inactive 时父行 inactive。

真实 Store 接线测试：

1. 非 selected、无 live、committed stale active + 目录 completed：任务行与父行 inactive。
2. selected live completed/failed/interrupted/systemError + 目录 project running：任务行与父行均 inactive，不显示“正在处理后台任务”。
3. selected live running 或另一子任务 live running：对应任务行与父行 active。
4. backend working + committed active + 目录 active 同 turn：保持 active；turn 不一致时 committed 不进入覆盖映射。
5. 标题、正文失败状态、断线恢复、新任务先出现、去重、归档/移除与短时失效合并保持通过。

本轮相对开始时：`conversationDirectory.ts` +11/-0，`useProjectConversations.ts` +17/-2，`useConversationEvents.ts` +2/-0，`conversationStore.ts` +1/-1，`conversation-summary.test.mjs` +104/-0，`conversation-send-state.test.mjs` +92/-0；合计 +227/-3（净增224行）。

验证：

- `conversation-summary.test.mjs` + `shared-cache.test.mjs`：41/41 通过，`focused-tests.log`。
- `conversation-send-state.test.mjs` 真实 recovery 接线定向用例：1/1 通过，`realtime-recovery-test.log`。
- TypeScript `--noEmit`、Vite 生产构建、`git diff --check` 通过；受保护文件无差异。
