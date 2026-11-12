# PR #2 对当前 develop 的只读审核

审核时间：2026-11-12。结论：**不可直接合并；部分修复可移植，但必须基于当前 `ui-feishu` 和现行服务重做。** 未执行 checkout、stash、merge、push、构建、重启或源码改动。

## 基线与冲突数

- 本地 `HEAD` 与 `origin/develop` 同为 `55f293bbf0bbd7fb82d8f25401a5e94465b83f77`；PR head `cf06972d5a82bbdb94cb5024f6fe5f3465e3aa44`，merge-base `45b445da2e9d1fe4f363577a5270a8d6e1bc355f`。PR 为单提交，实际差异 56 文件、+1549/-1744。
- GitHub PR API 当前显示 base=`develop`、`mergeable=false`、`mergeable_state=dirty`。现有 `/tmp/negus-pr2-merge-tree.txt` 记录 merge-tree 退出码 1；清单首段为 **40 个冲突路径**，正文有 **44 条 CONFLICT 诊断**：21 content、16 modify/delete、6 rename/delete、1 add/add。后两类对同一迁移文件可能重复诊断。
- 工作区有大量用户未提交改动，主要为 `docs/project-management` 条目及 `ui-feishu/server/employee-task-extension.mjs`、`ui-feishu/server/group-task-service.mjs`、`windows/server/project-management-store.mjs` 等。GitHub mergeability 只针对已提交的 `55f293bb`，不覆盖这些改动。

## 阻断项，按优先级

### P0：当前对话、员工、群任务路径被旧实现覆盖

1. `windows/server/routes/conversation-routes.mjs`：PR 把单聊、发送、设置、历史重组为旧的一体路由，函数只接收 `conversations/execution/contextManagement/media/broadcast`。当前文件已把逻辑交给 `conversation-message-routes.mjs`、`conversation-history-routes.mjs`、`conversation-settings-routes.mjs`、`conversation-interaction-routes.mjs`，并注入 `agentConversationStore`、`employeeRuntime`、`agentTasks`、`modelProviders`、`submissionStore`。取 PR 版本时，用户打开员工直属会话再发送消息，`conversationId` 授权和员工运行时路径消失；任务会话、跨渠道模型、持久幂等发送和工具问答也失去现行入口。PR 的 `assertProjectThread` 仅用 `cwd === projectRoot`，与 `FEAT-017` 中员工 Thread 归员工项目、多业务项目各有 cwd 的决定冲突。其项目隔离思路值得保留，具体判断和入口必须按当前会话绑定、项目目录和供应商路由实现。
2. `windows/server/request-handler.mjs`：PR 仅注册旧会话、旧群聊等少量路由。当前文件还注册群任务、员工项目目录、员工成长、分享/转发、连接、图片设置、项目复核、后续任务队列，并有 `createMaintenanceGate`。选 PR 版本会让用户点击这些现有功能时收到 404 或丢掉维护期间的忙碌保护。`windows/scripts/remote-room-demo.mjs` 也来自旧单项目装配：PR 默认静态目录为 `web-ui/dist`，当前装配加载 `ui-feishu`、多项目、员工和模型提供方；不可整体替换。
3. `windows/server/multi-agent-service.mjs`、`windows/server/routes/group-routes.mjs`：PR 的停止操作对单一 `currentRun` 和内存队列增量计数，并直接调用其默认 client 的 `turn/interrupt`。当前有多 room 服务、`ui-feishu/server/group-task-service.mjs` 持久任务账本、`ui-feishu/server/task-routes.mjs` 按 taskId 停止/核对/重试交付，以及按员工模型渠道取 client。用户在群里停止任务时，必须只停止对应房间/任务并保留任务与结果状态；旧 `/api/group/interrupt` 不能代替当前任务服务，旧 client 也未必是实际执行该员工 Turn 的渠道。当前 `multi-agent-service.mjs` 已有 `interruptDiscussion` 和延迟取得 Turn ID 后停止的机制，PR 的这部分不应覆盖。

### P0：删除仍在使用的项目进度能力

4. PR 删除 `windows/server/project-progress-store.mjs` 及 `/api/project-progress`，同时删除旧 `web-ui` 进度页。当前 `ui-feishu/shared/features/settings/LegacyFeaturePanel.tsx` 仍引用 `ProjectProgressApp`，其 `progressApi.ts` 仍调用 `/api/project-progress`；当前 `windows/server/routes/system-routes.mjs` 仍提供此 API。直接接受删除会使用户打开设置中的项目进度页失败。`docs/feature-development/FEATURE_INDEX.md` 在 `develop` 已删除，PR 的修改/保留也不能恢复为现行需求来源；工作区正在维护的 `docs/project-management` 条目必须保留。

### P1：访问控制与运行配置语义

5. `windows/server/http/access-control.mjs` 增加常量时间比较、失败速率限制和令牌持久化；其中有可单独评估的安全改进。但 `clientAddress` 无信任代理边界，优先接受任意 `cf-connecting-ip`/`x-forwarded-for` 请求头；直连时攻击者可轮换该值绕过按 IP 的失败计数。共享令牌已由现行分享入口管理，PR 的 `resolveAccessToken` 改从 `runtime/access-token` 生成/读取，需对齐实际入口及旧链接，不能替换整个鉴权装配。PR 服务脚本还把带 token 的本机 URL 输出到日志，现行外部分享流程不应因此回退。
6. PR 的 `multi-agent-service.mjs` 未接入当前 `modelProviders` 和员工独立工作目录。`windows/server/request-handler.mjs` 也未传当前模型服务；`windows/server/routes/system-routes.mjs` 是旧版，不能覆盖现行模型配置/分享/项目管理 API。Cloudflare 连接相关路由由现行 `createConnectionRoutes()` 挂载，PR handler 没有该入口；因此即使服务能启动，设置里的 Cloudflare 连接会失效。工作区未提交的员工派工授权提示词和群任务基础提示词改动进一步提高整块覆盖的风险。

### P1：路径迁移与前端实际效果

7. 迁移冲突集中在 `web-ui/src/features/*` 与 `ui-feishu/shared/features/*`：旧群聊 `GroupComposer.tsx`、`groupApi.ts`、`useGroupEvents.ts`，旧单聊 `useConversationEvents.ts`、`useConversationCatalog.ts`，以及 6 个项目进度文件。PR 新增的 `web-ui/src/shared/realtime/realtimeConnection.ts` 在当前前端无对应引用。当前 `ui-feishu/shared/features/conversations/realtime/useConversationEvents.ts` 已有 EventSource 重连、lastEventId 和 gap 恢复；群聊 `useGroupEvents.ts` 已有断线重连/重新快照。复制 PR 旧 Hook 既不会进入现行构建，还可能退化当前事件处理。`package.json` 的新 `build/check` 指向已不存在的 `web-ui`，属于明确的不可用脚本。

## 冲突分类与保留范围

| 类别 | 典型路径 | 判断 |
| --- | --- | --- |
| 纯机械冲突 | `README.md`、`docs/architecture/domains/frontend.md`、`package.json`，少数测试文件 | 文案/脚本可逐项重写；`package.json` 不能机械选 PR 的 `web-ui` 命令。|
| 路径迁移冲突 | 9 个旧 `web-ui` 修改/删除路径、6 个被迁移的进度组件、`ui-feishu/shared/features/conversations/realtime/useConversationEvents.ts` | 以现行 `ui-feishu` 组件为基线审功能点，不恢复旧树。|
| 业务语义冲突 | `conversation-routes.mjs`、`request-handler.mjs`、`multi-agent-service.mjs`、`group-room-store.mjs`、`app-server-conversation-store.mjs`、`system-routes.mjs`、`static-files.mjs` | 涉及多项目/员工归属、群任务状态、分享与模型/Cloudflare 配置，需逐项设计和定向验收。|
| 不能安全移植的整块 | 旧 `web-ui` 与进度删除、PR 一体路由/handler/启动脚本、旧单队列停止、旧静态目录与构建脚本 | 直接丢弃；只在现行模块内实现所需行为。|

值得按功能单独挑选：`windows/server/state/json-state-file.mjs` 的串行原子写入（先核对当前各状态存储已有保障和失败处理）、`access-control.mjs` 的常量时间比较及有限速率保护（修正代理信任与令牌来源）、`app-server-conversation-store.mjs` 对普通项目 Thread 的归属检查（兼容多根目录/员工绑定）、附件发送中的具体修正及其测试、SSE gap 恢复的测试思路。PR 的 SSE 单聊核心在当前 `ui-feishu` 已存在，群聊重连也已有实现；先定位尚缺的可复现行为再补。`artifact-service.mjs` 等写入重构只在发现现行状态损坏/竞态时移植，避免无收益地替换持久化行为。

## 用户收益与回归风险

可验证收益是：错误项目的普通 Thread 被拒绝、真实断线后的消息恢复、附件发送成功、群任务停止后状态和结果一致、访问令牌猜测受限、状态写入中断后仍可读取。当前 `develop` 对其中多项已有实现；PR 的净增收益需针对复现用例确认。直接合并的现实风险是员工会话发送失败、群任务停止错对象或结果丢失、Cloudflare/模型设置入口消失、项目进度页失败、旧 UI 脚本无法构建。这些均直接影响用户现有操作。

## Checks 与建议步骤

GitHub 对 head SHA 报告 3 项成功：Static checks、Windows PowerShell 7、Windows PowerShell 5.1，完成于 2026-11-12 05:52 UTC。PR API 的整体 `updated_at` 为 06:00 UTC，当前 base 为 `develop`；该字段不能单独证明 base 修改的准确时间。仓库 `.github/workflows/ci.yml` 的 `pull_request.branches` 仍仅有 `main`。这些绿灯说明 head 在当时 CI 测试范围内通过，**没有验证当前 develop 的冲突解决结果**，也未覆盖当前 `ui-feishu` 的构建、Mac 发布运行、多项目/员工/模型/Cloudflare 行为。`mergeable=false` 本身已阻断 GitHub 直接合并。

最小方案：

1. 保持 `develop` 为工作基线，先保全并核对现有未提交需求表和运行时代码；不要对 PR 整体 rebase 或 cherry-pick。它是一个跨 56 文件的单提交，二者都会把旧 UI 和旧服务装配的冲突原样带回。
2. 按现行模块逐项重做仍有缺口的修复：普通项目 Thread 归属与访问控制；附件发送；群任务停止；SSE 恢复；状态写入。每项先写用户操作复现与当前行为，再把最小代码放在 `ui-feishu`/当前路由和运行时。保留现行多项目、员工归属、任务账本、模型提供方、Cloudflare 连接和项目进度 API。
3. 对每项执行对应定向测试与现行 `ui-feishu` 构建/类型检查，最后以 `develop` 的真实部署流程验证手机断线、员工会话、群任务停止、分享/访问、Cloudflare/模型设置和项目进度页；取得新合并目标上的 checks 后再评估新的 PR。本文仅为审核，没有发布。

证据：本地 `git diff origin/develop...origin/pr-2`、`git show origin/pr-2:<path>`、`git show origin/develop:<path>`、`/tmp/negus-pr2-merge-tree.txt`；GitHub PR 与 check-runs API；现行需求 `docs/project-management/items/FEAT-017/item.md`、`FEAT-020/item.md`、`FEAT-022/item.md` 和未提交 `docs/project-management/INDEX.md`。
