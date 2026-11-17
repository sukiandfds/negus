import type { CSSProperties } from 'react';
import { Bot } from 'lucide-react';
import { avatarColor } from '../presentation';

export function Avatar({ name, text, projectRoot, agentId, active = false, size = '' }: { name: string; text?: string; projectRoot?: string | null; agentId?: string; active?: boolean; size?: string }) {
  text ||= projectRoot?.split(/[\\/]/).filter(Boolean).at(-1);
  return <span className={`avatar ${size}`} style={{ '--avatar-color': avatarColor(agentId) } as CSSProperties} aria-hidden="true">
    {agentId ? <Bot size={22} strokeWidth={1.8} /> : text ? <span className="avatar-text" title={text} style={{ fontSize: Array.from(text).length <= 2 ? 14 : Array.from(text).length <= 4 || /^[\x00-\x7f]+$/.test(text) ? 10 : 7 }}>{Array.from(text).slice(0, 8).join('')}</span> : name.slice(0, 1) || 'N'}
    {active && <i />}
  </span>;
}
