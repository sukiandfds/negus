const pending = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;
const publish = () => { version += 1; listeners.forEach(listener => listener()); };

export const conversationReads = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => version,
  pending: () => pending.size > 0,
  // FEAT-001 (2026-10-30): wait only for this fixed batch, never restart its deadline.
  wait: (threadIds: ReadonlySet<string>, timeoutMs = 10000) => new Promise<void>((resolve, reject) => {
    const relevant = () => [...pending.keys()].some(pathname => {
      const url = new URL(pathname, window.location.origin);
      const id = url.searchParams.get('threadId');
      return !id || threadIds.has(id);
    });
    const finish = () => { if (!relevant()) { cleanup(); resolve(); } };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('同步超时，正在保留当前内容')); }, timeoutMs);
    const cleanup = () => { window.clearTimeout(timer); listeners.delete(finish); };
    listeners.add(finish);
    finish();
  }),
  start: (pathname: string) => {
    const url = new URL(pathname, window.location.origin);
    if (!/^\/api\/(?:project|project-directory|sessions|models|model-defaults|execution-status|session(?:\/(?:context|goal|queue|user-input))?)$/u.test(url.pathname)
      || url.searchParams.has('before') || url.searchParams.has('cursor')) return () => {};
    pending.set(pathname, (pending.get(pathname) || 0) + 1);
    publish();
    // Let the existing request handlers apply their results before releasing the display.
    return () => window.setTimeout(() => {
      const remaining = (pending.get(pathname) || 1) - 1;
      if (remaining) pending.set(pathname, remaining); else pending.delete(pathname);
      publish();
    }, 0);
  },
};
