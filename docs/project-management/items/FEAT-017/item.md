---
id: FEAT-017
type: feature
title: 多业务项目与 Codex 会话归类
category: development
priority: P1
status: implemented_pending_review
updated_at: 2026-11-12 16:52 +08:00
source: docs/negus-knowledge/features/feature-records/FEAT-017-multiple-business-projects.md
related: [FEAT-001, FEAT-002]
---

# 多业务项目与 Codex 会话归类

## 用户原话

原始对话未保存在本条目中，待从原始对话补录；不根据功能文档反推用户原话。

2026-11-12，来源：当前对话。用户原话：“negus本来就是一个全面的项目管理系统，管理多个项目应该挺正常。如果你说的是项目对话的存放位置不对还可能是错误。你先记下来，后续再找时间和我对齐。咱不列为异常。”

当前有效决定：多项目管理是正常能力，跨项目读取和回答待回答输入暂不列为异常。只有确认属于项目对话存放位置错误时，才按归属错误处理；后续再与用户对齐具体边界。

## 简短摘要

在项目目录中显示多个本机 Codex 业务项目，并保证普通会话、员工会话、公共群聊和工作项目文件的归属边界正确。

## 具体内容

用户从一个项目目录打开对应项目，新建会话使用该项目路径，已有 Thread 可以继续。普通项目会话归对应业务项目；员工直属单聊和员工参与群聊的长期会话归员工自己的项目；项目群聊属于工作项目；员工 Thread 不得出现在工作项目普通会话列表中。

## 预计效果

用户选择项目后进入正确的工作目录和会话，不把员工私聊混入业务项目，也不因为打开项目而改变员工会话的所有者。

## 当前状态

代码中已有项目目录、业务项目配置和会话过滤能力，功能记录称定向测试与构建通过。正式服务里的多项目归类、移动端和真实供应商仍待体验验收。

## 当前证据

- `docs/negus-knowledge/features/feature-records/FEAT-017-multiple-business-projects.md`
- `windows/server/business-project-config.mjs`
- `windows/server/employee-project-directory.mjs`
- `windows/server/routes/conversation-history-routes.mjs`
