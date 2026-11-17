# PR #2 最新版只读合并审核

审核日期：2026-11-12
PR：[#2](https://github.com/sukiandfds/negus/pull/2)
Head：`d60f32b3e0eea56a2751de4f1230d6cdac3f95f5`
Base：`develop`
当前 `origin/develop`：`55f293bbf0bbd7fb82d8f25401a5e94465b83f77`

## 结论

**有条件下合并：当前不能直接合入。**

最新版已经完成从旧 `web-ui/main` 到当前 `ui-feishu/develop` 的有效收敛：17 个文件全部位于 `windows/` 后端和测试目录，不再覆盖旧前端、员工入口、群任务路由、Provider、Cloudflare、项目进度或单前端静态路由。`merge-tree` 无冲突，GitHub 也报告 `MERGEABLE / CLEAN`。

但“所有 Thread 操作按项目隔离”和“Codex 进程结束时任务结束”各有一个可复现缺口。前者仍允许读取并回答另一个项目的待回答 TextInput，后者在自动恢复 `recovered` 后不结束员工任务。两项修复并补测试前，不应把本 PR 视为安全完成。

## 阻断项

### P0：跨项目待回答 TextInput 仍可读取并提交

新增的 `assertAccessibleThread` 已覆盖历史、发送、转向、中断、状态、归档和恢复等主要入口，但 `getPendingUserInput` 与 `respondToUserInput` 仍直接转发给 app-server client：

- `windows/server/app-server-conversation-store.mjs:1016`
- `windows/server/app-server-conversation-store.mjs:1020`
- `windows/server/routes/conversation-interaction-routes.mjs:12`
- `windows/server/routes/conversation-interaction-routes.mjs:26`

普通 Thread 没有 Agent binding 时，`authorizeAgentThread()` 返回 `null`，随后路由直接执行上述两个方法。用户只要拿到一个非当前项目 Thread ID，就能：

1. 请求 `/api/session/user-input?threadId=<外部Thread>`；
2. 看到该 Thread 正在等待的 Codex 问题；
3. 提交 `/api/session/user-input` 回答；
4. 让外部项目的 Thread 按该回答继续执行。

我用 PR 的真实 Store 和聚合会话路由做了临时用例：同一外部 Thread 的 `getThreadStatus()` 返回 403，但随后 GET 和 POST 待回答接口仍返回 200，并调用了 `respondToUserInput()`。证据：

- `/tmp/negus-pr2-user-input-scope.test.mjs`
- 结果：1/1 通过，即测试成功复现“状态被拒绝、待回答仍可操作”

必须把项目/Turn 归属校验放到 `getPendingUserInput`、`respondToUserInput` 的 Store 公共入口，或在路由层统一取得并校验 Thread；同时覆盖 GET 与 POST，确认 403 时 app-server 没有收到回答。只改一个读取入口不完整。

### P1：自动恢复后员工任务仍保持“进行中”

`app-server-client` 在自动恢复时发出 `recovered`，并已经替换、终止旧进程。会话 Store 也把 `recovered` 视为丢失进程内所有活跃 Turn：

- `windows/server/app-server-client.mjs:382`
- `windows/server/app-server-conversation-store.mjs:333`

员工运行时只处理 `exited`：

- `windows/server/employee-runtime-service.mjs:92`
- `windows/server/employee-runtime-service.mjs:93`

因此连续健康探测失败触发重启后，旧员工 Turn 已经不存在，但员工状态仍为 `active: true`。用户会继续看到员工“正在处理”；`employeeRuntime.hasPendingWork()` 也继续返回忙碌，维护和受控重启会被不必要的运行任务阻塞，最长占用等待窗口 30 分钟。

我基于 PR 的现有员工测试夹具做了临时验证：发送任务后模拟 `recovered`，员工仍为 `active: true`。证据：

- `/tmp/negus-pr2-employee-recovery-gap.test.mjs`
- 结果：按预期失败，断言 `active === false` 时实际为 `true`

必须让员工运行时同时处理 `recovered`、`failed` 和 `exited` 中表示旧进程 Turn 已丢失的事件，并保持幂等，不能重复广播 `employee_turn_completed`。新增测试至少覆盖 `recovered`、重复事件以及旧 Turn ID。

### P1：公网入口的代理信任配置未接入受控启动

代码中的信任边界方向正确：转发头只在直连 Peer 被列入 `trustedProxies` 时使用；默认空集合不会信任任意外部伪造头。

实际问题是仓库内的受控启动流程没有设置 `NEGUS_TRUSTED_PROXIES`，也没有把 `127.0.0.1,::1` 写入隧道或服务环境：

- `windows/scripts/remote-room-demo.mjs:68`
- `scripts/negus-backend.mjs` 的启动参数未包含该配置
- `scripts/negus-tunnel.mjs` 通过 `cloudflared` 访问 `127.0.0.1:9360`

若按当前默认值部署在现有本机 Cloudflare Tunnel 后面，所有公网客户端都会归到 `127.0.0.1` 的同一个失败桶。任意访问者提交 10 个错误 token，就能让所有公网用户收到 429 一至两分钟，包括持有正确 token 的用户。

发布前必须选择并落地一项：

- 在服务环境中明确设置 `NEGUS_TRUSTED_PROXIES=127.0.0.1,::1`，并核对 Cloudflare 请求携带正确的 `CF-Connecting-IP`；
- 或由受控启动脚本在确认本机反向代理模式下自动配置，但仍保留“只有指定 Peer 可信”的边界。

这不是直接改写鉴权逻辑的问题，而是当前生产入口的部署前置条件。

## 声明修复逐项核验

| 声明 | 结论 | 依据 |
| --- | --- | --- |
| 项目线程作用域 | **部分完成；P0 缺口** | 分页/完整历史、发送、steer、interrupt、状态、归档/恢复、模型、Goal、压缩等主要路径会校验 `cwd` 或员工/任务运行时归属。待回答 TextInput 的 GET/POST 没校验；Context 阈值仍可按任意 ID 写本地状态。 |
| 常数时间 token | **真正修复** | `sameSecret()` 对等长值使用 `timingSafeEqual`，不等长时也对 token 自身做同等比较。查询参数与 Cookie 两条路径都使用该函数。 |
| persistent token | **已有能力，非本 PR 新增** | `scripts/negus-deployment.mjs`、`scripts/negus-service-common.mjs` 和 `runtime/access-token` 读取逻辑已在 `develop` 存在；PR 没有修改这些文件。相关部署/服务测试在全量后端套件中通过。 |
| 错误 token 限速 | **基本修复；部署条件未满足** | 10 次/分钟、按地址计数、`Retry-After` 和 2000 客户端上限已实现。配置可信代理后，伪造头不能无限轮换绕过；当前受控启动未接代理配置时，隧道下会形成全站共用一个失败桶。 |
| 代理头信任边界 | **代码修复；启动配置缺口** | 未受信任 Peer 完全忽略 `CF-Connecting-IP`/`X-Forwarded-For`；受信任 Peer 才读取。现有新增单测覆盖直连伪造与可信 ingress。缺少从真实 Tunnel 到受控服务的端到端配置和测试。 |
| Codex 意外退出结束任务 | **部分完成；员工自动恢复路径仍有 P1** | app-server Client 发出 `exited`；会话 Store 将事件分发给所有活跃 Thread；普通执行、后台任务和员工直接退出路径有测试。员工对 `recovered` 不收敛，自动重启后仍显示忙碌。旧单群 `multi-agent-service` 只处理 `exited`，但当前群聊实际使用 `group-task-service` + `native-task-runtime`，后者已有 `recovered/failed` 和 10 秒健康核对，因此新单群改动属于旧路径补丁，不构成当前群任务主要保障。 |
| 群任务停止 | **已有能力，未退化** | 本 PR 没有重写当前 `ui-feishu/server/group-task-service.mjs` 或 `ui-feishu/kernel/task-kernel.mjs`。`task-kernel.test.mjs` 单独运行 14/14 通过，覆盖停止一起启动中的任务不影响其他 lane、迟到输出不能覆盖停止结果、停止来源阻止迟到子任务重启等行为。旧版 PR 的停止实现没有重新带入。 |
| SSE 背压 | **修复有效；缺少持久测试** | `realtime-hub.mjs` 在 `writableLength` 超过 4 MiB 时移除并销毁连接。临时压力脚本在约 4.20 MiB 时触发销毁。主对话已有 gap 后快照恢复；群聊重连会重新拉取快照。PR 未新增对应的仓库测试。 |
| JSON 404 / 静态资源 | **修复有效；缺少持久测试** | 未知 `/api/*` 在 route 未匹配时返回 `application/json` 的 `{"error":"Not found"}`；非 API 路径仍进入原静态文件服务。临时端到端用例验证 `/api/does-not-exist` 为 JSON 404，`/page` 仍返回静态内容。静态文件实现本 PR 未修改。 |

## 收敛与回归核对

最新 PR 的净差异为 17 个文件、`+451/-58`，全部是：

- `windows/server/` 的访问控制、会话、执行、SSE、退出处理和 PDF；
- `windows/scripts/remote-room-demo.mjs`；
- `windows/tests/` 的 5 个测试文件。

以下旧版高风险改动已消失：

- 没有 `web-ui/*` 修改或恢复；
- 没有 `ui-feishu/*` 前端修改；
- 没有删除 `ui-feishu/shared/features/project-progress/*`；
- 没有删除 `windows/server/project-progress-store.mjs`；
- 没有修改 `windows/server/routes/system-routes.mjs`、Provider、Cloudflare、员工路由、群任务服务或静态路由；
- `request-handler.mjs` 保留当前群创建、任务、连接、图片设置、转发、版本、Artifact、发布、员工、成长、项目复盘、群聊、后续队列、单聊、用量和系统路由。

因此，旧报告中的“覆盖员工、群任务、Provider、Cloudflare、项目进度或单前端路由”不再成立。最新版没有这些路径层面的回归。

## 测试验证

全程使用 `git archive` 和 `/tmp` 文件，没有 checkout、stash、merge、worktree、rebuild、restart，也没有写当前源码。

### 合并与组合树

- `git merge-tree --write-tree --name-only origin/develop origin/pr-2`：退出 0，无冲突，虚拟 Tree 为 `62f9a0b6fafc969188e8338a3b4558170828f2cc`。
- 当前工作区的 tracked dirty 文件和 untracked 文件与 PR 的 17 个路径交集为空。
- 为核对组合效果，我在 `/tmp` 取上述虚拟合并 Tree，并叠加当前工作区除 `work/` 外的未提交文件。

### Node 后端

使用 Node `v24.22.1`，在 `/tmp` 执行：

| 树 | 总数 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| PR-only | 568 | 555 | 12 | 1 |
| 当前 `develop` 基线 | 558 | 545 | 12 | 1 |
| PR + 当前未提交改动 | 570 | 557 | 12 | 1 |

三者失败的 12 项名称完全一致，集中在既有历史回退、模型设置、PWA 缓存、图片尺寸和 Provider 迁移夹具。PR 新增了 10 个通过用例，没有扩大既有失败集合。

证据：

- `/tmp/negus-pr2-d60-full-tests.log`
- `/tmp/negus-develop-full-tests.log`
- `/tmp/negus-pr2-combined-full-tests.log`

### 定向验证

- 新增/修改的 5 个后端测试文件：108 项，104 通过，4 项失败；4 项在 `develop` 基线上同名失败。
- `ui-feishu/validation/task-kernel.test.mjs`：14/14 通过。
- `ui-feishu/validation/group-task-service.test.mjs`：使用 `--test-force-exit` 运行，13/13 通过。
- SSE 背压临时脚本：超过 4 MiB 后连接被销毁，输出 `buffered=4200719`。
- JSON 404/静态回退临时测试：1/1 通过。
- 跨项目 TextInput 临时测试：成功复现 P0。
- 员工 `recovered` 临时测试：成功复现 P1。

`ui-feishu/validation/group-workspace.test.mjs` 依赖 `127.0.0.1:4320` 的固定测试服务；本次只读审核没有启动该服务，因此没有浏览器结果。本 PR 也没有修改前端文件。

### 测试质量判断

新增测试确实覆盖了：

- token 精确比较、地址限速、可信/不可信代理；
- 普通 Thread 的主要读写操作 403；
- app-server `exited` 对普通执行、后台任务、员工的直接收敛；
- 重复 `exited` 不重复结束员工 Turn；
- 群任务停止和任务内核不误伤其他任务。

测试仍缺少：

- 跨项目 TextInput 的 GET/POST；
- 员工 `recovered`、`failed` 与自动重启后的幂等；
- SSE 4 MiB 背压和断开后的真实 EventSource 重连；
- 未知 `/api/*` JSON 404；
- 本机 Cloudflare Tunnel + 受控服务环境下的代理地址和错误 token 限速。

现有安全作用域测试是 Store 单元测试，未走完整 HTTP 路由，所以没有发现 TextInput 路由绕过。

## GitHub checks

最新 Head 的 `statusCheckRollup` 为空，PR 没有 review 或 checks。仓库 `.github/workflows/ci.yml` 的 pull request 触发分支仍只有 `main`：

```yaml
on:
  pull_request:
    branches: [main]
```

所以当前 PR 以 `develop` 为 Base 时不会自动产生 GitHub CI。本次本地全量结果可以支撑代码评估，但不能在 GitHub 上留下可追溯的 PR 检查。

## 脏工作区与建议合并顺序

当前工作区有已修改和未跟踪的需求表、员工任务/群任务、项目目录、项目管理和 Windows 服务文件。它们与 PR 的 17 个路径没有重叠，直接合并不会覆盖这些文件；组合树全量测试也保持相同失败集合。

建议顺序：

1. **先不要合并当前 Head。** 在 PR 或基于最新 `develop` 的小提交中修复跨项目 TextInput 与员工 `recovered` 两项，并补路由级和自动恢复测试。
2. 在当前 `develop` 上先把用户现有的未提交需求表和代码改动单独提交，再做一次组合测试。这样保留清晰的回滚边界，避免需求文档、员工任务改动和 PR 合并混成一次提交。
3. 两项阻断修复通过后，从干净的 `develop` 合并处理后的 PR Head；当前共同祖先关系支持快进，但仍应先更新并核对远端 `develop`，避免基于过期 Base。
4. 合并后重跑 `windows/tests/*.test.mjs`、相关群任务测试和新增安全路由测试。发布前再配置 `NEGUS_TRUSTED_PROXIES` 并做隧道入口验证。
5. 本次审核不包含发布、重启或线上验收。

## 可接受残留风险与必须修改项

必须修改：

- 跨项目待回答 TextInput 的项目/Turn 校验；
- 员工运行时处理 `recovered/failed`，并保持终态幂等；
- 公网部署的 `NEGUS_TRUSTED_PROXIES` 实际接线；
- 为上述前两项增加能复现当前缺口的测试。

可接受残留：

- 12 个既有 Node 测试失败不属于本 PR 新增，但在 PR 和合并后仍会让测试集非全绿；
- 当前群任务原生运行层对真实 `exited` 的最坏收敛延迟为一次 10 秒健康核对；
- 精确路径 `/api`（无尾斜杠）仍不会走 `/api/*` JSON 404 分支；
- SSE 背压与 JSON 404 当前只有本次临时验证，仓库内没有回归测试；
- 最新 PR 没有 GitHub checks，需要依赖本地结果或先扩展 CI 触发范围。
