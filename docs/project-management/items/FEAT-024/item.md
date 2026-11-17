---
id: FEAT-024
type: feature
title: 对话转发与公共摘要
category: development
priority: P2
status: handoff_pending
updated_at: 2026-09-30
source: docs/negus-knowledge/features/feature-records/FEAT-024-conversation-forwarding.md
related: [FEAT-001, FEAT-002, FEAT-003]
---

# 对话转发与公共摘要

## 用户原话

原始对话未保存在本条目中，待从原始对话补录；不根据功能文档反推用户原话。

## 简短摘要

从会话菜单转发用户原话与助手最终回复的快照到另一个普通对话或员工主对话，不调用摘要模型。

## 具体内容

转发读取完整可见记录、生成带来源范围的原文快照，并让目标助手先理解内容、等待用户下一步指令。复制等同于在最后一条消息处创建分支；独立摘要服务不再被复制或转发流程隐式调用。

## 预计效果

用户可以把一段对话交给另一个助手继续处理，目标明确知道这是转发的历史内容，不误执行其中的旧指令。

## 当前状态

转发、分支、队列投递和快照保存已有实现，20 项定向测试记录通过；真实手机点击和真实会话投递仍待用户验收。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-024-conversation-forwarding.md`
- `ui-feishu/shared/features/conversations/components/ConversationActions.tsx`
- `windows/server/routes/conversation-forward-routes.mjs`
- `windows/server/conversation-forward-service.mjs`
