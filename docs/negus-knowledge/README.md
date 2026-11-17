# Negus 产品知识库

这里集中保存 Negus 的产品方向、功能预期、调研结论、规划和历史决策。以后查找“Negus 想做什么、为什么这样做、功能应该怎样使用”时，先从本目录开始。

## 先看这几份

1. [产品定义](product/PRODUCT_DEFINITION.md)：当前确认的产品定位、用户流程、功能边界和待定问题。
2. [功能状态索引](features/FEATURE_STATUS_INDEX.md)：各功能档案的入口、当前状态和证据边界。
3. [下一阶段调研汇总](research/NEGUS_NEXT_PRODUCT_RESEARCH_2026-10-03.md)：近期方向、已有证据和开放问题。
4. [文档导航](../README.md)：项目文档的总入口、证据优先级和使用规则。

## 按内容查找

| 目录 | 内容 | 什么时候看 |
| --- | --- | --- |
| [product](product/) | 产品定义和有效行为 | 判断当前应该做什么 |
| [features](features/) | 功能预期、功能状态、UX 和开发经验 | 设计或修改具体功能 |
| [research](research/) | 竞品、技术、运行链路和用户体验调研 | 需要事实、对比或方案依据 |
| [planning](planning/) | 阶段计划和场景推演 | 讨论后续路线 |
| [decisions](decisions/) | 用户原话、方向决策和愿景形成过程 | 追溯为什么这样决定 |
| [records](records/) | 开发日志、事故、验证和问题复盘 | 核对历史证据和已发生问题 |
| [strategy](strategy/) | 早期战略、竞品全景、多 Agent 路线和外部评估 | 查历史背景，不能直接当当前需求 |
| [audits](audits/) | 系统和架构审计、清理建议 | 核对结构问题和历史技术证据 |
| [reference](reference/) | 提示词、宣传文案和历史辅助资料 | 查辅助素材 |

## 资料使用边界

- `product/PRODUCT_DEFINITION.md` 是当前产品行为的唯一完整来源；功能档案只补充该功能的实现、验证和变化。
- `research/`、`planning/`、`decisions/`、`records/` 和 `strategy/` 保存证据与历史过程。里面的旧结论不会自动变成当前需求，使用前要核对日期和产品定义。
- 运行、架构、项目管理和服务维护文档仍在 `docs/architecture/`、`docs/project-management/`、`docs/negus-knowledge/audits/` 和 `docs/operations/`，它们描述如何实现和维护系统，不与产品知识混放。
- 根目录的 `PROJECT.md`、`AI_ASSISTANT_WORK_RULES.md`、`USER_PROFILE.md` 是开发入口和操作规则，保留在根目录供工具直接读取。
