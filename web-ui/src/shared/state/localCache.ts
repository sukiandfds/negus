import { readValidStorage, writeStorage } from "./storage";

interface LocalCacheEntry<T> {
  version: 1;
  value: T;
}

export const readLocalCache = <T>(key: string, valid: (value: unknown) => value is T): T | null => {
  const entry = readValidStorage<LocalCacheEntry<unknown>>(
    key,
    (value): value is LocalCacheEntry<unknown> => Boolean(
      value
      && typeof value === "object"
      && (value as LocalCacheEntry<unknown>).version === 1,
    ),
  );
  return entry && valid(entry.value) ? entry.value : null;
};

export const writeLocalCache = <T>(key: string, value: T) => {
  writeStorage<LocalCacheEntry<T>>(key, { version: 1, value });
};


export interface CachedResource<T> {
  getSnapshot: () => { data: T | null; refreshing: boolean; error: string };
  subscribe: (listener: () => void) => () => void;
  refresh: (load: () => Promise<T>, invalidate?: boolean) => Promise<T>;
}

// Create once per resource/scope in its data module. A subscriber never owns
// the shared request; unmounting it must not cancel another subscriber's load.
export const createCachedResource = <T>(
  key: string,
  valid: (value: unknown) => value is T,
  merge: (next: T, previous: T | null) => T = (next) => next,
): CachedResource<T> => {
  let snapshot = { data: readLocalCache(key, valid), refreshing: false, error: "" };
  const listeners = new Set<() => void>();
  let pending: Promise<T> | null = null;
  let queued: (() => Promise<T>) | null = null;
  const publish = (next: typeof snapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: (load, invalidate = false) => {
      if (pending) {
        if (invalidate) queued = load;
        return pending;
      }
      queued = load;
      // Defer loader execution until pending is assigned, including sync throws.
      pending = Promise.resolve().then(async () => {
        publish({ ...snapshot, refreshing: true, error: "" });
        while (queued) {
          const read = queued;
          queued = null;
          try {
            const result = await read();
            if (queued) continue; // A newer invalidation requires a fresh read.
            if (!valid(result)) throw new Error("Invalid cached resource response");
            const next = merge(result, snapshot.data);
            const data = JSON.stringify(next) === JSON.stringify(snapshot.data) ? snapshot.data! : next;
            writeLocalCache(key, data);
            publish({ data, refreshing: true, error: "" });
          } catch (reason) {
            if (queued) continue;
            publish({ ...snapshot, error: reason instanceof Error ? reason.message : String(reason) });
            throw reason;
          }
        }
        return snapshot.data!;
      }).finally(() => {
        pending = null;
        publish({ ...snapshot, refreshing: false });
      });
      return pending;
    },
  };
};
