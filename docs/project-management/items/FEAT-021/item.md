---
id: FEAT-021
type: feature
title: 项目记忆入口与可解释上下文边界
category: development
priority: P2
status: implemented_pending_review
updated_at: 2026-09-15 00:15 +08:00
source: docs/negus-knowledge/features/feature-records/FEAT-021-project-memory-entry.md
related: [PM-001, FEAT-002, FEAT-019]
---

# 项目记忆入口与可解释上下文边界

## 用户原话

原始对话未保存在本条目中，待从原始对话补录；不根据功能文档反推用户原话。

## 简短摘要

项目管理页提供“项目记忆”区域，可以查看最近更新、产品决策和公共群聊完整历史，并明确 Agent 实际接收的上下文范围。

## 具体内容

页面复用现有项目管理文档和群聊读取接口，不建立第二份记忆数据库；用户点击“读取完整历史”时按服务端分页读取目标项目公共群聊。员工私聊不进入该历史，摘要不作为事实，完整历史不会隐式注入模型上下文。

## 预计效果

用户能从一个入口理解项目最近发生了什么、哪些记录会被 Agent 看到，并按需读取完整群聊历史。

## 当前状态

入口和读取逻辑代码已存在，构建记录通过；真实浏览器、手机和公网群聊历史点击仍待验收。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-021-project-memory-entry.md`
- `ui-feishu/shared/features/project-management/components/ProjectMemoryPanel.tsx`
- `ui-feishu/shared/features/project-management/ProjectManagementApp.tsx`
