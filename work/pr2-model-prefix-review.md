# 模型标识与成功状态最小修复审核

日期：2026-11-12
范围：`windows/server/provider-conversation-store.mjs` 当前未提交改动
结论：**可交付，无必须修改项。**

## 审核结论

本次 4 行新增、3 行删除修正了两个独立问题：

1. `ready()` 原先把两个都缺失的字段用 `undefined === undefined` 判为跨渠道副本，导致普通对话在重启加载时把 `lastSuccessfulSettings` 覆盖为当前选择。现在只有 `crossProviderCopyFrom` 为真且与来源 Thread 一致时才进入副本修复。
2. `getRuntimeContext()` 原先把所有裸模型名都补成 `${providerId}::model`，导致 current 通道返回测试中的 `current::saved-model`。现在 current 保持裸模型名，其他渠道继续保留渠道前缀，并设置 `modelProvider`。

`lastSuccessfulSettings` 与当前选择/待切换模型仍保持两个状态：成功完成事件只更新前者；`model`、`pendingProviderId` 继续表达当前及下一次使用的选择。

## 验证

- 合并运行 `conversation-controls.test.mjs` 与 `provider-conversation-store.test.mjs`：66 项，61 通过、5 失败。
- 本次修复直接覆盖的两项均通过：
  - `unloaded settings reuse project history metadata without resuming a thread`
  - `failed sends keep the current choice but preserve the last completed settings across restart`
- 剩余 5 项均为修复前已有失败：
  - 3 项空原生正文历史回退；
  - 2 项跨渠道复制缺少 `rollout.jsonl` 或原对话校验失败。
- 修复前同一组合中的目标失败为 7 项；本次减少 2 项，没有新增失败。
- `git diff --check` 通过。
- 日志：`/tmp/model-prefix-review-tests.log`。

## 生效边界

改动位于后端。前端代码没有变化，但只重启前端不会加载这次修复；需要按 Negus 受控流程重启后端。本次审核未执行提交、发布或重启。
