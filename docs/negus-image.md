# Negus Image 助手使用说明（Windows MCP）

用户描述画面即可。纯文字用 generate_image，有参考图用 edit_image。保留用户原意和参考图顺序。每次调用前客户端用生图密钥向 /v1/models 查询可见 GPT Image 系列。默认配置使用最新候选，同代优先 Flare。明确指定的模型或已设置的专用配置优先。

- 查询模型和价格：list_image_models({"pricing":true})。价格来自面板账户，按 enable_groups 和 billing_mode 阅读。tiered_expr 查看 billing_expr，model_price 为 0 不等于免费。缺少面板令牌时仍可列模型。
- 快速初稿：generate_image({"prompt":"窗边翻阅稿件的成年女性","size":"3:4","quality":"medium"})。
- 精修：edit_image({"prompt":"保留图一的人物，按图二的机位拍摄","model":"gpt-image-2.6-sunburst","complexity":"low","image_paths":["D:/refs/person.png","D:/refs/scene.jpg"],"aspect_source_image_index":2})。先确认模型在目录中。complexity 用于 2.6；low 的实际耗时受服务端负载影响。
- 可选 resolution 为 1K、2K、4K。可指定 size 或用一开始计数的参考序号继承比例。局部编辑用 mask_path（PNG），多张输出用 n（供应商文档上限 10）。读返回的 model 和 outputs 确认实际结果。SVG、GIF、视频、异步任务未作为本 MCP 的输出选项。
- 安装依赖沿用仓库原方式。Windows MCP 入口为 windows/server/image-generation/mcp-server.mjs。更新后重新加载 MCP，通过 tools/list 核实三个工具。设置中选流光绘境或使用已有 NEGUS_IMAGE_API_KEY 配置。

## 面板令牌跨机备份

本机 Windows 用户加密存储位置为 %LOCALAPPDATA%/NegusImage/panel-token.xml。它与生图密钥独立。准备 GitHub CLI（已登录并有 gist 权限）和 Git for Windows 的 GnuPG。在交互式 PowerShell 运行：

    .\tools\negus-panel-backup.ps1 -Mode Backup

GnuPG 会询问备份口令。脚本只上传 ASCII 加密文件到 GitHub secret Gist 并显示地址。可从 gh gist list 找回。Secret Gist 持链接可读，保护依靠备份口令。另一台 Windows 机器登录同一 GitHub 账号后运行：

    .\tools\negus-panel-backup.ps1 -Mode Restore -GistId <Gist地址末尾的ID>

输入同一备份口令后，令牌写入当前 Windows 用户的加密存储。有效期和权限沿用供应商设置。
