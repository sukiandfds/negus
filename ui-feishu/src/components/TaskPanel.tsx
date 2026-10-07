import { useState } from 'react';
import { useTaskRuns, taskFinished, taskStateLabels } from '../useTaskRuns';

export function TaskPanel({ roomId, threadId }: { roomId?: string; threadId?: string }) {
  const runs = useTaskRuns(Boolean(roomId || threadId), roomId);
  const tasks = roomId ? runs.tasks : runs.tasks.filter(task => task.runtime.threadId === threadId || task.source?.threadId === threadId);
  const [pending, setPending] = useState<string[]>([]);
  const act = async (task: typeof runs.tasks[number], action: 'stop' | 'reconcile' | 'retry-delivery') => {
    setPending(previous => [...previous, task.id]);
    try { await runs.act(task, action); } finally { setPending(previous => previous.filter(id => id !== task.id)); }
  };
  if (!tasks.length && !runs.error) return <div />;
  const undelivered = tasks.filter(task => task.delivery?.state === 'failed').length;
  return <details className="group-task-panel"><summary>任务 · {tasks.filter(task => !taskFinished(task)).length} 项进行中{undelivered ? ` · ${undelivered} 项结果未送达` : ''}</summary>
    {runs.error && <p className="list-error" role="alert">{runs.error}</p>}
    <div className="group-task-list">{[...tasks].reverse().map(task => <article key={task.id}>
      <div><strong title={task.title}>{task.title}</strong><span>{task.agentName} · {taskStateLabels[task.state] || task.state}{task.resultOf ? ' · 结果汇总' : task.parentTaskId ? ' · 外派任务' : ''}{task.delivery?.state === 'failed' ? ' · 结果未送达' : ''}</span></div>
      {!taskFinished(task) && <button disabled={pending.includes(task.id) || task.cancelRequested} onClick={() => void act(task, 'stop')}>{task.cancelRequested ? '正在停止' : '停止'}</button>}
      {task.conversationId !== task.roomId && task.runtime.threadId && <a href={`/?agent=${encodeURIComponent(task.agentId)}&thread=${encodeURIComponent(task.runtime.threadId)}&conversation=${encodeURIComponent(task.conversationId)}`}>打开对话</a>}
      {task.state === 'needs-reconciliation' && <button disabled={pending.includes(task.id)} onClick={() => void act(task, 'reconcile')}>重新确认状态</button>}
      {task.delivery?.state === 'failed' && <button disabled={pending.includes(task.id)} onClick={() => void act(task, 'retry-delivery')}>重新发送结果</button>}
    </article>)}</div>
  </details>;
}
