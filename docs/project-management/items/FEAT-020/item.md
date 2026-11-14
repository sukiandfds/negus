---
id: FEAT-020
type: feature
title: 内测访问入口与共享链接
category: delivery
priority: null
status: retired
updated_at: 2026-09-16 23:15 +08:00
source: docs/negus-knowledge/features/feature-records/FEAT-020-beta-access-entry.md
related: [FEAT-006]
---

# 内测访问入口与共享链接

## 用户原话

功能档案只记录了“认为与分享功能重复，明确允许判断可删除后直接删除”的授权摘要，没有逐字原话；待从原始对话补录。

## 简短摘要

历史上曾增加独立“内测入口”，后来删除重复入口，统一使用原有分享链接与二维码。

## 具体内容

当前用户通过分享入口生成链接；访问令牌进入 HttpOnly Cookie，页面地址不长期保留令牌。该能力仍是单工作区共享访问令牌，不是账号注册、成员邀请或细粒度权限系统。

## 预计效果

用户只看到一套分享入口，链接持有者能够访问当前工作区，无效访问继续被拒绝。

## 当前状态

重复的“内测入口”已删除，功能标记为已替代。分享链接、Cookie 和访问控制仍保留，真实手机和公网体验不是本条目新增开发内容。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-020-beta-access-entry.md`
- `ui-feishu/shared/features/conversation-sharing/components/ShareConversationDialog.tsx`
- `windows/server/http/access-control.mjs`
