# 前端领域

## 目录职责

| 路径 | 主职责 |
| --- | --- |
| `ui-feishu/src/main.tsx` | 飞书布局入口与应用启动 |
| `ui-feishu/src/FeishuApp.tsx` | 页面组装，不承载具体业务规则 |
| `ui-feishu/src/components/` | 跨功能 UI 外壳和纯展示组件 |
| `ui-feishu/shared/features/<feature>/` | 单一功能的组件、数据访问、Hook、状态和类型 |
| `ui-feishu/shared/shared/` | 跨功能稳定 API、媒体类型、实时事件和公共模型 |
| `ui-feishu/shared/pwa/` | Service Worker 与 PWA 注册 |
| `ui-feishu/shared/styles/` | 全局样式与设计令牌 |

## 当前模块边界

- 对话、执行、附件、上下文、模型、设备、交付物、群聊、项目管理、项目进度和用量监控分别作为功能域。
- `src/components/` 不直接调用业务 API，不持有某个功能的业务状态，不反向依赖具体 feature 类型。
- `shared/features/` 可以依赖 `shared/shared/` 和纯 UI 组件，不应互相深度引用；需要共用的稳定能力先放 `shared/shared/`。
- 页面入口负责组装，功能组件负责交互，数据目录负责 HTTP/事件接口，Hook 负责状态组合，model 负责类型和格式化。

## 当前整理判断

前端已经是项目中最清晰的分层区域，第一阶段不建议大规模移动。后续重点是确认 `Conversation*`、`Execution*` 和群聊实时 Hook 的边界是否稳定，以及把新产品分支新增入口纳入同一套说明。
