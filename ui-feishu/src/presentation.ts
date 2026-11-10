import type { ProjectRuntimeStatus } from '../shared/features/project-directory/model/types';
export { avatarColor } from '../shared/shared/presentation/avatarColor';
export const compactTime = (value?: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return date.toLocaleDateString('zh-CN') === new Date().toLocaleDateString('zh-CN')
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};

export const conversationStatus = (status?: ProjectRuntimeStatus, contextPhase?: string, projectRoot = '') =>
  status?.phase === 'waitingOnApproval' || status?.phase === 'waitingOnUserInput' ? '等待用户确认...'
    : contextPhase === 'compacting' ? '正在压缩对话...'
    : status?.active && !['submitted', 'unknown'].includes(status.phase || '')
      ? status.label?.startsWith('正在') ? status.label : '助手正在运行...'
      : projectRoot ? `所属项目:${projectRoot.split(/[\\/]/).filter(Boolean).at(-1) || '未关联'}` : '';
