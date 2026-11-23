import { useEffect, useState, useSyncExternalStore } from 'react';
import { pinStore } from '../shared/features/project-directory/data/conversationPins';
import { byLatest, conversationKey } from './conversationDirectory';
import type { Conversation } from './types';

export const pinKey = (item: Conversation) => item.main && item.agentId ? `employee:${item.agentId}` : conversationKey(item);
export const sortPinned = (items: Conversation[], times: ReadonlyMap<string, number>) => [...items].sort((a, b) =>
  (times.get(pinKey(b)) || 0) - (times.get(pinKey(a)) || 0) || byLatest(a, b));
export function usePinnedConversations() {
  const { times } = useSyncExternalStore(pinStore.subscribe, pinStore.get);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(new Map<string, number>());
  const pinned = new Map(Object.entries(times));
  pending.forEach((time, id) => pinned.set(id, time));
  for (const [id, time] of pinned) if (!time) pinned.delete(id);
  useEffect(() => { void pinStore.migrate().catch(e => setError(e.message)); }, []);
  const toggle = async (item: Conversation) => {
    const id = pinKey(item), next = !pinned.has(id);
    if (pending.has(id)) return;
    setError('');
    setPending(old => new Map(old).set(id, next ? Date.now() : 0));
    try { await pinStore.save({ id, pinned: next }); } catch (e) { setError(String(e)); }
    finally { setPending(old => { const rest = new Map(old); rest.delete(id); return rest; }); }
  };
  return { pinned, toggle, error };
}
