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

## 第二轮：iOS 动效规范（2026-11-24 追加）

在第一轮三档时长与统一缓动之上扩展，不推翻既有 token。新增内容已落地于 `tokens.css`，`src/style.css` 的外壳变量同步了一份，两处取值必须一致。

### 曲线分工

| 曲线 | Token | 值 | 用在哪 |
| --- | --- | --- | --- |
| 通用缓动 | `--ease-out` | `cubic-bezier(0.25, 1, 0.5, 1)` | hover、淡入淡出、颜色/透明度过渡（第一轮既有） |
| iOS 弹簧感 | `--ease-spring` | `cubic-bezier(0.32, 0.72, 0, 1)` | 面板/弹窗/菜单进场、按压回弹、展开收起、分段控件选中态 |

- 浮层进场统一时长 `--duration-overlay: 250ms`，形态固定为：淡入 + `scale(0.96)`（或上移 6–8px）→ 静止，`transform-origin` 指向触发点一侧；遮罩只做 200ms 淡入。
- 原生 `<dialog>` 用 `[open]` 时刻触发进场动画；关闭动画受原生行为限制，本轮不做，不要为此改组件逻辑。
- 任何新动画时长不得超过 300ms；循环动画只许用于状态指示（呼吸点、加载旋转）。

### 按压回弹

- 所有可点元素必须有 `:active` 缩放反馈：大元素（导航项、列表行、分段按钮、对话框按钮）用 `--press-scale: 0.97`，小图标按钮用 `--press-scale-small: 0.92`，发送按钮 0.92。
- 缩放的过渡写在元素本体的 `transition` 里（含 `transform var(--duration-fast) var(--ease-spring)`），保证按下和松开都平滑；本体已有定位用 `transform` 的元素（如 translateY(-50%) 的悬浮钮）禁止再叠加缩放，避免覆盖定位。

### 毛玻璃材质

浮层（菜单、弹窗、toast、输入框、顶栏、回到底部钮、顶栏弹层）统一用材质 token，不许各自写 rgba：

| Token | 值 | 说明 |
| --- | --- | --- |
| `--material-bg` | `rgba(26, 29, 35, .72)` | surface 色半透明版 |
| `--material-bg-dim` | `rgba(11, 13, 16, .72)` | bg 色半透明版（顶栏用） |
| `--material-blur` | `blur(20px) saturate(1.5)` | 背景模糊 + 饱和 |
| `--material-highlight` | `inset 0 1px 0 rgba(255, 255, 255, .07)` | 顶部 1px 内高光，与外阴影并列写在 `box-shadow` 第一位 |

- `backdrop-filter` 必须同时写 `-webkit-` 前缀版。
- 不透明页面型容器（设置页、整页面板）不使用毛玻璃。

### 分段控件

- 会话筛选（全部/员工/项目/后台）选中底块：背景/文字色用 200ms 过渡衔接切换，选中瞬间叠加 250ms `--ease-spring` 的 `scale(.86 → 1)` 弹入。真正的跨按钮滑动需要测量 DOM 的指示层，不在本轮范围，不要用写死偏移的 `:has()`  hack。

### 新消息入场

- 聊天区消息节点挂载时 200ms 淡入 + 上移 6px（`ConversationView.module.css` 的 `.message` 动画）。只许用挂载动画，不许为此改消息渲染逻辑；历史消息首次整页加载时同样播放，保持轻微即可。

### 滚动

- 所有滚动容器：`-webkit-overflow-scrolling: touch` + `overscroll-behavior: contain`，滚动条沿用第一轮细样式。

### 降级

- `prefers-reduced-motion: reduce` 时全局把动画/过渡时长压到近零（`shared/styles/global.css` 末尾的全局媒体查询，第一轮已落地），新增动效一律不得绕过它：不要在媒体查询之外写 `!important` 的动画时长。
