# GitHub类似项目：固定版本与源码核对

日期：2026-10-07。先完成官方功能核对，再检索Github。查询包括 `"Grok Bot"`、`"OpenMausBot"`、`multi agent group chat`、`AI coworkers chat`、TypeScript群聊、`org:xai-org bot`、`org:openai dots`。查询与元数据见 [searches.json](sources/github/searches.json) 和 [manifest.json](sources/github/manifest.json)。只读公开源码，未安装、未运行这些项目；不把README营销描述等同于跑通体验。

## 结论与选择

最接近目标产品形态的是 **OpenMausBot**。最适合Negus现在借鉴的是它“显式点名优先、普通消息有默认接待者/可替换自动router、异步交接有来源与回执”的实现边界。它比当前需要的功能范围更大，整套引入会添加桌面壳、连接器服务、VM和多引擎依赖，不符合用户减少复杂度的目标。

**LibreChat**适合借鉴子任务可见对话、状态、权限和全链路观测；**OpenClaw**适合参考任务归属、持久恢复、完成与回报分开。**nanobot**是较轻的Python后台子任务参考，不应直接搬进Node原生执行链。**LobeHub**实际有群协作源码，但商业衍生许可证限制需要认真区分，建议先借鉴设计。**AutoGen/LangGraph**是调度框架，不能当成现成聊天软件。**grok-bot-cli**依赖官方服务，不是可自托管复刻。

| 项目 | 固定commit（缩写；完整值在manifest） | 最近推送UTC/参考stars | 许可证核对 | 形态与适配 |
|---|---|---|---|---|
| [OpenMausBot](https://github.com/milind-soni/OpenMausBot) | 89bfd5506b20 | 10-06 17:42 / 4092 | Apache-2.0；保留声明、NOTICE和改动说明（若适用） | 员工通讯录、群、电脑、工具、外派；最接近 |
| [LibreChat](https://github.com/LibreChat-AI/LibreChat) | e1dfc10449ff | 10-06 16:00 / 45332 | MIT | 成熟聊天、Agents、子任务线程、权限；不是相同员工群产品 |
| [OpenClaw](https://github.com/openclaw/openclaw) | df73bb11139a | 10-06 17:53 / 391513 | MIT | 多渠道个人助手、子Agent与Task inspector；可参考回报 |
| [nanobot](https://github.com/HKUDS/nanobot) | d6ddceed997b | 10-06 17:32 / 48826 | MIT | Python助手与后台子任务；轻但运行栈不同 |
| [LobeHub](https://github.com/lobehub/lobehub) | 95d94decb4d1 | 10-06 17:57 / 83015 | LobeHub Community License；Apache基础加商业衍生发行需商用许可 | 有真实Agent Groups supervisor和异步任务；不是纯Apache开源 |
| [AutoGen](https://github.com/microsoft/autogen) | 027ecf0a379b | 04-15 11:59 / 61273 | 代码MIT，文档CC-BY-4.0；不能只看API的根license分类 | Selector/RoundRobin/Swarm群调度；维护模式 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 70dd64065bff | 10-06 17:55 / 42782 | MIT | 低层有状态流程/checkpoint/interrupt；需自行建产品 |
| [grok-bot-cli](https://github.com/ScriptedAlchemy/grok-bot-cli) | 43499fa27f36 | 10-05 23:46 / 81 | MIT；latest release v0.12.4 | 官方服务CLI/MCP客户端；不是后端源码 |

stars为抓取时快照，仅用于判断维护规模，不代表功能正确。八仓库均未标archived；AutoGen虽未archived，README明确Maintenance Mode。旧URL `lobehub/lobe-chat` 重定向到 `lobehub/lobehub`，`danny-avila/LibreChat` 重定向到 `LibreChat-AI/LibreChat`，不能误认停止维护。

## 1. OpenMausBot：最接近，但不能无脑整体导入

固定证据：

- [group-routing.ts](https://github.com/milind-soni/OpenMausBot/blob/89bfd5506b202aea08beab55727cea30d79efa84/src/lib/group-routing.ts)：`member`、`everyone`、`mentions`、`auto`四种默认应答策略；显式@或@everyone优先；成员失效时回退可用成员。
- [room-routing.ts](https://github.com/milind-soni/OpenMausBot/blob/89bfd5506b202aea08beab55727cea30d79efa84/server/decider/room-routing.ts)：auto只选Bot而不做任务；输入群/成员职责/最近历史/新消息；候选Bot ID校验；低置信或失败fallback。源码1.5秒预算、0.6阈值和Jev是该项目自己的选择，不是Grok Bot官方机制，也不建议直接硬搬Negus。
- [decision-model.md](https://github.com/milind-soni/OpenMausBot/blob/89bfd5506b202aea08beab55727cea30d79efa84/docs/decision-model.md)：send先返回，router在turn开始前执行；记录latency/inputTokens/stateHash不记录消息/密钥。其前端会显示“Picked by Jev”；Negus用户要求debug在后端，应省掉这个前端技术标识。
- [delegations.ts](https://github.com/milind-soni/OpenMausBot/blob/89bfd5506b202aea08beab55727cea30d79efa84/server/delegations.ts)：sourceThreadId/sourceBotId/targetThreadId稳定归属，pending queue原子写delegations.json并启动加载；receipt按id去重持久化；目标忙时等待、释放后重评权限。队列保存不是授权，dispatch再校验。
- [room-handoffs.ts](https://github.com/milind-soni/OpenMausBot/blob/89bfd5506b202aea08beab55727cea30d79efa84/server/room-handoffs.ts)：树节点含root/parent/group/thread/Bot及状态；父等待子不占provider queue；report回指定parent。**constructor将所有非终态标failed，提示server restart且不replay**。因此“有持久化”不能被写成“所有群交接重启可自动续跑”。
- [room-turn-timeout.ts](https://github.com/milind-soni/OpenMausBot/blob/89bfd5506b202aea08beab55727cea30d79efa84/server/room-turn-timeout.ts)：等待用户approval/question会暂停有效运行计时，stall watchdog单独；比Negus现有一刀切30分钟timer更明确，但其中时间与深度上限不是我们的产品需求。
- [GroupView.tsx](https://github.com/milind-soni/OpenMausBot/blob/89bfd5506b202aea08beab55727cea30d79efa84/src/components/GroupView.tsx)：实际group UI、状态、语音等是项目实现；不是证明官方也有群语音。官方明确实时语音1对1。

依赖：Electron/React/TypeScript本地harness，Claude/Codex/Grok CLI与原有登录，电脑/VM provider，Composio工具及可选Jev/语音vendor。OpenMausBot的每Bot电脑与Grok Bot普通用户共享电脑不同。README比较表写官方“Grok only”也不能覆盖官方Cursor模型selection描述。

适合移植：纯路由选择合同、稳定来源字段、receipt/outbox、共享行组件概念。应避免照搬：完整全局store、巨型GroupView、provider lifecycle、开源方默认超时、组语音、自动取首成员当产品负责人、引擎需要的第三方凭据。借鉴模块逐条对Negus运行器适配，复制源码前逐文件确认许可与声明。

## 2. LibreChat：任务对话与观测参考

源码固定到 `e1dfc10449ff713faffacd60273fddcfe2c0a698`：

- [Agent client](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/api/server/controllers/agents/client.js) 有subagent配置/聚合、持久来源、checkpoint namespace、stream用量seq、工具和续接相关实现。它很大，不能当成可直接抽离的小组件。
- [task.ts](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/client/src/components/Chat/Subagents/task.ts) 把子任务的taskId/threadId与parentConversationId组合定位；有权限线程可在索引未覆盖旧项时直接查询；shared page没有认证线程面板不生成无效selection。
- [SubagentThreadPanel.tsx](https://github.com/LibreChat-AI/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/client/src/components/Chat/Subagents/SubagentThreadPanel.tsx) 为真实子任务提供可打开面板；可借鉴“外派仍是能继续交流的对话”的思路。

README包括Agents分享、Skills、MCP、Artifacts、多端同步、OTel、Trace Viewer、attached workspaces（标highly experimental）等。部署涉及自己的认证/数据库/Redis/文件与provider体系。当前证据不证明它复制了Grok Bot自主群员工的完整逻辑；建议取授权定位、状态事实与共享UI设计，不整体迁移Negus。

## 3. OpenClaw：完成执行与回报投递分别记账

固定 `df73bb11139acae998676f2876337dbcb8385985`：

- [completion docs](https://github.com/openclaw/openclaw/blob/df73bb11139acae998676f2876337dbcb8385985/docs/tools/subagents/announce.md)：按requester/run与thread route回传；重复delivery用记录的delivery事实去重；运行成功但没有结果仍需恢复，不能用NO_REPLY逃避交付；失败不把tool output冒充final；部分文本投递失败不能盲重试已发部分。
- [registry persistence](https://github.com/openclaw/openclaw/blob/df73bb11139acae998676f2876337dbcb8385985/src/agents/subagents/registry/subagent-registry-persistence.ts)：run版本、authoritative rows、写入提交和发布状态分开；需要确认版本冲突/rollback。
- [origin](https://github.com/openclaw/openclaw/blob/df73bb11139acae998676f2876337dbcb8385985/src/agents/subagents/announce/subagent-announce-origin.ts)：来源会话/渠道/线程路由有专用处理，不能按当前UI页面决定收件人。

适合回报与来源可靠性；它多渠道gateway、session、plugin控制生态比Negus当前大。需要同它已有provider与identity体系接入才是可运行依赖，不是几段代码独立运行。控件Task inspector不等于员工通讯群完整产品。

## 4. nanobot：较轻的后台子任务，有明确中断恢复边界

固定 `d6ddceed997b53c4adcd56e8b302bd124bfa0c71`：

- [subagent.py](https://github.com/HKUDS/nanobot/blob/d6ddceed997b53c4adcd56e8b302bd124bfa0c71/nanobot/agent/subagent.py)：spawn建立task/session后用asyncio.create_task后台跑；runtime/owner/origin在派工时固定；semaphore限并发；cancel/append/read/status与result announce存在。
- [subagent_sessions.py](https://github.com/HKUDS/nanobot/blob/d6ddceed997b53c4adcd56e8b302bd124bfa0c71/nanobot/agent/subagent_sessions.py)：共用SessionManager，私人child由parent所有；late completion不可重建已删除child；`interrupt_pending()`启动后将遗留queued/running/stopping标interrupted/host_restarted。**不是自动恢复执行**。
- [SubagentTasks.tsx](https://github.com/HKUDS/nanobot/blob/d6ddceed997b53c4adcd56e8b302bd124bfa0c71/webui/src/components/thread/SubagentTasks.tsx)：实际Web UI子任务展示，适合参考任务行与子会话。

Python运行器、工具加载器、SessionManager、消息总线构成依赖。新开Python服务会增加Negus架构复杂度；优先把设计用于已有Node任务服务，而不是直接新增服务。

## 5. LobeHub：真实群supervisor，许可证不同

旧lobe-chat仓库已重命名，不要沿用旧认知只说普通聊天。固定 `95d94decb4d16c6ac883bbaee0f7297d86128f4c`：

- [GroupOrchestrationSupervisor](https://github.com/lobehub/lobehub/blob/95d94decb4d16c6ac883bbaee0f7297d86128f4c/packages/agent-runtime/src/groupOrchestration/GroupOrchestrationSupervisor.ts) 显式处理speak、broadcast并行、delegate、execute_task、execute_tasks、finish。broadcast默认disableTools；maxRounds为项目自定上限，不能替代Negus产品定义。
- [Runtime](https://github.com/lobehub/lobehub/blob/95d94decb4d16c6ac883bbaee0f7297d86128f4c/packages/agent-runtime/src/groupOrchestration/GroupOrchestrationRuntime.ts) supervisor→instruction→executor→result循环，step运行状态和abort独立。
- [agentGroup service](https://github.com/lobehub/lobehub/blob/95d94decb4d16c6ac883bbaee0f7297d86128f4c/apps/server/src/services/agentGroup/index.ts) 资料与组员数据库操作、组删除事务、配置defaults→server→user→agent合并；可借鉴配置有效值只有一套解析路径。
- [LICENSE](https://github.com/lobehub/lobehub/blob/95d94decb4d16c6ac883bbaee0f7297d86128f4c/LICENSE) 明写商用开发分发derivative work要commercial license。GitHub license=NOASSERTION，README徽章写Apache不能覆盖附加条件。

Next/React与数据库、agent-runtime/tool packages构成产品平台，不是可直接移入Negus的单个路由器。可当设计和体验竞品参考；商业复制先解决许可，再决定是否引入，而非宣称可自由改造发行。

## 6. AutoGen与LangGraph：运行方法，不是完整产品

[AutoGen SelectorGroupChat](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_selector_group_chat.py) 能模型选speaker、custom selector/candidate、repeat speaker配置、state save/load；RoundRobin和Swarm各有调度形式。用户账户、员工目录、多端消息、routine工具和云电脑仍需自己做。README明确维护模式并建议 [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)，本次补查该后继仓库metadata/README，MIT，固定41e785fb9a3c853272ce0fbd2eb93364e9d1de13；**未源码级验证后继的所有群功能**。Negus Node代码不宜为了一个选人策略新增Python/.NET栈。

[LangGraph checkpoint base](https://github.com/langchain-ai/langgraph/blob/70dd64065bffaa3b6ab61a33f1f020fb54db8efa/libs/checkpoint/langgraph/checkpoint/base/__init__.py) 定义checkpoint tuple/get/list/put/put_writes/delete_thread同步异步接口；[types](https://github.com/langchain-ai/langgraph/blob/70dd64065bffaa3b6ab61a33f1f020fb54db8efa/libs/langgraph/langgraph/types.py) 有interrupt/command等状态协议。提供可恢复状态编排，具体数据库saver和副作用idempotency还需配置。README提LangGraph.js适用于Node，但本次固定源码读的是Python，不把JS兼容和运行效果说成已验收。已有原生执行器能满足时用小型ledger/outbox更省代码。

## 7. grok-bot-cli：有用的接口参考，不能代替开放后端

[gateway.js](https://github.com/ScriptedAlchemy/grok-bot-cli/blob/43499fa27f36807f6ac93b56365b3cae5200bc1e/src/core/gateway.js) 有createGroup、set/add/removeGroupMember、sendPrompt及clientNonce；sendPrompt没有要求先@。该代码把消息交给官方gateway，不能看出服务端如何决定speaker。客户端允许1–6成员，官方首次创建UI写2–6，接口约束与UI约束不能混。

依赖官方已登录会话和服务。若用户已有测试账号它能辅助取行为证据；本次未使用登录会话、未发消息、未提取凭据。Negus自托管场景无需导入此官方服务依赖。最值得借鉴的是rejected与delivery_unknown分开，未知投递不盲重发。

## 补充发现与排除项

- [OpenSquad](https://github.com/opensquad-ai/opensquad)：描述PM/Coder/QA通过群合作，MIT，本次固定dd9739910560d40b9c43f1670e0f4a8b749e09c9。小规模仓库，README级发现，不替代以上深查，未验收稳定性。
- [Piko](https://github.com/cpp285/Piko)：员工、group chat、身份、skills、macOS+local web，MIT，固定66ec8902112976f554edac3fc86456dca83e8fe2。README级发现，有产品相似方向；不以0stars直接否定，也不凭描述宣称功能跑通。
- [Marlo](https://github.com/Qumge/marlo)：OpenWorker发行，MIT，固定5b18ba51ee6bf55ee1ebdaa570e39c3c97b0bd0d。偏单个桌面coworker交付，群员工匹配程度较低。
- `unicodef1wn/grokbot-field-notes` 是同作者社区记录，不是实现源码；“每Bot回答每条消息”已被官方“participating Bots decide who”校正，不当独立多源证据。
- `xai-org/grok-prompts` 是提示词，不是长期员工群聊产品后端；官方组织这次搜索有限结果**不能证明全世界无官方源码**。本次没有找到可验证的Grok Bot官方完整实现。
- 命名相似的X @grok机器人、交易bot、Telegram转发bot不符合本次对象，不按名字凑清单。

## 迁移与复用建议

| Negus问题 | 首选参考 | 改动边界 | 不需要引入 |
|---|---|---|---|
| 普通消息无人回 | OpenMausBot defaultResponder/auto fallback | 现有route函数增加可替换选择；响应状态准确 | Electron、Jev专属vendor、每条全员执行 |
| 外派只靠终稿@ | OpenMausBot handoff+Negus已有agent-tasks | 通用来源/任务/回执；单聊群共用执行 | 两套全量任务引擎 |
| 重启丢内存queue | OpenClaw版本/receipt及数据库outbox | 持久accepted→queued→running与状态协调 | 完整gateway/channel生态 |
| 用户看不出子任务在哪里 | LibreChat thread定位、nanobot Task UI | 共享ConversationRow/TaskRow跳真实对话 | 新的不可交互任务聊天形式 |
| 默认模型/思考显示实际不一致 | LobeHub配置解析思想 | 共用effective config resolver及run snapshot | 另一全局store或默认值体系 |
| 缺全流程debug | route日志/OTel设计 | 用户动作至UI呈现关联并脱敏 | 前端“Picked by技术名”与调试墙 |

不建议为了“复刻”重写Negus。把稳定对象和统一事件补入现有消息/员工/后台任务服务，比导入任一完整平台更贴合现有规范。后續若决定另建从零独立产品，OpenMausBot可作最接近基线，但需重新评估桌面优先、真实多用户、服务端部署、云电脑隔离和第三方依赖成本。
