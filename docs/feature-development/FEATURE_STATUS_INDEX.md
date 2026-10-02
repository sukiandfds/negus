---
document_type: feature_status_index
schema_version: 1
last_updated: "2026-09-29 18:31 +08:00"
---

# 功能状态索引

本文件只做导航与简短摘要。状态、版本沿用既有记录，不代表本轮重新验收；字段冲突明确标注，不通过文档整理擅自判定完成。

当前产品方向见 [产品定义](../../PRODUCT_DEFINITION.md)，旧需求如何重新评估见 [文档导航](../README.md)。具体工作状态读取项目管理 item.md；功能行为和验证证据读取对应档案，两者不同范围不能混作一种完成状态。

## 当前功能

| 编号 | 功能 | 既有记录状态 | 记录版本 | 边界与结论 | 详细来源 |
| --- | --- | --- | --- | --- | --- |
| `FEAT-001` | 单人 Codex Web 对话与控制 | `implemented_pending_review` | `v0.10.12` | 已有会话与执行能力；后续隔离、缓存及滚动修复有独立记录，真实体验仍分项验收。 | [`FEAT-001-single-codex-web.md`](./features/FEAT-001-single-codex-web.md) |
| `FEAT-002` | 项目群聊与多 Agent 讨论 | `in_progress` | `v0.4.4` | 索引原为 in_progress，档案为 code_ready_pending_user_review；状态冲突待核对，不能认定已验收。 | [`FEAT-002-group-multi-agent.md`](./features/FEAT-002-group-multi-agent.md) |
| `FEAT-003` | 附件与对话内容渲染 | `implemented_pending_review` | `v0.3.0` | 支持上传、图片/音频/视频/文件展示和 Markdown 本地图片登记；仍是 Demo 级上传协议 | [`FEAT-003-attachments-content-rendering.md`](./features/FEAT-003-attachments-content-rendering.md) |
| `FEAT-004` | PWA、设备身份与移动/平板入口 | `implemented_pending_review` | `v0.2.0` | 新构建会提示用户刷新且不会自动打断任务；连接状态不再误报电脑离线，真实 PWA 更新流程待原开发电脑验证 | [`FEAT-004-pwa-device-identity.md`](./features/FEAT-004-pwa-device-identity.md) |
| `FEAT-005` | Desktop/Web 连续性与同任务提示 | `discovery` | `v0.4.1` | Desktop 与 Web 共享持久化 Thread 但不共享实时事件；双端同时操作曾导致 Web app-server 失联，需先做同任务提示、最小控制权和受控恢复 | [`FEAT-005-desktop-web-continuity.md`](./features/FEAT-005-desktop-web-continuity.md) |
| `FEAT-006` | 固定公网入口与正式访问控制 | `in_progress` | `v0.2.2` | 固定域名可用，但公网图片上传实测约 10-16 秒，本机仅约 0.1 秒；VPN 不稳定，需评估稳定线路或大陆中转方案 | [`FEAT-006-stable-remote-access.md`](./features/FEAT-006-stable-remote-access.md) |
| `FEAT-007` | Agent 交付物生成、预览与版本管理 | `implemented_pending_review` | `v0.2.1` | M1 代码已提交：交付物发布、预览、版本和审核均已有实现；剩余是整体真实使用验收，不是未提交开发 | [`FEAT-007-agent-artifacts.md`](./features/FEAT-007-agent-artifacts.md) |
| `FEAT-008` | HTML 网页生成与 PDF 双文件交付 | `implemented_pending_review` | `v0.2.0` | 静态 HTML、Edge 转 PDF、安全打开和群聊双文件发布代码已提交；剩余是体验验收，不继续扩展网页编辑器或 Office 能力 | [`FEAT-008-html-page-pdf-generation.md`](./features/FEAT-008-html-page-pdf-generation.md) |
| `FEAT-009` | Mac 检查、前后端更新与恢复 | `handoff_pending` | `v0.5.0` | Mac 正常部署自带独立脚本及 3 小时定时检查；隔离验证通过，正式后端首次加载与重启体验待验证。 | [档案](features/FEAT-009-remote-development-host.md) |
| `FEAT-010` | Orca 群聊执行运行时适配技术试验（非路线 2） | `paused_experiment` | `v0.1.0` | 仅完成可选 Orca CLI 执行器及离线测试，没有迁移产品功能；因范围偏离用户目标而冻结，不计入路线 2 进度 | [`FEAT-010-orca-group-runtime-adapter.md`](./features/FEAT-010-orca-group-runtime-adapter.md) |
| `FEAT-011` | 浮生云算用量监控 | `implemented_pending_review` | `v0.1.1` | 用量摘要、详情、按 Turn 去重、缓存和失败保留旧数据已提交；供应商查询和多端布局已有真实体验记录，不再列为未提交 | [`FEAT-011-fusheng-usage-monitor.md`](./features/FEAT-011-fusheng-usage-monitor.md) |
| `FEAT-012` | 消息内容快捷复制 | `implemented_pending_review` | `v0.1.0` | 复制和浏览器回退已提交；重新编辑入口也已接入会话流程，剩余只需确认不同浏览器权限下的体验 | [`FEAT-012-conversation-copy.md`](./features/FEAT-012-conversation-copy.md) |
| `FEAT-013` | 从当前消息分叉继续 | `implemented_pending_review` | `v0.1.0` | 官方 `thread/fork` 路由、Turn 边界、按钮和自动切换已提交；若当前运行时不支持，需保留明确不可用提示 | [`FEAT-013-conversation-fork.md`](./features/FEAT-013-conversation-fork.md) |
| `FEAT-014` | 项目对话归档与恢复 | `implemented_pending_review` | `v0.1.0` | 活动/归档列表、恢复、失败提示和 JSONL fallback 隔离已提交；剩余是本机运行时与移动端体验确认 | [`FEAT-014-conversation-archive.md`](./features/FEAT-014-conversation-archive.md) |
| `FEAT-015` | 自然语言生图与自动化工作台 | `in_progress` | `v0.5.0` | 对话生图核心已经完成并进入真实 Thread/Turn：自然语言触发、2.35:1 4K、连续改图、普通后续对话、旧会话迁移和结果去重已有实现；仍在开发的是专门工作台、Artifact、批量模板、队列和定时任务 | [`FEAT-015-image-generation-and-automation-workbench.md`](./features/FEAT-015-image-generation-and-automation-workbench.md) |
| `FEAT-016` | 项目统一更名为 negus | `implemented_pending_review` | `v1.0.0` | 界面、PWA、包名和 GitHub 仓库已统一为 negus，浏览器旧数据保留兼容；本地目录将在当前活动 Turn 收口后由独立 Worker 迁移并恢复同一端口 | [`FEAT-016-project-identity-negus.md`](./features/FEAT-016-project-identity-negus.md) |
| `FEAT-017` | 多业务项目与 Codex 会话归类 | `implemented_pending_review` | `v0.1.0` | 已确认所有者项目、目标工作项目和文件访问路径必须分离；员工 Thread 不得进入工作项目普通会话列表。现有实现仍需按该定义检查和修复 | [`FEAT-017-multiple-business-projects.md`](./features/FEAT-017-multiple-business-projects.md) |
| `FEAT-018` | Codex 原生 Goal 调用与展示对齐 | `handoff_pending` | `v0.3.0` | 56 项回归、富文本浏览器及正式服务真实 HTTP/SSE 验收通过；未验证边界见档案 | [`FEAT-018-system-goal-orchestration.md`](./features/FEAT-018-system-goal-orchestration.md) |
| `FEAT-019` | 项目面板单项目经理 AI 入口 | `implemented_uncommitted` | `v0.1.0` | 项目管理页可打开长期 manager 单聊，并在对话标题显示当前项目上下文；仍待真实员工 Runtime、点击和移动端验收 | [`FEAT-019-project-manager-entry.md`](./features/FEAT-019-project-manager-entry.md) |
| `FEAT-020` | 内测访问入口与共享链接 | `retired` | `v0.1.1` | 删除重复的内测按钮和弹窗，统一使用原有分享入口；保留共享链接及 Cookie 授权，待手机刷新确认 | [`FEAT-020-beta-access-entry.md`](./features/FEAT-020-beta-access-entry.md) |
| `FEAT-021` | 项目记忆入口与可解释上下文边界 | `implemented_uncommitted` | `v0.1.0` | 项目管理页读取最近更新、关键决策和公共群聊完整历史，并公开说明 Agent 上下文边界；不引入隐式长期记忆 | [`FEAT-021-project-memory-entry.md`](./features/FEAT-021-project-memory-entry.md) |
| `FEAT-022` | 模型配置与 CC Switch 共享 | `handoff_pending` | `v0.2.0`（页首） | 后续有 9 月 25/26 日记录；恢复逻辑与撤回原话冲突，不能据此认定需求已重新确认。 | [档案](features/FEAT-022-cc-switch-channels.md) |
| `FEAT-023` | 自定义桌面 | `handoff_pending` | 页首 v0.3.0 / 后续 v0.4.0 | 定制模式与真实任务组件已有记录；任意业务组件生成发布未接通，版本头待整理。 | [档案](features/FEAT-023-desktop.md) |

| `FEAT-024` | 对话转发与公共摘要 | `handoff_pending` | v0.2.0 | 原文转发、原生分支复制、成功自动关闭；归档不变，真实使用待验收。 | [档案](features/FEAT-024-conversation-forwarding.md) |

## 状态与证据

- discovery / planned：调研或计划，不表示已实现。
- in_progress：进行中。
- implemented_uncommitted：记录时已实现但未提交；必须核对后续 Git，不能永久沿用“未提交”。
- implemented_pending_review / code_ready_pending_user_review / handoff_pending：仍有体验、验证或交接未完成，保留原文含义，不自动互换。
- accepted：有用户确认；completed：须说明完成的是研究、文档还是功能。
- paused / paused_experiment / retired：暂停、冻结实验或已替代，不自动重新列为开发任务。

代码完成、构建通过、测试通过、服务加载、真实浏览器/供应商验证、用户验收分别记录。历史测试数量和记录时部署状态不代表今天的运行状态。

## 历史记录与后续工作

旧索引中的逐次补丁、完整需求表和优先级已退出日常索引。原文可在 Git 基线 [c8c7b66 的索引](https://github.com/sukiandfds/negus/blob/c8c7b66d686fb3a896c4c939fe6dec9bb2d8d8d4/docs/feature-development/FEATURE_STATUS_INDEX.md) 追溯，功能原始档案未删除。

- 缓存和任务闪动证据：[9 月 26/27 日记录](../records/SHARED_CACHE_2026-09-26.md)。
- 配置恢复争议：[用户原话](../records/NEGUS_MODEL_CONFIG_DISCUSSION_2026-09-25.md)。
- 普适经验：[常见错误](DEVELOPMENT_COMMON_MISTAKES.md)，按任务选择相关条目。
- 新开发顺序依据当前产品方向逐项确认，不照抄旧索引的 P1–P6 排序。
