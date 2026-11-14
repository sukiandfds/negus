+# PR #2 对 Negus develop 的只读合并审核
+
+## 结论
+
+**不可直接合并；按 `ui-feishu` 当前架构重做其中少量后端加固，其余旧实现丢弃。**
+
+PR head 为 `cf06972d5a82bbdb94cb5024f6fe5f3465e3aa44`，当前 `origin/develop` 为 `55f293bbf0bbd7fb82d8f25401a5e94465b83f77`，共同祖先为 `45b445da2e9d1fe4f363577a5270a8d6e1bc355f`。GitHub 返回 `mergeable=CONFLICTING`、`mergeStateStatus=DIRTY`。`git diff --stat` 实际为 56 个文件、+1549/-1744，和 PR 描述的数量一致；代码内容与描述的多项前提不符，详见后文。
+
+Rebase、整提交 cherry-pick 或保留旧目录解冲突都不合适。PR 从旧 `main` 的 `web-ui`、单群聊服务和单体会话路由出发，当前 `develop` 已迁移到 `ui-feishu`、多群聊、员工运行时、持久化群任务与共享模型配置。正确方案是从当前 `develop` 新建小范围改动，按现有入口重做可保留的修复。
+
+## 冲突盘点
+
+已有 `/tmp/negus-pr2-merge-tree.txt` 记录退出码 1，共 **44 条冲突路径记录**：
+
+| 冲突类型 | 数量 | 主要含义 | 优先级 |
+| --- | ---: | --- | --- |
+| `content` | 21 | 新旧后端、测试、文档和实时连接直接交叉修改 | P0/P1 |
+| `modify/delete` | 16 | 当前已迁移或保留的文件，被 PR 删除/改写 | P0 |
+| `rename/delete` | 6 | `web-ui` 项目进度树已迁入 `ui-feishu`，PR 又删除旧源 | P0 |
+| `add/add` | 1 | `windows/tests/access-control.test.mjs` 两边各自新增 | P1 |

按处理性质再看：

| 分类 | 文件范围 | 判断 |
| --- | --- | --- |
| 纯机械/文本冲突 | `README.md`、`docs/architecture/domains/frontend.md`、新增 access token 测试 | 冲突本身可直接改字，但 PR 侧内容描述旧入口，完整保留会写错当前架构 |
| 路径迁移冲突 | `web-ui/*` 的前端模块、`ui-feishu/shared/features/project-progress/*`、`docs/feature-development/FEATURE_INDEX.md`、`windows/server/project-progress-store.mjs` | 新树已经是唯一有效位置；按路径迁移恢复旧树或删除当前目标都会回归 |
| 业务语义冲突 | `request-handler.mjs`、四组会话路由对应的旧单体路由、`app-server-conversation-store.mjs`、`remote-room-demo.mjs`、`system-routes.mjs`、`static-files.mjs`、`package.json` | 旧对象少了员工、模型、Cloudflare、任务、多群、Goal、等候队列和单前端语义，冲突行数少也照样有行为回归 |
| 不能安全移植 | 旧 `multi-agent-service`、旧群聊 Composer/SSE、项目进度删除、单 `projectRoot` 作用域、第二套 JSON writer | 已有更完整实现，或移植会破坏当前多项目/多群/持久化任务边界；只提取算法和安全概念重写 |
+
+### P0：真正阻断项
+
+1. **请求总入口与当前员工、群任务、Cloudflare、模型配置接线冲突**
+
+   `windows/server/request-handler.mjs`
+
+   当前 `develop` 的入口导入了 `ui-feishu/server/group-extension.mjs`、`task-routes.mjs`、员工路由、Cloudflare 连接路由、模型设置、图片设置、对话转发等；并把 `employeeRuntime`、`employeeProjectDirectory`、`modelProviders`、`agentTasks`、`roomDirectory`、`multiAgentDirectory` 注入各路由。PR 的入口仍只有旧的基础 artifact、单群聊、单体 conversation、usage、system 路由。
+
+   采用 PR 版本会让员工任务、多群聊目录、任务续派、Cloudflare 账号连接、共享模型设置、转发等路由从运行入口消失。这是直接功能中断，不仅是文本冲突。
+
+2. **会话路由被重写成旧单体路由**
+
+   `windows/server/routes/conversation-routes.mjs`
+
+   当前 `develop` 已拆成 message/history/settings/interaction 四组路由，并在消息、设置、上下文、Goal、用户输入等路径中处理 `conversationId` 与 thread 的绑定、员工主对话、群/任务只读语义、持久化 submission store、follow-up queue 和共享模型 Provider。
+
+   PR 从 `45b445da` 的旧单体路由重写，没有 `conversationId` 授权，没有 `employeeRuntime.sendMessage/updateModelSettings/interrupt` 分流，没有知识目标、等候队列、待用户输入和持久化 submission 链路。若按 PR 解冲突，普通员工会话及任务会话会走错服务。
+
+3. **旧 `web-ui` 与 `ui-feishu` 的路径迁移冲突**
+
+   直接阻断路径包括：
+
+   - `web-ui/src/features/group-chat/*`
+   - `web-ui/src/features/conversations/hooks/useConversationCatalog.ts`
+   - `web-ui/src/shared/api/http.ts`
+   - `web-ui/vite.config.ts`
+   - `web-ui/src/features/project-progress/*`
+   - `ui-feishu/shared/features/project-progress/*`
+
+   当前前端只有一个 `ui-feishu` 入口。PR 的群聊停止、附件发送和 SSE 改动全部落在已删除的 `web-ui` 树；保留这些文件等于把第二套旧前端重新塞回仓库。项目进度文件在 `develop` 已迁到 `ui-feishu`，PR 却把旧 `web-ui` 源删除，Git 因而同时报告 `rename/delete` 与目标文件 `modify/delete`。
+
+4. **删除仍在使用的项目进度功能**
+
+   `windows/server/project-progress-store.mjs`、`windows/server/routes/system-routes.mjs`、`ui-feishu/shared/features/project-progress/*`
+
+   PR 声称项目进度已被项目管理页取代并删除 `/api/project-progress`。当前实现并非如此：`ui-feishu/shared/features/settings/LegacyFeaturePanel.tsx` 仍挂载 `ProjectProgressApp`，`ui-feishu/shared/features/project-progress/data/progressApi.ts` 仍请求 `/api/project-progress`，`windows/server/routes/system-routes.mjs` 仍调用 `readProjectProgress`。合并这个删除会让设置中的进度视图直接报错。
+
+5. **旧单群 Agent 服务覆盖当前群任务内核**
+
+   `windows/server/multi-agent-service.mjs`
+
+   当前群聊由多个 `ui-feishu/server/group-task-service.mjs` 实例、`task-kernel`、`native-task-runtime`、群目录和员工 Provider 迁移链路驱动。PR 的 `multi-agent-service` 仍是单组 `currentRun`、内存队列和旧讨论回合逻辑。它不处理多群、任务持久化、后台子任务、员工项目上下文或 Provider 路由。
+
+   PR 的停止按钮与附件发送在旧单群实现中存在，但当前 `GroupComposer`、`useGroupRoom`、`groupApi`、`group-task-service` 已有停止、附件解析、任务取消和结果回写；采用 PR 版本会让这些能力退化为旧流程。
+
+6. **启动脚本重新接回旧服务图**
+
+   `windows/scripts/remote-room-demo.mjs`
+
+   当前启动序列创建员工注册表、员工运行时、共享模型 Provider、项目身份、多个群 Room、群任务目录、Cloudflare/图片/电脑工具上下文。PR 版本只构造旧基础服务，并在信号处理里 `process.exit()`。若冲突解决偏向 PR，现有员工、群组、模型和持久化服务不会启动，或关闭时无法按当前依赖顺序刷新。
+
+7. **静态路由规则会让现有 SPA 入口失效**
+
+   `windows/server/static-files.mjs`
+
+   当前实现把 `group.html`、员工页、进度页、项目管理页重定向到单前端查询参数；PR 又映射 `/group` 到旧 `group.html`、`/progress` 到旧 `project-management.html`，并删除现有别名。当前 `ui-feishu` 构建不能依赖旧多入口文件。
+
+8. **应用服务存储基线落后于多项目、模型和附件能力**
+
+   `windows/server/app-server-conversation-store.mjs`
+
+   当前版本支持 `projectRoots`、业务项目、用户画像注入、自动标题、共享 Provider、原生附件、Goal、Provider 会话迁移等；PR 在 `45b445da` 基础上改成单 `projectRoot` 精确匹配，并重排 read/resume/send。直接取 PR 会破坏员工项目和业务项目会话，也会覆盖当前未提交需求的运行基础。
+
+9. **系统路由会覆盖模型和 Cloudflare 配置入口**
+
+   `windows/server/routes/system-routes.mjs`
+
+   PR 只删除项目进度路由，但当前该文件还负责 `/api/model-defaults`、`/api/model-channels`、Provider 配置编辑/删除/测试、项目管理和上传等。冲突解决若采用 PR 版本，会让模型共享渠道与当前设置页失效。Cloudflare OAuth 的路由本身在 `connection-routes.mjs`，但总入口丢失后也会不可达。
+
+### P1：业务语义冲突，不能原样移植
+
+- `ui-feishu/shared/features/conversations/realtime/useConversationEvents.ts`
+
+  PR 的共享 SSE helper 有事件编号去重和断线恢复价值，但当前单人 SSE 已额外合并 `sessions_changed` 的 thread 列表、处理窗口 focus、等待首批事件、按当前 thread 筛进度事件。原样套用会退回逐个事件刷新目录。
+
+  当前群聊 SSE 还会过滤不同 `roomId`、保护历史阅读时的 live 消息、在重连后重拉群快照。PR helper 没有 `roomId` 过滤，也没有当前历史阅读抑制。把它直接用于当前多群会串群或覆盖正在查看的历史位置。
+
+- `windows/server/app-server-client.mjs`
+
+  PR 的意外退出 health event、stdin error 处理值得保留。当前 Provider/员工架构还会为不同模型创建多个 client；只修改个人对话 client 不能解决员工主对话、群任务和后台任务卡在运行态的问题。重做时必须逐一接线 `employee-runtime-service.mjs`、`ui-feishu/server/group-task-service.mjs` 和模型 Provider client。
+
+  PR 缓存 `selectedRuntime`、自行在 PATH 扫描全部候选的改法不应照搬；当前代码已经支持 macOS App、PATH、共享模型环境和仓库工具环境，改为旧发现逻辑没有收益。
+
+- `windows/server/execution-tracker.mjs`
+
+  “进程退出后把 active turn 标为 interrupted”是有效修复，当前仍缺少统一的 `exited` health 处理。PR 改动基于旧 tracker；当前已有 `eventEpoch`、Goal、等候队列、员工状态和更多终态。只能把概念补进当前状态机，不能整文件替换。
+
+- `windows/server/state/json-state-file.mjs` 及多个 store
+
+  PR 声称共享原子写入修掉五份副本，但当前已有 `windows/server/persistence/json-file.mjs`，且 `group-room-store`、`artifact-service`、`context-management-service`、`conversation-version-store`、`execution-tracker` 已调用 `writeJsonFileAtomic` 或使用现有原子写入封装。再引入第二套 `state/json-state-file.mjs` 会制造重复基础设施，收益接近零。
+
+- `windows/server/conversation-service.mjs`
+
+  PR 对 403 不回落 JSONL、变更操作只走 primary，是对安全检查方向有帮助的小改。但当前 service 还有 supplemental messages、provider migration、content version、list 合并等；必须按当前文件补规则，不能替换文件。
+
+- `windows/server/multi-agent.test.mjs`、`request-handler-routing.test.mjs`、`access-control.test.mjs`
+
+  测试描述的是 PR 旧路由和旧群服务。除 access-control/state-writer 的纯函数测试可迁移外，另外两类必须按当前四组会话路由、员工运行时、多群任务和 `ui-feishu` 重写。
+
+### P2：文本或低风险机械冲突
+
+- `README.md`
+- `docs/architecture/domains/frontend.md`
+- `package.json`
+
+README 和前端架构文档仍描述旧 `web-ui`、`progress` 多入口。`package.json` 新增的 `build` 指向 `web-ui`，在当前仓库会构建已下线目录；`start/test/check` 也没有覆盖当前 `ui-feishu` 构建与验证。这三项都不应机械保留。
+
+PR 新增的 access token 测试和 JSON state writer 测试可以选其有价值断言重写，但不构成直接合并理由。
+
+## 与当前工作区和需求表的关系
+
+当前工作区有一批未提交的员工、群聊、提示词和需求表改动。与 PR 的关系如下：
+
+- `docs/project-management/*` 的需求表改动和 PR 没有同路径文本冲突，但需求表明确记录当前已采用 `ui-feishu`、多群群任务、员工运行时、停止与附件能力；这些有效决定否定 PR 的旧结构。
+- `windows/tests/project-management.test.mjs` 两边都修改。当前未提交改动新增状态标签和标题时间测试；PR 在同一文件追加静态文件测试。普通 merge 会因该文件脏改动被 Git 阻止，即使强行保留也应按当前测试文件重新定位静态测试。
+- 未提交的 `windows/server/employee-task-extension.mjs`、`ui-feishu/server/group-task-service.mjs`、`ui-feishu/src/conversationDirectory.ts` 等文件不在 PR 的 56 文件清单中；合并冲突不会自动“覆盖”它们，但 PR 的旧总入口和旧群服务不会调用这些现有实现。
+- 未提交的 `windows/server/project-management-store.mjs` 和需求表继续依赖当前管理页、进度页。PR 删除进度接口会与当前产品行为冲突。
+- 当前工作区已是 `develop...origin/develop` 同步、存在大量未提交文件。正常 merge 本身还会被相关脏文件阻止；这不是主要技术风险，主要风险是旧架构覆盖新架构。
+
+## PR 中的安全修复是否完整
+
+PR 对 access token 做了常数时间比较、错误令牌按地址限速、生成/持久化 token，方向正确。当前 `windows/server/http/access-control.mjs` 仍是直接字符串比较，启动 token 每次随机，值得单独吸收。
+
+PR 声称“所有 browser 提供的 thread 操作都做项目作用域”，实际 diff 没有覆盖所有路由：
+
+- `/api/session/context` 直接调用 `contextManagement.load(threadId)`；
+- `/api/session/context/settings` 和 `/api/session/context/compact` 没有统一项目校验；
+- `/api/execution-status` 仅在 `reconcile=1` 且 active 时调用有作用域的 `getThreadStatus`；
+- 消息提交中的 `conversations.assertProjectThread?.()` 是可选调用，接入方漏实现时会静默跳过。
+
+所以这项加固有价值，但 PR 的实现仍不是完整安全边界。重做时应在当前路由层统一校验 `threadId + conversationId`，并让 `app-server-conversation-store` 的读取、设置、上下文、状态和变更路径都调用基于当前 `projectRoots` 的验证。不能恢复 PR 的单 `projectRoot` 精确匹配，否则员工私有项目和业务项目会再次被拒绝。
+
+限速实现直接信任 `cf-connecting-ip`/`x-forwarded-for`。在服务同时监听公网端口时，调用者可伪造这些头绕过按地址限速。应只信任配置的代理来源，或把限速作为辅助层，保留 token 本身的强随机性。
+
+## 值得保留的修复
+
+1. `windows/server/http/access-control.mjs`：常数时间 token 比较、强 token 生成与持久化、错误 token 限速；按当前启动链接入并处理代理头信任边界。
+2. `windows/server/app-server-client.mjs` + `app-server-conversation-store.mjs` + `execution-tracker.mjs`：app-server 意外退出时发出 `exited`，把所有受影响 active turn 收敛为 interrupted；同时覆盖普通、员工、群任务和后台任务 client。
+3. `app-server-conversation-store.mjs`：将项目校验前移覆盖只读历史；基于当前 `projectRoots`，不是 PR 的单一 `projectRoot`。
+4. `realtime-hub.mjs` 的 SSE 4 MiB 背压断开：能防止休眠手机或失效隧道让服务无限缓存；需验证客户端能从 last event id 补拉。
+5. `request-handler.mjs` 的未知 `/api/*` JSON 404、`headersSent` 后销毁响应、静态文件 `nosniff`/`referrer-policy` 与正确缓存策略：可在当前总入口做小范围补丁。
+6. `app-server-client` 的 stdin error 监听、静态 MIME 补 `.ico/.woff2`：低风险小改。
+7. 现有 `writeJsonFileAtomic` 可继续复用；PR 的 `state/json-state-file.mjs` 丢弃。
+8. 单人/群聊 SSE 共用的“事件编号去重 + 缺口重拉”概念可保留，但要在当前 helper 中保留目录批处理、群 `roomId` 隔离、历史阅读抑制和 focus/visibility 恢复。
+
+## 必须丢弃的旧结构
+
+- 所有 `web-ui/*` 前端文件及其群聊、项目进度修订。
+- 当前 `ui-feishu/shared/features/project-progress/*` 的删除。
+- `windows/server/project-progress-store.mjs` 的删除和 `/api/project-progress` 撤离。
+- 旧单群 `multi-agent-service` 路由和内存队列替换当前 `group-task-service`/`task-kernel`。
+- 单体 `conversation-routes.mjs` 替换当前四组路由。
+- 不含员工、模型 Provider、Cloudflare、任务和群目录接线的 `request-handler.mjs`/`remote-room-demo.mjs`。
+- `package.json` 的 `web-ui` 构建脚本。
+- PR 的全局 `unhandledRejection` 吞错后继续运行；当前受控监督机制需要真实故障可见并可恢复。
+- 第二套 JSON 原子写工具。
+
+## 建议的最小落地步骤
+
+1. **不合并 PR #2，不 rebase、不整提交 cherry-pick。** 保留 PR 作为问题清单和测试参考；从当前 `develop` 直接做小补丁。
+2. 先做访问控制补丁：`http/access-control.mjs`、`request-handler.mjs`、当前启动脚本；保持现有 Cookie、分享链接和公网入口行为。增加有效 token、错误 token、Cookie、代理头、重启后 token 不变测试。
+3. 再做进程退出补丁：在 `app-server-client` 发 `exited`，分别接到普通执行、员工运行时、群任务和后台任务；验证 active turn 停止、迟到事件不复活、空闲线程不误报。
+4. 把 thread 项目校验放到当前读路径和统一路由鉴权层，按 `projectRoots` 验证；覆盖普通、员工、群、任务和业务项目，避免按 PR 的单根路径回归。
+5. 在当前 `ui-feishu` 补 SSE 背压与共用事件编号去重。群聊已有停止、附件和任务取消，不重复移植 PR 的旧群 UI；如新增 helper，必须保留 `roomId` 过滤和历史阅读保护。
+6. 只补静态文件安全头、缓存规则、JSON 404 和 stdin error 等小修；继续复用 `persistence/json-file.mjs`，继续提供项目进度页。
+7. 分组验证：当前 `windows/tests`、`ui-feishu/validation`、TypeScript、前端生产构建、多群/员工/任务定向测试、SSE 断线与退出场景。由于本次审核明确禁止写入和启动，未运行会落盘或启动服务的测试；本次只做了只读 diff、对象核对和 `git diff --check`，后者通过。
+
+## GitHub checks 是否足以支撑合并
+
+**不足以支撑。**
+
+PR 的三个检查均成功：
+
+- `Static checks`
+- `Windows (Windows PowerShell 5.1)`
+- `Windows (PowerShell 7)`
+
+它们属于 workflow run `43164211408`，均在 `2026-11-12T05:52:07Z` 开始、`05:52:46Z` 前完成，检查的是 head `cf06972` 和当时基于 `main` 的 PR 树。GitHub 事件显示 base 到 `develop` 的变更发生在 `2026-11-12T06:00:40Z`，晚于检查完成。当前仓库 `.github/workflows/ci.yml` 仍只触发 `pull_request: branches: [main]`。
+
+因此这些绿灯没有验证：
+
+- 与 `develop` 的合并结果；
+- `ui-feishu` 类型检查和生产构建；
+- 当前多群、员工运行时、任务内核、共享模型 Provider、Cloudflare OAuth；
+- 冲突解决后的路由和服务装配；
+- 56 个 PR 文件在当前代码中的实际语义。
+
+## 用户可见收益与现实风险
+
+可保留的真实收益集中在安全和可靠性：
+
+- 公网访问 token 不易被时序探测，重启后不会让已保存链接失效；
+- app-server 崩溃时用户能看到任务已中断，不必等 30 分钟或发下一条消息才恢复；
+- 跨项目已知 thread id 的读取边界更严；
+- 睡眠手机/失效隧道不会无限占用服务内存；
+- 未知 API 不再落成静态页，静态资源缓存和 MIME 更正确。
+
+PR 所声明的群聊停止、附件发送和群聊断线恢复，在当前代码中已有更新实现，PR 本身没有带来可直接采用的新增用户价值。直接合并或按旧结构解冲突的主要回归是：员工/群任务路由消失、模型与 Cloudflare 设置不可用、单前端入口失效、项目进度页报错、多群串流或群任务内存化。
+
+最终判断：**可移植但需重做；不应合并 PR #2。** 先抽取第 1 至 6 项小范围修复，按当前 `develop` 逐组验证，再决定是否形成新的 PR。
