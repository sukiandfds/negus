# Negus飞书布局：独立聊天界面

2026-10-06，FEAT-001 / FEAT-002界面增量。基线：`codex/publish-current-panel` / `427a708fa85f4564822caeac97c6601bd97b4745`。

用户要求：以飞书风格布局作为唯一前端入口；接入现有真实对话与功能；旧页面中仍需要的功能收进设置页；逻辑保持一致。

## 结构与复用

- `src/FeishuApp.tsx`只负责共享数据、导航和页面组合；`src/components/`中的`AppRail`、`ConversationList`、`ChatWorkspace`、`ConversationDetails`分别负责四个界面区域，`Avatar`供多个区域复用。
- `src/types.ts`从原有Hooks推导类型；`src/presentation.ts`集中头像颜色和时间展示。
- 新页面、样式、配置和构建产物均位于本目录。旧功能中仍被使用的组件收在`shared/`，只保留当前页面和设置页的实际依赖。
- 左侧为功能导航，中间为“全部／员工／项目”三个对话视图。全部按对话更新时间排序并去重；员工行仍直接进入主聊天，右侧箭头展开外派对话；项目箭头展开已有项目对话。右侧为共用聊天、输入框和详情。
- 单聊执行直接使用`useProjectConversations`、`ConversationView`、`ConversationComposer`，复用原发送、附件、流式回复、上下文、模型、Goal、队列、停止、复制、编辑、分叉和运行时提问能力。
- 员工入口复用`openAgentConversation`；普通会话更多菜单使用本目录的`ConversationActions`适配原菜单并增加置顶，原重命名、分享、复制和归档行为保留；设置、用量和员工详情复用既有组件。任务入口复用`useCurrentTasks`的运行与Goal判断、既有定期任务接口及周期格式化，点击仍进入同一份聊天。
- `ConversationRows`是员工、项目、全部及任务共用的列表／展开组件；`buildConversationDirectory`和`buildTaskSections`集中映射既有数据。展开或切换分类不卸载聊天输入框，也不创建执行任务。
- 文件页从当前已加载消息的真实内容块展示附件，当前未提供全历史文件索引。
- “添加”通过共用`DropdownMenu`提供新建对话和创建群聊。创建时填写名称、选择已有项目与员工，成功后直接进入真实群聊；群聊进入全部和对应项目展开列表，按更新时间排序。
- 群聊工作区复用`useGroupRoom`、`MessageTimeline`、`GroupComposer`等原有组件；消息存储、点名员工、模型执行和事件流复用原后端。首次进入沿用原成员名称填写流程。
- `usePinnedConversations`复用原本地缓存工具；员工、单聊、群聊共享置顶逻辑。置顶保存于当前浏览器，刷新保留，不跨设备同步。
- 云文档、日历等未接入入口保留样式，并禁用操作；工作台、项目进度、项目管理、设备状态和更新入口从设置页进入。
- 项目总群聊未开发，项目无已绑定主聊天时点击只提示展开已有对话，不把任意子对话当成总群聊。仅依据明确项目绑定归属对话，不按员工身份猜测项目。

## 启动

正式入口统一使用仓库根目录的受控服务，读取主线 `runtime/access-token`、项目数据和 `ui-feishu/dist`：

```sh
node scripts/negus.mjs start
node scripts/negus-watchdog.mjs check
```

已有服务更新使用 `node scripts/negus-supervisor.mjs restart`，不再提供独立体验后端启动器。公网入口为 `https://codex.negus.us.ci/`，本机后端默认端口为 49974，以 `runtime/negus-web-demo.json` 为准。

开发界面可在仓库根目录运行：

```sh
node ui-feishu/node_modules/vite/bin/vite.js --config ui-feishu/vite.config.ts
```

开发入口仅监听 `http://127.0.0.1:5180/`，默认代理到同一主线后端，使用主线凭据。

根目录 `employees/` 是唯一员工配置来源。员工配置在启动时读取，修改后通过受控重启生效。

`server/group-extension.mjs` 复用房间目录、存储和执行服务，`server/register.mjs` 接入主线后端。日志可能包含访问凭据，不应公开。

`server/execution-policy.mjs`统一单聊、员工、群聊、外派任务的直接执行策略，新建与恢复对话均应用相同配置。员工无需单独确认修改权限。公网发布使用49974的静态构建与原有访问凭据，不能将附加内部认证的5180开发代理直接暴露到公网。

`server/employee-provider-integration.mjs`让员工主对话支持切换供应商，复用供应商服务的原生记录复制能力，保留 Thread、对话编号与全部历史；成功恢复后才保存新配置，失败继续使用原配置。思考强度单独修改不会改变供应商，切换与发送按顺序执行；过期的忙碌状态会核对原生任务状态。回归测试：`node --test validation/employee-provider.test.mjs`。

Vite仅监听本机，读取既有后端访问凭据，为API代理附加认证。凭据不写入新UI源码、不传入客户端构建、不放在浏览器地址中。

切换后端时可指定`NEGUS_UI_BACKEND`及`NEGUS_UI_TOKEN_FILE`，必须成对匹配对应后端。本界面不管理或更改供应商配置。

## 验证

类型检查与独立构建：

```sh
node ../ui-feishu/node_modules/typescript/bin/tsc -p tsconfig.json
node ../ui-feishu/node_modules/vite/bin/vite.js build --config vite.config.ts
node validation/directory-check.mjs
node --test validation/group-extension.test.mjs
```

实际浏览器验证结果及限制见[验证记录](../docs/negus-knowledge/records/RESULTS.md)。各项功能是否通过验收以对应记录为准。

## 移动端与原项目

手机端复用同一导航组件显示底部消息、工作伙伴、任务和设置；聊天独占屏幕，输入区按可视窗口与安全区适配。

`server/existing-projects.mjs`从原安装目录的项目索引接入已有项目，复用原生会话、供应商路由与历史读取服务。原记录不搬迁、不重建；同一会话在当前与原环境同时出现时优先当前环境，读取、回复、重命名、归档、分叉继续由对应会话服务处理。原供应商的可用性仍由其实际配置决定。
