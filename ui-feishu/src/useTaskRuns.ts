import { useCallback, useEffect, useState } from 'react';
import { fetchJson, postJson } from '../../web-ui/src/shared/api/http';

export type TaskRun = { id: string; title: string; state: string; kind?: string; agentId: string; agentName: string;
  roomId?: string; roomName?: string; conversationId: string; parentTaskId?: string; resultOf?: string;
  result?: string; error?: string; updatedAt: string; cancelRequested: boolean;
  source?: { threadId?: string };
  runtime: { threadId?: string; turnId?: string }; delivery?: { state: string } };
export const taskStateLabels: Record<string, string> = { queued: '排队中', starting: '正在连接', running: '执行中',
  stopping: '正在停止', recovering: '正在恢复', 'needs-reconciliation': '状态待确认', completed: '已完成', failed: '未完成', interrupted: '已停止' };
export const taskFinished = (task: TaskRun) => ['completed', 'failed', 'interrupted'].includes(task.state);
export function useTaskRuns(active: boolean, roomId = '') {
  const [tasks, setTasks] = useState<TaskRun[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await fetchJson<{ tasks: TaskRun[] }>(`/api/tasks${roomId ? `?roomId=${encodeURIComponent(roomId)}` : ''}`, signal);
      if (!signal?.aborted) { setTasks(result.tasks); setError(''); }
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : '任务读取失败'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [roomId]);
  useEffect(() => {
    setTasks([]); setError('');
    if (!active) return;
    setLoading(true);
    const controller = new AbortController();
    const update = () => { if (!document.hidden) void refresh(controller.signal); };
    update(); const timer = window.setInterval(update, 3000);
    document.addEventListener('visibilitychange', update);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [active, refresh]);
  const act = async (task: TaskRun, action: 'stop' | 'reconcile' | 'retry-delivery') => {
    try { await postJson('/api/tasks/action', { roomId: task.roomId, taskId: task.id, action }); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : '操作失败'); }
  };
  return { tasks, loading, error, refresh, act };
}
