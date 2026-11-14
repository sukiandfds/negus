---
document_type: project_management_index
schema_version: 1
project_id: negus
last_updated: "2026-11-12"
---

# 项目管理目录

先按功能找到条目，读取用户原话、后续澄清及有效决定，再修改代码。维护规则见[助手工作规则](../../AI_ASSISTANT_WORK_RULES.md#需求原话与澄清2026-10-30)。实现、发布与用户验收分开记录；旧条目的状态按其登记日期理解，不能直接当作今天的运行结论。

## 按功能找需求

| 功能 | 阅读入口 |
| --- | --- |
| 用户原话、纠正与冲突处理 | [PM-004](items/PM-004/item.md) |
| 单聊缓存、发送、状态、配置、归档、分享 | [FEAT-001 功能导航](items/FEAT-001/item.md#功能导航2026-11-04整理) |
| 整页点击、输入、内容更新和乐观消息延迟（已知问题版本） | [FEAT-001 问题与根因](items/FEAT-001/item.md#2026-11-12-整页响应延迟与乐观消息迟到已知问题版本) |
| 历史图片导致发送变慢，待优化 | [调研与待办](items/FEAT-001/item.md#2026-11-04-含历史图片的长对话发送延迟待优化) |
| 员工与群聊设计 | [FEAT-002](items/FEAT-002/item.md)；近期单聊派工澄清同时见FEAT-001功能导航 |
| 多业务项目、员工会话与工作项目的归属 | [FEAT-017](items/FEAT-017/item.md) |
| 图片、附件与内容渲染 | [FEAT-003](items/FEAT-003/item.md) |
| 消息复制、分支、归档 | [FEAT-012](items/FEAT-012/item.md)、[FEAT-013](items/FEAT-013/item.md)、[FEAT-014](items/FEAT-014/item.md)；近期澄清见FEAT-001 |
| 对话转发与独立摘要 | [FEAT-024](items/FEAT-024/item.md) |
| 项目经理入口与项目记忆 | [FEAT-019](items/FEAT-019/item.md)、[FEAT-021](items/FEAT-021/item.md) |
| 模型配置与共享渠道 | [FEAT-022](items/FEAT-022/item.md) |
| 桌面工作空间 | [FEAT-023](items/FEAT-023/item.md) |
| 固定公网入口、分享链接与访问控制 | [FEAT-006](items/FEAT-006/item.md)、[FEAT-020](items/FEAT-020/item.md) |
| 系统使用日志与内部错误记录 | [RESEARCH-005](items/RESEARCH-005/item.md) |
| Cloudflare 与电脑工具 | [BUG-025](items/BUG-025/item.md) |
| Goal目标模式 | [FEAT-018](items/FEAT-018/item.md) |
| Orca 群聊运行时试验 | [FEAT-010](items/FEAT-010/item.md)；已暂停，不是当前路线 |
| 模块边界与文件精简 | [PM-003](items/PM-003/item.md) |

## 当前计划

以下是仍需开发、验证或产品决策的事项，按建议交接顺序排列；具体开工顺序和产品取舍仍由用户确认，不因列入本表自动获得发布或重启授权。

| 顺序 | 条目 | 当前可执行范围 | 尚需确认或阻塞 |
| --- | --- | --- | --- |
| 1 | `FEAT-001` | 历史读取、分页、缓存和错误分类已有实现；当前存在已记录的整页响应延迟问题版本。 | 先收敛非当前活跃对话的高频正文读取与全页通知；图片压缩副本与画质取舍、聊天记录日期定位交互仍待确认。 |
| 2 | `FEAT-002` | 群聊、员工任务、未点名接待兜底和零员工群已有实现。 | 员工共享上下文策略、页面没有运营管理时的接待顺序、员工详情页重设计。 |
| 3 | `FEAT-015` | 对话自然语言生图、连续改图和“增加边框”工具已有实现。 | 批量模板、生图工作台、Artifact 登记和定时任务的优先范围。 |
| 4 | `FEAT-006` | 固定公网入口与访问控制可用。 | 公网图片上传仍明显慢于本机，需要网络线路或上传方案。 |
| 5 | `FEAT-009` | 前后端受控发布、定时检查、恢复和回退已有实现。 | 没有可用 DeepSeek 渠道时应严格停止还是降级启动，尚未确认。 |
| 6 | `BUG-025` | Cloudflare 官方账号连接和共享工具已有实现，等待真实授权使用。 | 桌面浏览器与可见桌面的点击、输入仍待真实验收。 |

## 当前进行中

- `PM-004`：持续维护用户原话、澄清和需求表；本次整理见其更新记录。

## 交接前验证基线

2026-11-11 对 `develop / c92c3d8` 加当前工作区改动执行了完整检查：

- `windows/tests`：560 项，547 通过、12 失败、1 跳过。失败集中在历史读取回退、模型配置元数据、跨渠道会话、心拍提示词、图片尺寸参数及测试环境缺件。
- `ui-feishu/validation`：141 项，131 通过、9 失败、1 跳过。9 项来自未启动的固定测试服务或缺少隔离环境变量，不能据此判定产品回归；也尚未取得完整 UI 通过结果。
- TypeScript `--noEmit`、项目管理定向测试 5/5、37 个条目来源检查和文档链接检查均通过。
- 详细失败清单见 `work/requirements-audit-20261111/verification.md`。接手开发前应先确认这些失败是正式行为变化、旧测试预期还是测试环境问题，不应把当前测试集描述为全绿。

## 条目目录

以下覆盖全部37个现有条目；其中3个旧日期编号（BUG-20260926-01、BUG-20260927-01、RESEARCH-20260925-01）仅通过文档链接查阅，现有面板读取其余34项；名称链接用于阅读，文件夹列保留面板读取格式。状态、优先级和更新时间仍以各item.md为单一来源，不在索引重复维护。旧记录保留，未因本次整理改判功能已完成。

| 条目编号 | 名称 | 类型 | 分类 | 文件夹 | 排序 |
| --- | --- | --- | --- | --- | --- |
| `PM-001` | [独立项目管理系统](items/PM-001/item.md) | `feature` | `development` | `items/PM-001/` | 1 |
| `PM-004` | [用户原话与澄清的持续维护](items/PM-004/item.md) | `maintenance` | `maintenance` | `items/PM-004/` | 2 |
| `PM-002` | [现有实现功能介绍同步](items/PM-002/item.md) | `maintenance` | `maintenance` | `items/PM-002/` | 3 |
| `RESEARCH-001` | [项目文件功能与模块交叉关系调研结果](items/RESEARCH-001/item.md) | `research` | `research` | `items/RESEARCH-001/` | 4 |
| `RESEARCH-002` | [核心运行链路、实时状态与项目数据源调研](items/RESEARCH-002/item.md) | `research` | `research` | `items/RESEARCH-002/` | 5 |
| `RESEARCH-003` | [文档分支内容迁移与归档核对](items/RESEARCH-003/item.md) | `research` | `research` | `items/RESEARCH-003/` | 6 |
| `RESEARCH-005` | [Negus 全系统日志与用户原文提取调研](items/RESEARCH-005/item.md) | `research` | `research` | `items/RESEARCH-005/` | 7 |
| `FEAT-001` | [单人 Codex Web 对话与控制](items/FEAT-001/item.md) | `feature` | `development` | `items/FEAT-001/` | 8 |
| `FEAT-002` | [项目群聊与多 Agent 协作](items/FEAT-002/item.md) | `feature` | `development` | `items/FEAT-002/` | 9 |
| `FEAT-003` | [附件与对话内容渲染](items/FEAT-003/item.md) | `feature` | `development` | `items/FEAT-003/` | 10 |
| `FEAT-004` | [PWA、设备身份与移动/平板入口](items/FEAT-004/item.md) | `feature` | `delivery` | `items/FEAT-004/` | 11 |
| `FEAT-005` | [Desktop/Web 连续性与同任务提示](items/FEAT-005/item.md) | `research` | `research` | `items/FEAT-005/` | 12 |
| `FEAT-006` | [固定公网入口与正式访问控制](items/FEAT-006/item.md) | `maintenance` | `maintenance` | `items/FEAT-006/` | 13 |
| `FEAT-007` | [Agent 交付物生成、预览与版本管理](items/FEAT-007/item.md) | `delivery` | `delivery` | `items/FEAT-007/` | 14 |
| `FEAT-008` | [HTML 网页生成与 PDF 双文件交付](items/FEAT-008/item.md) | `delivery` | `delivery` | `items/FEAT-008/` | 15 |
| `FEAT-009` | [原开发电脑远程运行、开发与应急恢复](items/FEAT-009/item.md) | `feature` | `development` | `items/FEAT-009/` | 16 |
| `FEAT-011` | [浮生云算用量监控](items/FEAT-011/item.md) | `feature` | `development` | `items/FEAT-011/` | 17 |
| `FEAT-015` | [自然语言生图与自动化工作台](items/FEAT-015/item.md) | `feature` | `development` | `items/FEAT-015/` | 18 |
| `FEAT-016` | [项目统一更名为 negus](items/FEAT-016/item.md) | `feature` | `maintenance` | `items/FEAT-016/` | 19 |
| `PM-003` | [文档方向核对与核心入口精简](items/PM-003/item.md) | `maintenance` | `maintenance` | `items/PM-003/` | 20 |
| `BUG-025` | [演示前联网与电脑操控验证](items/BUG-025/item.md) | `bug` | `maintenance` | `items/BUG-025/` | 21 |
| `BUG-20260926-01` | [共享缓存与项目入口同步验收](items/BUG-20260926-01/item.md) | `bug` | `maintenance` | `items/BUG-20260926-01/` | 22 |
| `BUG-20260927-01` | [历史状态延迟与任务初始化闪动](items/BUG-20260927-01/item.md) | `bug` | `maintenance` | `items/BUG-20260927-01/` | 23 |
| `FEAT-012` | [消息内容快捷复制](items/FEAT-012/item.md) | `feature` | `development` | `items/FEAT-012/` | 24 |
| `FEAT-013` | [从当前消息分叉继续](items/FEAT-013/item.md) | `feature` | `development` | `items/FEAT-013/` | 25 |
| `FEAT-014` | [项目对话归档与恢复](items/FEAT-014/item.md) | `feature` | `development` | `items/FEAT-014/` | 26 |
| `FEAT-018` | [Codex 原生 Goal 目标模式入口](items/FEAT-018/item.md) | `feature` | `platform` | `items/FEAT-018/` | 27 |
| `RESEARCH-004` | [Codex Desktop 与 negus 同会话协作调研](items/RESEARCH-004/item.md) | `research` | `research` | `items/RESEARCH-004/` | 28 |
| `RESEARCH-20260925-01` | [Grok Bot 产品与 Agent 管理及 Negus 最小改造调研](items/RESEARCH-20260925-01/item.md) | `research` | `research` | `items/RESEARCH-20260925-01/` | 29 |
| `FEAT-017` | [多业务项目与 Codex 会话归类](items/FEAT-017/item.md) | `feature` | `development` | `items/FEAT-017/` | 30 |
| `FEAT-019` | [项目面板单项目经理 AI 入口](items/FEAT-019/item.md) | `feature` | `development` | `items/FEAT-019/` | 31 |
| `FEAT-020` | [内测访问入口与共享链接](items/FEAT-020/item.md) | `feature` | `delivery` | `items/FEAT-020/` | 32 |
| `FEAT-021` | [项目记忆入口与可解释上下文边界](items/FEAT-021/item.md) | `feature` | `development` | `items/FEAT-021/` | 33 |
| `FEAT-022` | [CC Switch 共享渠道管理](items/FEAT-022/item.md) | `feature` | `development` | `items/FEAT-022/` | 34 |
| `FEAT-023` | [自定义桌面](items/FEAT-023/item.md) | `feature` | `development` | `items/FEAT-023/` | 35 |
| `FEAT-024` | [对话转发与公共摘要](items/FEAT-024/item.md) | `feature` | `development` | `items/FEAT-024/` | 36 |
| `FEAT-010` | [Orca 群聊执行运行时适配技术试验](items/FEAT-010/item.md) | `research` | `research` | `items/FEAT-010/` | 37 |

## 历史排期（原目录，保留追溯）

以下沿用2026-09-29目录，已移出当前计划和进行中；不作为重新开发、发布或验收的授权。已完成调研仍可在条目目录查阅，完成状态见其原记录。

原计划：PM-001, RESEARCH-001, RESEARCH-002, RESEARCH-003, FEAT-001, FEAT-011, FEAT-005, FEAT-002, FEAT-015, FEAT-016, FEAT-009, FEAT-003, FEAT-007, FEAT-008。

原进行中：FEAT-006, FEAT-009, FEAT-015。

需要复盘时，读取相应条目的updates.md；仅存在专属复盘时再读process.md。用户原话与纠正不因整理删除，后续明确澄清优先于早期方案。
