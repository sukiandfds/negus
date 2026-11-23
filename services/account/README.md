# Negus 独立账号
入口为 https://auth.negus.us.ci 。服务只管理账号，不签发主机令牌，也不读取对话。旧版 Negus 无需重启。

生产环境使用独立 D1 数据库 negus-account；新环境初始化时执行 migrations/0001.sql。不要对已有用户、会话表重复初始化。Google Cloud 中选择“Web 应用”，授权重定向 URI 填 https://auth.negus.us.ci/api/auth/callback/google 。发信方需验证 auth.negus.us.ci 后使用 login@auth.negus.us.ci 发信。

Worker 私密配置：BETTER_AUTH_SECRET（随机生成，至少 32 字节，长期保留）、GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、RESEND_API_KEY（仅授予该发信域发送权限）。密钥只通过 Cloudflare 私密配置输入，不写入仓库或聊天。

本地测试：在本目录执行 npm ci --legacy-peer-deps 和 npm test。用本地 SQLite、测试收件箱和独立浏览器会话验证注册、重复验证码拒绝、跨设备身份、账号隔离、退出，以及 Google 授权地址。生产验收另用真实邮箱收码，关联 Google 后退出，在另一台设备通过 Google 登录并核对同一账号。
