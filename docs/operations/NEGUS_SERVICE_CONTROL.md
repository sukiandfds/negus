# Negus 服务维护（macOS）

更新：2026-09-30，FEAT-009。当前管理器适用于 Mac；Windows 系统恢复与发行包尚未适配。

## 自带能力与命令

正常新部署完成依赖与前端构建后，执行 `pnpm negus:start`：初始化持久访问凭据、保存并隔离验证初始运行快照、启动服务，并安装登录时及每3小时检查的用户级 LaunchAgent。已有健康旧部署不会被普通 start 擅自切换。

| 操作 | 命令 |
| --- | --- |
| 本地/公网只读检查 | `node scripts/negus-watchdog.mjs check` |
| 恢复已退出的服务 | `node scripts/negus-watchdog.mjs recover` |
| 准备新版及验证回退版本 | `node scripts/negus-supervisor.mjs prepare` |
| 常规后端重启，等待任务收口 | `node scripts/negus-supervisor.mjs restart` |
| 用户接受中断当前任务时接管重启 | `node scripts/negus-supervisor.mjs restart --handoff` |
| 查看任务与最终结果 | `node scripts/negus-supervisor.mjs status` |
| 前端重新构建并发布 | `node scripts/negus.mjs rebuild` |
| 前端静态文件回退 | `node scripts/negus-frontend.mjs rollback` |
| 定时检查状态 | `node scripts/negus-watchdog-macos.mjs status` |

`pnpm negus:restart`、`pnpm negus:backend:restart`、旧 `node scripts/negus-backend.mjs restart` 统一转入独立管理器。另有 `negus:release:prepare`、`negus:restart:status`、`negus:rebuild`。没有准备版本时，restart 会先准备；没有首个回退版本时拒绝停止服务。

## 首次从旧部署切换

旧进程内存不是可恢复的源码快照。首次需指定已核对的仓库提交：

`node scripts/negus-supervisor.mjs prepare --fallback-revision <完整提交SHA>`

脚本将该提交的后端代码、当前安装依赖及现有前端产物保存为基线回退版本，在临时数据目录/临时端口实际启动并验证 HTTP API 和页面；这不代表精确还原旧进程内存，也不证明所有历史业务都已验收。Git仅用于旧部署首次取基线；新部署已有初始快照，后续重启不依赖Git。

当前新版同样生成独立快照并构建前端、启动预检。任一准备失败，原服务不停止。

用户接受短暂断开时，使用 restart --handoff。独立进程有15秒交接时间；命令返回 scheduled 后应及时完成回复，不在当前对话等待自身重启。此模式可以中断任务，并允许从没有维护接口的旧后端切换；仍核验 PID、进程归属和端口，不直接强杀未知进程。默认无 --handoff 时继续等待任务收口。

## 三次失败与恢复

- 源码、Node依赖及前端产物保存在 runtime/releases/，有内容校验和隔离预检记录；工作区后续编辑不改这些快照。
- 独立管理进程也从候选快照运行。停止旧服务前，先持久化已验证的回退指针。
- 停止使用 SIGTERM；30秒内无法确认原进程退出与端口释放则中止，不发送生产 SIGKILL、不并发启动第二份服务。
- 新版启动后检查 API、页面、前端版本及连续5次健康探测；失败先停止本管理器启动的进程，确认退出后重试。
- 新版连续失败3次后恢复回退快照的前端文件和后端代码，并再次验证。回退失败记录 failed，不能承诺一定恢复。
- 成功后保存当前运行快照；管理进程结束。若后端之后退出，定时检查/start 使用已确认的后端运行快照，保留当前已发布的前端，不重新发布快照中的旧页面。定时恢复周期仍为3小时，不是实时可用性保证。
- 对话、附件、访问令牌和供应商配置保持原数据目录，不自动回滚业务数据。此机制不适用于不兼容数据迁移；该类更新必须另行制定迁移与恢复方案。

前端独立 rebuild 继续使用现有构建、备份、资源优先发布与失败恢复，不重启后端。后端版本回退恢复的是快照中的前端，可能撤回此后单独发布的前端更新。旧哈希静态资源保留，页面重连后可按原版本提示刷新。

## 状态与排错

- `runtime/negus-restart-job.json`：任务ID、worker PID、阶段和尝试次数。
- `runtime/negus-backend-result.json`：最终 started、rolled-back 或 failed。scheduled 不是成功；核对 jobId 和时间，不能用旧结果判断本次。
- `runtime/negus-release-state.json`：已确认运行版本及前版；`negus-release-prepared.json`：待切换版本。
- `runtime/negus-backend-worker.log`：独立管理日志；`release-check-*.log`：隔离预检日志。服务日志可能包含访问链接，不直接贴给用户。
- `runtime/negus-watchdog-result.json`：系统定时检查结果。

所有发布/恢复共享操作锁。旧锁所属进程退出后，使用独占 `.lock.recovery` 标记串行清理旧锁，并在取得标记后重新读取锁；其他竞争脚本退出。损坏或无法确认归属的锁仍拒绝自动清理。若清理进程本身崩溃留下 `.lock.recovery`，不递归自动抢占：先核对任务、服务状态及工作区/快照启动的维护进程，确认没有清理或维护任务执行后，才可由维护人员清理对应标记并重试，不能仅凭文件时间删除。快照/备份不自动删除，后续按保留策略清理。

## 提示词与边界

统一规则由 windows/server/maintenance-instructions.mjs 生成，接入普通对话、员工单聊与群聊真实 developerInstructions 链路。提示词识别服务主机平台和安装目录，说明独立交接、结果查询、回退及授权范围。后端加载新版本后生效。

系统检查仅在用户登录后运行，休眠、关机、退出登录时不保证服务。完整下载发行包、Windows实机恢复、无感A/B切换、正在生成任务的无损迁移尚未交付。

## 验证记录

本轮16项定向测试通过，包括真实测试子进程连续失败3次后拉起回退版本、停止失败不启动竞争进程、原有等待任务重启、部署和提示词。基线与新版在临时项目目录实际启动、API/页面/前端版本检查通过；新版TypeScript与Vite构建通过。未发送供应商生成请求。正式切换最终结果以运行结果文件为准。
