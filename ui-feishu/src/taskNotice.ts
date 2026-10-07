import type { SessionMessage } from '../../web-ui/src/features/conversations/model/types';

// Presentation only; the original source message and native history remain intact.
export function taskNotice(message: SessionMessage): SessionMessage {
  const match = message.text.match(/^\[Negus任务结果 ([a-f0-9-]{36})\]\n任务：([^\n]+)\n状态：([^\n]+)\n([\s\S]*?)\n任务对话：(\S+)\n这是已有任务的反馈/);
  if (!match) return message;
  const [, , title, state, result, link] = match;
  const label = ({ completed: '已完成', failed: '未完成', interrupted: '已停止' } as Record<string, string>)[state] || '有新进展';
  const target = new URL(link, window.location.origin).href;
  const text = `外派任务「${title}」${label}。\n\n${result}\n\n[打开任务对话](${target})`;
  return { ...message, role: 'assistant', authorName: '任务反馈', text, blocks: [{ id: `task-notice:${message.id}`, type: 'markdown', text }] };
}
