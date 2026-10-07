# Grok Bot 群聊与完整协作产品调研

日期：2026-10-07；本地项目：Negus。**已完成公开官方资料与类似开源实现的调研，形成复刻设计。尚未登录Grok Bot做真实群实验，也没有修改Negus生产功能。**

## 最关键的结论

1. **应用内群聊普通消息能触发Bot判断谁应该回复，不要求先@。** 官方原文是 “Write normally to let the participating Bots decide who should respond.” 点名可指定负责人，多点名适用于共同职责，@everyone用于全群更新。不能推导全员每条必答，也不能把Slack频道需要先@的规则套到应用群。来源：[官方](https://docs.x.ai/grok-bot/chat-and-collaboration#direct-a-message)。
2. Negus现有群消息API在目标列表为空时返回 `execution:null, listening:true`，确实不会启动员工。这解释了用户普通“有人吗”无人回复的体验；不是借此证明供应商失败。点名之后供应商可用性仍是另一步检查。源码：[group-routes.mjs:91](/Users/hans/myproject/negus/windows/server/routes/group-routes.mjs:91)。
3. 复刻完整目标需要长期员工身份、动态群、可见异步交接、任务事实、输入/审批/成果卡、历史与线程、计划任务、工具与执行电脑、多端状态。只加群界面或给普通消息默认@某人，不等于完整复刻。
4. 项目区分有官方依据：帮助中心提供侧栏section按项目/客户/业务组织Bot，跨桌面和iOS同步；section删除不删除Bot。**section不等于执行项目权限或cwd**。Negus可保留自己的projectId和工作目录，同时用同一会话数据分类展示。
5. 最贴近的公开实现是OpenMausBot；LibreChat/OpenClaw/nanobot适合参考子任务可见性和生命周期。LobeHub确有群协作代码但商用衍生许可证不同；grok-bot-cli只是官方服务客户端。

## 本次资料范围与交付

| 文件 | 内容 |
|---|---|
| [FEATURE_MATRIX.md](FEATURE_MATRIX.md) / [CSV](FEATURE_MATRIX.csv) | 169条记录：官方行为、证据、复刻提案、Negus差距、验收条件 |
| [REPLICA_SPEC.md](REPLICA_SPEC.md) | 从零对象模型、15步发送链、选人方案、状态机、外派/并发/恢复、API事件、UI位置、语音文件routine企业、日志、19种场景与增量路线 |
| [OPEN_SOURCE.md](OPEN_SOURCE.md) | 8个项目固定commit源码核查，4个补充发现，部署依赖与许可证、可复用边界 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 62条待实施验收用例及8组竞品实测脚本 |
| [official-manifest.json](official-manifest.json) | 官方索引与39篇文档原始快照URL、时间、SHA256 |
| [sources/github/manifest.json](sources/github/manifest.json) | GitHub固定commit、仓库名重定向、许可证/维护元数据、源码快照hash |
| [coverage.json](coverage.json) | 官方文档与章节索引、矩阵映射；有些重复/概述页合并核对 |
| [VALIDATION.json](VALIDATION.json) | 引用/哈希/原始文件未改动的校验；不代表产品运行验收 |

资料分三种：**官方文字事实**、**读取过的Negus/开源代码行为**、**我们的复刻提案**。矩阵不是“169个功能已经实现”；一些行是功能的限制或失败边界。八仓库源码核查为选定关键模块，不是对整个仓库每行审计。

官方覆盖包括：overview/get-started/bots/chat/computer/files/skills/settings/mobile/use-cases/faq/troubleshooting，以及Team Bot/enterprise/identity/network/proxy/security/computer management；另补帮助中心18篇，包括group-chats、voice-chat、routine、edit-bot、how-to、secret、recovery、plans等。`llms.txt`索引包含21篇Grok Bot文档，补充help链接后共39篇。

## 文档超时的原因与重试结果

之前失败在 **直连TCP443建立连接超时**，未收到官方HTTP错误。macOS系统启用了127.0.0.1:7892代理，但curl/urllib并不会自动采用该系统设置。显式指定已有代理后，`docs.x.ai/llms.txt`和21篇 `.md` 文档成功200，后续18篇Cursor帮助中心页面也成功200。

这说明本次“读不到文档”可以通过使用正确出口解决，不能认定官网宕机。没有修改系统代理设置。`x.ai/bot`产品页此前通过代理遇到Cloudflare403，是另一种结果，不能与TCP连接超时混在一起。还发现 `.md`路径叠加`Accept:text/markdown`会404，采集采用 `.md`不加该Accept。

采集器第一版把Cursor外链同名路径误映射到docs.x.ai，4条404是采集URL错误，已修正并抓取正确帮助中心链接；清理后的manifest记录实际有效官方快照。HTML原件保存为 `cursor-help-*.md`，后缀便于归档但内容仍是HTML；同名 `.txt` 是抽取正文，去除重复导航/移动副本，原件未篡改。

GitHub直接API随后遇到匿名请求额度403，显式走系统代理继续只读查询并完成快照；这是API限流，不是GitHub仓库不可访问。404的两条框架源码猜测路径随后按真实tree定位纠正，manifest保留失败请求和成功路径，报告只引用成功版本。

## 产品边界里容易误会的地方

| 名词/行为 | 官方资料支持的含义 | 对Negus的启示 |
|---|---|---|
| Bot | 长期身份/职责/上下文 | 不用供应商配置或一个进程充当员工身份 |
| 普通群 | 多Bot共同目标与交接 | 普通消息应进入可解释的回复链 |
| Team Bot | owner发布共享定义，成员各自私聊私有 | 不是一个全公司共享的私人历史 |
| 模板 | 接收者得到独立副本 | 不共享源账户电脑/登录/完整历史 |
| 共享电脑 | 普通用户一个账户电脑，多Bot独立屏幕 | 同账户文件/登录共享；屏幕不是安全隔离 |
| routine | 一owner计划/事件定义，运行出独立实例 | 定义状态、实际run、结果/通知应分开 |
| stop | 停止后续执行 | 不撤销已经发生的外部动作 |
| hide | 隐藏入口与关闭提醒，仍继续工作 | 不等同pause/delete |
| task已完成 | 执行终态 | 不等同文件已上传或通知已送达 |
| @ | 可指Bot/群/routine/connector | 类型化引用，不能所有@都派工 |
| 语音 | 听写草稿、1对1实时、音频memo | 官方没有实时群语音；不能拿开源群语音当官方证据 |
| debug | 官方有控制面Audit和动作Recording/OTel分层 | Negus按用户要求完整链路日志在后端，前端呈现有用错误 |

官方2–6初始群成员、6附件/25MB/200MB、50routine/20历史、约10分钟后台批准过期、14天旧版本强制更新等，仅作为**竞品事实**。不会未经确认变成Negus新限制。正式开发追求删除重复与共享组件，不因为调研覆盖广就一次引入所有竞品细节。

## 官方资料差异：不能假装唯一规则已经确认

| 项 | docs.x.ai | Cursor帮助中心 | 当前处理 |
|---|---|---|---|
| Bot编辑入口 | bots页仍写Edit Profile | edit-bot明确旧右键Edit Profile已移除，改资料详情Bot settings | 用help记录新入口，同时保留版本差异；没有截图实测不报坐标 |
| routine删除 | skills页写立即生效无撤销 | routines页明确删除确认 | 记录冲突；复刻提案采用用户明确删除并有范围说明，待体验验收 |
| Team Bot私人connector在1对1 | team-bots页说1对1不用询问，shared chat先问 | help/team-bots说1对1也先问 | **未定**；实测owner/teammate各场景，不能合成唯一答案 |
| Team Bot审批可答人 | 无人可回答时无AutoReview，除非团队强制 | help明确只owner私聊可答，teammate/Slack/group按owner权限工作 | help细化范围但仍需版本核实；不默认绕过组织规则 |
| Team Bot执行电脑 | 同事app/DM用其电脑；Slack共享电脑 | help说隐私更严格可另电脑，且group共享电脑 | 确认存在按安全scope分配环境；普通app group具体边界保留未知 |
| 个人转Team Bot | 特定情况下可Copy旧chat/memory并选择 | help说personal chats不move | copy与move可能不同，不宣称复制历史的精确范围；采用显式选择和隐私验收 |
| 手机电脑恢复 | troubleshooting曾说手机同样卡片 | help/mobile明确电脑update/recover/reset仅桌面 | 暂按help能力约束记录，等待运行版本实测 |
| App语言 | settings说20多种 | help列31桌面/11手机 | 后者更细，不算本质冲突；仍按平台版本记录 |

没有公开版本时间/登录实测足以判定哪篇最新，因此不是“所有差异都按help百分百覆盖”。上述不确定性没有影响“普通群无@也参与选人”的核心结论。

## Negus现有链路：正常部分与差距

以下是源码级观察，不是本次跑过全部供应商和浏览器链路。

**可复用的正常基础**：群消息JSON持久化、message sequence和clientMessageId去重，历史前后/around查询，附件与成果路径；员工×群native线程与增量上下文；已有终稿@其他员工能接续一次；单聊控制和researcher后台任务已经存在。新UI预览创建群和新增negus助手是此前工作，调研没重新开发这些。

**已确认差距**：

- 无点名/请求目标时 `listening:true`但没有执行，普通群体验与官方规则不同。
- 群内单currentRun与promise queue，员工顺序执行；不是各Bot独立异步工作。
- 终稿@形成追加目标，每员工本轮最多唤醒一次；能初步链式交接，但不支持可靠多轮返工与持久异步回执。
- discussions/queue在内存；关闭服务丢执行调度事实，消息落盘不能补这个缺口。
- 群interrupt会取消群pending和当前run，不是按任务选择；一刀切30分钟timer标failed/清currentRun，源码该分支没见native interrupt，存在底层继续与迟到事件风险。此项为代码风险，尚未故障注入复现。
- 群成员主要来自启动定义快照，生产路由未见完整成员CRUD；preview extension有动态创建但不是完整员工/群生命周期API。
- replyTo引用不是独立thread；localStorage显示身份不是团队真实认证。
- 单聊原生协议支持的审批/输入/附件，不代表群UI相应卡片都能完整操作；需逐卡验收。

链接：[routing](/Users/hans/myproject/negus/windows/server/multi-agent/agent-routing.mjs:25)、[queue与交接](/Users/hans/myproject/negus/windows/server/multi-agent-service.mjs:455)、[timer](/Users/hans/myproject/negus/windows/server/multi-agent-service.mjs:374)、[preview群扩展](/Users/hans/myproject/negus/ui-feishu/server/group-extension.mjs)、[现有后台任务](/Users/hans/myproject/negus/windows/server/agent-tasks/service.mjs)。

## 复刻路线与下一次产品讨论

推荐先沿现有UI和原生运行器完善 **普通消息路由→持久run→通用异步交接与回报→任务控制与分类**。用户能直观验证“发消息有人接、知道谁在干什么、外派对话可以继续聊、刷新/离开不丢结果”。其余线程、routine、语音、电脑、Team Bot和企业能力逐步补，不需要现在重写全部。

未来真正需要用户定义的主要体验选项：普通消息谁接待/自动选人如何表现；结果只在原群还是允许员工私聊回报；员工外派是否创建可见小群及其成员；任务标题和预计产出如何更新。当前报告给出选择与推荐，没有替用户冻结新产品限制。

**本次已完成**：公开功能核对、来源存档、现有实现差距、从零设计、选定开源源码/许可证比较与验收说明。**仍未获得的事实**：官方内部选人/上下文/调度算法、登录UI像素与灰度能力、Team Bot差异的实际版本行为。它们已在验收文件给出具体核实步骤，不能用调研文字冒充官方实测或源码还原。
