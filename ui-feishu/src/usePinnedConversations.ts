import { useState } from 'react';
import { readLocalCache, writeLocalCache } from '../../web-ui/src/shared/state/localCache';
import { byLatest, conversationKey } from './conversationDirectory';
import type { Conversation } from './types';

const key = 'negus:feishu:pinned-conversations:v1';
export const pinKey = (item: Conversation) => item.main && item.agentId ? `employee:${item.agentId}` : conversationKey(item);
export const sortPinned = (items: Conversation[], pinned: ReadonlySet<string>) => [...items].sort((a, b) => Number(pinned.has(pinKey(b))) - Number(pinned.has(pinKey(a))) || byLatest(a, b));
export function usePinnedConversations() {
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(readLocalCache<string[]>(key, (value): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string')) || []));
  const toggle = (item: Conversation) => setPinned(previous => {
    const next = new Set(previous);
    const id = pinKey(item);
    if (next.has(id)) next.delete(id); else next.add(id);
    writeLocalCache(key, [...next]);
    return next;
  });
  return { pinned, toggle };
}
