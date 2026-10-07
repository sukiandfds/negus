import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CurrentTask } from '../../web-ui/src/features/desktop/currentTasks';
import { useCurrentTasks } from '../../web-ui/src/features/desktop/useCurrentTasks';
import { scheduleLabel } from '../../web-ui/src/features/desktop/AutomationsWidget';
import { goalStatusLabels } from '../../web-ui/src/features/goals/model/types';
import { fetchJson } from '../../web-ui/src/shared/api/http';
import { byLatest } from './conversationDirectory';
import type { Conversation, DirectoryState } from './types';
import { useTaskRuns, taskFinished, taskStateLabels, type TaskRun } from './useTaskRuns';

type Automation = { id: string; name: string; status: string; schedule: string; threadId: string | null; lastRunAt: number | null; runs: { threadId: string; status: string; updatedAt: number }[] };
type Snapshot = { items: Automation[]; warnings: string[] };
export type ConversationSection = { title: string; items: Conversation[] };
const date = (value: number | null) => value ? new Date(value).toISOString() : null;

export function useTaskConversations(directory: DirectoryState, all: Conversation[], active: boolean) {
  // Group worker history is a projection; group executions come from the shared task API.
  // The original goal endpoint accepts employee/task conversations, not these projections.
  const goalDirectory = useMemo(() => ({ ...directory, projects: directory.projects.map(project => ({ ...project,
    conversations: project.conversations?.filter(entry => (entry as typeof entry & { role?: string }).role !== 'project'),
  })) }), [directory]);
  const current = useCurrentTasks(goalDirectory, active);
  const runs = useTaskRuns(active);
  const [scheduled, setScheduled] = useState<Snapshot | null>(null);
  const [scheduleError, setScheduleError] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchJson<Snapshot>('/api/desktop/automations', signal);
      if (signal?.aborted) return;
      setScheduled(previous => next.warnings.length && !next.items.length && previous?.items.length ? { ...next, items: previous.items } : next);
      setScheduleError(next.warnings.length ? '定期任务数据暂未完整读取' : '');
    } catch {
      if (!signal?.aborted) setScheduleError('定期任务数据暂不可用');
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const update = () => { if (!document.hidden) void refresh(controller.signal); };
    update();
    const timer = window.setInterval(update, 15000);
    document.addEventListener('visibilitychange', update);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [active, refresh]);
  const sections = buildTaskSections(current.tasks, scheduled?.items || [], all);
  const runRow = (task: TaskRun): Conversation => ({ id: task.id, taskId: task.id, kind: task.roomId && task.conversationId === task.roomId ? 'group' : undefined,
    roomId: task.conversationId === task.roomId ? task.roomId : undefined,
    threadId: task.runtime.threadId, conversationId: task.conversationId,
    name: task.title, agentId: task.agentId, subtitle: task.roomName ? `${task.roomName} · ${task.agentName}` : task.agentName,
    time: task.updatedAt, active: !taskFinished(task), preview: `${task.agentName} · ${taskStateLabels[task.state] || task.state}${task.resultOf ? ' · 结果汇总' : ''}` });
  const running = runs.tasks.filter(task => !taskFinished(task));
  sections[0].items = sections[0].items.filter(item => !running.some(task => task.runtime.threadId && task.runtime.threadId === item.threadId));
  sections[0].items.push(...running.map(runRow));
  sections.push({ title: '已完成', items: runs.tasks.filter(task => task.state === 'completed').map(runRow).sort(byLatest) },
    { title: '未完成与已停止', items: runs.tasks.filter(task => ['failed', 'interrupted'].includes(task.state)).map(runRow).sort(byLatest) });
  return { sections, error: current.goalError ? '部分长期任务状态暂未读到' : scheduleError || runs.error,
    loading: current.checking || runs.loading || (active && !scheduled && !scheduleError),
    refresh: () => { current.retry(); void refresh(); void runs.refresh(); } };
}

export function buildTaskSections(tasks: CurrentTask[], scheduled: Automation[], all: Conversation[]): ConversationSection[] {
  const taskRow = (task: CurrentTask): Conversation => ({
    ...all.find(row => row.threadId === task.id), id: task.id, threadId: task.id,
    name: task.title, agentId: task.project.employeeId, conversationId: task.conversation.conversationId,
    subtitle: task.project.name, time: task.updatedAt, active: task.category === 'running',
    preview: task.goal ? goalStatusLabels[task.goal.status] : task.label,
  });
  const sections: ConversationSection[] = [
    { title: '正在执行', items: tasks.filter(task => task.category === 'running').map(taskRow) },
    { title: '长期任务', items: tasks.filter(task => task.goal).map(taskRow) },
    { title: '定期任务', items: scheduled.map(item => ({
      ...all.find(row => row.threadId === item.threadId), main: false,
      id: `automation:${item.id}`, kind: 'automation' as const, name: item.name,
      threadId: item.threadId, subtitle: '定期任务', time: date(item.lastRunAt),
      preview: `${scheduleLabel(item.schedule)}${item.status === 'PAUSED' ? ' · 已暂停' : ''}`,
      children: item.runs.map(run => ({ ...all.find(row => row.threadId === run.threadId),
        id: run.threadId, threadId: run.threadId, name: item.name, subtitle: '执行对话',
        time: date(run.updatedAt), preview: ({ RUNNING: '正在执行', IN_PROGRESS: '正在执行', COMPLETED: '已完成', SUCCESS: '已完成', FAILED: '执行失败' }[run.status] || run.status),
      })).sort(byLatest),
    })).sort(byLatest) },
  ];
  return sections;
}
