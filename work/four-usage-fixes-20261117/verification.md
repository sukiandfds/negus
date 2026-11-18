# 四项真实使用问题：工作区修复与自测证据

> 当前状态：第一轮 DeepSeek Flash High 独立审核为 **FAIL**（分页上下文、同毫秒压缩回退两项阻断及目录补读分类一项低风险）。下方第一轮记录保留为历史局部证据；本轮仅补这三项，自测结果和差异见文末“第二轮补修”。来源对话另行复审，本轮未发布。

基线：develop / dfe8bcf5213992adbf97cb643d80516d64119a7e。范围为本轮用户明确四项；先读 AGENTS、需求原话规则、INDEX、FEAT-001/002 相关原话与更新及 FEAT-017。既有已发布修复、Mermaid 和新增测试保持；无需求冲突需用户决策。

四项均已作源码修复并完成下列定向自测。来源对话安排独立验收，本轮没有创建审核任务；运行服务未加载本轮代码。

## 用户操作前后与根因

| 项 | 修复前操作与现象 | 修复后操作与已测结果 | 根因链与入口 |
| --- | --- | --- | --- |
| 1 | 点击立即压缩→等待 POST→列表仍是旧消息时间 | 点击立即显示客户端开始；服务端开始覆盖（测试刻意服务器时钟早于客户端）；完成覆盖开始；迟到 POST 不回退 | compact 等返回才 setStatus；目录只读消息时间。useContextManagement.ts:56、conversationDirectory.ts:58、context-management-service.mjs:54 |
| 2 | 打开已缓存普通/员工主对话→正文出现、用量缺失→发送后才更新 | 已有正文但缺上下文时选择校准一次，携带 sourceRevision；发送前显示用量；完整缓存 A/B 切换零请求 | usePageSnapshot.ts:37 只检查正文；员工 runtimeContextForThread 原先仅返回模型，无历史 usage。employee-runtime-service.mjs:923、provider-conversation-store.mjs:122 |
| 3 | 员工页→新建→URL 清了、员工标题和身份仍残留 | 新建→标题新对话、URL 无员工参数、个人 root；发送才创建真实线程，发送无员工 conversationId；普通业务对话新建保留其 cwd | FeishuApp.tsx:181 的 create 未清 agentId。个人来源是目录 personal.root，后备 /api/project 普通项目 root；员工私有 root 不作个人项目 |
| 4 | 设备 A 完成→B 目录遗漏完成失效，失败后留旧值；落盘前读取也可能拿旧摘要 | B 收到完成事件→单次 timedout 后补读成功→摘要、时间更新；连续两次失败停止并保留旧值；后续完成恢复 | useProjectConversations.ts:708 漏事件；projectDirectoryApi.ts:9 的 10 秒请求无补读；employee-runtime-service.mjs:637 原先落盘未结束就 sessions_changed |

第4项没有把公网取消日志认定唯一根因。本轮依据前端事件接线、共享资源实测及保存 gate 复现修复；未重放用户真实公网历史。

时间语义：compactionUpdatedAt 独立于 updatedAt。客户端开始不改服务端 updatedAt，因此服务器时钟较早也能接管。完成时间来自服务端生命周期，使用量刷新不改变该时间。压缩开始零正文读取；完成保留现有一次正文校准。上下文 load 时间仅表示读取状态的时间，不称作最后回答完成时间。

目录恢复：每个共享 loader 最多两次请求，每次 60 秒；一次失败即可恢复，连续失败保留旧目录并停止，下次现有事件/恢复/手动刷新可继续。没有永久轮询或短延迟员工状态核对。

## 逐文件增减（相对本轮开工工作区，不是 HEAD）

业务12文件 **+40/-11（净+29）**；测试5文件 **+288/-1**；需求记录6文件 **+75/-0**。证据辅助脚本与日志不混入业务统计。

| 文件 | 新增/删除 | 原因 |
| --- | ---: | --- |
| [docs/project-management/items/FEAT-001/item.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-001/item.md:1) | +19/-0 | 追加本轮原话、有效决定、操作变化、修复与验证边界，保留历史记录 |
| [docs/project-management/items/FEAT-001/updates.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-001/updates.md:1) | +8/-0 | 追加本轮原话、有效决定、操作变化、修复与验证边界，保留历史记录 |
| [docs/project-management/items/FEAT-002/item.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-002/item.md:1) | +16/-0 | 追加本轮原话、有效决定、操作变化、修复与验证边界，保留历史记录 |
| [docs/project-management/items/FEAT-002/updates.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-002/updates.md:1) | +8/-0 | 追加本轮原话、有效决定、操作变化、修复与验证边界，保留历史记录 |
| [docs/project-management/items/FEAT-017/item.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-017/item.md:1) | +16/-0 | 追加本轮原话、有效决定、操作变化、修复与验证边界，保留历史记录 |
| [docs/project-management/items/FEAT-017/updates.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-017/updates.md:1) | +8/-0 | 追加本轮原话、有效决定、操作变化、修复与验证边界，保留历史记录 |
| [ui-feishu/shared/features/context-management/hooks/useContextManagement.ts](/Users/hans/myproject/negus/ui-feishu/shared/features/context-management/hooks/useContextManagement.ts:56) | +9/-3 | 点击立即显示开始；POST 响应复用事件排序，迟到失败不覆盖权威状态 |
| [ui-feishu/shared/features/context-management/model/types.ts](/Users/hans/myproject/negus/ui-feishu/shared/features/context-management/model/types.ts:17) | +1/-0 | 压缩活动时间独立于用量/模型/读取更新时间 |
| [ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts](/Users/hans/myproject/negus/ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts:708) | +1/-1 | employee_turn_completed 接入已有目录失效事件 |
| [ui-feishu/shared/features/project-directory/data/projectDirectoryApi.ts](/Users/hans/myproject/negus/ui-feishu/shared/features/project-directory/data/projectDirectoryApi.ts:9) | +3/-1 | 共享请求 60 秒，失败仅一次补读，不增加轮询 |
| [ui-feishu/shared/features/project-directory/hooks/useProjectDirectory.ts](/Users/hans/myproject/negus/ui-feishu/shared/features/project-directory/hooks/useProjectDirectory.ts:30) | +1/-0 | 从原 Store 投影压缩活动时间 |
| [ui-feishu/src/FeishuApp.tsx](/Users/hans/myproject/negus/ui-feishu/src/FeishuApp.tsx:181) | +3/-2 | 清除 React 员工身份及自动打开标记；普通 cwd / personal root 分开选择；列表监听压缩时间 |
| [ui-feishu/src/conversationDirectory.ts](/Users/hans/myproject/negus/ui-feishu/src/conversationDirectory.ts:58) | +6/-2 | 普通、员工及父行采用明确的压缩活动时间；摘要选择不变 |
| [ui-feishu/src/usePageSnapshot.ts](/Users/hans/myproject/negus/ui-feishu/src/usePageSnapshot.ts:37) | +3/-0 | 选中缺上下文时清除观察签名，复用聚合校准和正文版本；展示目录带压缩时间 |
| [ui-feishu/validation/conversation-summary.test.mjs](/Users/hans/myproject/negus/ui-feishu/validation/conversation-summary.test.mjs:756) | +13/-0 | 普通/员工/父行时间及前后端时钟不同的目录投影测试 |
| [windows/scripts/remote-room-demo.mjs](/Users/hans/myproject/negus/windows/scripts/remote-room-demo.mjs:427) | +1/-0 | 生产员工运行时注入已有 provider 只读上下文读取 |
| [windows/server/context-management-service.mjs](/Users/hans/myproject/negus/windows/server/context-management-service.mjs:54) | +2/-0 | 服务端压缩生命周期记录真实时间；历史读取补状态时间但不广播 |
| [windows/server/employee-runtime-service.mjs](/Users/hans/myproject/negus/windows/server/employee-runtime-service.mjs:637) | +6/-2 | 消息成功落盘后发布 sessions_changed；923 行起恢复同模型同供应商历史用量 |
| [windows/server/provider-conversation-store.mjs](/Users/hans/myproject/negus/windows/server/provider-conversation-store.mjs:122) | +4/-0 | 复用指定供应商上下文读取，保留登记 historyFile 回退 |
| [windows/tests/context-management-service.test.mjs](/Users/hans/myproject/negus/windows/tests/context-management-service.test.mjs:177) | +36/-0 | 压缩阶段时间不被后续用量覆盖；冷服务读取用量无广播 |
| [windows/tests/employee-runtime.test.mjs](/Users/hans/myproject/negus/windows/tests/employee-runtime.test.mjs:831) | +43/-1 | 记录保存 gate 与目录失效次序；恢复实例用量及跨模型不套旧值 |
| [windows/tests/rollout-file.test.mjs](/Users/hans/myproject/negus/windows/tests/rollout-file.test.mjs:50) | +33/-0 | 真实临时 rollout → provider → 员工运行时 → context 服务，只调用 thread/read |
| [ui-feishu/validation/four-usage-fixes-browser.test.mjs](/Users/hans/myproject/negus/ui-feishu/validation/four-usage-fixes-browser.test.mjs:1) | +163/-0 | 四项真实界面操作的隔离 API 场景，覆盖缺缓存、迟到响应、失败补读和普通发送 |

## 实际验证

1. 定向 Node 测试 **185/185 通过**，0 失败、0 跳过：[unit.log](unit.log)。其中本轮新增6项单测（目录时间1、context2、员工2、真实rollout1）。首次本轮新测试发现两个夹具问题（摘要带现有“助手：”前缀、模拟 client 缺 close），修正测试后最终组合185项通过；未隐瞒产品失败。
2. 新增浏览器脚本5组断言全部通过：[browser.log](browser.log)。同时覆盖普通/员工冷上下文、正文已热且缺 updatedAt、有时间戳但缺用量；完整缓存零请求；压缩开始/完成及迟到响应；普通业务 root、员工转普通 root；设备B完成/超时/连续失败/后续恢复。
3. 既有刷新策略浏览器通过：[storm.log](storm.log)。20个对话预热，100、1,000、10,000 context_status **新增 session 请求均0**；中文组合输入、英文、删除与光标操作保持输入，longTasks=[]；标题更新零正文请求，真实内容/终态校准、慢读、409及手动恢复通过。
4. 既有 Store 浏览器7组通过：[store.log](store.log)。缓存切换、发送确认、重复事件、相同文字、失败/占用图片刷新、pending迁移、运行追加、队列、模型、Goal/提问、未加载发送、历史分页和重连。使用仅删除截图调用的 [运行副本](store-no-screenshot.mjs)，原测试保留不动，未截图。
5. TypeScript --noEmit 退出0：[types.log](types.log)；9个MJS --check 通过：[syntax.log](syntax.log)；git diff --check 退出0：[diff-check.log](diff-check.log)。
6. 两份受保护文件相对 HEAD 零差异：[protected.log](protected.log)。开工645个源码/需求文件中623个逐字节保持，22个有本轮增量，0个删除：[preservation.json](preservation.json)。本轮精确差异：[changes.patch](changes.patch)，逐文件统计：[delta.json](delta.json)。未触及职责、全局规则、系统配置。

可复跑命令（仓库根目录）：

```sh
task_node=/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$task_node" --test windows/tests/context-management-service.test.mjs windows/tests/employee-runtime.test.mjs windows/tests/conversation-routes.test.mjs windows/tests/shared-cache.test.mjs windows/tests/conversation-send-state.test.mjs windows/tests/provider-conversation-store.test.mjs windows/tests/rollout-file.test.mjs ui-feishu/validation/conversation-summary.test.mjs ui-feishu/validation/employee-provider.test.mjs ui-feishu/validation/realtime-regression.test.mjs
"$task_node" ui-feishu/node_modules/typescript/bin/tsc -p ui-feishu/tsconfig.json --noEmit
# 隔离测试服务器，无后端代理；另一个终端执行下面浏览器脚本。
"$task_node" ui-feishu/node_modules/vite/bin/vite.js --config work/four-usage-fixes-20261117/vite.config.mjs
"$task_node" ui-feishu/validation/four-usage-fixes-browser.test.mjs
"$task_node" ui-feishu/validation/conversation-refresh-policy-browser.test.mjs
"$task_node" work/four-usage-fixes-20261117/store-no-screenshot.mjs
# syntax.log 列明9个文件，逐个执行：
"$task_node" --check windows/server/employee-runtime-service.mjs
git diff --check
git diff --exit-code HEAD -- ui-feishu/shared/features/conversations/components/ConversationView.tsx ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts
```

浏览器只访问本轮隔离 Vite 5201，业务API/EventSource全部夹具拦截；测试脚本仅在测试模块响应内暴露真实Store用于清除上下文，不修改生产代码来开放测试入口。测试服务器已关闭。没有真实供应商、员工或群聊消息。

## 边界与工作区

- 未提交、推送、创建分支/worktree、发布、重启或截图；没有修改/撤销既有其他功能改动。
- HEAD仍为指定dfe8bcf，develop与现有origin/develop本地跟踪引用差异0/0；本轮没有fetch或推送，不把本地引用比较冒充实时远端查询。
- FEAT-001、FEAT-002、FEAT-017的item/updates已追加原话和验证；没有另建重复需求清单。
- 独立审核按用户分工由来源对话安排；真实公网、真实手机和真实供应商端到端按明确边界留到发布后。源码自测通过，不报告运行服务已生效。


## 第二轮补修（独立审核 FAIL 后）

授权来源：本轮用户转交独立审核 FAIL，明确“只补以下三个缺项”“不要重做已验证通过的四路主体”。本轮实际未修改 FeishuApp、新建入口、员工归属、员工历史读取、落盘失效或目录父行映射。基线仍为 develop / dfe8bcf5213992adbf97cb643d80516d64119a7e，加第一轮及所有原有未提交改动。

### 三项根因与用户前后变化

| 缺项 | 修复前真实操作与根因 | 本轮修复与实际验证 |
| --- | --- | --- |
| 分页缓存缺上下文 | 打开已有回答的长对话，分页 messageCount=null；切走再点回，用量仍空。判定错误依赖计数真值；单改判定还会让服务端确认无用量的对话每次切回重复读取 | 改依据缓存 messages 存在；聚合结果在原 contextStatus 保存 usageSourceRevision，表示已校准当前正文版本，包含“确实无usage”。普通/员工各恰好一次 GET session，sourceRevision=r1，发送前显示用量；服务器返回无usage后两轮A/B零新增请求。事件保留标记，显式换模型清除。|
| 同毫秒压缩回退 | 点击压缩，SSE显示完成后旧POST抵达；updatedAt完全相等时原严格小于比较放行，回到compacting | 服务端每次真实phase转换递增compactionRevision，SSE和POST都带序号。前端拒绝低序号；同序号或无序号不得让completed/failed回到compacting/queued。更高序号可进入新压缩。浏览器验证同毫秒completed先到、旧POST后到保持completed；失败终态同样受保护；下一轮高序号正常开始。开始零正文读，每次完成仅一次原校准。|
| 无差别目录补读 | 设备B目录请求遇401/403/404也补一次；catch未区分错误 | GET使用已有HttpError携带status，原错误文案不变，POST/PATCH/DELETE行为不变；目录仅网络TypeError、TimeoutError/AbortError及500–599补读一次。401/403/404/429、普通格式错误只请求一次；连续可恢复错误最多两次停止，旧值一直保留，下次已有失效事件可再尝试。|

校准标记是原上下文快照中的一个可选兼容字段，不新增缓存系统或轮询；旧缓存缺字段时只做必要一次校准。同一正文的“无usage”结果不因无关上下文事件丢失。后端压缩序号只随真实阶段转换变化：重复completed、tokenUsage、load不递增；用量和load不改变compactionUpdatedAt。测试将Date固定，验证开始/完成同毫秒，再推进时钟验证普通更新仍不改压缩时间。

### 本轮逐文件增量

相对第一轮交付工作区：**业务7文件 +31/-12（净+19）；测试3文件 +142/-5；需求记录6文件 +62/-0**。第一轮至本轮累计：业务14文件+67/-19、测试6文件+425/-1、需求6文件+137/-0。辅助日志/证据不计入业务量。

| 文件 | 本轮增减 | 改动原因 |
| --- | ---: | --- |
| [docs/project-management/items/FEAT-001/item.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-001/item.md) | +18/-0 | 追加本轮审核FAIL、用户原话、有效决定/保留范围与自测状态 |
| [docs/project-management/items/FEAT-001/updates.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-001/updates.md) | +7/-0 | 追加本轮审核FAIL、用户原话、有效决定/保留范围与自测状态 |
| [docs/project-management/items/FEAT-002/item.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-002/item.md) | +16/-0 | 追加本轮审核FAIL、用户原话、有效决定/保留范围与自测状态 |
| [docs/project-management/items/FEAT-002/updates.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-002/updates.md) | +7/-0 | 追加本轮审核FAIL、用户原话、有效决定/保留范围与自测状态 |
| [docs/project-management/items/FEAT-017/item.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-017/item.md) | +7/-0 | 追加本轮审核FAIL、用户原话、有效决定/保留范围与自测状态 |
| [docs/project-management/items/FEAT-017/updates.md](/Users/hans/myproject/negus/docs/project-management/items/FEAT-017/updates.md) | +7/-0 | 追加本轮审核FAIL、用户原话、有效决定/保留范围与自测状态 |
| [ui-feishu/shared/features/context-management/hooks/useContextManagement.ts](/Users/hans/myproject/negus/ui-feishu/shared/features/context-management/hooks/useContextManagement.ts) | +7/-2 | 先按压缩序号合并；终态防回退；保留用量校准标记，换模型清除 |
| [ui-feishu/shared/features/context-management/model/types.ts](/Users/hans/myproject/negus/ui-feishu/shared/features/context-management/model/types.ts) | +2/-0 | 兼容可选compactionRevision与usageSourceRevision |
| [ui-feishu/shared/features/conversations/state/conversationStore.ts](/Users/hans/myproject/negus/ui-feishu/shared/features/conversations/state/conversationStore.ts) | +2/-1 | 聚合读取成功后标记已校准的正文版本，包括无usage结果 |
| [ui-feishu/shared/features/project-directory/data/projectDirectoryApi.ts](/Users/hans/myproject/negus/ui-feishu/shared/features/project-directory/data/projectDirectoryApi.ts) | +6/-2 | 仅可恢复网络/超时/5xx补读一次 |
| [ui-feishu/shared/shared/api/http.ts](/Users/hans/myproject/negus/ui-feishu/shared/shared/api/http.ts) | +2/-2 | GET错误补status元数据，错误文案及写请求行为保持 |
| [ui-feishu/src/usePageSnapshot.ts](/Users/hans/myproject/negus/ui-feishu/src/usePageSnapshot.ts) | +5/-3 | 依据实际缓存正文而非messageCount；已校准缺用量不重复读 |
| [ui-feishu/validation/four-usage-fixes-browser.test.mjs](/Users/hans/myproject/negus/ui-feishu/validation/four-usage-fixes-browser.test.mjs) | +53/-5 | 分页null计数、无usage缓存、同毫秒/同序号/低序号/无序号终态与下一轮压缩 |
| [windows/server/context-management-service.mjs](/Users/hans/myproject/negus/windows/server/context-management-service.mjs) | +7/-2 | 真实压缩phase转换递增单调序号并记录时间 |
| [windows/tests/context-management-service.test.mjs](/Users/hans/myproject/negus/windows/tests/context-management-service.test.mjs) | +27/-0 | 冻结/推进时钟验证生命周期递增及普通更新稳定 |
| [windows/tests/project-directory-recovery.test.mjs](/Users/hans/myproject/negus/windows/tests/project-directory-recovery.test.mjs) | +62/-0 | 实际fetchJson/shared resource链路错误分类、次数、缓存保留和下次事件恢复 |

源码关键位置：usePageSnapshot.ts选中路径约40行；conversationStore.ts聚合结果约251行；useContextManagement.ts事件合并约35行；context-management-service.mjs的publish约55行；projectDirectoryApi.ts的list约9行；http.ts响应错误约67行。

### 实际命令与结果

统一Node：`/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`。

```sh
task_node=/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$task_node" --test windows/tests/context-management-service.test.mjs windows/tests/project-directory-recovery.test.mjs windows/tests/conversation-send-state.test.mjs windows/tests/conversation-routes.test.mjs windows/tests/shared-cache.test.mjs ui-feishu/validation/conversation-summary.test.mjs
"$task_node" ui-feishu/node_modules/vite/bin/vite.js --config work/four-usage-fixes-20261117/vite.config.mjs
# 隔离Vite运行时，另终端分别执行：
"$task_node" ui-feishu/validation/four-usage-fixes-browser.test.mjs
"$task_node" ui-feishu/validation/conversation-refresh-policy-browser.test.mjs
"$task_node" work/four-usage-fixes-20261117/store-no-screenshot.mjs
"$task_node" ui-feishu/node_modules/typescript/bin/tsc -p ui-feishu/tsconfig.json --noEmit
for source_file in windows/server/context-management-service.mjs windows/tests/context-management-service.test.mjs windows/tests/project-directory-recovery.test.mjs ui-feishu/validation/four-usage-fixes-browser.test.mjs; do
  "$task_node" --check "$source_file"
done
git diff --check
git diff --exit-code HEAD -- ui-feishu/shared/features/conversations/components/ConversationView.tsx ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts
```

- 定向组合 **115/115**，0失败/跳过：[round2-unit.log](round2-unit.log)。新目录测试含12种错误子用例；包括501/503等5xx、不补读401/403/404、连续失败停止及下一次失效恢复。只重跑本轮涉及上下文、快照、HTTP和共享目录相关组合，未机械重跑无关员工供应商等第一轮全部测试。
- 四项浏览器 **7组PASS**：[round2-browser.log](round2-browser.log)。新缺项断言与第一轮四路主体一起运行；API/EventSource全部拦截，无真实发送。
- storm **PASS**：[round2-storm.log](round2-storm.log)。20个预热；100/1,000/10,000上下文事件新增session均0；输入保持，longTasks=[]；409有界恢复、标题零请求及慢读取/终态保留通过。
- 既有缓存/发送浏览器 **7组PASS**：[round2-store.log](round2-store.log)。覆盖模型、Goal、分页、图片、重连与失败气泡；运行副本没有截图调用。
- TypeScript退出0：[round2-types.log](round2-types.log)。4个MJS语法、diff检查、两份保护文件相对HEAD零差异：[round2-checks.log](round2-checks.log)。
- 本轮独立差异：[round2-changes.patch](round2-changes.patch)、[round2-delta.json](round2-delta.json)；第一轮至今累计：[changes.patch](changes.patch)、[delta.json](delta.json)。本轮开工646个文件，631个逐字节不变、15个本轮增量、0删除；新增目录回归测试1个：[round2-preservation.json](round2-preservation.json)。

本轮测试均通过。统计脚本首次读取未变化的PNG遇UnicodeDecodeError，改为先比较哈希再读取发生变化的文本后生成上述差异；此为证据统计脚本问题，不是产品测试失败。

### 交付边界

独立审核第一轮结果仍为FAIL，本轮仅报告三项补修和自测通过，来源对话安排复审。未提交、推送、发布、重启、截图或发送真实消息；未创建分支/worktree或修改职责/全局规则/系统配置。隔离Vite测试进程已关闭，运行服务保持原版本。develop/HEAD未改变，与现有origin/develop本地跟踪引用0/0，本轮没有fetch，不作为实时远端查询。真实公网、真实手机、真实供应商仍按授权边界留待发布后验收。


## 第三轮补修（第二轮独立复审 FAIL 后）

第二轮 DeepSeek 复审仍为 FAIL：慢读 live 合并丢失校准标记、旧压缩请求迟到失败污染新阶段；HTTP 补读分类 PASS。本节保留前两轮结果，仅记录用户授权的两个补修。基线仍为 develop / dfe8bcf5213992adbf97cb643d80516d64119a7e。

### 真实操作、根因与修复

1. 打开普通/员工长对话（messageCount:null、已有回答、无 usage）→慢读期间状态事件到达→原先校准标记被 live 覆盖，切走再回来又 GET。现在 commit 保留同模型、正文版本仍有效的聚合 usageSourceRevision，并回写 live；后续状态保留该标记，两轮 A/B 零新增读取。模型改变或正文改变时清除旧标记，允许重新校准。证据入口：conversationStore.ts:287、301、318；既有 handleEvent 不变。Store 测试覆盖普通和员工的同模型、不同模型、r1→r2 正文竞态，以及新版本重新校准；浏览器覆盖慢读 live 覆盖、后续 SSE、A/B、模型清标记及旧标记/当前正文版本不匹配时一次校准。
2. 点击压缩→SSE 已显示完成，或再次点击开始 B→A 请求此时才失败→原先无条件 publish(failed)，覆盖完成或 B 并刷新列表时间。现在 startCompaction 捕获本轮开始序号；catch 仍 onError 和抛出原错误，仅当前仍 compacting 且序号相同才发布 failed。证据入口：context-management-service.mjs:77、87。测试覆盖自身失败 rev1→2、完成 rev2 后迟到失败、B rev3 期间 A 失败、B 完成 rev4 与下一次 rev5，以及已 failed 时旧错误不重复发布。对过期失败断言完整状态/时间/广播次数不变。前端比较逻辑及完成一次校准不变。

### 本轮逐文件改动

| 文件 | 增减 |
| --- | --- |
| `docs/project-management/items/FEAT-001/item.md` | +17/-0 |
| `docs/project-management/items/FEAT-001/updates.md` | +7/-0 |
| `ui-feishu/shared/features/conversations/state/conversationStore.ts` | +7/-0 |
| `ui-feishu/validation/four-usage-fixes-browser.test.mjs` | +33/-2 |
| `windows/server/context-management-service.mjs` | +3/-2 |
| `windows/tests/context-management-service.test.mjs` | +42/-0 |
| `windows/tests/conversation-send-state.test.mjs` | +40/-0 |

业务仅2文件 +10/-2；测试3文件 +115/-2；FEAT-001记录2文件 +24/-0。Store 增加有效性判断及 live 回写；后端增加请求归属判断；三个测试文件分别扩展 Store/Hook、服务端时序和四项操作回归。FEAT-002/017 的已通过主体和第二轮记录未改。

### 验证命令与实际结果

统一 Node：`/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`，以下 `$task_node` 为此绝对路径。

```sh
"$task_node" --test windows/tests/context-management-service.test.mjs windows/tests/conversation-send-state.test.mjs windows/tests/project-directory-recovery.test.mjs windows/tests/conversation-routes.test.mjs windows/tests/shared-cache.test.mjs ui-feishu/validation/conversation-summary.test.mjs
"$task_node" ui-feishu/node_modules/vite/bin/vite.js --config work/four-usage-fixes-20261117/vite.config.mjs
"$task_node" ui-feishu/validation/four-usage-fixes-browser.test.mjs
"$task_node" ui-feishu/validation/conversation-refresh-policy-browser.test.mjs
"$task_node" work/four-usage-fixes-20261117/store-no-screenshot.mjs
"$task_node" ui-feishu/node_modules/typescript/bin/tsc -p ui-feishu/tsconfig.json --noEmit
```

- `round3-unit.log`：117/117，0失败、0跳过。首跑新增 Hook 夹具缺少 window.location，补齐测试环境后通过。
- `round3-browser.log`：8组 PASS；包括四项主体与新增慢读标记测试。新增版本测试首次同时修改目录和正文，混入正常同步造成计数2，改为隔离旧校准标记与当前正文版本不匹配的选择路径；真正 r1→r2 的读取竞态由共用 Store 测试覆盖。
- `round3-storm.log`：20线程预热，100/1,000/10,000纯状态事件新增 /api/session=0；longTasks=[]；输入、标题、慢读、终态及409恢复通过。日志内409为有意夹具失败。
- `round3-store.log`：既有7组 PASS；复用前轮去截图副本，原测试不改。
- `round3-types.log`：TypeScript exit 0。
- `round3-checks.log`：上述3个修改的MJS测试及服务端文件分别 `node --check` 全部 exit0；`git diff --check`、`git diff --exit-code HEAD -- ui-feishu/shared/features/conversations/components/ConversationView.tsx ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts` 均 exit0。

### 证据与工作区边界

`round3-changes.patch`/`round3-delta.json` 为本轮7文件差异；`changes.patch`/`delta.json` 为累计范围差异，不混入原有无关改动。前轮累计文件另保存为 `round2-cumulative-changes.patch`/`round2-cumulative-delta.json`，round2-changes.patch及历史日志均保留。第三轮基线位于 `/tmp/negus-four-fixes-round3-baseline-20261117`；此前两轮未修改 conversation-send-state.test.mjs，其基线从第二轮备份复用。

浏览器仅访问无后端代理的隔离 Vite 5201，所有业务 API/EventSource 使用夹具，测试服务已关闭。未提交、推送、发布、重启生产服务、截图或发送真实消息。保留既有未提交改动；develop 和 HEAD 不变，本地 origin/develop 跟踪引用比较0/0（没有fetch，不作为实时远端核验）。两个保护文件相对HEAD零差异。运行服务未加载本轮改动；真实公网、手机、供应商端到端按原边界保留到发布后。源码补修及自测结果交来源对话复审，不将自测记为独立复审PASS。


## 第四轮补修（第三轮复审 FAIL 后）

第三轮 DeepSeek 确认慢读校准和 context_status 压缩阶段保护 PASS，整体仍 FAIL：实际生产 onError 将旧错误投递 execution。本轮仅补此项；前3轮 FAIL 和原日志/patch保留。

真实操作：点击压缩A→看到完成，或开始B→A请求迟到失败；修前 context 保持 completed/compacting，却显示“Codex 执行失败”。修后旧失败仅留安全日志，执行状态/错误/更新时间/广播次数均不变；当前压缩自身失败继续显示真实错误，原POST仍抛出同一 error。

根因链：context-management-service.mjs catch 无条件通知 onError → remote-room-demo.mjs 生产回调无条件投递 method:error/willRetry:false → execution tracker 发布 failed。此次在服务端先计算阶段和序号归属，再通过第三参数 `{current, compactionRevision}` 传给回调；生产仅 current===true 转发，其他只 console.warn 固定说明与线程/序号，不输出原错误文本或凭据。默认回调/两参数调用者兼容。

| 本轮文件 | 增减 | 原因 |
| --- | --- | --- |
| windows/server/context-management-service.mjs:86 | +3/-2 | 计算归属并向 onError 传结构化元数据，保留 context 保护与原错误抛出 |
| windows/scripts/remote-room-demo.mjs:233 | +4/-1 | 实际生产回调仅转发当前错误，陈旧错误安全日志 |
| windows/tests/context-management-service.test.mjs | +66/-0 | 直接提取生产 bootstrap 回调并接真实 createExecutionTracker 验证 |
| docs/project-management/items/FEAT-001/item.md | +13/-0 | 原话、有效决定、真实体验 |
| docs/project-management/items/FEAT-001/updates.md | +7/-0 | 复审结论、补修及证据边界 |

业务2文件+7/-3，测试+66/-0，需求记录+20/-0。前端及其他已通过业务文件没有本轮增量。

实际命令（task_node指定路径如下）：

```sh
task_node=/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$task_node" --test windows/tests/context-management-service.test.mjs windows/tests/execution-tracker.test.mjs
"$task_node" ui-feishu/node_modules/vite/bin/vite.js --config work/four-usage-fixes-20261117/vite.config.mjs
"$task_node" ui-feishu/validation/four-usage-fixes-browser.test.mjs
"$task_node" ui-feishu/validation/conversation-refresh-policy-browser.test.mjs
"$task_node" ui-feishu/node_modules/typescript/bin/tsc -p ui-feishu/tsconfig.json --noEmit
"$task_node" --check windows/server/context-management-service.mjs
"$task_node" --check windows/scripts/remote-room-demo.mjs
"$task_node" --check windows/tests/context-management-service.test.mjs
git diff --check
git diff --exit-code HEAD -- ui-feishu/shared/features/conversations/components/ConversationView.tsx ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts
```

结果：
- round4-unit.log：41/41，无失败/跳过；新增测试逐一覆盖当前失败 context rev2/execution failed、完成后旧失败、B rev3期间旧失败、already failed，以及B完成rev4→新压缩rev5→自身失败rev6。旧错误仍原样通知onError且current=false；execution完整快照（含phase/error/updatedAt）及广播数量不变，context亦不变；新当前错误current=true并正常发布failed。测试执行实际生产回调源码，未启动生产bootstrap。
- round4-browser.log：四项主体及并发校准共8组PASS，压缩开始零读取、每次完成一次既有校准。
- round4-storm.log：20线程预热，100/1,000/10,000状态事件新增正文请求0；longTasks=[]；标题/慢读/409恢复回归PASS，409为夹具故意注入。
- round4-types.log：TypeScript exit0；round4-checks.log：3个MJS语法、diff及保护文件检查均exit0。

第四轮独立差异 round4-changes.patch/round4-delta.json；累计 changes.patch/delta.json已更新。第三轮累计另存 round3-cumulative-changes.patch/round3-cumulative-delta.json。基线 /tmp/negus-four-fixes-round4-baseline-20261117，前3轮patch/log未覆盖。

工作区保持develop / dfe8bcf5213992adbf97cb643d80516d64119a7e，保留既有未提交改动。HEAD与本地origin/develop跟踪引用0/0，未fetch。两保护文件相对HEAD零差异。仅隔离Vite5201用于API/EventSource全拦截的浏览器测试，已关闭。未提交、推送、发布、重启生产服务、截图或发送真实消息。生产运行服务未加载本轮代码，真实公网/手机/供应商端到端保留发布后验收；本轮为源码修复与自测结果，由来源对话继续复审。
