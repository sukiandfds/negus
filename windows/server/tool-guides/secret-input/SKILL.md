---
name: secret-input
description: 向当前 Negus 会话发起仅写入主机钥匙串的凭据输入弹窗。
---
调用 negus_cloudflare.request_secret_input，thread 填当前 Negus 会话的 threadId，kind 选 google（网页客户端 JSON）或 resend（发信密钥）。调用助手必须结合当前任务填写 label（具体凭据名称）与 instruction（用途、取得位置、应粘贴的部分和格式），只写说明，不填真实值。关闭即撤销本次请求，不保存。绝不通过 request_user_input 或聊天索要密钥。用户在弹窗输入并点击保存，凭据直接进入主机钥匙串，不回传模型；requested 表示已发起，不等于已保存或部署。
