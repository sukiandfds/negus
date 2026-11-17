
## 2026-11-10 Cloudflare 账号连接开发与预检

- 基线 `develop / 340baaaadc9a0a6bec28047ad565d55bd38228ec`。业务代码实际 +245/-6 行，测试 +111 行；增加与现有 MCP Server 同版本的 Client SDK 及锁文件。复用设置样式，不新增插件框架或 Cloudflare 数据面板。
- 设置 → 账号连接提供 Cloudflare 官方 OAuth、测试、断开。服务器端独立持久化，SDK处理发现、动态客户端注册、PKCE及刷新；共享锁串行刷新，跨模型统一注入 `negus_cloudflare`，普通对话与员工提示词统一接入。工具每次读取连接，后续授权/断开不必重启对话。
- 24项定向检查：23通过、1个Windows专用测试跳过；覆盖浏览器绑定、state/过期/取消/重放、凭据文件0600及不返回密钥、刷新轮换、断开及真实stdio工具发现。实际Codex app-server返回 `call/discover/status` 三个工具。
- 官方OAuth真实注册预检返回公网回调 `https://codex.negus.us.ci/integrations/cloudflare/callback` 及S256。桌面、390px手机浏览器通过：设置页无横向溢出、未认证API 401、点击连接后真实OAuth启动200及正确本机回调；未代用户批准授权，未查询或修改其Cloudflare业务资源。截图：`work/cloudflare-connection/settings-desktop.png`、`settings-mobile.png`。
- TypeScript、Vite及候选快照隔离API/页面/版本检查通过；最终候选 `1794318966433-94591791`，回退 `1794315428906-b7c015d6`。部署结果以同次重启任务和运行状态为准。用户首次在设置中完成官方授权后，再使用“测试连接”和对话查询验收实际账号权限。

发布结果：受控任务 `1794319038852-39586` 一次启动成功，运行快照 `1794318966433-94591791`，前后端均 healthy。使用独立 Chrome 浏览器通过真实公网访问账号连接页：页面HTTP200、账号连接标题及按钮可见、已认证连接API HTTP200，状态为未连接。截图 `work/cloudflare-connection/settings-public.png`。等待用户在官方页面自行完成首次账号及权限授权；未代替用户批准OAuth。
