---
id: FEAT-013
type: feature
title: 从当前消息分叉继续
category: development
priority: P2
status: pending_review
updated_at: 2026-08-06
source: docs/negus-knowledge/features/feature-records/FEAT-013-conversation-fork.md
related: [FEAT-001]
---

# 从当前消息分叉继续

## 用户原话

类似 Codex 的从当前对话继续按钮功能。

## 助手初步理解

用户希望从某条已经完成的回复位置创建一个独立对话分支，原对话不被改写，新分支可以继续输入。

## 简短摘要

从已完成回复创建可继续的新 Thread。

## 具体内容

使用场景：用户想沿着历史中的某个结果尝试另一个方向，但不希望污染原对话。

当前体验：已完成助手消息下方出现分叉入口；服务端按该消息的 Turn 调用官方 `thread/fork`，成功后自动切换新 Thread。

## 预计效果

用户点击后进入包含指定历史前缀的新对话，原对话保持不变；运行中的任务不能分叉，失败显示真实错误。

## 关联条目

`FEAT-001`

## 当前状态

已实现并已进入提交历史；当前只剩本机 app-server 能力探测，若不支持则显示明确不可用状态。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-013-conversation-fork.md`
- `windows/server/app-server-conversation-store.mjs`
- `web-ui/src/features/conversations/hooks/useProjectConversations.ts`

## 后台任务分支的指令

本轮质管复验后，用户要求「后台任务点『从这里继续』的原生 thread/fork 必须通过统一指令组装保留岗位指令和一份共用规则，并剥离应用内部字段」。保留分支位置和原对话，沿用现有完整指令覆盖顺序。共用指令规则见 PM-004，隔离协议验证见 [分支补验](../../../../work/config-refactor-20261119/fork-verification.md)。
