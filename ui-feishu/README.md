# Negus飞书布局：独立聊天界面

2026-10-06，FEAT-001 / FEAT-002界面增量。基线：`codex/publish-current-panel` / `427a708fa85f4564822caeac97c6601bd97b4745`。

用户要求：原有文件不改；新增飞书风格布局；接入现有真实对话与功能；逻辑保持一致。最新增量为“添加→创建群聊”及“全部”列表的置顶／取消置顶。

## 结构与复用

- `src/FeishuApp.tsx`只负责共享数据、导航和页面组合；`src/components/`中的`AppRail`、`ConversationList`、`ChatWorkspace`、`ConversationDetails`分别负责四个界面区域，`Avatar`供多个区域复用。
- `src/types.ts`从原有Hooks推导类型；`src/presentation.ts`集中头像颜色和时间展示。
- 新代码、样式、配置和构建产物均位于本目录。原组件、Hooks、接口客户端只读导入。
- 左侧为功能导航，中间为“全部／员工／项目”三个对话视图。全部按对话更新时间排序并去重；员工行仍直接进入主聊天，右侧箭头展开外派对话；项目箭头展开已有项目对话。右侧为共用聊天、输入框和详情。
- 单聊执行直接使用`useProjectConversations`、`ConversationView`、`ConversationComposer`，复用原发送、附件、流式回复、上下文、模型、Goal、队列、停止、复制、编辑、分叉和运行时提问能力。
- 员工入口复用`openAgentConversation`；普通会话更多菜单使用本目录的`ConversationActions`适配原菜单并增加置顶，原重命名、分享、复制和归档行为保留；设置、用量和员工详情复用既有组件。任务入口复用`useCurrentTasks`的运行与Goal判断、既有定期任务接口及周期格式化，点击仍进入同一份聊天。
- `ConversationRows`是员工、项目、全部及任务共用的列表／展开组件；`buildConversationDirectory`和`buildTaskSections`集中映射既有数据。展开或切换分类不卸载聊天输入框，也不创建执行任务。
- 文件页从当前已加载消息的真实内容块展示附件，当前未提供全历史文件索引。
- “添加”通过共用`DropdownMenu`提供新建对话和创建群聊。创建时填写名称、选择已有项目与员工，成功后直接进入真实群聊；群聊进入全部和对应项目展开列表，按更新时间排序。
- 群聊工作区复用`useGroupRoom`、`MessageTimeline`、`GroupComposer`等原有组件；消息存储、点名员工、模型执行和事件流复用原后端。首次进入沿用原成员名称填写流程。
- `usePinnedConversations`复用原本地缓存工具；员工、单聊、群聊共享置顶逻辑。置顶保存于当前浏览器，刷新保留，不跨设备同步。
- 云文档、日历等未接入入口保留样式，并禁用操作；工作台暂不接入新布局。
- 项目总群聊未开发，项目无已绑定主聊天时点击只提示展开已有对话，不把任意子对话当成总群聊。仅依据明确项目绑定归属对话，不按员工身份猜测项目。

## 启动

无需安装新依赖，沿用`web-ui/node_modules`：

```sh
cd ui-feishu
node ../web-ui/node_modules/vite/bin/vite.js --config vite.config.ts
```

本机入口：`http://127.0.0.1:5180/`。没有链接有效期。

默认连接用户此前查看的49974体验后端，它有真实持久化会话与模型执行，并非示例内容。公网入口也连接此后端，直接提供本目录构建的界面，保留原有接口认证。

群聊创建需要先运行本目录的隔离后端启动器（Node 24，49974须空闲）：

```sh
node ../web-ui/node_modules/vite/bin/vite.js build --config vite.config.ts
node server/launch-preview.mjs
```

`employees/negus-assistant/employee.json`定义新增的通用员工“negus助手”。启动器将本目录的员工配置同步至隔离环境，沿用原员工加载器、身份、主对话及模型设置逻辑。当前员工配置在启动时读取，没有用户自行创建员工的表单、创建接口或热加载能力；开发者添加配置后需重启对应后端。本次不改变正式环境员工目录。

`server/group-extension.mjs`提供可注入的创建与持久化能力，复用原房间目录、存储和执行服务。`server/register.mjs`只在模块加载时接入现有后端，不写原文件；接入位置变化会明确报错。群聊数据保存在本目录的`runtime/groups/`，启动器沿用此前隔离验证环境，可用 `NEGUS_UI_STATE_ROOT` 指定已有运行目录。日志可能包含访问凭据，不应公开。

`server/execution-policy.mjs`统一单聊、员工、群聊、外派任务的直接执行策略，新建与恢复对话均应用相同配置。员工无需单独确认修改权限。公网发布使用49974的静态构建与原有访问凭据，不能将附加内部认证的5180开发代理直接暴露到公网。

Vite仅监听本机，读取既有后端访问凭据，为API代理附加认证。凭据不写入新UI源码、不传入客户端构建、不放在浏览器地址中。

切换后端时可指定`NEGUS_UI_BACKEND`及`NEGUS_UI_TOKEN_FILE`，必须成对匹配对应后端。本界面不管理或更改供应商配置。

## 验证

类型检查与独立构建：

```sh
node ../web-ui/node_modules/typescript/bin/tsc -p tsconfig.json
node ../web-ui/node_modules/vite/bin/vite.js build --config vite.config.ts
node validation/directory-check.mjs
node --test validation/group-extension.test.mjs
```

实际浏览器验证结果及限制见[验证记录](validation/RESULTS.md)。正式产品文件与功能验收状态未更新；本轮不表示全站功能已迁移或原后端缺陷已修复。

## 移动端与原项目

手机端复用同一导航组件显示底部消息、工作伙伴、任务和设置；聊天独占屏幕，输入区按可视窗口与安全区适配。

`server/existing-projects.mjs`从原安装目录的项目索引接入已有项目，复用原生会话、供应商路由与历史读取服务。原记录不搬迁、不重建；同一会话在当前与原环境同时出现时优先当前环境，读取、回复、重命名、归档、分叉继续由对应会话服务处理。原供应商的可用性仍由其实际配置决定。
