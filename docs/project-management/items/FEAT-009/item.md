---
id: FEAT-009
type: feature
title: 原开发电脑远程运行、开发与应急恢复
category: development
priority: P5
status: handoff_pending
updated_at: 2026-09-30 09:02 +08:00
source: docs/feature-development/features/FEAT-009-remote-development-host.md
related: [FEAT-001, FEAT-006]
---

# 原开发电脑远程运行、开发与应急恢复

## 用户原话

2026-09-30 原话：

> 我需要一个 mac 或者 codex 上的定时检查 negus 的项目，如果发现不在了就进行重启。因此还需要一个重启脚本，需要时用脚本重启，避免 negus 因为重启把自己弄断了。请你理解我的意思，先弄个脚本，就是有完整的检查，启动，恢复机制的脚本。有时我远程操控 negus 更新功能也需要我和 negus 对话后，让 negus 运行重启脚本。区分好前后端。分别有重启脚本。

更早的原始对话未保存，不倒推补写。

## 助手初步理解

Mac 独立检查退出并恢复；前端只发布页面，后端等当前任务收口，由外部 Worker 重启并验证。

## 简短摘要

让项目服务在原开发电脑上可远程检查、启动和应急恢复。

## 具体内容

使用场景：用户在外部网络使用项目时，本机服务停止或需要继续开发。

当前体验：Mac 正常部署启动已接入自动安装每 3 小时检查；脚本及用户级定时检查已完成，旧后端尚未加载安全收口接口，正式重启体验待验证。

交互变化：沿用命令入口，不增加页面；脚本输出 scheduled 与最终结果分开。

## 预计效果

用户能知道电脑、项目服务和 Codex 任务分别是否正常；项目服务异常时有明确的恢复路径。

## 关联条目

`FEAT-001`、`FEAT-006`

## 当前状态

handoff_pending；定向测试、隔离构建和真实只读检查通过。正式首次加载及浏览器恢复未验收。

## 当前证据

- `docs/feature-development/features/FEAT-009-remote-development-host.md`

- `docs/operations/NEGUS_SERVICE_CONTROL.md`
