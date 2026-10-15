# BUG-20260926-01 共享缓存与稳定更新

更新时间：2026-09-26 22:34 +08:00
状态：handoff_pending
分支：codex/publish-current-panel
产品基线：a3dd3f779649db3cb86bbf864d3c0d25f44c3488

## 范围与调用关系

用户授权检查调用关系并完成最小修改，优先删减和复用，关注旧内容覆盖与位移。

- App -> ConversationApp -> useProjectDirectory -> projectDirectoryApi / projectDirectoryResource。
- GroupApp -> 同一 projectDirectoryResource；删除原独立目录状态、校验器和持久化。普通对话始终挂载，其现有目录事件连接继续负责变化通知；未增加事件连接。
- Desktop -> 多个 AutomationsWidget -> 同一 automations 资源。保留原 15 秒可见性刷新及不完整来源合并。
- useProjectConversations -> useModels -> modelCatalogFor(conversationId) -> modelApi.list。模型读取显式捕获 conversationId，避免排队请求在 URL 改变后读错环境。
- useConversationCatalog、useContextManagement、useProjectConversations 对 readModelCatalog 的同步读取也走当前环境资源。
- 所有上述资源复用 shared/state/localCache.ts 的 createCachedResource；既有 readLocalCache/writeLocalCache 接口保留，布局保存失败检测等调用语义不变。

## 当前行为

原先目录、自动化、模型分别管理缓存与请求；现在同一资源共用内存快照、订阅、持久化和在途请求。有缓存时后台更新，合法空数组属于已有结果；错误或格式异常保留最后有效内容，相同内容保留数据引用。
失效通知到达在途请求期间时，合并补读并丢弃通知前的结果；共享请求不由单个组件的 AbortSignal 取消，各数据源保留超时。自动化不完整结果合并，完整空结果可以确认删除。
模型按 conversationId 隔离；旧 v1 模型缓存归属不可证明，首次改用 v2 后需重新读取一次。未删除旧缓存文件或存储项。
消息快照、正文版本判断、乐观消息合并、稳定消息 ID、虚拟列表与滚动跟随保留。公共缓存不承担聊天业务合并。
未修改启动画面、Service Worker、助手连接就绪条件、真实执行流程或基础 UI；这次完成共享缓存核心及目录、自动化、模型的接入，并非全系统缓存实现已迁移。

## 修改与保护

8 个产品代码文件：localCache.ts、projectDirectoryApi.ts、useProjectDirectory.ts、GroupApp.tsx、AutomationsWidget.tsx、modelCatalogCache.ts、modelApi.ts、useModels.ts。
相对于开工时工作区：增加129行、删除106行，净增23行。无新增依赖。
修改前内容保存在 output/BUG-20260926-01-before/，包含原有未提交内容。其他既有修改未回退或覆盖。
新增两个定向测试文件：windows/tests/shared-cache.test.mjs、windows/tests/shared-cache.browser.mjs。

## 验证证据与边界

- node --test windows/tests/shared-cache.test.mjs：10/10 通过。覆盖空缓存、坏缓存、共享请求、订阅取消、同值引用稳定、失效补读、失败/重试、同步抛错、存储容量失败、部分结果/删除、模型环境隔离。
- pnpm build:ui：类型检查与生产构建通过；有大 chunk 提示，未扩展做拆包。
- 无界面 Edge，实际加载此次 dist，全部网络请求本地拦截，未访问真实供应商，未尝试创建会话或发送任务。
- 390×844 与 1280×900：两个自动化组件共用一次请求，群聊与普通对话共用在途目录请求；任务行 DOM 身份不变，纵向坐标和高度变化 <1px；再次进入恢复最新自动化缓存。
- 历史阅读期间后台追加消息：手机尺寸 scrollTop 9903 -> 9903，桌面尺寸 6486 -> 6486。两种尺寸无 pageerror。
- 初始浏览器测试夹具先后缺少安全上下文、渠道接口 channels 数组，已修正夹具后通过；未据此改动产品代码。
- 定向 git diff --check 通过。

未重启服务、未提交或推送。dist 已构建，但未证明用户当前设备已加载该版本。真实手机、公网慢网、供应商切换、图片延迟解码下的滚动，以及跨标签页即时缓存同步未验收。现有其他专用缓存并未全部迁移，不声称彻底消除所有加载提示。

## BUG-20260927-01 进入时的延迟插入与任务闪动

2026-09-27 10:12 +08:00，handoff_pending。用户确认“已完成”在助手回复下方延迟出现，并反馈桌面组件进入时仍明显更新。
基线 a3dd3f779649db3cb86bbf864d3c0d25f44c3488，分支 codex/publish-current-panel。

调用原因：ConversationView 将接口恢复的历史 completed 状态挂到最后一条助手回复；useProjectDirectory 将会话 hook 本地生成、无 updatedAt 的恢复/idle 状态作为真实目录覆盖，任务分类随之变化；CurrentTasksWidget 摘要签名未回退到已缓存目录中的 turnId。

修改三个现有产品文件：ConversationView 仅在本会话观察过该 Turn 运行时保留完成过程行，历史 completed 不延迟补出；失败/中断仍显示。目录忽略无更新时间的本地临时执行状态，并阻止有时间戳的旧状态覆盖新状态。摘要签名复用已有目录 Turn ID。没有关闭真实更新，没有添加第二套任务缓存。原内容备份 output/BUG-20260927-01-before/，保留其他未提交修改。

pnpm build:ui 通过。shared-cache.browser.mjs 补充 1.5 秒延迟完成接口、真实运行/完成事件及当前任务组件；390×844 与 1280×900 无界面 Edge 的隔离接口检查通过：历史完成不插入工作过程；实际运行转完成仍显示；缓存任务行 DOM 保持；自动化共享请求及历史滚动检查继续通过。全部网络拦截，无真实任务发送。真实手机、公网和所有组件的完整内容更新尚未验收。不声称已消除所有刷新变化。未重启、提交或推送。
