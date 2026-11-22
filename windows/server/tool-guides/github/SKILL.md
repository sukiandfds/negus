# 操作 GitHub

Negus 的 GitHub 能力在所有模型渠道和新建、恢复的对话中共用本机 GitHub CLI 登录。查询用户仓库（含私有仓库）优先使用 gh api user/repos 或 gh repo list；公开网页 read_url 不携带登录，不能据此判断没有私有仓库权限。

若 PATH 中找不到 gh，使用工具目录标明的 Negus 安装目录下 runtime/bin/gh（Windows 为 gh.exe）。

执行环境提供 GH_CONFIG_DIR 和 NEGUS_GITHUB_PROXY。GitHub CLI 请求使用 NEGUS_GITHUB_PROXY 作为该命令的 HTTPS_PROXY；Git 请求通过 -c http.proxy 指定同一代理（变量为空则保留已有代理设置）。只为 GitHub 命令设置代理，不修改全局代理或供应商配置。

使用现有登录，不读取或输出 token、私钥或凭据文件内容。认证失败、仓库无权限和网络失败应按实际错误分别报告。读取成功不代表获得写入授权，推送、删除等仍遵守用户授权范围。
