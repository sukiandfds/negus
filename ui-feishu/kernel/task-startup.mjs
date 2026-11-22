export const taskStartupReceipt = async (kernel, task) => {
  const current = await kernel.waitForStart(task.id);
  const confirmed = current.state === 'running' || current.state === 'completed';
  const message = confirmed ? '已确认任务开始执行'
    : current.state === 'failed' ? `启动或执行失败：${current.error || '任务未产生错误详情'}`
      : current.state === 'queued' ? '任务已创建，仍在等待调度，尚未确认启动'
        : current.state === 'starting' ? '任务已创建，正在建立执行会话，尚未确认启动'
          : current.state === 'needs-reconciliation' ? '任务已创建，启动响应不确定，正在核对真实状态'
            : `任务已创建，当前状态为 ${current.state || '未知'}，尚未确认正常启动`;
  return { ...current, startup: { confirmed, state: current.state, message,
    threadId: current.runtime?.threadId || '', turnId: current.runtime?.turnId || '',
    modelProviderId: current.runtime?.modelProviderId || current.modelProviderId || '',
    model: current.runtime?.model || current.model || '',
    reasoningEffort: current.runtime?.reasoningEffort || current.reasoningEffort || '',
    routing: current.taskRouting || null,
    error: confirmed ? '' : current.error || message } };
};
