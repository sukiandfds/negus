# PM-003 更新记录

### 2026-09-29 18:31 +08:00

- 状态：implemented_pending_review。
- 本次更新：按近期原话核对当前方向，精简核心入口与功能索引，明确资料归属和按需读取路径。
- 用户影响：文档导航更聚焦个人助理工作空间；产品行为与运行服务不变。
- 证据：[文档导航](../../../README.md)、[条目](item.md)。
- 验证：git diff --check 通过；117 处相对链接目标存在，23 个功能编号完整且唯一；调用现有项目管理读取器确认 PM-003 摘要、详情、状态和原话可解析，PM-002 无重复。未运行构建、浏览器或供应商验收，未调用模型。
- 边界：保留历史原话、未定方案和冲突；没有删除换肤代码、提交或推送。

- 2026-11-04：共用Mac/Windows图片解析，保留两边入口，三个Mac安装/打包入口物化完整模块。业务+11/-129，净减118行。用户明确免验证，未运行测试；源码即时供后续启动/打包使用，未更改已安装换肤服务。

- 2026-11-04：对话路由802行拆为100/242/223/130/146行，共841行，净增39行（新增文件计入）。25个路由分支AST提取后逐字一致；17项原路由测试通过，证据/tmp/negus-routes-split-tests.log与/tmp/verify-route-move.mjs。相关测试47通过2失败；原路由通过临时loader替换复跑同样2失败，分别是current::saved-model前缀与前端配置覆盖断言，证据/tmp/negus-routes-related-tests.log、/tmp/negus-routes-baseline-tests.log。本次未改这些行为。当前工具目录无Negus create_background_task/negus_handoffs入口，未派出DeepSeek任务；未绕用户入口。服务未重启，候选待指定验收。

- 2026-11-04：用户同意“改用原生 DeepSeek 子代理验证”。实际派发deepseek-flash/high两次、deepseek-v4-pro/high一次，均在执行前被供应商503拒绝：astra特价分组无可用渠道。请求标识分别202611031629456265676318268d9d6a3d0CabQ、202611031630424344064588268d9d6BfyBdhl6、202611031631404492796778268d9d6KOVBJPD7。无DeepSeek审核结果；已停止重复请求，候选保留、未发布。

### 2026-11-11 取消加载时改写后端源码

- 修改前：`ui-feishu/server/register.mjs` 在加载时用字符串替换改写 `remote-room-demo.mjs`、`request-handler.mjs`、`app-server-client.mjs`、`employee-runtime-service.mjs`，磁盘上的源码不是实际运行的代码；FEAT-001 中曾因只读基础源码得出错误判断，2026-11-10 员工状态不回落的根因也在这层适配。
- 修改后：把加载后的源码原样写回这四个文件，删除改写函数和 `employee-event-integration.mjs`；`register.mjs` 保留为空文件，因为发布清单和管理器仍以 `--import` 传入它。用户可见行为不变。
- 证据：修改前后分别捕获 Node 实际加载的五个文件源码（仅把绝对导入地址换成相对路径），SHA 完全一致。`windows/tests` 在 +08:00 下 544/558，与修改前相同的 13 项既有失败；`employee-runtime.test.mjs` 中两项按未改写旧行为断言的用例改为断言实际运行行为（事件只交给执行跟踪器一次；跨供应商选择保存为待应用）。受影响的 UI 校验 46 通过 1 跳过；TypeScript 通过；隔离实例启动及零员工群 HTTP 流程通过。
- 状态：仅工作区修改，未提交、未发布、未重启；真实供应商和浏览器未验证。部署机若在这四个文件上有未提交改动，拉取时需要手工合并。
