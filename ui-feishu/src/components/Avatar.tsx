import type { CSSProperties } from 'react';
import { Bot } from 'lucide-react';
import { avatarColor } from '../presentation';

export function Avatar({ name, agentId, active = false, size = '' }: { name: string; agentId?: string; active?: boolean; size?: string }) {
  return <span className={`avatar ${size}`} style={{ '--avatar-color': avatarColor(agentId) } as CSSProperties} aria-hidden="true">
    {agentId ? <Bot size={22} strokeWidth={1.8} /> : name.slice(0, 1) || 'N'}
    {active && <i />}
  </span>;
}
