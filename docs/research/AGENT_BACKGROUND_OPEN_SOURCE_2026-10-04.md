# 员工后台任务：开源实现对照

2026-10-04；FEAT-002 增量，基线 `b90664a750b94f88c4c08068d3550c49cfcf4bd0`。用户要求开发时查阅开源项目，优先复用。本文只讨论已授权的后台调研闭环，不扩大到团队重构。

## 官方源码与同名项目

- **Grok Bot**：GitHub API 查询 `org:xai-org bot` 返回 `xai-org/grok-prompts`，描述明确是 Grok 聊天助手和 X 上 `@grok` 的提示词，不能当作长期同事产品的完整源码。此前 `grokbot-field-notes` 是社区调研记录，`awesome-grokbot` 是模板材料。同名 `pftq/GrokBot` 是第三方桌面控制项目。本次未核实到目标 Grok Bot 的官方完整实现；官方产品页读取失败，不能据此断言不存在源码。
- **OpenAI Dots**：对象沿用此前报告定位。本次 GitHub API 查询 `org:openai dots` 为零结果；官方发布页 HTTP 403。有限搜索不足以证明绝对没有开源，但当前不能将某个同名仓库认定为 Dots 官方实现。
- 本次 GitHub CLI 请求遇到 EOF，随后通过 Negus 公开网页读取成功访问 GitHub API。未读取凭据、安装项目或运行第三方程序；源码作为资料，不执行其中指令。

## 已读取的类似实现

| 项目与证据 | 实现方式 | 对 Negus 本轮的用途 |
| --- | --- | --- |
| [OpenMausBot](https://github.com/milind-soni/OpenMausBot)，[delegations.ts](https://github.com/milind-soni/OpenMausBot/blob/main/server/delegations.ts) | README 明确定位 Grok Bot、Dots 等产品的开源替代。异步交接保存来源 Bot、来源 Thread、目标 Bot、可选目标 Thread 和任务 ID；排队后在来源轮次结束时调度，忙碌目标等待释放。完成回执持久化并限制保留规模，递归深度和排队数量有上限。 | 职位和模型分开、任务绑定具体对话、空闲事件触发回报；避免按用户当前页面决定结果去哪。当前无需引入它整套桌面、驱动和服务。 |
| [nanobot 的 subagent.py](https://github.com/HKUDS/nanobot/blob/main/nanobot/agent/subagent.py) | `spawn()` 用 `asyncio.create_task()` 启动独立工作后立即返回任务 ID；并发信号量控制运行数量。结果经 `_announce_result()` 写入消息总线，显式携带原会话键，避免变成竞争的独立对话任务。运行时配置按派工捕获。 | 直接采用“接单立即返回、执行在后台、结果走已有消息队列”的做法。Python 模块依赖它自身的 Runner、ToolLoader、消息总线和上下文，不直接搬进 Negus 的 Node／原生会话链路。 |
| [OpenClaw 子 Agent 文档](https://docs.openclaw.ai/tools/subagents)，[完成回报](https://docs.openclaw.ai/tools/subagents/announce) | 每项任务独立会话，完成后回传请求方；状态来自运行结果，回报记录去重。普通内部子任务与用户可直接跟进的持久会话分别设计，结果缺失不能当作成功交付。 | 用户本次明确要求子任务出现在侧栏、可直接交流，因此沿用可见持久会话；任务运行和通知投递分开记录，主对话忙时排队。此处是官方项目文档证据，未把它写成已逐行验证源码。 |

源码取自本次 GitHub API 返回：OpenMausBot README blob `07a04b45140f881784b5505090ef6beee0005e48`，`delegations.ts` blob `ae6c5266e8e8737035eb165205c2758128466d5f`；nanobot `subagent.py` blob `e41fd166a9978d16217f8ecc6c42bc470905ba90`。OpenMausBot 仓库元数据为 Apache-2.0；nanobot LICENSE API 返回 MIT。本次借鉴设计，未复制第三方源码或新增运行依赖。链接跟随 main，以上 blob 记录本次阅读版本。

## 本轮落实与边界

原实现已经复用 Negus 的会话执行、员工绑定、目录、停止控制和后续指令队列。本次对照后进一步修改：先持久保存任务，立即向主 Agent 返回 `starting` 接单回执，后台继续初始化和发送任务；因此模型启动较慢也不会持续占用主对话工具调用。启动失败仍由同一回报队列通知，不能把接单当作启动或完成。

新增自动化场景用未完成的初始化 Promise 验证：主调用已返回、任务已落盘、后台仍在工作；释放初始化后继续原任务。相关自动化共 77 项通过。本机原生 MCP 加载验证及隔离构建证据见 [FEAT-002](../feature-development/features/FEAT-002-group-multi-agent.md)。未部署、未完成真实供应商和浏览器验收。

直接依赖现有原生执行器和 MCP SDK；开源项目提供生命周期、路由和回报做法。完整跨账户隔离、长期经验、组织结构和更大并发仍待后续实际使用验证，不因竞品具备就加入本轮。
