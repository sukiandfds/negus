# BUG-GROK-THREAD-PERMISSIONS

2026-09-22 02:24 +08:00。基线 651e86c9471e09bd79bbec1260f02d08750406a3。

用户明确要求为最近报无权限的 Grok 会话开放所有执行权限。定位到 Grok 4.7 会话 01a0c51a-152c-7d63-8515-296dd18bb214，其回复报告只读且禁止审批。

新增本机 runtime/thread-permissions.json 按 Thread 授权，原项目归属校验仍保留。指定会话 resume 使用 danger-full-access / never，turn 使用 dangerFullAccess / never，允许文件、命令及网络执行；其他会话不变，不修改 Windows 管理员身份。读取配置失败不忽略异常。服务加载代码后，下次发送生效，不自动发送模型消息。
