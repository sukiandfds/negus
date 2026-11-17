# 员工主对话完成状态回落复核

日期：2026-11-10
基线：`340baaa`（`develop`）

## 验证命令

```bash
/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test windows/tests/employee-runtime.test.mjs \
  ui-feishu/validation/employee-provider.test.mjs \
  ui-feishu/validation/realtime-regression.test.mjs

/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --check windows/server/employee-runtime-service.mjs

/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --check ui-feishu/server/employee-event-integration.mjs

/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --check ui-feishu/server/register.mjs

/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --check windows/scripts/remote-room-demo.mjs

git diff --check
```

## 结果

- `employee-runtime.test.mjs`：31/31 通过。
- `employee-provider.test.mjs`：13/13 通过。
- `realtime-regression.test.mjs`：7/7 通过。
- 三文件组合：51/51 通过，失败 0。
- 相关 MJS 语法检查通过。
- `git diff --check` 通过。

覆盖：空闲态旧 `turn/started`、提交期候选 turnId、响应确认绑定、steer 保留 turnId、同轮 delta/final、无 turnId 正文拒绝、无 turnId completion 兼容、普通与早到无 turnId completion 的员工/execution 双状态同步、无 ID 与 matching ID completion 同时存在时总 completion 一次、无 confirmed ID 时安全失败且不静默清 execution、start 响应前 started/delta/final/completion 的深拷贝缓冲与原序回放、不同 turnId 丢弃、回放各一次、失败提交不跨下一轮泄漏、旧 Provider/线程/轮次正文与 completion 不进入 execution tracker、活动线程 turnId 恢复、无法恢复时安全中断、员工目录端点 working→idle。

无 turnId completion 早到时会在确认 turnId 后按兼容规则回放；它与旧 Provider 的无标识迟到事件无法被协议数据严格区分，属于保留兼容规则时的已知边界。

正式 execution 接线只为合法无 turnId completion 生成 tracker 专用深拷贝，补齐 `params.turnId` 和 `params.turn.id`；原始员工消息及 completion payload 不变。无法取得 active/confirmed turnId 时不向 execution 投递 completion。

## 状态

仅工作区源码、测试与文档已修改。未提交、未推送、未发布、未重启，运行服务尚未加载。
