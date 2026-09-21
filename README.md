# negus 仓库入口

文档更新时间：2026-09-14 01:03 +08:00

**Negus：你需要什么工作功能，直接说出来。**

产品方向是一个可以用自然语言不断定制的个人／企业工作空间：有网络和浏览器即可访问已部署、获授权的工作区；按需求创建或调整功能页面，把入口放在需要的位置。每日资讯、项目进度、进销存入口、报销上传、会议预约和员工间 AI 通信都是目标场景，具体实现状态见[产品定义](./PRODUCT_DEFINITION.md#产品定位与核心卖点)。

本仓库包含两套相互独立的产品代码：

1. **negus Web 工作空间**：当前提供真实 Codex 对话与控制、项目群聊、Agent 和交付物能力，逐步发展自然语言定制功能页面的完整流程。
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
- 宣传口径与演示建议：[`docs/promo-copy.md`](./docs/promo-copy.md)

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
