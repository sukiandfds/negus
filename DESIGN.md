# Negus 前端设计规范（DESIGN.md）

本文件是 Negus 前端的唯一设计 token 来源。**后续任何前端改动（人或 AI）只能引用本文件定义的 token 和数值，禁止在组件里自创颜色、间距、圆角、字号和动效时长。** 缺 token 时先在本文件登记，再使用。

落地位置：`ui-feishu/shared/styles/tokens.css`（全局变量）与 `ui-feishu/src/style.css`（飞书式外壳变量），两处取值必须一致。

## 颜色

背景只允许三层，不许出现第四个背景色：

| 用途 | Token | 值 |
| --- | --- | --- |
| 应用底 | `--color-bg` | `#0B0D10` |
| 面板（左栏、列表、侧栏） | `--color-sidebar` / `--color-surface-soft` | `#111318` |
| 气泡与悬浮（消息气泡、输入框、浮层） | `--color-surface` / `--color-composer` / `--color-user-message` | `#1A1D23` |
| 边框 | `--color-border` | `rgba(255,255,255,0.06)` |
| 强边框 | `--color-border-strong` | `rgba(255,255,255,0.12)` |

文字只允许三档：

| 用途 | Token | 值 |
| --- | --- | --- |
| 主文字 | `--color-text` | `#E8EAED` |
| 次文字 | `--color-text-secondary` | `#9AA0A6` |
| 弱文字（时间、提示） | `--color-text-muted` | `#60646C` |

强调色全站只有一个：`--color-accent: #79A5FF`（品牌蓝）。选中态背景用 `--color-surface-active: #26314A`（accent 的暗色调），hover 背景用 `--color-surface-hover: #1E222A`。状态色（成功/警告/危险）沿用 tokens.css 中已有定义，不新增。

## 间距与圆角

- 间距只用 `4 / 8 / 12 / 16 / 24`（`--space-1..5`），禁止 5、7、10、14 等中间值出现在新代码里。
- 圆角只用 `6 / 8 / 12`（`--radius-small / --radius-medium / --radius-large`），禁止 16、20 等其他值出现在新代码里。

## 字号

- 正文：`14px`，行高 `1.65`（`--text-body` / `--line-body`）。
- 列表标题：`13.5px`，字重 600。
- 列表预览：`12.5px`，用次文字色。
- 弱信息（时间戳等）：`11px`，用弱文字色。

## 动效

时长只允许三档，缓动全站统一：

| 用途 | Token | 值 |
| --- | --- | --- |
| 快速反馈（hover、按下） | `--duration-fast` | `120ms` |
| 面板进出、展开收起 | `--duration-medium` | `200ms` |
| 大过渡 | `--duration-slow` | `300ms` |
| 缓动 | `--ease-out` | `cubic-bezier(0.25, 1, 0.5, 1)` |

## 交互状态约定

- 每个可点击元素必须有默认 / hover / 按下 / 聚焦 / 禁用五态，hover 过渡 120ms。
- 消息操作图标默认隐藏，消息 hover 或聚焦时 200ms 淡入；触屏设备常驻显示。
- 正在执行任务的会话/员工头像显示呼吸状态点（`.avatar i` 的 pulse 动画）。
- 选中会话在列表中用左侧 2px accent 指示条 + `--color-surface-active` 背景表示。
- 内容区最大宽度 `--content-width: 790px`（约 800px），消息与输入框共用。

## 已知豁免

- 状态面板（`src/features/status-panel/panel.css`）、边框工具（`BorderToolPage`）等独立页面暂未纳入本轮统一，后续改到时按本文件收敛。
- 历史代码中不符合上述数值的写法，在改动到对应文件时顺手收敛，不做无关的大扫除。
