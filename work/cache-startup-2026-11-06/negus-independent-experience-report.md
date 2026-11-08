# Negus 缓存与真实使用场景独立验收（2026-11-06）

执行：Codex 原生子 agent，直接操作真实 Google Chrome（Playwright），不修改业务源码、不再派工。正式服务、正式对话和正式浏览器存储均未写入；API 夹具/临时 HTTP 服务隔离。需求核对：FEAT-001“刷新首屏等待最小修复”“最近20个”“停止反复自动读取”“已加载正文全部持久保存”；FEAT-002 缓存澄清。

## 当前验收证据

- 应用/仓库场景：16/16，通过日志 `/tmp/negus-independent-cache-test.log`、JSON `/tmp/negus-independent-cache-results.json`，脚本 `/tmp/negus-independent-cache-test.cjs`。
- 最近20个与选择调度：9/9，通过日志 `/tmp/negus-selection-final.log`，脚本 `/tmp/negus-selection-variant-browser.mjs`（TEST_PORT=5202）。
- 真实 Service Worker：5/5，通过日志 `/tmp/negus-independent-sw-test.log`、JSON `/tmp/negus-independent-sw-results.json`。
- 生产构建聊天入口/SW/确认升级：4/4，通过日志 `/tmp/negus-real-app-update-test.log`、JSON `/tmp/negus-real-app-update-results.json`。最终生产构建 `feishu-mw3uoqvm` 已再次通过，缓存刷新42ms。

- 最终历史交接：1/1，Chrome验证95条旧缓存晚于30条新页返回时，95条唯一消息、同ID最新文字、r2来源版本及最早已缓存页边界游标完整；日志 `/tmp/negus-final-history-handoff.log`。

共35个独立场景断言组；不是35位用户或35条真实生产会话。最终历史合并变更后，原16组也重新全部通过。

## 应用与仓库场景（16）

1. 所有业务API失败时，当前正文及列表先显示；首屏只get当前线程。
2. URL指定B、上次选中A：优先显示B，95条已加载历史及失败图片/原因完整。
3. 所有业务API慢2.5秒，缓存正文先显示。
4. 空缓存且API失败仍能挂载界面。
5. 旧localStorage快照恢复正文、失败图片和原因。
6. 其他缓存晚到期间切B，恢复B且保持选择。
7. 普通B（不含失败pending）晚到后UI与IndexedDB均95条。
8. 普通B回填尚未释放时刷新，仍直接恢复磁盘95条。
9. 群列表、群正文断网刷新保留。
10. 群列表首次成功读取后持久化，下次断网刷新恢复。
11. 闲置goal_status事件直接显示恢复/暂停，零额外聚合GET。
12. user_input_requested事件直接弹问题，零额外聚合GET。
13. queue_changed事件直接出现等候气泡，零额外聚合GET。
14. Chrome执行Store：缓存晚到不覆盖新正文。
15. Chrome执行Store：新Goal先到时，恢复缺失正文且保留新Goal。
16. Chrome执行Store：旧失败图片与新pending同时保留。

## 选择与同步场景（9）

首轮仍只读最近20个，峰值4；已同步且无变化t1/t0切换0详情GET；首次打开20外t22仍读取；20外已读对象只目录变化不预读；重新打开时r1→r2则更新正文；无变化再次切换0详情；从未打开t24仍读；运行中t2变化仍读；手动刷新正常重新读。

隔离变体证据：直接删selectedThread切换失效逻辑会让已看过的20外对象目录版本改变后再打开仍显示旧正文，日志 `/tmp/negus-selection-delete.log`。条件比较变体复用原signature后全部通过，最终候选同样通过。开工副本也复现无变化切换多余2次GET及手动刷新0次GET，日志 `/tmp/negus-selection-baseline.log`，故这两项属于开工既存缺陷。

## Service Worker与入口

真实SW5项：缓存导航网络挂起时16ms返回；后台HTML更新后下一导航使用新HTML；断网继续缓存；缓存缺失走网络；新构建等确认后激活且清理旧缓存。

真实应用入口4项：不打开设置即可注册并被SW控制；导航网络挂起时42ms恢复聊天正文；版本变更只提示且页面身份/旧控制器保持；用户确认后激活新版本、刷新，thread及正文缓存保留，更新提示消失。版本升级夹具修改临时服务器返回的构建ID/对应JS常量，不改业务源码或正式发布。

## 性能对照

同一Chrome、CPU降速6倍、300个缓存对话（36,917,671字符）、当前60条正文、业务API隔离失败；静态生产构建交替顺序3轮，避免Vite编译噪声。日志 `/tmp/negus-independent-static-perf-repeat.log`。

开工基线首次正文：833.4 / 824.7 / 820.4 ms；首屏候选：556.4 / 562.0 / 558.8 ms。中位824.7→558.8 ms，减少265.9ms（32.2%）。基线首屏前getAll全部300条；候选首屏前未发getAll。该数字是本机隔离样本，不外推所有设备或生产数据量。

## 独立发现并交主线程修复的边界

- 状态/Goal先写committed且session为null时，不能因committed.has就跳过旧正文恢复。
- 已有新localPending时，仍须保留旧failed/occupied图片，按既有submission去重。
- 不能把store.get合成的空正文当真实正文写盘；后台回填真实正文后须改变持久版本，保证UI/磁盘一致。修前已实测普通B UI95条但磁盘0条，修后上述第7/8项均通过。
- 不能直接删切换失效而遗漏20外变化；复用原signature作切换时比较即可。
- 手动刷新clear observed后必须唤醒既有调度，不依赖服务端列表变化。
- live Goal/问题/队列已经在原仓库投影，页面不能再用旧committed覆盖；删除重复覆盖后第11至13项均通过。

## 代码路径核对

首屏元信息及当前缓存→原界面挂载→后台剩余缓存补入原Store→原同步调度；失败/已有新状态保留。选择只改变当前ID并比较既有signature；真实变化仍走原聚合/版本核对。事件使用原store/live；正文仍取committed视图。没有修改滚动、首次底部定位、跟随和历史阅读位置代码。

online恢复按最新“停止反复自动读取”仅刷新目录/摘要，不令全部闲置正文失效；验收应等待/api/sessions并核对现有历史不丢。待答问题按事件直接显示，不以新增聚合GET作为成功条件。

## 最后持久化guard一行追加验收

主线程将保存参数设为 `store.committed.get(c.selectedId)?.session ? session : null`：真实committed决定是否可保存，实际保存对象沿用含failed/occupied覆盖层的session。该变更后独立Chrome定向6/6通过：

- 实际failed图片发送后留A直接刷新：文字、图片、状态和原因在UI/IndexedDB保留。
- 实际occupied图片发送后留A直接刷新：同上。
- 实际failed图片发送后切B、刷新、再切A：同上。
- 实际occupied图片发送后切B、刷新、再切A：同上。
- 普通B延迟恢复后磁盘仍95条。
- 普通B恢复前刷新仍直接读到磁盘95条。

这四个发送案例均经测试页面真实上传/发送流程及隔离503接口产生失败，不是预置失败消息。日志 `/tmp/negus-failure-overlay-guard-browser.log`、`/tmp/negus-plain-b-guard-test.log`。后两项属于既有场景的针对性重跑，不将6项全部计为新增独立场景。按主线程要求仅验此一行，未重复SW/性能测试，未修改业务源码或正式数据。
