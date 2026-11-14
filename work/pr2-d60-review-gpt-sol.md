# PR #2 / d60 对 Negus develop 的只读审核

## 结论

**有条件下合并；当前不可直接合并或发布。** 最新 head `d60f32b3e0eea56a2751de4f1230d6cdac3f95f5` 对 `origin/develop` `55f293bbf0bbd7fb82d8f25401a5e94465b83f77` 的净变化是 17 文件、+451/-58。`git merge-tree --write-tree --name-only` 得到 `62f9a0b6fafc969188e8338a3b4558170828f2cc`，退出 0；GitHub `mergeable=MERGEABLE`，但最新 head 的 check-runs 为 0。旧版 cf06972 的 56 文件和冲突结论不适用于这次净 diff。

## 阻断项与必须修改项

1. **有效访问令牌会被其他人的错误尝试锁住。** 当前用户打开有效分享链接或已保存 Cookie 可进入；合入后，`createAccessGuard.check()` 在验证正确令牌前先看该地址是否累计 10 次失败，达到阈值就连正确令牌也返回 429（`windows/server/http/access-control.mjs:79-89`）。默认未配置信任代理时，公网经本机 tunnel 的访问可能共用一个 `127.0.0.1` peer；有人拿旧链接连续刷新或猜错十次，其他持有效链接的手机也会被锁一分钟。新增测试甚至把“正确令牌仍拒绝”写成预期。必须让有效令牌可以通过，错误令牌仍限速，并补同一入口下两个真实客户端/旧链接的请求测试；代理配置需按实际部署验证。此项阻断直接合并。
2. **线程作用域只完成部分入口。** 用户输入外部 Thread ID 读取普通会话、追加、停止、恢复归档时，新校验在 `app-server-conversation-store.mjs` 拒绝 403，`conversation-service.mjs` 不再回退 JSONL，属于有效修复。可是 `conversation-settings-routes.mjs:73-106` 的上下文读取/阈值/压缩只经 `authorizeAgentThread`，普通 Thread 无绑定时直接通过；`/api/execution-status` 亦未统一校验。`contextManagement` 直接操作指定 ID，仍可读取或改变其他 Thread 的上下文状态。若以“所有浏览器 Thread 操作受项目约束”为合并目标，须先补统一授权及 API 层外部 Thread 测试；不能把现有部分修复称为完整隔离。
3. **持久令牌声明未实现。** `windows/scripts/remote-room-demo.mjs:64` 仍默认 `randomBytes(12)`，没有读取或保存 `runtime/access-token`；已有 `--token`/受控服务传参可保持链接，但 PR 本身没有提供重启后持久化。若此项是验收承诺，须补实际启动链路与重启测试；否则从 PR 说明中撤回声明，不以它作为合并收益。

## 收敛与逐项核验

| 项目 | 判断及用户可见链路 |
| --- | --- |
| 旧 UI 收敛 | **完成。** 净 diff 未动 `web-ui`、`ui-feishu`、`static-files`、`system-routes`、模型 Provider、Cloudflare 连接、项目进度、群任务账本。请求入口仍装配员工、群任务、模型、Cloudflare；`ui-feishu` 单前端及 `/api/project-progress` 保留。旧版整块覆盖风险已消除。 |
| 项目线程作用域 | **部分修复。** 直接会话读取/steer/interrupt/unarchive 增加校验，403 不回退；上下文和部分状态入口仍缺 API 边界。测试只覆盖 store 方法，不覆盖这些浏览器请求。 |
| 常数时间 token | **基本修复。** `timingSafeEqual` 比较相同长度字节；长度不同仍可区分长度，但令牌本身是高熵值，这不是本次阻断。 |
| persistent token | **未实现。** 启动仍生成临时随机值；现有显式 token 传参是原有能力。 |
| 错误 token 限速 | **实现但有回归。** 按地址计数和 429 测试通过；先锁再验正确凭据导致有效用户被连坐。 |
| 代理头信任边界 | **基本修复。** 默认忽略转发头；只在显式可信直连 peer 上接受 `CF-Connecting-IP`/XFF。部署时必须确认代理清洗/覆盖这些头，且 tunnel peer 配置正确；单元测试只模拟 header。 |
| Codex 进程退出 | **主要链路已修。** client 发 `exited`，普通执行 tracker、员工主会话、后台任务、旧群 Agent 的当前 run 都收终态；新增测试覆盖员工、后台任务和 tracker。未模拟真实子进程崩溃、多个 Provider 并发和任务目录最终显示。 |
| 群任务停止 | **已有能力，非本次修复。** 当前 `multi-agent-service.interruptDiscussion()` 已请求停止并取消排队，`ui-feishu` 持久群任务另有停止链路；PR 净 diff 仅增加旧群 Agent 的进程退出收尾，未改任务停止。既有相关测试通过。 |
| SSE 背压 | **服务端新增上限。** 超过 4 MiB 销毁慢客户端，原有 last-event-id 重连/200 条回放可接续。新增代码无背压测试；已有测试仅验证回放与 gap，休眠手机/代理的实际断连和恢复仍是残留风险。 |
| JSON 404 / 静态资源 | **前者修复，后者沿用已有能力。** 未命中 `/api/*` 现在返回 JSON 404；`serveStatic`、当前 SPA 别名和静态文件实现未改。缺未知 API 的 HTTP 断言，但路由装配测试通过。 |

额外变化：`web-output-service.mjs` 增加 macOS/Linux Chromium 查找及 root 环境 `--no-sandbox`，不改现有 PDF 入口；只有配置 Edge 的已有测试，跨平台实际打印未覆盖。`app-server-client` 的 spawn `error` 路径仍未发 `exited`，进程启动失败时主要依赖请求失败和既有超时收尾；这是可接受的剩余边界，不应描述成所有进程失败都已统一结束。

## 验证证据

- GitHub `gh pr view 2`：4 提交，head/base 与上文一致，`MERGEABLE`，`statusCheckRollup=[]`；check-runs API `total_count=0`。`git diff --check` 通过。未把旧 head 的 checks 当作本次证据。
- 未碰工作区，以 `git archive 62f9a0b6...` 展开到 `/tmp/negus-pr2-d60.HRGPDW`，只在副本链接现有 `node_modules`，使用本机 Node v24.22.1 跑测试。`access-control`、`background-task-health`、`conversation-controls`、`employee-runtime`、`execution-tracker`：108 项，104 通过、4 失败。`request-handler-routing`、`realtime-hub`、`multi-agent-service`、`group-routes`、`web-output-service`：43/43 通过。
- 另以 `git archive origin/develop` 展开 `/tmp/negus-pr2-base.mw6YR4` 对照 `conversation-controls`：同样 4 项失败，分别是 3 个“空 native 正文回退”用例和 1 个旧模型名称预期 `saved-model` 与实际 `current::saved-model` 不符；不能归咎于本 PR，也不能宣称全绿。
- 测试是服务/路由单元级，未在真实手机、公网 tunnel 或真实 Codex 多 Provider 上验收；未启动或改变当前 Negus 服务。

## 脏工作区与建议顺序

当前 `develop` 跟踪 `origin/develop`，有未提交需求表、员工/群任务代码、项目管理代码和未跟踪资料。逐路径比对：这些改动与 PR 的 17 个路径**没有直接重叠**，虚拟 tree 也没有 Git 内容冲突；因此没有已知脏文件覆盖冲突。但不能在脏工作区把 `merge-tree` 的结果当成可直接执行合并的保证，更不能让需求表混入 PR 合并提交。

建议先在当前 `develop` 单独核对并提交应保留的未提交工作（未跟踪临时资料按需要排除），同步 `origin/develop`；然后让 PR 修复上面访问回归与作用域缺口，更新 head 后取得针对新 head 的 checks，并在临时副本复跑定向测试。最后在干净 `develop` 上合入并核对本地/远端同步；`main` 不动。本文仅审核，未执行提交、合并、推送、构建或重启。
