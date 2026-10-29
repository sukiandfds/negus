# Negus 需求维护入口（2026-10-30）

修改 Negus 前，必须按功能及相关文件查阅 `docs/project-management/INDEX.md` 定位的条目，读取其中的用户原话、后续澄清和当前有效决定；执行细则见 `AI_ASSISTANT_WORK_RULES.md` 的“需求原话与澄清”。不能只看最近代码或助手交接摘要。派工必须附条目路径和相关澄清，执行者同样核对。无冲突直接执行；与有效决定冲突且用户未明确替代时，列出两条原话及体验差异请用户决定，不自行恢复已被否定的理解。只核对本次相关条目，不扫描全部历史。

# Negus 分支约定

用户明确要求只保留长期分支 `develop` 和 `main`。

- 当前工作区始终使用 `develop`；开发、修复、提交和推送默认直接在 `develop` 上进行。
- 不自行创建临时分支或额外 worktree，不切换到 `main`。只有用户明确提出新的要求时才改变此约定。
- `develop` 跟踪 `origin/develop`；交付时核对本地与远端同步。
- `main` 保持不动，未经用户明确要求，不向其提交、合并、重置或推送。
- 已运行的受控服务使用发布快照；仅重命名 Git 分支不需要重启服务。后续发布从 `develop` 的工作区准备，并按仓库受控发布流程执行。

# 对话滚动逻辑保护（2026-10-24 用户明确要求）

- 对话首次定位、底部跟随、历史阅读位置恢复，以及相关虚拟列表测量逻辑，后续任何修改必须先取得用户本人针对这部分的明确同意。
- 一般功能开发、其他问题修复或顺手重构，不视为修改上述逻辑的授权；不得自行改动或绕过。
- 相关入口：`ui-feishu/shared/features/conversations/components/ConversationView.tsx`、`ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts`。此约束也覆盖其他文件中会改变上述行为的代码。
