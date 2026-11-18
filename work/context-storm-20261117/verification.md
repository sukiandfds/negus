# FEAT-001 context_status 请求风暴修复验证（2026-11-17）

结论：源码修复与定向自测完成，等待来源对话另行安排 DeepSeek 审核。未提交、推送、发布或重启 Negus；无截图、无真实测试消息。HEAD/develop 为 dfe8bcf5213992adbf97cb643d80516d64119a7e，与本地 origin/develop 引用差异 0/0（未 fetch）。原有 FEAT-001/002/003 文档及 Mermaid 改动保留。

## 根因与使用变化

方向与既有排查一致。旧 useContextManagement 将用量写入 committed，推进与正文调度共用的 revisions；usePageSnapshot 的签名包含该版本，导致读正文；context load 无条件 publish 又制造状态事件。隔离浏览器加载修改前 HEAD 的四份前端源码，预热20个对话后100条状态使请求从20增至40，见 storm-baseline.log。服务端新增测试确认快照读取不广播，真实协议用量仍广播且不会被慢读取覆盖。

用户操作：打开已有对话，同时多个后台任务运行，持续在输入框输入中英文、删除和移动光标。修前后台状态导致重复正文读取；修后用量仅在现有位置更新，每线程固定180ms合并通知，正文不随用量事件读取。真实消息、正文版本、终态、压缩、手动刷新和恢复继续走原有显示/同步入口。无新UI、提示或滚动改动。

## 逐文件差异（仅本项）

| 文件 | + / - | 原因 |
|---|---:|---|
| ui-feishu/shared/features/context-management/hooks/useContextManagement.ts | 4 / 2 | 合并普通用量通知，压缩完成明确失效，失败立即显示，保留模型选择 |
| ui-feishu/shared/features/conversations/state/conversationStore.ts | 59 / 15 | 正文需求版本独立于字段时钟；相同业务值不增加版本/持久化；保留时间顺序；固定窗口通知；旧读取不清新dirty或覆盖新上下文；状态更新不阻碍旧运行层清理 |
| ui-feishu/shared/features/conversations/hooks/useProjectConversations.ts | 3 / 2 | 在处理事件前捕获旧状态，当前对话重复终态不再反复要求校准 |
| ui-feishu/src/usePageSnapshot.ts | 4 / 2 | 正文签名使用正文需求、sourceRevision、消息数和摘要（正文 contentVersion 保留原防旧覆盖逻辑）；手动刷新显式唤醒原调度 |
| windows/server/context-management-service.mjs | 12 / 1 | 快照加载不广播，慢加载保留期间的新用量及模型，并补齐首次加载缺失的设置元数据 |
| ui-feishu/validation/conversation-refresh-policy-browser.test.mjs | 92 / 1 | 20线程事件压力、输入、慢读取、重复终态、409与手动恢复回归 |
| windows/tests/context-management-service.test.mjs | 32 / 0 | 只读不广播、真实事件和首次加载竞争 |
| windows/tests/conversation-send-state.test.mjs | 89 / 1 | 相同业务值、时间戳、固定窗口、多线程最终用量、新dirty/模型保护、旧运行状态清理 |

业务代码合计 +82/-22；测试 +213/-2；合计 +295/-24。FEAT-001 updates.md 另追加交付记录。精确差异见 changes.patch、diff-numstat.txt；不包含用户既有改动。

## 测试命令与结果

环境 PATH 未提供 node，使用已安装的绝对路径，无安装或升级：

```sh
NODE=/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$NODE --test windows/tests/context-management-service.test.mjs windows/tests/conversation-send-state.test.mjs windows/tests/conversation-loading.test.mjs windows/tests/conversation-batch.test.mjs windows/tests/conversation-controls.test.mjs windows/tests/conversation-source-revision.test.mjs windows/tests/page-snapshot-pending.test.mjs ui-feishu/validation/conversation-summary.test.mjs
$NODE --test windows/tests/context-management-service.test.mjs
$NODE ui-feishu/node_modules/typescript/bin/tsc -p ui-feishu/tsconfig.json --noEmit
$NODE ui-feishu/validation/conversation-refresh-policy-browser.test.mjs
$NODE ui-feishu/validation/conversation-priority-browser.test.mjs
$NODE work/context-storm-20261117/conversation-store.mjs
$NODE work/context-storm-20261117/conversation-batch.mjs
$NODE work/context-storm-20261117/workspace.mjs
git diff --check
```

浏览器连接仅供夹具的 Vite 5201，所有业务 API 和 EventSource 被夹具拦截；既有测试的截图调用仅在保存于本目录的运行副本中去除，源测试不改。修改前对照使用 baseline.config.mjs 在5202按需读取 git show HEAD，不回退工作区；对照脚本为 workspace-baseline.mjs、storm-baseline.mjs。

- regression.log：136/136；后续服务端首次加载竞争补断言 server-final.log：9/9。
- types.log：退出码0；git diff --check 通过，受保护的两个滚动文件零差异。
- browser.log：20个对话预热后分别100/1,000/10,000条事件新增正文请求均0；慢读取期间三次真实版本变化仅一次在途和一次补读，峰值1；当前及后台重复终态不重读；完整助手消息即时显示，重复事件只显示一条；旧contentVersion不覆盖新正文、并发read复用同一请求的单元断言通过。409后用量事件不触发重试循环，手动刷新恢复。
- browser.log：持续事件期间输入 abc、移动光标、Backspace，再通过 Chromium IME 输入中文；三轮最终文字 a中文a中文a中文ccc 正确，焦点和DOM身份不变；输入到下一帧最大16.4ms，采样无long task。测量属于本机无CPU节流的夹具结果。
- store.log：完整消息和乐观确认、失败图片、缓存A/B零重复读取、快速切换、模型选择、Goal/提问、历史分页及断线恢复通过。
- batch.log：最近批次、首批10、失败保留、归档/恢复通过。priority.log：首批10、并发峰值4通过。
- workspace.log：编辑回退原线程及HTTP确认前事件、压缩失败展示等6项通过；“queue accepted event removes clock”在等待旧 aria-label “等待助手完成后发送”时超时。workspace-baseline.log 在修改前同一位置同样超时，列为既有夹具失败；没有修改无关业务以适配它。队列行为另由 store.log 与单元测试验证。

## 边界与交接

完成的是源码与隔离自动化验证。真实手机、公网延迟、真实模型供应商和生产运行快照未参与本轮测试；本轮明确禁止发布及真实发送。手机卡死的最终线上验收在后续获授权发布后执行。DeepSeek 独立审核由来源对话安排，本执行者没有另行派工。无其他本项实施阻塞；旧工作区夹具1项失败保留在报告中。

## 第2次修复尝试：审核两项补修（2026-11-17）

第一轮经 DeepSeek 审核为 FAIL：纯元数据变化未更新当前标题，以及乐观归档早于API返回时遗留180ms通知。本节记录本次增量；上方第一轮记录保留历史，不作为第二轮验收结论。

本轮结论：两项已修复，自测通过，待来源对话复审；未提交、推送、发布或重启Negus。没有截图或真实发送，没有新增界面、提示或轮询。

| 本轮文件 | 新增/删除（相对第一轮交付） | 原因 |
|---|---:|---|
| usePageSnapshot.ts | +14/-5 | 会话标题与时间直接更新shown摘要和当前展示，慢读取发布时标题也以最新摘要为准；元数据不加入正文读取签名 |
| conversationStore.ts | +6/-3 | 抽取并复用原有cancelContextNotification清理代码，供乐观移除入口调用；原即时通知及迁移入口复用 |
| useConversationCatalog.ts | +3/-1 | 乐观归档/移除时立即取消该线程已有待触发通知，无需等API返回 |
| useProjectConversations.ts | +1/-0 | 将store已有清理方法传给catalog |
| conversation-refresh-policy-browser.test.mjs | +11/-0 | 标题单独变化覆盖列表、当前标题和重命名值；断言零正文请求、无后续波次及无long task |
| conversation-send-state.test.mjs | +29/-1 | 运行真实catalog乐观归档入口，在API挂起期间验证目标timer取消且另一线程正常通知 |

本轮业务代码 +24/-9，测试 +40/-1，共 +64/-10；文档记录另计。精确增量见 round2-changes.patch、round2-numstat.txt；相对本轮开工文件快照计算，不混入第一轮或Mermaid改动。

本轮命令仍用上文NODE绝对路径：

```sh
$NODE --test windows/tests/context-management-service.test.mjs windows/tests/conversation-send-state.test.mjs windows/tests/conversation-loading.test.mjs windows/tests/conversation-batch.test.mjs windows/tests/conversation-controls.test.mjs windows/tests/conversation-source-revision.test.mjs windows/tests/page-snapshot-pending.test.mjs ui-feishu/validation/conversation-summary.test.mjs
$NODE ui-feishu/node_modules/typescript/bin/tsc -p ui-feishu/tsconfig.json --noEmit
$NODE ui-feishu/validation/conversation-refresh-policy-browser.test.mjs
$NODE work/context-storm-20261117/conversation-store.mjs
$NODE work/context-storm-20261117/conversation-batch.mjs
git diff --check
git diff --exit-code -- ui-feishu/shared/features/conversations/components/ConversationView.tsx ui-feishu/shared/components/JumpToLatest/useReturnToBottom.ts
```

- round2-unit.log：137/137。归档测试中API一直挂起，110ms乐观移除后，220ms时仅另一个线程产生1次通知；再等200ms仍为1次；随后API完成才确认归档。模型、慢读取、新dirty及contentVersion保护测试通过。
- round2-browser.log：sourceRevision/messageCount/preview不变，仅title改变，列表名称、当前标题、重命名输入一致；新增正文请求0，额外等待900ms无重复波次。100/1,000/10,000条context_status分别新增正文请求0；正文版本、完整消息、重复终态、同线程最多1路及仅一次最新补读、409/手动恢复通过。
- 同一浏览器中中英文组合输入、删除、移动光标、最终文字、焦点及DOM身份断言通过；新增long task数量断言为0，输入到下一帧最大15.6ms（本机无CPU节流夹具采样）。
- round2-store.log：缓存A/B、真实消息事件/确认、模型选择、历史分页、断线恢复通过。round2-batch.log：批次加载、归档/恢复通过。
- round2-types.log：TypeScript退出0；diff检查通过；两个受保护滚动文件零差异。

覆盖边界：本轮验证为隔离接口浏览器及单元测试，未连接真实消息供应商或手机公网生产会话。第一轮workspace旧排队标识失败的HEAD对照记录保留，本轮未改该无关行为。工作区保持develop/dfe8bcf5213992adbf97cb643d80516d64119a7e；所有先前未提交改动保留。
