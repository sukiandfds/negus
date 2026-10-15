---
feature_id: FEAT-018
title: Codex 原生 Goal 调用与展示对齐
status: handoff_pending
version: v0.3.0
updated_at: 2026-09-26 01:17 +08:00
product_base_commit: a3dd3f779649db3cb86bbf864d3c0d25f44c3488
scope: platform
---

# FEAT-018 Codex 原生 Goal 调用与展示对齐

## 对标依据

本机 Codex Desktop 26.917.8451.0 的 app.asar：app-initial-8f0e46979798.js、app-primary-b25c952dc388.js、thread-goal-side-panel-content-ee28019c1226.js、zh-CN-6b83584f4688.js。实际运行 Codex CLI 0.155.0-alpha.16.3。
官方 App Server 页面已读取，但未提供本轮所需 Goal 界面细节；行为以本机实现为证据，不以旧档案推测。
基线分支 codex/publish-current-panel；工作区原有 6 个未提交文件，本轮保留已有会话隔离修改。

## 修改前与当前行为

- 修改前工作区把 /goal 作为普通消息交给模型，目标控件在工具栏弹层；缺少 blocked/usageLimited、编辑和持续计时，含非 Codex 的手动完成按钮。
- 普通会话与员工直属单聊的 /goal 直接调用所属运行实例 thread/goal/set，设置 objective/status:active，不额外 turn/start。
- 复用原会话的模型/思考强度设置，等待新 Thread 就绪；切换会话后不把请求改投新会话。
- 输入框上方显示真实目标摘要；状态采用 Codex 的六种中文标签；支持清除、暂停/恢复、编辑；编辑保存使目标 active；无手动完成按钮。
- active 按原生 timeUsedSeconds、updatedAt 每秒更新显示；active/budgetLimited 有 tokenBudget 时显示实际用量/预算。
- 原生 complete 保留本页面完成结果，并调用 clear 清理目标；真实目标仍只由 Codex 持有，不创建 Negus Goal 数据库。
- 替换现有目标先确认；取消保留输入草稿。裸 /goal 可对现有目标发起恢复确认。
- 停止当前轮次前先暂停 active Goal，避免原生持续模式又起下一轮；轮次间停止也可暂停目标。暂停失败不阻止正在执行轮次的中断。
- 所有返回与事件按 Thread 隔离；新原生事件不被旧暂停/清除响应覆盖。重连与页面返回重新查询；首次读取失败不假装没有目标。
- 长目标超过 4000 Unicode 字符时采用 Codex 相同目标文件引用格式；图片/文本附件复用已上传真实文件引用。读取目标文件需验证所属 attachments 目录及真实路径。
- 员工直属单聊按实际拥有者路由 Goal 接口并转发原生事件，不改变员工会话归属。

## 验证

- 前端 TypeScript/Vite 构建通过（有原有大包提示）。
- 56 项目标、完成轮次匹配、历史、会话、供应商和员工回归通过。
- 真实无界面 Edge + 隔离 API：创建不发普通消息、状态控制、实时用时、编辑、替换取消、旧暂停与清除响应、会话切换、重连、手机/桌面布局及可见错误通过。
- 原生独立会话 01a0d94b-924d-7fe3-a7bb-bfbdf1907289：真实 create/read/resume/complete/clear 成功；记录观察到 paused/active/budgetLimited/complete。
- 真实浏览器 + 修改后的 Negus Goal 路由 + 本机真实 Codex，独立会话 01a0d954-2ca9-7410-8876-4131ef1cb710：页面 /goal -> 原生 active -> complete -> 页面已达成 -> 原生 cleared/null，全链路通过。非 Goal 周边接口隔离，不等同正式服务已加载新代码。
- 截图：runtime/goal-mobile.png、goal-desktop.png、goal-live-complete.png。脚本 windows/tests/thread-goal*.mjs 可复查。
- 原生测试结束关闭测试客户端；未改动现有用户会话。原生短测试脚本打印 PASS 后清理退出等待较长，不把进程退出当成单独通过证据；真实浏览器链路测试已正常退出。

- 完整服务实机验证新增 `windows/tests/thread-goal.http-browser.mjs`：临时项目启动正式服务入口，无 API/SSE 替身，真实浏览器直接创建目标、原生完成清理、最后轮次收尾、输入框回到空闲均通过。会话 `01a0d96a-88e3-7b61-b1fe-e2b06186750d`；截图 `runtime/goal-http-complete.png`。正式 9360 后端已于 2026-09-26 01:17 完成安全重启，PID 33164；正式服务真实 HTTP/SSE 验收退出码 0。
- 编辑器保存后保持打开，显示相对更新时间，支持还原；非模态交互浏览器回归通过。已接入 Markdown 富文本编辑器。

## 验收边界

不能宣称与 Codex 所有体验完全一致：
- 已补齐重新打开暂停/受阻/用量受限会话的恢复询问；浏览器验证保持暂停不调用恢复、点击恢复才继续。
- Codex Goal 编辑器完整富文本/文件回读交互和目标达成结果在历史中的完整还原尚未逐项验收；当前编辑器已接入 Markdown 富文本，粗体、列表、链接、代码块及格式保存通过浏览器验证。
- 群聊不是一个 Codex Thread，没有原生一对一对应的公共群 Goal 生命周期；本轮未增加“群目标”或改动点名规则，群聊入口仍走原消息渠道。
- 员工单聊真实 HTTP/SSE 已通过（NEGUS_GOAL_EMPLOYEE_TEST=1）；current → ccswitch_default 切换后直接创建目标的真实 HTTP/SSE 已通过；附件真实供应商执行及手机真机没有完成真实端到端验收；已有针对性模拟回归不替代这些证据。
- 正式服务已加载修改并通过真实浏览器验收。测试会话 01a0d991-7b25-7793-9aef-daa5c1eaed22；证据 runtime/goal-deployment-verification.json 与 .log。用户主观体验及上述未验证边界保留，状态 handoff_pending。

## 测试入口

node --test windows/tests/thread-goal-objective.test.mjs windows/tests/thread-goal-routes.test.mjs windows/tests/conversation-controls.test.mjs windows/tests/conversation-routes.test.mjs windows/tests/provider-conversation-store.test.mjs windows/tests/employee-runtime.test.mjs

浏览器脚本要求 NEGUS_PLAYWRIGHT_MODULE 指向现有 Playwright，使用无界面 Edge。
原生测试会调用真实供应商并创建独立测试 Thread，不能作为普通离线测试自动运行。
