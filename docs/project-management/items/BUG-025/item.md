---
id: BUG-025
title: 演示前联网与电脑操控验证
status: in_progress
---

用户要求：通过Negus发指令操控电脑；连接GitHub、Cloudflare。先验证与修复前两项，桌面绘制新功能待用户另行确认。

基线：codex/publish-current-panel / c8c7b66d686fb3a896c4c939fe6dec9bb2d8d8d4。保留现有未提交工作。

2026-10-03：本机GitHub HTTP及git ls-remote成功；Cloudflare控制台命令行返回403，API返回400，尚无浏览器登录验收。生产模型接口503：找不到新版ChatGPT内的CodexCLI程序。辅助功能、屏幕录制未授权，已请求用户完成授权。

范围：修复Codex路径发现；接入跨渠道复用的Negus电脑工具；验证会话权限及真实调用；通过既有发布流程加载并验收。非目标：修改桌面业务组件或未经指示更改远程服务资源。

进展：用户完成授权，LaunchServices启动身份两项权限true。主渠道和折扣渠道实际模型调用Negus MCP并读取GitHub API成功；Cloudflare CLI已认证、隧道4连接；GitHub推送仍缺凭据。自动化37通过/1平台跳过，完整前端构建及隔离预检通过。屏幕操作效果尚未确认，已请求用户暂停桌面操作以免互相干扰；不声称端到端演示完成。

2026-10-03补充：用户明确要求自动锁屏后后台任务继续运行。Mac电源设置sleep=0，显示器休眠10分钟；不将锁屏等同系统休眠。正式会话发现MCP子进程过滤安装目录环境变量，导致快照中找不到组件，已通过MCP env显式传递修复；修复候选版本真实模型已完成permissions/read_url/screenshot。锁屏时截图曾超时，增加锁屏明确错误，尚未实现或验收锁屏桌面操控。

Codex原生cua_repl首次getState实测可列应用，但浏览器清单失败：Codex auth token is unavailable。未绕过认证。后台浏览器与可见桌面的点击输入尚未验收。当前系统7892代理无监听，GitHub网页直连超时但API成功；Cloudflare CLI凭据及隧道有效，不等于浏览器控制台可用。


2026-10-03进度快照：正式版本1790959880810-8092ecde已通过权限、截图与GitHub API检查。自建输入工具实测返回成功但页面没有文字；本机原生工具已完成输入、点击和页面回执，独立渠道原生MCP复用已加入源码，但仍有调用兼容错误，尚未发布或完成正式验收。代理曾因lsof无输出被误判未监听，后续真实代理请求及netstat证实可用；GitHub网页经代理HTTP200。详细过程见docs/negus-knowledge/records/NEGUS_DEMO_PROGRESS_2026-10-03.md。

用户要求先推送一版GitHub，按当前项目源码保存进度快照，包含此前工作区已有修改，排除work临时资料与runtime。前端TypeScript检查及Vite构建成功；本次相关测试28通过。扩大到windows/tests全部测试：354项，343通过、10失败、1跳过；失败集中在会话/群聊加载测试的data URL相对导入，以及heartbeat-message测试缺依赖。此快照不标记为稳定发布或电脑操控验收完成。

## 2026-11-10 Cloudflare 官方账号连接

来源：本次 Codex 对话。用户原话：“我的需求是后续我通过公网访问negus，也能在服务器端连接到cloudflare帮我管理”；“请你帮我开发好相关功能，我作为用户来体验一下，怎么用negus接入我的cloudflare”“最小代码改动快速敏捷开发好”。

有效决定：设置中提供官方 Cloudflare OAuth 连接；账号归当前 Negus 工作空间，在服务器独立保存和刷新凭据，普通对话、员工及模型渠道共用。连接能力与供应商 CODEX_HOME 分离。先完成连接、断开、连接测试与助手工具调用；后续域名统计展示复用连接，本次不新增数据面板或插件市场。当前 Negus 是单工作空间访问令牌模型，本次不引入多用户账户系统。连接不是对任意远程资源修改的授权。保留原 Wrangler 与提供方内手工 Cloudflare 授权，不复制其凭据。

交互：设置 → 账号连接 → 连接 Cloudflare → 在 Cloudflare 官方页面登录、选择权限和账号 → 回到 Negus。公网回调绑定启动授权的浏览器，PKCE、10分钟有效期及一次性 state；只接受配置中的公网域名或本机地址，凭据不返回页面/模型。断开删除 Negus 本地凭据，Cloudflare 侧撤销授权可在其控制台完成。工具每次读取共享连接，连接或断开不要求用户重建对话。

实现范围：`windows/server/connections/cloudflare*.mjs`、`routes/connection-routes.mjs`、`app-server-client.mjs`、单聊和员工共用提示词、设置页。基线 develop / 340baaaadc9a0a6bec28047ad565d55bd38228ec。预计业务新增250～400行，修改15～25行，另加回归测试及SDK依赖。发布和验证证据见 updates.md。
