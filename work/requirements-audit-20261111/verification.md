# 需求表与代码状态审计

日期：2026-11-11
代码基线：`develop / c92c3d8`
运行快照：`1794400528503-d6f3c248`

## 需求页读取

- `GET /api/project-management`：HTTP 200。
- 面板可见条目：34。
- 当前计划：`FEAT-001`、`FEAT-002`、`FEAT-015`、`FEAT-006`、`FEAT-009`、`BUG-025`。
- 24 个 `FEAT-*` 功能档案均已有关联项目管理条目。
- 运行中的旧解析器仍显示 16 个英文状态标签；工作区源码已修正，需后端重启后才能完全生效。

## 自动化结果

命令：

```bash
node --test windows/tests/*.test.mjs
node --test ui-feishu/validation/*.test.mjs
ui-feishu/node_modules/.bin/tsc -p ui-feishu/tsconfig.json --noEmit
node --test windows/tests/project-management.test.mjs
```

- Windows/后端：560 项，547 通过，12 失败，1 跳过。
- UI：141 项，131 通过，9 失败，1 跳过。
- 项目管理定向测试：5/5 通过。
- TypeScript `--noEmit`：通过。
- `git diff --check`：通过。

## 失败分类

后端 12 项失败：

- `conversation-controls.test.mjs` 3 项：空原生正文预期回退或返回明确读取错误，实际得到 `thread not loaded`。
- `conversation-controls.test.mjs` 1 项：未加载会话的模型元数据实际保留 `current::saved-model` 前缀，测试预期裸模型名。
- `conversation-file.test.mjs` 1 项：测试模拟环境没有 `caches.open`。
- `conversation-send-state.test.mjs` 1 项：保存的模型选择实际为 `wrong`，测试预期 `group::saved`。
- `conversation-service-media.test.mjs` 1 项：补充会话测试触发 `fresh thread has no persisted turns`。
- `heartbeat-message.test.mjs` 1 项：测试依赖 `ui-feishu/node_modules/esbuild/lib/main.js`，当前安装中找不到。
- `lynn-workbench-routing.test.mjs` 1 项：图片编辑实际发送 `3840x1632`，测试预期 `4K:2.35:1`。
- `provider-conversation-store.test.mjs` 3 项：跨渠道复制缺少 `rollout.jsonl`、原对话校验失败，以及失败发送后保留的模型带 `current::` 前缀。

UI 9 项失败：

- 8 个浏览器测试因分别访问未启动的固定测试服务端口 `5201`、`5297`、`4320` 而 `ERR_CONNECTION_REFUSED`。
- `group-isolated-attachment.test.mjs` 缺少 `NEGUS_TEST_ORIGIN`、房间、令牌和上传目录环境变量。

这些 UI 失败不能证明产品回归，也不能据此认定 UI 通过；需要在完整隔离测试编排下重跑。后端失败需要逐项判断是正式行为、旧测试预期还是测试环境缺件，交接时不能写成“全套测试通过”。

## 2026-11-11 最新提交真实运行测试

运行版本：`develop / 55f293bb`，快照 `1794409080769-f1f4cefc`，PID `70262`。

- 重启：一次成功，没有回退；后端、前端、公网隧道均为 healthy。
- 员工状态：`developer` 收到真实 DeepSeek 请求，状态从 `working` 回到 `idle`；会话最新助手回复为“状态测试通过”。
- 模型切换：切到 `deepseek-v4-pro/high` 后，原始会话记录的该轮 `turn_context` 为 `deepseek-v4-pro`；切回 `deepseek-flash/high` 后，下一轮原始记录也为 `deepseek-flash`。
- 群聊未点名：`current-project` 群内消息由 `manager` 接待，回复“群聊接待测试通过”；任务 completed，结果 delivered。
- 群聊点名：`@技术研发` 消息由 `developer` 回复“群聊任务测试通过”；任务 completed，结果 delivered。
- 未覆盖：Mac 锁屏，未做浏览器视觉和点击验收；测试消息保留在真实员工会话及 `negus 项目群`。
