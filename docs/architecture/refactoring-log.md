# Negus 代码精简与架构记录

这份记录按功能模块维护。每次重构先写清楚用户操作链和现有目的，再记录风险判断、改动入口和快速验证结果。后续修改优先从“新入口”进入，旧入口只有在兼容外部客户端时才保留。

## 2026-10-13：共享请求与浏览器存储基础设施

### 用户操作链

- 用户打开 Negus、切换对话/项目/群聊、刷新页面或提交设置时，界面通过 `/api/*` 读取或写入 JSON。
- 用户在同一浏览器再次打开页面时，界面先显示本地缓存，再用服务端结果刷新；缓存不可用时仍应走网络请求。
- 用户展开项目状态、桌面组件、当前任务或项目管理详情后，刷新页面应保留可恢复的视图状态。

### 原有逻辑与风险

- `shared/api/http.ts` 中 GET、POST、PATCH、DELETE 各自重复构造请求、解析 JSON 和处理错误。改动风险集中在 GET 的内容类型提示、401/404 中文提示，以及各写请求的失败文案。
- `shared/state/localCache.ts` 已提供 localStorage 缓存，但项目管理和项目状态各自直接操作 sessionStorage/localStorage。直接替换会影响旧键迁移、缓存过期策略和私密浏览模式。

### 本次改动

- 把请求方法收敛到一个带方法和错误文案的通用 JSON 请求器，保留原公开函数作为稳定调用入口。
- 新增安全存储小组件，统一 JSON 读写、坏数据处理和存储不可用时的行为；localCache、项目管理缓存、项目状态缓存共用它。
- 项目状态的展开项仍使用独立键，项目管理仍使用 sessionStorage 和 30 秒 TTL；只抽掉重复的容错读写代码。

### 后续入口

- 网络请求：`web-ui/src/shared/api/http.ts`。
- localStorage 缓存：`web-ui/src/shared/state/localCache.ts`。
- 通用存储读写：`web-ui/src/shared/state/storage.ts`。
- 项目管理缓存：`web-ui/src/features/project-management/data/projectManagementApi.ts`。
- 项目状态缓存：`web-ui/src/features/project-status/ProjectStatusControl.tsx`。

### 验证

- 修改完成后执行 web-ui TypeScript/Vite 构建；服务端只执行受影响的单元测试和模块语法检查。

## 2026-10-13：会话创建旧弹窗

### 用户操作链

- 当前用户点击“新建对话”后，Feishu 界面直接建立延迟会话，标准界面由 `App.tsx` 控制模型和项目参数。

### 原有逻辑与风险

- `NewConversationDialog` 只存在于源码目录，没有任何入口、动态导入或路由引用；它的模型筛选逻辑已经被当前 `openNewSession` 流程取代。
- 删除风险为低：删除的是不可达组件和配套样式，不改变任何实际入口。

### 本次改动

- 删除未被引用的 `NewConversationDialog.tsx` 及其 CSS，避免后续维护者误以为存在第二套新建对话流程。

## 2026-10-13：会话加载选项清理

### 用户操作链

- 用户打开、切换、预加载或恢复一个对话时，界面读取会话内容；网络失败时显示同步错误并按原策略重试。

### 原有逻辑与风险

- `useConversationSession` 和目录层在多个调用点传递 `quiet`，但加载函数从未读取它；它不会改变 loading、错误、重试或渲染状态，属于已经失效的参数。
- 同时删除参数会影响十余个调用点的类型契约，因此先全局搜索并同步收敛接口，避免留下“看似支持、实际无效”的分支。

### 本次改动

- 从加载选项、选择接口和全部调用点移除 `quiet`。
- `adoptSelection` 改为只接受会话 id；加载行为由实际缓存和恢复状态决定，用户看到的加载/错误/重试流程保持不变。
- 删除目录初始化中未使用的 `hasCachedSession` 局部变量。

## 2026-10-13：服务端 JSON 持久化与浏览器缓存统一

### 用户操作链

- 用户发送消息、切换模型、加入群聊、提交员工成长建议、生成图片或打开后台任务时，服务端会把状态写入 `runtime`，服务重启后继续显示可恢复结果。
- 用户切换群聊、项目状态、用量面板或效率筛选时，页面会读写浏览器缓存，缓存损坏或被浏览器禁用时仍继续使用在线数据。

### 原有逻辑与风险

- 多个服务各自实现 JSON 读取、临时文件命名、目录创建、写入和重命名；其中群聊状态直接覆盖目标文件，异常中断时可能留下半写状态。
- 多个 UI 数据模块各自 `try/catch + JSON.parse + localStorage.setItem`，行为相近但坏数据和私密浏览器的处理不一致。
- `runtime` 文件是持久状态边界，不能改变版本号、字段形状、缺失文件行为或原有写入串行化。

### 本次改动

- 新增 `windows/server/persistence/json-file.mjs`，统一 JSON 读写、原子临时文件替换和 JSON 深拷贝；已迁移员工成长、项目身份、员工会话、群聊、后台任务、图片任务、提交记录、交付物、会话版本和模型默认配置。
- 保留各服务自己的版本校验、队列、错误提示和字段过滤，只抽出文件边界代码。
- 新增 `web-ui/src/shared/state/storage.ts`，统一 localStorage/sessionStorage 的安全读、校验、写入；会话快照、群聊快照、群成员、项目管理、项目状态、用量和效率筛选共用它。
- 删除 `App.tsx` 中只写入却从未读取的 `negus:last-surface`，路由参数才是当前页面表面的真实来源。

### 验证结果

- web-ui 与 ui-feishu TypeScript 编译通过，Node 语法检查通过。
- 受影响服务测试 67 项中 65 项通过；2 项失败都来自当前分支既有员工定义数量与测试固定期望不一致（`negus-assistant` 额外存在），失败断言发生在测试夹具计数，不在本次持久化改动路径。

## 2026-10-13：群聊输入组件与 Feishu 文案配置

### 用户操作链

- 用户进入标准群聊或 Feishu 群聊，在输入框键入消息、输入 `@` 点名、点击能力菜单、上传附件、引用消息或停止任务；界面显示点名顺序、任务状态和上下文说明，然后把同一份消息提交给群聊服务。
- 用户在 Feishu 界面看到的是更符合该产品的发送、点名和停止文案，但按钮位置、快捷键、附件处理、提交和中断行为应与标准群聊一致。

### 原有逻辑与风险

- 两个界面实际复用同一个 `GroupComposer`，但 Feishu 构建插件通过替换源码中的中文字符串改变文案。标准文案一旦调整、换行或抽取，插件就会直接抛错导致 Feishu 无法构建。
- 这种替换还会把同一字符串的多个语义混在一起，例如“停止当前任务”同时用于能力菜单、停止按钮和无障碍标签；继续增加文案会扩大误替换风险。

### 本次改动

- `GroupComposer` 新增可选的 `copy` 配置和默认文案，所有行为、输入状态、菜单和样式仍只有一份实现。
- Feishu 只传入少量产品文案定制（占位提示、点名提示、上下文说明、停止文案），删除 Vite 源码字符串替换插件。
- 顺便把停止能力菜单项、停止按钮、忙碌点名提示和顺序提示改为配置驱动，后续产品文案修改只需改对应界面的配置对象。
- 删除 `GroupComposer` 从未读取的 `members` 入参；成员资料仍由消息时间线和成员资料面板使用，输入框只需要可点名的员工列表。

### 后续入口

- 共用行为与默认文案：`web-ui/src/features/group-chat/components/GroupComposer.tsx`。
- Feishu 产品文案：`ui-feishu/src/components/GroupWorkspace.tsx` 顶部的 `feishuGroupComposerCopy`。
- Feishu 构建插件配置：`ui-feishu/vite.config.ts`，不再负责改写组件源码。

### 验证结果

- web-ui 和 ui-feishu TypeScript 编译通过。
- ui-feishu 生产构建通过；之前因旧字符串不存在而失败的 `negus-group-composer-copy` 集成点已移除。

## 2026-10-13：剩余服务端文件持久化边界收敛

### 用户操作链

- 用户发送普通对话、切换模型、恢复任务、打开自动标题、生成项目页面草稿或员工成长建议时，服务端把路由、执行状态、标题和草稿写入 `runtime` 文件；重启后再次打开页面仍能恢复这些状态。

### 原有逻辑与风险

- 执行追踪、模型路由、项目页面草稿、自动标题和员工成长写文件各自实现临时文件、目录创建和重命名，行为相同但临时文件清理和异常中断处理不一致。
- 模型路由仍需要自己的串行写入；执行状态仍需要重启归一化；页面草稿仍需要损坏文件回退为空数组；这些业务语义不能被通用层吞掉。

### 本次改动

- 扩展 `windows/server/persistence/json-file.mjs`，提供通用文本原子写入，并让 JSON 原子写入复用它，统一临时文件清理。
- 执行追踪、模型路由、项目页面草稿、自动标题改用通用 JSON 原子写入；员工成长将 `AGENTS.md` 和 Skill 文件写入改用通用文本原子写入。
- 保留每个模块原有的版本字段、串行队列、损坏文件回退、权限和错误处理边界；模型路由继续使用紧凑 JSON，其他 JSON 文件继续保留原来的两空格和换行格式。

### 后续入口

- 文件读写组件：`windows/server/persistence/json-file.mjs`。
- 执行状态：`windows/server/execution-tracker.mjs`。
- 模型路由：`windows/server/provider-conversation-store.mjs`。
- 页面草稿：`windows/server/project-management-store.mjs`。
- 自动标题：`windows/server/app-server-conversation-store.mjs`。
- 员工成长文件写入：`windows/server/employee-growth-service.mjs`。

### 补充：对话转发回执

- 用户从一个对话点击转发到另一个对话时，服务端先生成只读历史 Markdown，再写入带请求编号的 JSON 回执，重复请求需要复用这份回执，避免重复发送。
- `conversation-forward-service.mjs` 原来另外维护一套临时文件写入和 JSON 解析；现改用同一持久化组件，继续保留请求编号去重、600 权限和中断后回执检查。
- 维护入口：`windows/server/conversation-forward-service.mjs` 的 `prepare` 与 `forward`；文件边界统一从 `windows/server/persistence/json-file.mjs` 进入。

## 2026-10-13：执行终态协议去重

### 用户操作链

- 用户发送对话指令或在群聊中点名员工后，页面接收执行中、完成、失败或中断状态；任务结束后输入框、状态栏和群聊时间线都要停止显示运行中状态。

### 原有逻辑与风险

- 普通执行追踪和多 Agent 状态分别维护 `completed`、`failed`、`interrupted`、`systemError` 等终态集合。新增终态时两处容易漂移，页面可能出现一边认为已结束、另一边仍认为可继续流式更新的情况。
- 终态集合属于协议约束，不能借重构改变事件名称或客户端可见状态。

### 本次改动

- 新增 `windows/server/execution/protocol.mjs` 作为终态集合唯一来源。
- `execution/activity.mjs` 与 `multi-agent/protocol-state.mjs` 共用这份协议，保留原事件名称、终止判断和广播格式。

### 后续入口

- 修改执行终态时先改 `windows/server/execution/protocol.mjs`，再检查普通执行和多 Agent 两条状态链。

## 当前验证记录

- web-ui 与 ui-feishu TypeScript 编译、双前端生产构建、受影响 Node 模块语法检查和 `git diff --check` 均通过。
- 本轮针对执行追踪、模型路由、项目管理、对话转发和员工成长运行 43 项测试，41 项通过；2 项仍是当前分支已有的员工定义数量断言（实际多出 `negus-assistant`），不涉及本轮修改路径。
- 已按 `windows/server/AGENTS.md` 调用 supervisor 受控重启。作业完成后 supervisor 报告 `Backend health/ownership uncertain; production was not stopped.`，因此当前服务未被强制停止，待 supervisor 环境恢复后再重试受控重启。
