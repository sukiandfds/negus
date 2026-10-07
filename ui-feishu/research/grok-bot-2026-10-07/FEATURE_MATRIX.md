# Grok Bot 功能核对矩阵

日期：2026-10-07。共 169 条细化记录。官方事实、复刻提案、Negus差距和验收分列；不是已经实现的功能清单。

来源行号指向本次保存的文字；帮助中心 `.txt` 为从原始HTML提取的正文。公开功能核对不等于登录产品实测。每项开发验收尚未执行。

## 入口与账户

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F001 | 付费Cursor或合格个人SuperGrok关联可访问 | 账户与使用权益分层；不照搬竞品套餐 | 非本轮产品配置 | 无权益显示准确原因；有权益进入同一账户 | [get-started.md:7](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/get-started.md:7) |
| F002 | 桌面覆盖macOS Windows Linux | 先共用Web界面；桌面壳按需要接入 | 现有Web可复用 | 三个系统入口可用；版本信息可查 | [get-started.md:7](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/get-started.md:7) |
| F003 | 浏览器登录后回到客户端 | OAuth回调携带state及单次授权码 | 需审计现有身份层 | 回调重复不创建双账户；取消可重试 | [get-started.md:7](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/get-started.md:7) |
| F004 | 首次初始化云电脑在后台进行 | 聊天控制面与执行环境健康分开 | 本地原生运行不同 | 环境未就绪仍能看到已保存聊天 | [get-started.md:7](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/get-started.md:7) |
| F005 | 引导推荐连接工具但不自动授权 | 工具目录与已授权连接分开 | 插件入口需补齐 | 跳过引导不会自动获得外部权限 | [get-started.md:7](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/get-started.md:7) |

## 员工身份

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F006 | 首个Bot名为Grok Bot；后续可先输入名字创建 | Negus沿用negus助手默认员工；员工可动态创建 | 员工定义目前以启动文件为主 | 新员工重启后存在且只创建一次 | [cursor-help-onboarding.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-onboarding.txt:6) |
| F007 | 名字 Label Description长期保留 | 可复用员工资料表单；身份独立于模型配置 | 资料与运行配置需解耦 | 改名字不丢历史；换模型不换员工 | [cursor-help-onboarding.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-onboarding.txt:6) |
| F008 | 描述保存长期职责；聊天保存一次性任务 | 提示构建区分职责和当前请求 | 已有员工instructions可用 | 一次性要求不永久写入资料 | [cursor-help-onboarding.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-onboarding.txt:6) |

## 员工资料与生命周期

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F009 | 头像可选角色样式 生成 上传裁剪；上传小于25MB | 共用头像选择组件；AI生成可后接 | 生成和裁剪未核实 | 上传失败保留旧头像；取消不保存 | [cursor-help-edit-bot.txt:10](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-edit-bot.txt:10) |
| F010 | 手机Description叫Instructions Label叫Title | 共用字段含义；端上文案可统一 | 需避免两套字段 | 桌面改职责后手机读同一内容 | [cursor-help-edit-bot.txt:10](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-edit-bot.txt:10) |
| F011 | 只有所有者可编辑Bot；新帮助页取消Edit Profile旧菜单 | 权限由服务端检查；不复制过时入口 | 现有预览权限不足 | 非所有者伪造请求也无法修改 | [cursor-help-edit-bot.txt:10](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-edit-bot.txt:10) |
| F012 | 可置顶；隐藏保留工作和历史；隐藏不暂停routine | 置顶隐藏为用户展示偏好 | 预览有置顶；持久跨设备待核实 | 隐藏后例行任务继续；取消隐藏恢复 | [bots.md:55](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/bots.md:55) |
| F013 | 复制保留资料设置技能routine头像；不含历史记忆附件 | 创建新身份并选择性复制定义 | 暂无完整复制API | 复制后旧对话与附件不可见 | [bots.md:55](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/bots.md:55) |
| F014 | 分享创建模板异步生成 可查看和更新 | 模板有版本及发布状态 | 未实现 | 未完成时不可给出已成功链接 | [bots.md:55](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/bots.md:55) |
| F015 | 公开或团队内模板；企业默认团队内 | 发布范围校验与接收者ACL | 未实现 | 禁止公开后旧链接也受限制 | [bots.md:55](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/bots.md:55) |
| F016 | 接收模板是独立副本 不共享电脑登录历史 | 模板只携带明确可分享字段 | 未实现 | 接收者无法看到源账户会话 | [bots.md:55](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/bots.md:55) |
| F017 | 删除Bot移除资料对话routine；不自动清除共享电脑文件登录 | 删除范围明确；计算环境清理另操作 | 现有删除范围需审计 | 删员工不会误删他人文件或隐瞒残留 | [bots.md:55](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/bots.md:55) |
| F018 | Bot私有上下文；共享文件或消息才跨角色传递 | 每员工会话上下文独立；显式引用权限验证 | 已有员工×群会话线程 | 群任务不偷偷拼接另一私聊 | [bots.md:55](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/bots.md:55) |

## 分区与项目

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F019 | 侧栏section按项目客户业务组织Bot；桌面Move to支持创建和重命名 | 共用分区关联；Negus projectId另保留执行含义 | 新UI有项目入口但不是完整section | 员工移动只影响归类不重写历史 | [cursor-help-how-to.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-how-to.txt:6) |
| F020 | section桌面和iOS同步；删除section移到Unassigned不删Bot | 分区是组织视图不是所有权或任务 | 本地展示偏好需服务端化 | 删除分区后员工和聊天仍可访问 | [cursor-help-how-to.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-how-to.txt:6) |
| F021 | iOS section要求v1.2.0以上 | 功能能力协商；不盲加版本限制 | 非当前Web能力 | 旧客户端不破坏未知字段 | [cursor-help-how-to.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-how-to.txt:6) |

## 群入口与成员

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F022 | New chat选择2至6个Bot生成群；可改自动群名 | 复用员工选择器；竞品人数是事实不是Negus新增限制 | 预览动态创建可复用 | 同一创建请求重放只出现一个群 | [chat-and-collaboration.md:63](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:63) |
| F023 | 手机通过加号New Group Chat创建 | 统一群创建API | 移动UI待核验 | 手机创建桌面可见 | [chat-and-collaboration.md:63](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:63) |
| F024 | 群成员之后可修改 | membership保存加入退出时间及版本 | 现有生产路由未见成员CRUD | 成员变更后路由使用最新有效名单 | [chat-and-collaboration.md:63](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:63) |
| F025 | 群描述共享目标及下一阶段负责人 | 群说明字段与消息任务分离 | 现有群元数据需扩展 | 改群说明不会改过去任务指令 | [chat-and-collaboration.md:63](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:63) |

## 群路由

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F026 | 普通消息让参与Bot决定谁应答；未公开具体算法 | 设计显式路由接口；自动挑选方案见SPEC | 现有无目标listening且不执行是差距 | 普通有人吗应有接待回复或明确待处理状态 | [chat-and-collaboration.md:75](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:75) |
| F027 | @选择一个Bot负责 | 结构化mention使用employeeId并保留显示文本 | 现有名称正则会歧义 | 重名员工不误叫；改名后旧消息仍识别 | [chat-and-collaboration.md:75](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:75) |
| F028 | 可同时@多个Bot | 多个目标各有runId；按依赖调度 | 目前群内顺序运行 | 每个被点名员工各有可追踪结果 | [chat-and-collaboration.md:75](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:75) |
| F029 | @everyone用于全群更新 | 特殊mention类型；不解析为同名员工 | 未见明确@everyone语义 | 广播覆盖当前成员且不自激重复 | [chat-and-collaboration.md:75](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:75) |
| F030 | Bot可在群发消息交接 | 消息与handoff实体分离但联动展示 | 已有终稿@链式但不是持久异步 | 交接可跳到来源与目标任务 | [chat-and-collaboration.md:75](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:75) |
| F031 | 用户群消息可带附件；Bot到群交接目前只支持文本 | 保留源文件引用并校验目标可读；兼容文本交接 | 已有上传；跨角色能力待核验 | 图像不可用时不能声称已看过 | [chat-and-collaboration.md:75](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:75) |
| F032 | 需要图片的Bot可通过直接消息接收 | 附件能力单独检测而非盲塞文本 | 未有通用员工直传工具 | 目标收到可访问图片并有来源记录 | [chat-and-collaboration.md:75](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:75) |

## 群与私聊边界

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F033 | 群消息默认在群回复；Bot可另发私聊或直接给另一Bot | 每条消息有真实conversationId；来源可回溯 | 目前终稿@主要留在同群 | 私聊交接不误写当前浏览页面 | [cursor-help-group-chats.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-group-chats.txt:6) |
| F034 | 群描述适用于该群所有Bot；员工描述适用于所有场景 | 群规则与员工规则分别注入并有版本 | 提示构建需补齐 | 群内规则不污染员工其他群 | [cursor-help-group-chats.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-group-chats.txt:6) |
| F035 | 没有禁止互发消息开关；可用消息或描述约束 | 保留产品自然语言边界；工具执行器仍校验权限 | 需补边界传播 | 明确不要外派后工具不能静默派工 | [cursor-help-group-chats.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-group-chats.txt:6) |
| F036 | 群没有每Bot同样的通知开关 | 通知能力分类型；不展示假开关 | 通知未完整实现 | 开关缺失不被当作服务失效 | [cursor-help-group-chats.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-group-chats.txt:6) |
| F037 | 群不能实时语音；应到单Bot私聊 | 语音入口按会话能力显隐 | 当前群无语音能力 | 群中不会出现不可用语音按钮 | [cursor-help-group-chats.txt:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-group-chats.txt:6) |

## 异步外派

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F038 | Bot可异步给另一Bot；目标被唤醒后晚些回复 | handoff持久排队；完成回执outbox | researcher后台任务可复用但群非通用 | 源Bot结束后目标仍运行且结果归来源 | [chat-and-collaboration.md:93](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:93) |
| F039 | 交接可见；每阶段明确负责人避免重复噪音 | 任务拥有owner parentRun sourceConversation targetConversation | 目前缺通用持久依赖图 | 用户能知道谁派谁 当前谁做 做什么 | [chat-and-collaboration.md:93](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:93) |
| F040 | 用户可在工作中发送指令重定向 | steering按runId序列化且高于后台优先级 | 群queue尚非即时steer | 执行中追加要求有已接收与应用状态 | [chat-and-collaboration.md:93](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:93) |
| F041 | 直接Stop now结束当前工作但不回滚已完成动作 | 取消幂等；效果核实后才能显示已停止 | 当前群stop范围偏广 | 停一个任务不停止无关群；已发邮件仍保留记录 | [chat-and-collaboration.md:93](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:93) |

## 消息与历史

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F042 | 支持回复线程保持主线清楚 | threadId rootMessageId replyToId独立建模 | 当前replyTo引用不是完整线程 | 同根回复聚合；从搜索可跳线程 | [chat-and-collaboration.md:109](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:109) |
| F043 | 反应轻量确认；关键变更和批准要文字或卡片 | reaction独立数据且不触发批准工具 | 未核实反应API | 点赞不批准发送邮件 | [chat-and-collaboration.md:109](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:109) |
| F044 | 跨Bot群消息文件routine搜索并跳上下文；发布可能有差异 | 统一索引含ACL及cursor | 已有历史分页跳转可复用 | 不能搜索出无权限私聊 | [chat-and-collaboration.md:109](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:109) |
| F045 | 工具动作电脑文件问题审批语音卡片混在记录中 | 消息块渲染复用已有组件与事件 | 原生单聊部分有；群审批需审计 | 卡片更新后刷新状态一致 | [chat-and-collaboration.md:109](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:109) |

## 桌面效率

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F046 | 快捷键覆盖新建 搜索 查找 侧栏聚焦 切Bot 历史前后 详情 插件 设置 缩放 | 复用command registry；键位完整表见SPEC | 现有键盘支持待审计 | 快捷键与输入法/输入框冲突有优先级 | [chat-and-collaboration.md:133](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:133) |
| F047 | Enter发送 ShiftEnter换行 CmdCtrlEnter全局发送 | composer统一键处理且IME组合中不发送 | 现有composer可复用 | 中文选字Enter不会误发送 | [chat-and-collaboration.md:133](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:133) |

## 草稿与发送

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F048 | 邮件Slack可以先显示可编辑收件人正文草稿；Send或Discard | draft版本与approvedPayload绑定；一次发送幂等 | 暂无完整通用草稿卡 | 改收件人后旧批准不复用；双击不重复发送 | [chat-and-collaboration.md:48](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:48) |
| F049 | 可粘贴文字链接图片 附加本地文件 | 共享composer与attachment API | 现有基本可用 | 上传中不可伪装已发送附件 | [chat-and-collaboration.md:48](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/chat-and-collaboration.md:48) |

## 附件与产出

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F050 | 支持常用媒体PDFOfficeCSVJSONYAML代码HTML邮件notebook | 媒体清单按真实解析能力展示 | 已有附件管道需能力审计 | 不支持格式给出原因不生成假内容 | [files-and-results.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/files-and-results.md:8) |
| F051 | 单消息6附件；文图音25MB 视频桌面200MB | 限制能力由服务端返回；不硬套Negus | 需核实现有容量 | 大小边界服务端拒绝且可保留草稿 | [files-and-results.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/files-and-results.md:8) |
| F052 | 手机iOS分享文件照片文本链接进草稿；Android文本 | OS分享先创建draft不自动执行 | Web无原生share extension | 分享后用户可编辑再发送 | [files-and-results.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/files-and-results.md:8) |
| F053 | 产出可预览卡片 保存链接和源文件 后续原件迭代 | artifactId版本及来源runId；预览受控 | 现有artifact UI可复用 | 第二次修改关联原成果不丢来源 | [files-and-results.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/files-and-results.md:8) |
| F054 | Cloud Agent成果复制回Bot电脑且附到聊天 | artifact transfer有校验和完成状态 | 无同产品Cloud Agent桥 | 传输失败不能标最终交付完成 | [files-and-results.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/files-and-results.md:8) |
| F055 | 共享workspace文件但结果应回链对话 | 存储与交付分离；文件引用真实可读 | 已有共享项目目录 | 用户离开任务仍找到成果且下载可用 | [files-and-results.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/files-and-results.md:8) |
| F056 | 证据区分事实 假设 待批准 附来源时间动作 | 共用结果模板不强加每次前端debug | 来源现有文本可以承载 | 研究结果可追溯；后端trace完整 | [files-and-results.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/files-and-results.md:8) |

## 执行环境

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F057 | 同一账户Bot共享云电脑文件Cookie登录和CLI凭据 | 账户环境与员工identity分层 | Negus供应商runtime与云电脑并非一回事 | 用户明白共享范围且不同账户隔离 | [computer-and-apps.md:3](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computer-and-apps.md:3) |
| F058 | 每Bot独立屏幕 可并行但屏幕不是安全边界 | 屏幕租约按员工；文件锁按资源 | 目前单群currentRun串行 | 两员工浏览互不抢屏；共享文件写有冲突处理 | [computer-and-apps.md:3](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computer-and-apps.md:3) |
| F059 | 关闭客户端任务和routine仍继续 | 执行服务独立客户端连接 | 后台已有部分支持 | 浏览器断开run继续且重连可恢复 | [computer-and-apps.md:3](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computer-and-apps.md:3) |
| F060 | Agent Computer可观察接管 登录2FA付款由用户完成 | humanTakeover有暂停恢复协议 | 待提供远程屏幕能力 | 用户接管时模型不同时点击 | [computer-and-apps.md:3](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computer-and-apps.md:3) |
| F061 | 插件安装与浏览器OAuth；全账户可用 | plugin安装和connection授权两对象 | 需审计插件管理 | Installed不等于Connected | [computer-and-apps.md:3](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computer-and-apps.md:3) |
| F062 | 插件tool可禁用；插件与事件trigger授权来源不同 | 能力注册表和触发授权分开 | 无统一目录 | 禁用tool不误表示事件已解绑 | [computer-and-apps.md:3](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computer-and-apps.md:3) |

## 环境维护

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F063 | 聊天存储与电脑分离；电脑故障不删除聊天 | 控制面持久DB与工作目录分开 | 群记录JSON可复用但job在内存 | 电脑重建后历史仍完整 | [cursor-help-computer-recovery.txt:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-computer-recovery.txt:8) |
| F064 | 软件Update可保留apps；整电脑更新 Recover Reset可能移除packages | 区分操作类型及损失范围 | 未实现同类环境服务 | 界面提前显示影响且进度可恢复 | [cursor-help-computer-recovery.txt:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-computer-recovery.txt:8) |
| F065 | Update备份不就绪或agent无法暂停时不继续 | 操作前保存与安全点检查 | 未实现 | 并行两次恢复拒绝重复执行 | [cursor-help-computer-recovery.txt:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-computer-recovery.txt:8) |
| F066 | Recover尽量先保存 Reset基于已保存状态；最近未同步数据可能丢 | 不保证无损；显示最后备份时点 | 未实现 | 恢复后报告实际保留与丢失范围 | [cursor-help-computer-recovery.txt:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-computer-recovery.txt:8) |
| F067 | 低磁盘Disk Saver Bot建议清理且先确认；不影响聊天 | 低磁盘诊断复用工具与确认卡 | 未实现 | 拒绝清理不删除；不把聊天算电脑文件 | [cursor-help-computer-recovery.txt:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-computer-recovery.txt:8) |
| F068 | 手机不能Update Recover Reset电脑 | 能力声明控制入口 | 未实现 | 手机提示去桌面而非错误触发 | [cursor-help-computer-recovery.txt:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-computer-recovery.txt:8) |

## 技能

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F069 | 技能是共享私人库 可跨Bot用；保存步骤输入验证输出边界 | skills版本库与启用绑定分离 | 现有skill机制需审计UI | 改技能有版本；共享定义不共享私聊 | [skills-routines-and-automations.md:15](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/skills-routines-and-automations.md:15) |
| F070 | slash可引用skill；Marketplace插件含skills | typed command引用真实skillId | 群slash当前偏附件/命令 | 未知技能不当成执行命令 | [skills-routines-and-automations.md:15](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/skills-routines-and-automations.md:15) |
| F071 | 1对1Teach a task录屏互动最多10分钟 不录麦克风 生成草稿 | 录制后人审技能；非模型实时执行授权 | 未实现 | 录制不含秘密；停止后可放弃草稿 | [skills-routines-and-automations.md:15](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/skills-routines-and-automations.md:15) |
| F072 | 示范式教学有发布能力差异 | 能力标记不显示伪完成 | 未实现 | 不可用时明确说明 | [skills-routines-and-automations.md:15](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/skills-routines-and-automations.md:15) |

## routine与事件

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F073 | 一routine一个Bot owner；自然语言创建编辑 | 所有运行共用run ledger；定义与实例分开 | 已有agent任务不等于routine | owner删除触发关闭而非漂移给其他员工 | [cursor-help-routines.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-routines.txt:40) |
| F074 | 时区自动检测或指定；新计划等待下次时刻 不自动首跑 | 持久schedule nextRunAt时区；DST测试 | 需要统一scheduler | 8点任务8点05创建第一轮次日；Test另执行 | [cursor-help-routines.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-routines.txt:40) |
| F075 | Test是真实工作可变文件调用插件 运行中Running | 同一执行器带trigger=test；不假称dry-run | 待实现 | Test失败显示真实原因；不重复触发 | [cursor-help-routines.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-routines.txt:40) |
| F076 | Slack GitHub Linear Sentry PagerDuty 邮件webhook事件 | 事件来源签名去重adapter | 暂无通用事件入站 | 重复事件只一个run；禁用后不新建 | [cursor-help-routines.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-routines.txt:40) |
| F077 | Slack触发支持Bot提及 词语 反应 任何消息 单频道或全局 | 订阅明确范围；历史不回填执行 | 未实现 | 规则创建前消息不启动任务 | [cursor-help-routines.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-routines.txt:40) |
| F078 | Webhook展示POST URL key完整Bearer header；200是开始并非完成 | secret单独存储；返回accepted与runId | 未实现 | 无效key不执行；结果在owner聊天 | [cursor-help-routines.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-routines.txt:40) |
| F079 | 详情Instruction When to run Webhook；手机Active Schedule Next run History | 通用TaskDetails；移动能力少于桌面 | 新UI任务分类有入口但非全实现 | 手机状态与后端一致 | [cursor-help-routines.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-routines.txt:40) |
| F080 | 暂停恢复编辑Test删除；帮助页删除要求确认 | 删除是显式动作；保留历史 | 未实现 | 暂停不误撤销运行中任务；删后无未来run | [cursor-help-routines.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-routines.txt:40) |
| F081 | 运行历史Running Succeeded Failed；失败附原因 | 状态由run事实生成 | 现有后台task可共用 | 无runs与failed分别显示 | [cursor-help-routines.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-routines.txt:40) |
| F082 | 官方参考50 routines每Bot及最近20 runs；文档曾写删除立即生效无撤销 | 容量保留可配置；帮助页确认差异显式记录 | 不自动新增用户未授权限制 | 容量达到不丢旧定义；删除行为验收待定 | [skills-routines-and-automations.md:118](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/skills-routines-and-automations.md:118) |
| F083 | 长期离开可能询问是否继续 无回复可能暂停；具体离开时长未公开 | 此为竞品机制 不默认加到Negus | 不实施限制 | 若未来选用需明确触发和通知 | [skills-routines-and-automations.md:118](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/skills-routines-and-automations.md:118) |

## 批准与输入

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F084 | 当前参与聊天审批等待用户；routine或Bot消息等后台审批约10分钟过期 | 运行等待状态与授权状态分开；期限可按产品明确选择 | 过去never策略冲突需审计 | 过期不执行；重试新approvalId；不照搬时间限制 | [cursor-help-how-to.txt:224](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-how-to.txt:224) |
| F085 | 批准入口在聊天 侧栏needs attention及通知 | attention来源pending input；日志在后端 | 现有协议phase可复用 | 审批卡刷新不丢且本人可操作 | [cursor-help-how-to.txt:224](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-how-to.txt:224) |
| F086 | 独立AutoReview评估shell 插件电脑automation写 delegation；allow ask deny | 策略服务和执行器分层；低风险内部派工可明确放行 | 此前后台任务审批冲突已处理范围须验证 | 内部派工不陷入需审批又禁止审批死锁 | [approvals-security-and-privacy.md:41](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/approvals-security-and-privacy.md:41) |
| F087 | Allow once Always allow Deny；Ask first胜出且其他风险仍可拦 | 批准绑定目标payload scope版本 | 群审批UI待审计 | 旧批准不覆盖变更过的动作 | [approvals-security-and-privacy.md:41](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/approvals-security-and-privacy.md:41) |
| F088 | 个人规则本桌面保存并同步电脑；管理员可锁规则 | Negus可用统一服务端规则而非照抄设备限制 | 未实现同类策略UI | 换设备不静默扩大权限 | [approvals-security-and-privacy.md:41](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/approvals-security-and-privacy.md:41) |
| F089 | 秘密卡掩码 值不入聊天模型；用户接管密码2FA支付 | secret store与renderer严格分离 | 供应商秘密不应进入消息 | trace与tool结果脱敏；操作日志只secretId | [approvals-security-and-privacy.md:41](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/approvals-security-and-privacy.md:41) |
| F090 | 本地执行Ask each time Always Never；管理员是上限 | 本地bridge和云工具分权限 | Negus原生本地模式需单独定义 | 没有本地授权不读用户本机文件 | [approvals-security-and-privacy.md:41](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/approvals-security-and-privacy.md:41) |
| F091 | 删Bot不清共享文件会话；移除访问应撤授权清文件暂停routine | 清理步骤真实列范围 | 暂无完整回收流程 | 删除后不能声称账户工具授权已全部撤销 | [approvals-security-and-privacy.md:41](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/approvals-security-and-privacy.md:41) |

## 语音

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F092 | 实时1对1语音支持静音挂断转录 Voice Speed Language | 共享语音会话控制状态机 | 未实现 | 断线清理mic；转录关联原对话 | [cursor-help-voice-chat.txt:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-voice-chat.txt:22) |
| F093 | 同一时刻一个通话；切换提示结束旧通话 | voice lease独立run；用户明确切换 | 未实现 | 两个端同时发起有冲突反馈 | [cursor-help-voice-chat.txt:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-voice-chat.txt:22) |
| F094 | 空输入框才显示语音通话；听写可编辑后发 | dictation与realtime两种模式 | 未实现 | 非空草稿不被语音入口覆盖 | [cursor-help-voice-chat.txt:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-voice-chat.txt:22) |
| F095 | 可切其他聊天后台通话；回到通话入口；结束卡含时长转录 | callId与conversationId固定 | 未实现 | 切页不把转录写到新页 | [cursor-help-voice-chat.txt:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-voice-chat.txt:22) |
| F096 | 群聊和同事Team Bot不支持实时语音 | 按能力显隐 | 未实现 | 没有伪群通话 | [cursor-help-voice-chat.txt:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-voice-chat.txt:22) |
| F097 | 失联Voice chat failed；microphone denied missing可重试 | 错误码区分权限网络设备 | 未实现 | 重试不保留重复麦克风流 | [cursor-help-voice-chat.txt:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-voice-chat.txt:22) |
| F098 | Bot语音memo可播放暂停展开文本 | 音频artifact共用播放器 | 未实现 | 不可播放有错误且文字可读 | [cursor-help-voice-chat.txt:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-voice-chat.txt:22) |

## 通知与状态

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F099 | needs attention 未读 正在输入是不同状态；打开可读 手动未读 | 用户lastReadSeq与run状态分开 | 现有展示需细分 | 读过消息仍有未处理批准 | [settings-and-notifications.md:142](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/settings-and-notifications.md:142) |
| F100 | Bot通知开关；当前焦点不弹桌面通知仍更新badge | 通知outbox和read receipt独立 | 未实现可靠推送 | 通知重复事件去重且链接准确 | [settings-and-notifications.md:142](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/settings-and-notifications.md:142) |
| F101 | 群不等同每Bot通知；push可能分阶段发布 | 通知能力声明 | 未实现 | 不错误承诺全端push已具备 | [settings-and-notifications.md:142](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/settings-and-notifications.md:142) |
| F102 | 错误通知Dismiss不回滚动作；可复制requestID | 前端简洁错误；完整debug留后端 | 已有协议错误可复用 | 每错误trace可查用户动作至返回 | [settings-and-notifications.md:142](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/settings-and-notifications.md:142) |
| F103 | 没有桌面打开时自动关闭手机通知的开关 | 不把桌面前台抑制误当全端抑制 | 未实现 | 电脑使用时手机行为由明确策略决定 | [cursor-help-mobile.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-mobile.txt:40) |
| F104 | 手机全局通知可关；Bot同一开关跨设备 | 用户与设备偏好分开 | 未实现 | OS禁用和产品开关禁用可区分 | [cursor-help-mobile.txt:40](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-mobile.txt:40) |

## 移动与设置

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F105 | 同账户共享Bots群对话云电脑插件routine；草稿切页保留 | 统一API与draft保存 | Web响应式可复用 | 手机草稿不会写到另一个对话 | [mobile.md:3](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/mobile.md:3) |
| F106 | 手机支持编辑成员资料pin hide delete线程反应接管 | 同组件能力适配触摸 | 需浏览器验收 | 窄屏抽屉焦点返回及可达 | [mobile.md:3](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/mobile.md:3) |
| F107 | iOS18 iPadOS18 Android9为官方参考最低版本 | Web按浏览器能力检测 | 非本轮系统要求 | 不无故锁用户设备 | [mobile.md:3](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/mobile.md:3) |
| F108 | 帮助中心写桌面31语言手机11；菜单语言和Bot回复语言关联；voice独立语言 | i18n字典与输出偏好分开 | 现有中文优先 | 切语言不改历史；未知locale回退 | [cursor-help-how-to.txt:122](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-how-to.txt:122) |
| F109 | 暗亮跟系统 多账户切换添加移除 | 服务端数据隔离与客户端缓存分namespace | 现有账户功能需审计 | 切账户不闪出上账户消息 | [cursor-help-how-to.txt:122](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-how-to.txt:122) |
| F110 | About复制version track OS；app检查自动更新 云工作不停 | 版本由构建产物产生；前端后端都可查 | 版本问题历史需持续可观测 | 运行SHA与源码SHA都报告不混淆 | [cursor-help-how-to.txt:122](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-how-to.txt:122) |
| F111 | 帮助页版本旧于14天且有新版本要求升级；Linux包管理器更新 | 竞品限制仅记录 不默认移植 | 不添加时间门槛 | 若选用必须产品确认支持期限 | [cursor-help-how-to.txt:122](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-how-to.txt:122) |

## Team Bot

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F112 | 一个owner维护发布团队共享Bot；每人独立私聊 | shared definition与private conversation分层 | 目前本地身份不是团队账户 | owner不能读取同事私聊 | [team-bots.md:52](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:52) |
| F113 | 先私有草稿 再发布；取消发布保留聊天routine再发布恢复 | draft published unpublished deleted显式生命周期 | 未实现 | 未发布不能搜索到；恢复不是创建新Bot | [team-bots.md:52](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:52) |
| F114 | 个人Bot Publish to Team做副本并审阅记忆技能文件秘密routine | 明确拷贝选择 共享记忆边界 | 未实现 | 个人敏感记忆不自动进入team memory | [team-bots.md:52](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:52) |
| F115 | 共享设置只有owner能改；成员可pin hide个人routine | RBAC含owner/member/admin | 未实现 | 成员不能改共享setup或删全员Bot | [team-bots.md:52](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:52) |
| F116 | Team memory仅明确希望全团队知道时写；私人notes跨app和Slack DM | 记忆ACL user/team plus provenance | 现有会话上下文不等于持久记忆 | 个人偏好不会流入团队摘要 | [team-bots.md:52](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:52) |
| F117 | 共享skill仅owner保存；同事教学只私有notes | 知识发布权限独立 | 未实现 | 同事不能借对话覆盖全队流程 | [team-bots.md:52](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:52) |
| F118 | OAuth按提问者连接；key token按Bot服务凭据 | actorUserId与credentialOwner分开校验 | 目前缺完整多用户授权 | 甲的OAuth永不借给乙 | [team-bots.md:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:6) |
| F119 | RemoteHTTPS可服务凭据或个人OAuth；Command用当前电脑且含秘密只能owner | tool connector类型声明可达环境 | 未实现 | Command参数无秘密；其他用户不能读owner环境 | [team-bots.md:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:6) |
| F120 | Team Bot最多25secret 值8字符至4096B 加密redaction | 存储加密 值不回显脱敏所有输出 | 未实现 | 日志文件tool不泄secret；轮换可生效 | [team-bots.md:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:6) |
| F121 | 团队参考files文本格式每文件256000字符 | 知识文件与聊天attachment不同分类 | 未实现 | 超限失败保持旧库且不截断冒充完整 | [team-bots.md:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:6) |
| F122 | 私人connector shared chat应询问Allow once或对Bot或所有Team Bots允许可Clear | grant scope person plugin bot team；官方1对1差异见REPORT | 未实现 | 授权账号显示正确；Clear后重新问 | [team-bots.md:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:6) |
| F123 | 无能回答approval的人时按权限工作；团队强制AutoReview仍生效 | policy blocked明确结束不死等 | 之前审批冲突相关 | 不能无人批准无限等待或静默绕过组织规则 | [team-bots.md:6](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:6) |
| F124 | owner私聊owner电脑 同事私聊同事电脑 Slack共享对话Bot独立共享电脑 | 环境归属按conversation security scope | 目前供应商进程分配不是此隔离 | 共享Slack不能访问owner私人目录 | [team-bots.md:121](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:121) |
| F125 | Slack Bot独立App有自己的name avatar；owner发布后安装 | Slack安装控制面与个人connector分开 | 未实现 | 未批准显示Awaiting admin approval而非Connected | [team-bots.md:121](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:121) |
| F126 | Slack DM每消息回；频道先@后线程内追踪不用再@ | Slack adapter定义thread mapping 与response policy | 未实现 | 无@顶层不回；已经参与线程新回复可唤醒 | [team-bots.md:121](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:121) |
| F127 | Slack账户先连Cursor团队；非成员不回；可解除 | 身份映射与membership每次检查 | 未实现 | 解除后不能使用旧event授权 | [team-bots.md:121](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:121) |
| F128 | 使用量算提问者 routine创建者；workflow未关联消息算owner | usage attribution作为run字段 | 当前无同类账单 | 限额不转借owner；事件发起者可追溯 | [team-bots.md:121](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:121) |
| F129 | 管理员可默认推送Bot至全队/目录group；成员不可hide | required assignment和展示偏好分层 | 未实现 | 强制员工不存在移除菜单且API也限制 | [team-bots.md:121](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:121) |
| F130 | owner/admin删Team Bot移除全队聊天routine SlackApp且不可撤销 | 范围预览确认及撤外部app任务 | 未实现 | Slack卸载失败单独报告而非宣称全部删除 | [team-bots.md:121](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/team-bots.md:121) |

## Team Bot差异

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F131 | 帮助页提及隐私更严可能用单独会话电脑；不能和本地运行Bot同群 | 按运行环境兼容性验证；文档描述不一致需实测 | 未实现 | 不兼容组合有具体原因 | [cursor-help-team-bots.txt:86](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-team-bots.txt:86) |
| F132 | 帮助页个人connector在1对1也先问；与docs.x.ai描述有差异 | 采用更明确授权边界作为提案 不声称官方唯一规则 | 未实现 | 验收确认实际版本的卡片触发条件 | [cursor-help-team-bots.txt:86](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-team-bots.txt:86) |

## 企业管理

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F133 | Teams默认开放 Enterprise显式启用与group access；关闭不删电脑 | entitlement membership environment三个状态 | 未实现 | 禁用阻止新执行但数据保留 | [teams-and-enterprises.md:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/teams-and-enterprises.md:22) |
| F134 | Team Rules Connector policy CloudAgent template local执行上限 | 策略注册不把提示规则当强授权 | 未实现 | 禁插件不误以网站也已屏蔽 | [teams-and-enterprises.md:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/teams-and-enterprises.md:22) |
| F135 | Enterprise Network Setup Secrets Egress Recording EnforceReview SSO SCIM OTel Audit | 产品套餐与能力矩阵分离 | 未实现 | 入口权限后端校验不可通过隐藏绕过 | [teams-and-enterprises.md:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/teams-and-enterprises.md:22) |
| F136 | CloudAgents独立电脑与网络政策 可禁止spawn | delegation目标adapter及权限 | 已有研究员子任务不同产品 | 禁spawn时明确失败而非创建假任务 | [teams-and-enterprises.md:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/teams-and-enterprises.md:22) |
| F137 | Team Secrets最多100 单值32KB总96KB；保留运行变量名拒绝 | script secret与Bot secret分层 | 未实现 | 多团队setup不注入任何team secret | [teams-and-enterprises.md:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/teams-and-enterprises.md:22) |
| F138 | Group可放宽团队能力不收紧 多group取更宽 Ask first冲突仍胜出 | 竞品policy组合记录；Negus不盲搬权限模型 | 未实现 | 权限组合有可解释effective policy | [teams-and-enterprises.md:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/teams-and-enterprises.md:22) |
| F139 | AdminAPI管能力access network rules setup；不管理Team Secrets | 管理API复用对象ACL及审计 | 未实现 | 机密写值不提供读回端点 | [teams-and-enterprises.md:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/teams-and-enterprises.md:22) |
| F140 | Conversation Insights工作类型自动化程度分类 | 统计源run结果 非前端任务标签主事实 | 未实现 | 统计不把接单当完成 | [teams-and-enterprises.md:22](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/teams-and-enterprises.md:22) |

## 日志与数据

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F141 | ActionRecording默认关 内部90天；Audit控制面独立；OTel输出sanitized events | Negus全行为debug需求另定义：trace结构化且脱敏 | 现有日志未覆盖全链 | 一次发送能查动作/路由/后端/返回/前端呈现 | [security.md:172](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/security.md:172) |
| F142 | Conversation content及MCP IO opt-in；关闭不补历史；stdio未覆盖payload | 内容日志与metadata隔离授权 | 未实现 | 关闭内容导出仍有诊断trace且不含正文 | [security.md:172](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/security.md:172) |
| F143 | 用户Firecracker隔离 同用户共享电脑非员工安全边界 | 不同账户环境隔离；无需照搬VM技术 | 本地单用户无法宣称云多租户隔离 | 跨tenant无读写文件token通道 | [security.md:172](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/security.md:172) |
| F144 | 云电脑美国部署 不等于默认US-only承诺；不支持onprem自带image | 复刻可自托管 属Negus能力选择 | 非代码现状差距 | 不把竞品部署限制添加Negus | [security.md:172](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/security.md:172) |
| F145 | 模型Cursor选无picker 企业allowlist非保证；privacy与ZDR有例外 | Negus保留供应商模型选择：复刻体验不盲复刻限制 | 已有模型配置 | 实际请求配置snapshot可查且UI同步 | [security.md:172](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/security.md:172) |
| F146 | 保留电脑持久disk hibernate非删 日备份；删除DPA条款30天 | 定义backup restore deletion作为生命周期 | 群JSON但任务内存 | 数据删除有可验证范围不等同隐藏 | [security.md:172](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/security.md:172) |
| F147 | 外部内容标记untrusted；AutoReview网络审批隔离分层 | 第三方文档与工具结果不可变用户指令 | 现有模型runtime需核验 | 恶意网页不能改变收件人或权限 | [security.md:172](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/security.md:172) |

## 网络与部署

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F148 | 桌面egress或Enterprise TeamSetup安装私网客户端 | 三链路诊断：客户端到后端 环境到provider 环境到工具 | 现有官方访问超时属第一/研究请求链 | 日志连接阶段HTTP阶段分别记录 | [private-networks.md:77](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/private-networks.md:77) |
| F149 | TeamSetup顺序脚本Check=0跳过 起机及约日刷新 30分钟timeout失败不阻启动 | setup job有独立状态 不用普通聊天任务timeout | 未实现 | 脚本重复可安全运行且失败可回查 | [private-networks.md:77](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/private-networks.md:77) |
| F150 | Tailscale已练习模式 Cloudflare参考未等量验证；平台不管客户网络client | 网络adapter不承诺第三方服务可用 | 未实现 | 内网访问失败定位认证或路由 | [private-networks.md:77](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/private-networks.md:77) |
| F151 | Network policy四模式 动态约分钟应用 睡眠醒来应用；和CloudAgent独立 | 网络控制与插件权限分层 | 未实现 | 阻止域名与阻止插件两种检查分别测试 | [private-networks.md:77](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/private-networks.md:77) |
| F152 | 共享静态出口无专属客户IP；local egress管理员关约5分钟停止 | 能力约束如实展示 | 未实现 | 本地断连不默默宣称仍走用户出口 | [private-networks.md:77](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/private-networks.md:77) |
| F153 | 客户端API域和电脑嵌套域不同；TLS检查 buffering可破坏流式 | 连接诊断记录DNS TCP TLS HTTP SSE不同阶段 | 目前研究curl未继承系统proxy已查明 | 有API无电脑连接显示对应组件失败 | [proxies.md:37](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/proxies.md:37) |
| F154 | 需cursor.sh CDN API及双层cursorvm.com等允许并免buffer | 部署文档列实际Negushost 而非硬抄竞品域 | 手机530曾涉及代理/出口 | stream逐段到达；断流重连不重复消息 | [proxies.md:37](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/proxies.md:37) |

## 电脑管理

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F155 | 组织admin才能批量recreate terminate；team admin有限重建 | 生命周期动作权限按环境归属校验 | 未实现 | 无权操作不能通过猜userId终止 | [computers.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computers.md:8) |
| F156 | Recreate保durable安全点；Terminate停当前保disk下次启动 | 计算环境和账户禁用不同接口 | 未实现 | 终止不等于收回访问 | [computers.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computers.md:8) |
| F157 | 操作progress queued running done skipped failed可重试幂等 | 操作ledger与用户结果分开 | 未实现 | 一团队并行操作被协调；失败用户可重试 | [computers.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computers.md:8) |
| F158 | 30天inactive terminate默认关闭；DeleteVMsData独立清数据 | 仅记录竞品 不新增Negus闲置限制 | 未实施 | 产品选择前不自动清用户数据 | [computers.md:8](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/computers.md:8) |

## 身份管理

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F159 | Cursor既有SAML SSO 不单设GrokBot应用；SCIM企业自动撤成员 | 复用Negus身份层而非再造账户 | localStorage群名不是真实auth | 伪造本地memberId不可成为团队用户 | [identity-and-access.md:19](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/identity-and-access.md:19) |
| F160 | 赋应用与云Linux访问IdP应用为两层；插件OAuth不走电脑 | 错误分类按登录作用域 | 未实现 | 本机SSO成功不声称远端登录必成功 | [identity-and-access.md:19](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/identity-and-access.md:19) |
| F161 | OktaFastPass MDM不在云Linux；企业条件访问应限定平台人员 | 配置文档与诊断 不在聊天里放宽全公司规则 | 未实现 | 设备信任失败有准确责任方 | [identity-and-access.md:19](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/identity-and-access.md:19) |

## 使用量与支持

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F162 | weekly included与ondemand月限；已运行可超limit完成 | usage admission与run完成分别建模 | 无同类产品计费 | quota不足不假保存成已执行 | [cursor-help-plans.txt:47](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-plans.txt:47) |
| F163 | Cursor与SuperGrok权益不叠加；跨设备同bucket | 计量按accountId不按客户端 | 未实现 | 双设备运行不双算同run | [cursor-help-plans.txt:47](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-plans.txt:47) |
| F164 | trial按steps tokens额度且7天窗口；store trial与web不同 | 竞品商业规则只记事实 | 不新增trial限制 | 不将失败结果当自动退款承诺 | [cursor-help-plans.txt:47](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-plans.txt:47) |
| F165 | 永久SuperGrok关联不能unlink移账户 升降级最长24h更新 | 复刻不需要第三方绑定；如有需明确可逆性 | 不做同类限制 | 用户操作前知道账号归属及不可逆 | [cursor-help-plans.txt:47](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-plans.txt:47) |
| F166 | 移动订阅仅月付个人；AppStorePlay管理退订退款 | 支付adapter与账户权益分开 | 未实现 | 已有权益不要求重复购 | [cursor-help-plans.txt:47](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-plans.txt:47) |
| F167 | 删GrokBot等于删Cursor账户；agents chats computers plugins等30天移除；本机文件第三方订阅不删 | Negus删除范围用自己账户模型明确 | 未实现 | 卸载/登出/删除账户三动作不混淆 | [cursor-help-delete-account.txt:42](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-delete-account.txt:42) |
| F168 | 支持需邮箱版本platform操作截图requestID；服务状态单独status页 | 完整trace供后端debug 前端只可复制id和具体错误 | 现有错误id可复用 | 报告能对应真实版本与请求 | [cursor-help-delete-account.txt:42](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/cursor-help-delete-account.txt:42) |

## 使用场景

| ID | 官方可确认行为 | 复刻方法（提案） | Negus现状/差距 | 验收条件 | 证据 |
|---|---|---|---|---|---|
| F169 | 官方场景覆盖销售招募广告费用绩效bug客户健康chief of staff | 对应场景完整链见SPEC；不只展示营销卡 | 已有员工角色可映射 | 各场景能从入口走到证据产出或具体阻塞 | [use-cases.md:9](/Users/hans/myproject/negus/ui-feishu/research/grok-bot-2026-10-07/sources/official/use-cases.md:9) |

