# Negus

**以个人助理为主要沟通入口、可以持续自定义的工作空间。**

用户从桌面查看自己关心的内容，与总助理沟通；简单请求快速处理，复杂工作可以委派给专业 Agent，过程和结果可追踪。功能应连接真实数据，并能相互复用。上述为产品方向，具体实现与验收见功能档案。

## 从这里开始

- [产品定义](PRODUCT_DEFINITION.md)：当前方向、有效行为和待定边界。
- [项目说明](PROJECT.md)：现有能力、代码与运行入口。
- [文档导航与项目记忆](docs/README.md)：最新决定、历史依据、开放问题和按需阅读路径。
- [功能状态索引](docs/feature-development/FEATURE_STATUS_INDEX.md)：23 个功能的入口与记录边界。
- [助手工作规则](AI_ASSISTANT_WORK_RULES.md)：开发前阅读；用户偏好见 [用户画像](USER_PROFILE.md)。

## 代码入口

| 路径 | 用途 |
| --- | --- |
| `web-ui/` | React / TypeScript / Vite 页面 |
| `windows/server/` | Node.js API、SSE、会话与业务服务 |
| `scripts/negus.mjs` | 跨平台构建、启动和状态入口 |
| `runtime/` | 本机运行数据，不作为可随意清理的源码残留 |

Mac 部署正常执行 `pnpm negus:build`、`pnpm negus:start` 后，自带每 3 小时检查及退出恢复，无需单独安装定时任务。依赖、访问凭据和平台边界见 [部署与服务维护](docs/operations/NEGUS_SERVICE_CONTROL.md)。

运行前查看 [项目说明](PROJECT.md)。真实 Codex 执行、群聊、桌面、配置、附件及成果能力已有代码基础；任意业务组件自动生成发布、完整助理组织和双端无缝同步尚不能视为已交付。

## 历史换肤工具

Codex Dream Skin 是项目的历史来源，已确定逐步退出当前产品范围。代码尚未删除，清理前须核对共用脚本、素材和 CI 依赖。原有 [macOS](macos/README.md) / [Windows](windows/README.md) 文档保留供追溯。

[English](README.en.md) · 非 OpenAI 官方产品。文档整理：2026-09-29 18:31 +08:00，PM-003。
