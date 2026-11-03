---
document_type: project_management_index
schema_version: 1
project_id: negus
last_updated: "2026-11-04"
---

# 项目管理目录

先按功能找到条目，读取用户原话、后续澄清及有效决定，再修改代码。维护规则见[助手工作规则](../../AI_ASSISTANT_WORK_RULES.md#需求原话与澄清2026-10-30)。实现、发布与用户验收分开记录；旧条目的状态按其登记日期理解，不能直接当作今天的运行结论。

## 按功能找需求

| 功能 | 阅读入口 |
| --- | --- |
| 用户原话、纠正与冲突处理 | [PM-004](items/PM-004/item.md) |
| 单聊缓存、发送、状态、配置、归档、分享 | [FEAT-001 功能导航](items/FEAT-001/item.md#功能导航2026-11-04整理) |
| 历史图片导致发送变慢，待优化 | [调研与待办](items/FEAT-001/item.md#2026-11-04-含历史图片的长对话发送延迟待优化) |
| 员工与群聊设计 | [FEAT-002](items/FEAT-002/item.md)；近期单聊派工澄清同时见FEAT-001功能导航 |
| 图片、附件与内容渲染 | [FEAT-003](items/FEAT-003/item.md) |
| 消息复制、分支、归档 | [FEAT-012](items/FEAT-012/item.md)、[FEAT-013](items/FEAT-013/item.md)、[FEAT-014](items/FEAT-014/item.md)；近期澄清见FEAT-001 |
| Goal目标模式 | [FEAT-018](items/FEAT-018/item.md) |
| 模块边界与文件精简 | [PM-003](items/PM-003/item.md) |

## 当前计划

- `FEAT-001`：含历史图片的长对话上传优化，用户明确“之后抽空优化”；先留待办，具体方案待确认，当前不实施。

## 当前进行中

- `PM-004`：持续维护需求原话与澄清；文档整理完成情况见其更新记录。

## 条目目录

以下覆盖全部29个现有条目；其中3个旧日期编号（BUG-20260926-01、BUG-20260927-01、RESEARCH-20260925-01）仅通过文档链接查阅，现有面板读取其余26项；名称链接用于阅读，文件夹列保留面板读取格式。状态、优先级和更新时间仍以各item.md为单一来源，不在索引重复维护。旧记录保留，未因本次整理改判功能已完成。

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

## 历史排期（原目录，保留追溯）

以下沿用2026-09-29目录，已移出当前计划和进行中；不作为重新开发、发布或验收的授权。已完成调研仍可在条目目录查阅，完成状态见其原记录。

原计划：PM-001, RESEARCH-001, RESEARCH-002, RESEARCH-003, FEAT-001, FEAT-011, FEAT-005, FEAT-002, FEAT-015, FEAT-016, FEAT-009, FEAT-003, FEAT-007, FEAT-008。

原进行中：FEAT-006, FEAT-009, FEAT-015。

需要复盘时，读取相应条目的updates.md；仅存在专属复盘时再读process.md。用户原话与纠正不因整理删除，后续明确澄清优先于早期方案。
