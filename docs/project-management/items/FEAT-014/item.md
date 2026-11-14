---
id: FEAT-014
type: feature
title: 项目对话归档与恢复
category: development
priority: P2
status: pending_review
updated_at: 2026-11-07
source: docs/negus-knowledge/features/feature-records/FEAT-014-conversation-archive.md
related: [FEAT-001]
---

# 项目对话归档与恢复

## 用户原话

和 Codex 一样的项目对话归档功能。

## 助手初步理解

用户需要把暂时不用的项目对话从活动列表移开，但保留内容，并能在需要时恢复继续使用。

## 简短摘要

活动与已归档项目对话分开管理，可恢复。

## 具体内容

使用场景：项目会话变多后，用户希望保留历史但只在活动列表看到当前工作。

当前体验：侧栏提供活动/归档视图；归档和恢复调用服务端操作。归档会话加载后只读，避免误发送。

## 预计效果

归档后活动列表立即移除该会话，内容不会删除；进入归档视图可恢复，恢复后回到活动数据源。失败时保留现状并显示真实错误。

## 关联条目

`FEAT-001`

## 当前状态

已实现并已进入提交历史；旧版 Codex 运行时兼容性和手机体验仍待确认。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-014-conversation-archive.md`
- `windows/server/jsonl-conversation-store.mjs`
- `web-ui/src/features/conversations/hooks/useConversationCatalog.ts`

### 2026-11-07 员工主对话禁止归档

用户原话：

> 我的员工目录没有员工了。可能是之前归档对话时归档了。请你先帮我恢复。然后，禁止员工对话被归档。

有效决定：员工主对话不参与活动/已归档切换，前端不提供“归档”操作，按时间归档也排除员工主对话；服务端拒绝直接调用归档接口。已归档的旧员工主对话仍允许“恢复”，现有普通对话、任务对话和群聊归档行为保持不变。
