---
id: FEAT-023
type: feature
title: 自定义桌面
category: development
priority: P2
status: handoff_pending
updated_at: 2026-09-30
source: docs/negus-knowledge/features/feature-records/FEAT-023-desktop.md
related: [FEAT-001, FEAT-002, FEAT-018]
---

# 自定义桌面

## 用户原话

功能档案只保留了用户确认的方向摘要，原始逐字要求未完整保存；待从原始对话补录。

## 简短摘要

把设备首页做成可编辑的工作空间，展示当前任务、自动化、框选区域和与真实会话绑定的回复浮层。

## 具体内容

用户可以拖放、缩放、固定和移除组件，在空白处画圆或矩形形成区域，并通过原输入框提出需求。桌面复用真实对话、Goal、自动化和消息状态，不执行任意生成的 HTML/JS，也不复制另一套聊天协议。

## 预计效果

用户打开 Negus 即可看到自己的工作空间，能从桌面发起任务、查看真实状态并保留布局与技术痕迹。

## 当前状态

桌面、当前任务、自动化只读展示、区域绘制和真实回复浮层已有实现；任意业务组件生成、跨设备同步、完整总助手与文件管理仍未实现。状态保持待交接。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-023-desktop.md`
- `ui-feishu/shared/features/desktop/`
- `windows/server/desktop-automations.mjs`
