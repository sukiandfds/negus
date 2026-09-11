# negus 仓库入口

文档更新时间：2026-09-11 17:11 +08:00

本仓库包含两套相互独立的产品代码：

1. **negus Web 协作工作台**：查看和继续真实 Codex 工作，支持群聊、Agent 和交付物。
2. **Codex Dream Skin 换肤工具**：通过本机 CDP 给 Codex 桌面端加载外部主题。

两套产品共用仓库，但文档、代码和运行方式分开维护。

## negus Web 协作工作台

当前开发分支已有真实 Codex 对话与执行控制、后续消息队列、模型与上下文设置、原生 Goal 状态操作、多项目目录、员工单聊与项目群聊、附件与生图、Artifact/HTML/PDF 交付，以及移动端和项目管理入口。

完整介绍见 [现有实现功能介绍](./PROJECT.md#现有实现功能介绍)。本轮按 `codex/publish-current-panel` 的源码核对；代码存在不等于运行环境可用或用户验收通过。员工自动成长、群聊完整体验、Desktop/Web 同步和远程长期稳定性仍有明确边界。

- 项目说明、运行方式和模块代码索引：[`PROJECT.md`](./PROJECT.md)
- 当前全部产品功能和不可违反的规则：[`PRODUCT_DEFINITION.md`](./PRODUCT_DEFINITION.md)
- 助手工作规则：[`AI_ASSISTANT_WORK_RULES.md`](./AI_ASSISTANT_WORK_RULES.md)
- 功能状态：[`docs/feature-development/FEATURE_STATUS_INDEX.md`](./docs/feature-development/FEATURE_STATUS_INDEX.md)
- 功能开发说明：[`docs/feature-development/README.md`](./docs/feature-development/README.md)
- 架构说明：[`docs/architecture/README.md`](./docs/architecture/README.md)

主要代码：

| 目录 | 内容 |
| --- | --- |
| `web-ui/` | React、TypeScript、Vite 前端 |
| `windows/server/` | Web 服务、API、SSE 和业务模块 |
| `runtime/` | 会话、执行、Artifact、员工和媒体数据 |

开发命令：

```powershell
pnpm build:ui
pnpm start:demo
```

## Codex Dream Skin 换肤工具

平台说明紧挨对应代码目录：

| 平台 | 用户说明 | 助手和维护者规则 | 代码目录 |
| --- | --- | --- | --- |
| macOS | [`macos/README.md`](./macos/README.md) | [`macos/SKILL.md`](./macos/SKILL.md) | [`macos/`](./macos/) |
| Windows | [`windows/README.md`](./windows/README.md) | [`windows/SKILL.md`](./windows/SKILL.md) | [`windows/`](./windows/) |

换肤工具只通过本机回环 CDP 注入，不修改官方 `.app`、`app.asar`、WindowsApps 或代码签名。

## 其他资料

- 换肤项目记录：[`docs/CODEX_DREAM_SKIN_PROJECT_NOTES.md`](./docs/CODEX_DREAM_SKIN_PROJECT_NOTES.md)
- 架构、研究和运行记录：[`docs/`](./docs/)
- 历史开发记录：[`docs/records/`](./docs/records/)

本项目不是 OpenAI 官方产品。具体功能和安全边界以对应产品目录中的说明和当前源码为准。
