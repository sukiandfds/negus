import { postJson } from '../../../shared/api/http';
import { readLocalCache, writeLocalCache } from '../../../shared/state/localCache';

export type Pins = { revision: number; times: Record<string, number> };
const key = 'negus:conversation-pins:v2';
const legacyKey = 'negus:feishu:pinned-conversations:v1';
const legacy = () => readLocalCache<string[]>(legacyKey, (v): v is string[] => Array.isArray(v) && v.every(id => typeof id === 'string'));
let state = readLocalCache<Pins>(key, (v): v is Pins => !!v && typeof v === 'object' && 'times' in v && 'revision' in v)
  ?? { revision: -1, times: Object.fromEntries((legacy() || []).map(id => [id, 1])) };
const listeners = new Set<() => void>();
export const pinStore = {
  get: () => state,
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  apply: (next?: Pins) => {
    if (!next || next.revision <= state.revision) return;
    state = next; writeLocalCache(key, next); listeners.forEach(fn => fn());
  },
  save: async (body: { id: string; pinned: boolean } | { legacy: string[] }) => {
    pinStore.apply(await postJson<Pins>('/api/project-directory/pin', body));
  },
  migrate: async () => {
    const ids = legacy();
    if (ids?.length) { await pinStore.save({ legacy: ids }); writeLocalCache(legacyKey, []); }
  },
};
