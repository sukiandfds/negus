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


### 2026-11-17 从员工主对话新建普通项目对话

来源：本轮修复任务原文；未提供原始对话消息标识。

用户原话：
> 3.现在，打开一个员工对话，然后再点击创建新对话，变成了创建这个员工的新对话，而不是这个项目的新对话。原因可能是把员工也当成项目了。

有效决定：员工页点击“新建对话”离开员工上下文，进入个人项目普通对话；普通业务项目会话中新建沿用其 cwd。员工私有 root 不作个人项目 root；个人目录未就绪时沿用 /api/project 的普通项目 root。员工在项目列表的展示身份不改变既有会话归属。未发送前仍只有 pending 临时对话，不创建真实 Thread。

根因：create 清除了 URL 的 agent/employee/conversation，但未清 React agentId，员工标题与员工身份推导继续残留。修改 FeishuApp 的现有新建入口：清 agentId、自动打开员工标记及旧群/详情状态；普通会话采用当前 cwd，员工会话采用 personal root，沿用原 deferred 创建和普通发送。

操作变化：打开员工主对话→添加→新建对话→看到“新对话”且无员工标题；输入后发送→创建请求使用个人项目 root，无员工 conversationId，随后调用普通会话发送 API。普通业务对话→新建→临时会话保留原业务 root。

隔离 Chrome 已核对 URL、标题、正文缓存身份、创建 root、延迟创建、普通发送和无员工 scope；所有 API 被夹具拦截，无真实消息。证据见 [本轮验证记录](../../../../work/four-usage-fixes-20261117/verification.md)。本轮仅源码和自测，未提交、推送、发布或重启，独立验收由来源对话安排。


### 2026-11-17 独立审核后的保留范围与回归

来源：本轮用户原话：“只补以下三个缺项”“不要重做已验证通过的四路主体”。独立审核为FAIL的缺项属于FEAT-001上下文/压缩和FEAT-002目录错误分类；员工页新建普通对话主体保持上一轮实现，本轮未改FeishuApp、项目归属或发送入口。

四项浏览器仍覆盖员工→新建→个人root→普通发送、URL/标题离开员工身份，以及普通业务会话新建保留cwd；所有消息由隔离API夹具处理。对应证据见 [复审补修记录](../../../../work/four-usage-fixes-20261117/verification.md#第二轮补修独立审核-fail-后)。工作区已通过部分保留；未提交、推送、发布或重启，来源对话安排独立复审。
