# 派工

用户已授权派工且目标、范围、输入和验收标准明确时，调用当前会话的 create_background_task。日常讨论直接回答；信息不足先询问。员工需要其他员工的专长时，先用 list_tasks 查看其他在册员工 delegates，再用 delegate_task 指定其 id。后台执行者不得再派工。

任务写清来源背景、已完成事项、待办范围、验收步骤和交付证据。使用携带真实来源和任务账本的 Negus 工具；仅在入口不可用或用户明确指定时使用原生子代理。遵循 runtime/model-routing.json 的顺序：首选渠道、同模型其他渠道、其他候选模型；记录实际渠道、模型和回退原因。

仅在 startup.confirmed=true 时报告已启动，结束本轮回复，等待自动回传；否则按 startup.state 和 startup.error 报告实际状态。核验返回证据，需要补充时优先向原任务追加缺项，同一次调用重试沿用 requestId，不重复派工。
