# FEAT-001 独立验收记录

最终结论（2026-10-30）：VIP Terra 独立验收允许本次单聊缓存进入受控发布。下文保留发现→修复→复验经过，早期阻断已按对应后续记录关闭；验收边界见末尾。

- 最终结论（2026-10-30）：已发现的模型串用、批次正文提前显示、失败后刷新无恢复、旧目录复现已归档对话及真实后端持续空转，均在对应场景复验关闭；本次单聊缓存修改可进入受控发布。真实后端静止窗口为 5 秒，仍有抽样确认的历史会话错误，不能宣称所有会话读取成功。群聊独立链路不在此次结论中。
- 验证环境：develop 工作区候选 5201；未提交、推送、发布、重启或修改项目文件。用户实际运行服务仍是原发布版本，候选测试通过不等于线上已生效。
- 基线：develop，HEAD 8946b801b9f8ef7b6e82c2e2b24677c98a838719，工作区有多项既存修改；候选前端 http://127.0.0.1:5201/ 返回 200。
- 需求依据：docs/project-management/items/FEAT-001/item.md 2026-10-30 逐项澄清。
- 已审作者证据：/tmp/negus-cache-delivery-tests.log 为 102 项中 101 通过、1 跳过；/tmp/negus-batch-test.log 和 /tmp/negus-batch-failure-test.log 使用 t0-t11 模拟，检查缓存正文、标题、批次切换、错误日志和展示。该测试各对话模型与上下文相同，不能证明元数据隔离；503 失败不等于超时后迟到结果验证。/tmp/negus-cache-workspace-test.log 覆盖编辑原线程及队列等 7 项，不能代替全部验收。
- 保护检查：ConversationView.tsx 的现有 diff 改变占位消息时间显示和 executionHandoff 调用，未直接改动首次定位、底部跟随或虚拟测量；useReturnToBottom.ts 无工作区 diff。其他既存变更归属不能单凭 diff 判定。

## 独立浏览器：模型串用、超时和迟到

- 操作：headless Chrome 打开 5201，注入 t0-t11 缓存及模拟接口；t0 模型 Model-A/High，t5 模型 Model-B/Low，阻塞 t9 至超时；第一批完成前点击“打开缓存标题5”。期望 t5 显示自己的缓存元数据或未知状态，不显示 t0 的模型。实际缓存正文 t5 与 Model-A/High 同时显示；超时后变为 t5 正确的 Model-B/Low。阻断发布，见 /tmp/negus-cache-independent.log 的 BEFORE_SWITCH、AFTER_SWITCH、AFTER_TIMEOUT；脚本 /tmp/negus-cache-independent.mjs。
- 2026-10-30 前台修改 seed 后复验：同一脚本、相同 t0-t11 模拟，t9 仍阻塞时点击 t5；实际直接显示“最新正文t5”和“选择模型”，等待“缓存正文t5”6 秒超时。旧模型串用未再出现，但最新正文提前穿透且与缓存标题/未知元数据混搭，仍阻断发布。证据 /tmp/negus-cache-retest.log；该次脚本因断言等待失败提前结束，并未完成后续超时观察。
- 前台随后改为从已展示缓存取 seed；再次运行独立切换脚本，在 t9 未放行时 t5 的缓存正文计数 1、新正文计数 0，模型栏为“选择模型”，未借 t0 模型。证据 /tmp/negus-cache-switch-retest.log、/tmp/negus-switch-retest.png。需结合批次放行后的最终模型复验确认两处修复。
- 完整复验：/tmp/negus-cache-final-switch.log 显示切换时缓存正文及未知模型；t9 超时后 t5 正文、Model-B/Low、70% 上下文一起出现；旧串用和提前正文穿透在此场景关闭。最终迟到及空闲计数详见同日志。
- t9 超过 10 秒时，成功项 t0-t8 同批呈现，t9 保留缓存标题，页面显示 t9 超时，控制台记录 threadId 和原因；释放迟到请求后短期仍保留 t9 缓存。证据同日志 AFTER_TIMEOUT 和 AFTER_LATE。该模拟未证明 t9 每一元数据均保留。
- 选中 t9 的补测：阻塞 25 秒后，其他首批标题更新，t9 仍显示缓存标题、正文、Old-Model/Low、20% 上下文和缓存目标，页面显示超时、控制台记录 t9 原因。证据 /tmp/negus-cache-timeout-metadata-long.log、/tmp/negus-cache-timeout-metadata.mjs、/tmp/negus-timeout-metadata.png。放行迟到结果和后续批次后新内容出现；两者同时放行，尚不能区分迟到结果穿透与下一批正常更新。
- 进一步将后续批次 t11 保持阻塞：t9 超时后放行 t9，等待 3 秒仍显示整套 t9 缓存和错误；放行 t11 后才出现 t9 最新正文与模型。证据 /tmp/negus-cache-timeout-held.log。测试期间前台可能更新 Vite 源码，最终版本仍应复验关键场景。
- 群聊通过 useGroupChats / GroupWorkspace 独立读取，以上测试不覆盖群聊。
- 请求观察：上述模拟加载完并释放迟到请求后，12 秒内 API 累计数从 99 保持 99，无持续循环；请求明细见日志 IDLE_COUNTS。该结果仅限本场景和观察窗口。

## 独立浏览器：批次期间发送文本

- 操作：t0 缓存显示、t9 仍阻塞时输入“验收发送消息”并按 Enter，模拟服务端接受，之后放行批次并让历史包含同 submissionId 的消息。期望即时显示，接受前后不消失不重复，按时间排在历史后。三个观察时点均只显示一次，最终在最新正文之后。证据：/tmp/negus-cache-send.log、/tmp/negus-cache-send.mjs、/tmp/negus-send-independent.png。此项不覆盖图片或连续发送。
- 补充：模拟上传 image-one 后发送“验收图片一”，接受事件后连续发送“验收连续二”，两条文字在放行批次前后各出现一次，按顺序排列，POST 包含 image-one。日志 /tmp/negus-cache-images.log；模拟图片 URL 未提供资源，图片本身显示失败属于测试夹具限制，不能证明图片渲染。
- 补充图片资源后复测：相同模拟上传与连续发送，提交后两条文字仍按顺序各一次，图片元素加载成功（naturalWidth=1）。/tmp/negus-cache-images-render.log、/tmp/negus-cache-images.mjs、/tmp/negus-images-independent.png；尚未覆盖图片被历史记录接管后的状态。
- 图片历史接管：分别发送含图片“验收图片一”和文本“验收连续二”，以相同 submissionId 返回服务端历史并触发 sessions_changed；阻塞期间两条本地消息均保留，放行后历史时间变为 08:01、08:02，文字各一次、图片 naturalWidth=1。证据 /tmp/negus-cache-image-history-final.log、/tmp/negus-cache-image-history.mjs。第一次试验夹具遗漏 markdown block 导致文字缺失，修正夹具后以上结果有效。

## 独立浏览器：带元数据缓存

- 操作：为 t0 注入缓存正文、旧标题、Old-Model/Low、上下文20%、暂停目标“缓存目标”，接口返回新正文、标题、Model-A/High、上下文10%、暂停目标“最新目标”；阻塞 t9，然后放行第一批和其余两条。期望等待期间整套旧值，第一批提交后整套新值，最后其余标题再更新。实际 BEFORE_RELEASE、FIRST_RELEASE、REST_RELEASE 符合以上检查。证据 /tmp/negus-cache-metadata.log、/tmp/negus-cache-metadata.mjs、/tmp/negus-metadata.png。运行状态及压缩操作不在此测试内，采样不是每个 DOM 变更的原子性证明。

## 独立浏览器：空列表与新建

- 无本地缓存、模拟空列表时显示“暂无对话”；点击添加、新建对话，输入并发送“新对话测试”，模拟服务创建 new-test 后列表和正文出现该消息，URL 指向 new-test。证据 /tmp/negus-cache-create-send.log、/tmp/negus-cache-create.mjs、/tmp/negus-create.png；仅模拟 API，无实际用户会话写入。
- 新版空目录回归：无会话缓存，接口返回无主线程的员工和项目，点击员工及项目筛选后各自出现“验收空员工”和“验收空项目”。证据 /tmp/negus-cache-empty-directory.log、/tmp/negus-cache-empty-directory.mjs。

## 独立浏览器：归档恢复

- 模拟将 t5 归档，活动列表不再出现 t5；进入已归档列表后 t5 出现，点击恢复并返回活动列表，t5 重新出现。证据 /tmp/negus-cache-archive.log、/tmp/negus-cache-archive.mjs、/tmp/negus-archive.png；该夹具目录为空，不能证明目录关联条目场景。
- 目录关联补测：模拟目录含 t5 子对话且归档后目录仍返回该关联，归档 API 成功、活动 sessions 不再包含 t5，但 1.5 秒后活动列表仍显示“最新标题5 / 缓存预览5”；归档列表也显示 t5。证据 /tmp/negus-cache-archive-directory.log、/tmp/negus-cache-archive-directory.mjs。该场景与已确认归档不能被旧目录恢复的要求不符，阻断发布，正在延长观察。
- 延长至归档后 5 秒仍显示同一旧目录条目，证据 /tmp/negus-cache-archive-directory-long.log。
- 前台修复后复跑相同旧目录场景：归档后活动列表不含 t5，归档列表包含 t5，恢复后活动列表重新包含 t5，且其余 11 条仍显示。证据 /tmp/negus-cache-archive-directory-fixed.log；该模拟阻断已关闭。

## 阻断：失败后刷新不恢复

- 操作：模拟 t9 的 session 请求返回 503，页面保留缓存标题并显示 t9 错误；随后服务恢复正常，点击“刷新会话”。期望重读 t9 并清除错误、展示最新标题；实际 3 秒后仍显示缓存标题和原错误，t9 的 session 请求累计仍为 1。证据 /tmp/negus-cache-recovery.log、/tmp/negus-cache-recovery.mjs、/tmp/negus-recovery.png。此结果阻断发布。
- 前台修复后同脚本复验：点击刷新后 t9 请求累计 2 次，最新标题显示，错误消失。证据 /tmp/negus-cache-recovery-retest.log；本阻断项在该模拟场景关闭。先前阻断已向来源线程提交一次反馈，接口 HTTP 202。

## 真实后端：大量请求与连接错误

- 独立 headless Chrome 访问候选 5201，API 转发到 config().port=49974，认证仅在内存传递，模拟本地缓存来自真实会话数据。总会话列表 94 条，约 8 秒观察期间记录 988 个 API 请求结果，其中 537 个连接错误、5 个 503、1 个 409、3 个 404。首屏呈现 31 个 article、无页面异常；列表点击后 URL 仍指向原线程，故没有证明真实切换。截图 /tmp/negus-cache-real.png，脚本 /tmp/negus-cache-real.mjs。
- 此次大量连接重置发生于 Playwright route.fetch 转发链路，不能单独证明真实后端自身故障；请求量及部分后端 503 仍需在限制并发后复验。脚本禁止了非 GET 操作，点击无法切换不能归因于页面；SSE 未被该脚本拦截。截图仅证明渲染，不能视作同步通过。测试初版异常日志包含请求头，发现后已删除该日志并将脚本改为只保存错误类型；不再记录凭据。
- 后续只读 watchdog check 返回 backend、frontend、tunnel 均 healthy；未重启或发布。
- 限制四条对话并发后真实复验：/tmp/negus-cache-real-bounded.mjs、/tmp/negus-cache-real-bounded.log、/tmp/negus-cache-real-bounded.png。94 条列表，页面初始打开既有会话，在未点击前观察 60 秒；总 API 完成约 6800 次，末尾三个 5 秒窗口分别 942、921、940，仍持续读取；最大在途 API 26；实际 HTTP 503 共 27 次，404 共 28 次，409 共 7 次，未记录代理连接错误。最后点击另一条真实会话，URL 和正文数量变化。未逐条分析 SSE 期间的真实事件，不能断言服务端完全没有变化，但持续的大量重复读取及 503 属阻断发布问题。
- 排除易变字段后的真实复验：/tmp/negus-cache-real-fixed.log，后半段每 5 秒读取数下降至 1、43、17、13、24、6、19；与之前约 900 次/窗口相比明显下降，但仍未观察到完整静止窗口。测试期间候选源码发生热重载，首段出现双倍初始化；实际 HTTP 503 共 32 次。需要在源码稳定条件下结合实时事件再判断，不能仅凭下降宣布关闭。
- 稳定源码复验：/tmp/negus-cache-real-events.mjs、/tmp/negus-cache-real-events.log。前期请求和实时 context/goal 事件逐步减少；最后 5 秒内 API 完成 0、实时事件 0，在途 0。最大在途 API 26；读取仍产生真实 HTTP 503 共 27 次、404 共 28 次、409 共 7 次，页面无脚本异常，切换后 URL 改为另一条真实对话。持续空转在此观察中关闭；这些失败的原因和对对应对话的实际影响仍需单独解释，不能视为所有真实会话读取成功。
- 顺序只读抽样 52 个接口（无并发），三条真实会话仍返回 503：01a18606-e310-7d10-98b5-20459e854449 的 goal/context/user-input 提示会话已归档；01a17e34-318e-7a31-8982-ef64efe8ff4d 的 context 提示已有活动写入者；01a18371-c9ea-7741-8e6e-bcdf4a1f0317 的 goal 提示线程未加载。证据 /tmp/negus-cache-errors-sample-distinct.log、/tmp/negus-cache-errors-sample.mjs。说明这些抽样错误不依赖本次并发；不代表其余所有错误已逐一归因。保持原错误与缓存是确认的失败行为，不执行归档恢复或其他数据更改。
- 实际阻断已追加发送来源线程，HTTP 202；复验后 watchdog 报 backend、frontend、tunnel 均 healthy。
- 隔离对照：12 条模拟对话，状态和上下文接口每次返回新 updatedAt，业务值不变；首个 5 秒窗口 158 次（含前端模块请求），后三个 5 秒窗口均 0。脚本 /tmp/negus-cache-volatile.mjs，日志 /tmp/negus-cache-volatile.log。单独变化响应时间戳未复现真实持续重读；不能据此排除其他真实事件或目录数据触发。

## 验收边界

- 本次对正文、标题、模型/强度、上下文比例和目标做了页面时间点检查，并验证超时缓存和阻塞后批时的迟到结果；未逐帧覆盖每一种运行状态、压缩及目标变化。
- 图片历史接管、空页新建、失败刷新和目录归档恢复已按上文模拟实测；编辑回退依据作者 workspace 测试，断线恢复和模型配置选择未单独做完整真实后端流程。
- 群聊通过独立链路，不在本次验收范围；不将单聊测试作为群聊证据。
