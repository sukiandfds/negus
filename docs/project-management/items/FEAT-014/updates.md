# FEAT-014 更新记录

### 2026-08-03 14:47 +08:00

- 状态：implemented_uncommitted
- 本次更新：增加 app-server 归档/恢复路由、活动/归档列表切换、JSONL fallback 目录隔离和归档只读状态。
- 用户影响：可以整理项目会话，归档不删除内容；失败时列表会显示错误，不再无反馈。
- 验证：定向 Node 测试 9/9；`pnpm build:ui`；`git diff --check`。
- 证据：`docs/negus-knowledge/features/feature-records/FEAT-014-conversation-archive.md`；Git：`uncommitted`。

### 2026-11-07 员工主对话禁止归档

- 用户反馈员工目录因误归档员工主对话而缺少员工，要求先恢复现有员工，再禁止员工主对话被归档。
- 修复：已把 6 名员工登记中的 `conversationArchived` 恢复为 `false`；员工主对话操作菜单不再显示“归档”，按时间归档排除员工主对话，服务端对员工主对话归档请求返回 409。旧归档数据仍可恢复，普通对话、任务对话和群聊归档不变。
- 验证：前端 TypeScript、生产构建、后端语法检查及服务恢复后的员工目录和归档接口定向核对。
