# 产品整体审查与加固记录（2026-11-12）

关联条目：`FEAT-001`、`FEAT-002`、`FEAT-006`、`FEAT-007`/`FEAT-008`、`PM-001`
分支：`claude/negus-product-implementation-gugnqy`

## 范围

按功能记录逐项核对现有实现，修复真实缺陷并去掉重复逻辑。没有修改 UI 样式文件；新增的群聊停止按钮复用已有发送按钮样式。

## 用户可见变化

| 功能 | 变化 |
| --- | --- |
| 单人对话 | 只能读取和操作当前项目的对话（此前任何 Thread ID 都能读出本机其他项目的对话内容并向其发送指令）；未命名会话显示首条请求而不是“未命名会话”；Codex 进程意外退出时，运行中的任务立即显示“已中断”，而不是长时间停在“处理中” |
| 项目群聊 | 发送框为空且有 Agent 工作时，发送按钮变为停止，停止当前 Agent 并取消排在后面的讨论；断线重连后自动补拉群消息；Agent 停止或失败后不再残留半截草稿；Codex 进程退出时 Agent 立即失败，不再阻塞队列 30 分钟；修复群聊附件被静默丢弃的问题 |
| 访问控制 | 令牌比较不再泄露时序；同一地址连续 10 次错误令牌后锁定 1 分钟；不传 `--token` 时生成强令牌并保存在 `runtime/access-token`，重启后链接不变；对外监听且令牌短于 16 位时启动告警 |
| 交付物 PDF | 非 Windows 系统可使用 Chrome/Chromium 生成 PDF；以 root 运行时自动加 `--no-sandbox` |
| 运行 | 可在 macOS/Linux 运行：自动从 PATH 查找 `codex`；新增 `pnpm build` / `pnpm start` / `pnpm test` / `pnpm check`；端口被占用时明确报错退出；退出时先写完状态文件 |
| 项目管理 | 删除已被项目管理页取代、无入口的旧“项目进度”页面和接口 |

## 结构调整

- `server/state/json-state-file.mjs`：五个服务各自实现的 JSON 读写合并为一处；群聊状态此前非原子写入，现在与其他状态一致。
- `routes/conversation-routes.mjs`：14 个分支改为路由表，提交去重逻辑只保留一份。
- `execution-tracker.mjs`：状态映射、活动列表更新和非阶段变更统一为辅助函数。
- `web-ui/src/shared/realtime/realtimeConnection.ts`：单人页和群聊共用 SSE 连接；此前群聊没有事件编号去重和断线补拉。
- 未知 `/api/*` 路径返回 JSON 404，而不是落到静态文件。
- SSE 客户端积压超过 4 MB 时断开，由浏览器按事件编号重连补发，避免服务内存无限增长。

## 检查

- `node --test windows/tests/*.test.mjs macos/tests/*.test.mjs`：100 项通过（新增访问控制、状态文件、静态文件、群聊停止与进程退出等用例）。
- `pnpm --dir web-ui build`：通过。
- 以真实 `codex app-server`（codex-cli 0.167.2）和本地模拟模型做端到端验证：新建对话、流式回复、追加、停止、分叉、归档/恢复、上下文用量；第二台设备在任务中途打开能看到草稿；仅凭 Cookie 重新打开；群聊回复与停止；项目管理页；杀掉 Codex 进程后任务显示已中断且下一条消息正常。浏览器控制台和请求无错误。
- 使用 Chromium headless shell 生成 PDF 成功。

## 未验证与风险

- 未在 Windows 原开发电脑、真实模型和手机上验收；PowerShell 回归套件未在本环境运行。
- 公网入口仍使用固定短令牌 `demo123`（`start-web-demo.ps1` 默认值）。为不改变用户已保存的入口，本次未修改；启动时会告警。建议改用生成的强令牌后更新已保存的链接。
- Codex 内部审批仍自动接受（`FEAT-001-I11`，个人可信环境前提不变）。
