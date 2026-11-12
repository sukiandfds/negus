---
id: FEAT-022
type: feature
title: CC Switch 共享渠道管理
category: development
priority: P1
status: handoff_pending
updated_at: 2026-09-30
source: docs/negus-knowledge/features/feature-records/FEAT-022-cc-switch-channels.md
related: [FEAT-001, FEAT-002, PM-004]
---

# CC Switch 共享渠道管理

## 用户原话

> “直接开发”

来源：功能档案“范围与基线”一节，2026-09-30 前后记录；未取得消息级标识。

## 简短摘要

让 Negus 与本机 CC Switch 共用供应商、凭据和当前选择，同时保留双方各自正在使用的配置。

## 具体内容

用户在设置里查看、复制、编辑、测试和刷新共享配置；保存时沿用 CC Switch 数据库和备份，当前启用渠道受到保护。普通对话、员工和群聊使用同一模型路由能力；不支持 Responses 协议的渠道不伪装成可用。

## 预计效果

用户添加或切换一个配置后，Negus 与 CC Switch 看到相同供应商和模型，Key 不回显，失败时显示真实原因。

## 当前状态

共享数据库、配置编辑、模型刷新、默认模型和跨渠道会话恢复已有实现及大量定向验证；正式页面、真实供应商生成和部分手机流程仍待用户验收。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-022-cc-switch-channels.md`
- `windows/server/cc-switch-config-service.mjs`
- `windows/server/model-provider-service.mjs`
- `windows/server/provider-conversation-store.mjs`
