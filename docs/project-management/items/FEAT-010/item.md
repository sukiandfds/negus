---
id: FEAT-010
type: research
title: Orca 群聊执行运行时适配技术试验
category: research
priority: null
status: paused_experiment
updated_at: 2026-07-29 18:53 +08:00
source: docs/negus-knowledge/features/feature-records/FEAT-010-orca-group-runtime-adapter.md
related: [FEAT-002, FEAT-009]
---

# Orca 群聊执行运行时适配技术试验

## 用户原话

原始对话未保存在本条目中，待从原始对话补录；不根据研究正文反推用户原话。

## 简短摘要

试验把群聊 Agent 的底层执行器从默认 Codex 切换到 Orca CLI，没有迁移 Orca 的产品界面或完整群聊能力。

## 具体内容

默认运行时仍为 Codex，只有显式选择 Orca 才通过 CLI 启动任务。目标是在不改变现有页面的前提下验证状态映射、回复和 Artifact 链路；本试验没有实现 Orca 登录、Relay、完整上下文、多人协作或执行中重启恢复。

## 预计效果

在验证条件下，用户仍使用 Negus 群聊页面，任务可以由 Orca Terminal 执行；Orca 不可用时显示明确失败，不悄悄回退。

## 当前状态

技术试验已暂停，不是当前产品路线，也不应作为群聊需求继续开发。只有用户重新确认完整 Orca 方案后才评估恢复。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-010-orca-group-runtime-adapter.md`
- `windows/server/runtime-adapters/`
