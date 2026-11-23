// One reason and one conversation-scoped notice for every rejected operation.
export const occupationText = "该对话正在被 Codex 占用中";
export const isOccupied = (reason = "") => /active writer/iu.test(reason) || reason === occupationText;
const listeners = new Set<() => void>();
const recent = new Map<string, number>();
export const occupationNotices = {
  get: (scope: string) => recent.get(scope),
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  report: (scope: string) => {
    if (!scope) return;
    recent.delete(scope);
    recent.set(scope, Date.now());
    if (recent.size > 128) recent.delete(recent.keys().next().value!);
    listeners.forEach(fn => fn());
  },
};
