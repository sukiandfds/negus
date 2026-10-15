import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDismissibleLayer } from '../../shared/shared/hooks/useDismissibleLayer';
import styles from '../../shared/features/conversations/components/ConversationActions.module.css';

export function DropdownMenu({ label, icon, items }: { label: string; icon: ReactNode; items: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }[] }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (position) menu.current?.querySelector('button')?.focus(); }, [position]);
  useDismissibleLayer({
    active: Boolean(position),
    onDismiss: () => setPosition(null),
    isInside: target => target instanceof Node && Boolean(menu.current?.contains(target) || trigger.current?.contains(target)),
    restoreFocus: () => trigger.current?.focus(),
  });
  return <><button ref={trigger} className="icon-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={() => {
    const rect = trigger.current!.getBoundingClientRect();
    setPosition(position ? null : { top: Math.max(8, Math.min(rect.bottom + 4, innerHeight - items.length * 40 - 15)), left: Math.max(8, Math.min(rect.right - 150, innerWidth - 158)) });
  }}>{icon}</button>{position && createPortal(<div ref={menu} className={styles.menu} role="menu" style={position}>{items.map(item => <button key={item.label} role="menuitem" disabled={item.disabled} onClick={() => { setPosition(null); trigger.current?.focus(); item.onClick(); }}>{item.icon}{item.label}</button>)}</div>, document.body)}</>;
}
