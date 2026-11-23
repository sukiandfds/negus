# FEAT-013 更新记录

### 2026-08-03 14:47 +08:00

- 状态：implemented_uncommitted
- 本次更新：增加 Turn 来源映射、`/api/session/fork` 和前端分叉后自动切换。
- 用户影响：可从已完成回复创建独立分支，原对话不追加新内容。
- 验证：定向 Node 测试 9/9；`pnpm build:ui`；`git diff --check`。
- 证据：`docs/negus-knowledge/features/feature-records/FEAT-013-conversation-fork.md`；Git：`uncommitted`。

- 2026-11-19 修复后台任务分支的原生请求指令，隔离验证实际路由和协议参数。源码交原质管复验，运行版本未变。见 [分支补验](../../../../work/config-refactor-20261119/fork-verification.md)。
