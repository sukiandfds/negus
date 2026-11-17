---
id: FEAT-019
type: feature
title: 项目面板单项目经理 AI 入口
category: development
priority: P2
status: implemented_pending_review
updated_at: 2026-09-14 23:20 +08:00
source: docs/negus-knowledge/features/feature-records/FEAT-019-project-manager-entry.md
related: [PM-001, FEAT-002, FEAT-021]
---

# 项目面板单项目经理 AI 入口

## 用户原话

原始对话未保存在本条目中，待从原始对话补录；不根据功能文档反推用户原话。

## 简短摘要

从项目管理概览进入现有 `manager` 员工的长期单聊，并在标题区显示当前项目上下文。

## 具体内容

用户点击“与项目经理讨论”后进入现有员工会话，带着项目 ID、名称、阶段和目标；页面不自动发送消息，不新建另一套经理聊天协议，也不改变员工会话的文件归属和权限。

## 预计效果

用户能从正在查看的项目直接找到项目经理，同时明确当前对话属于哪个项目；需要讨论的具体任务仍由用户发送。

## 当前状态

入口和上下文展示代码已存在，构建记录通过；真实员工 Runtime、浏览器点击和移动端体验仍待验收。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-019-project-manager-entry.md`
- `ui-feishu/shared/features/project-management/ProjectManagementApp.tsx`
- `ui-feishu/shared/features/agent-sharing/navigation/openAgentConversation.ts`
