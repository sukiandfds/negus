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

### 2026-11-18 更新 Sol 6.2 与 Astr 6.2 模型目录

用户原话：

> 更新一下模型选择列表，供应商反馈 6.2 sol 和 6.2 astr 已经可用

有效决定：向 vip、折扣和 astr 三个供应商目录实际读取可用模型后，仅加入供应商返回的模型。vip 与折扣加入 `gpt-6.2-sol`、`gpt-6.2-astra`；astr 专用渠道加入 `gpt-6.2-astra`。默认模型保持 `deepseek-flash`，现有模型和渠道顺序保留，新增模型列在同渠道旧版 GPT 模型之前。

用户操作变化：打开模型选择列表后，可以在 vip 和折扣渠道看到两个 6.2 模型，在 astr 渠道看到 `gpt-6.2-astra`；选择后沿用现有模型与推理强度选择流程。任务路由也能识别这些模型并按渠道可用性回退。
