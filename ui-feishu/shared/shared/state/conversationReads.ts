const pending = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;
const publish = () => { version += 1; listeners.forEach(listener => listener()); };

export const conversationReads = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => version,
  pending: () => pending.size > 0,
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
