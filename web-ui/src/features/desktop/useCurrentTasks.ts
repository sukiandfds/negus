import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJson } from "../../shared/api/http";
import type { useProjectDirectory } from "../project-directory/hooks/useProjectDirectory";
import type { GoalResponse, ThreadGoal } from "../goals/model/types";
import { collectCurrentTasks } from "./currentTasks";
import { readLocalCache, writeLocalCache } from "../../shared/state/localCache";

interface GoalCache { goals: Record<string, ThreadGoal | null>; checks: [string, { signature: string; at: number; failed: boolean }][] }
const cacheKey = "negus:desktop-goals:v1";
const readGoals = () => readLocalCache<GoalCache>(cacheKey, (value): value is GoalCache => Boolean(value && typeof value === "object" && (value as GoalCache).goals && Array.isArray((value as GoalCache).checks)));

export function useCurrentTasks(directory: ReturnType<typeof useProjectDirectory>, active: boolean) {
  const [cached] = useState(readGoals);
  const [goals, setGoals] = useState<Record<string, ThreadGoal | null>>(cached?.goals || {});
  const [checking, setChecking] = useState(false);
  const [goalError, setGoalError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [checkRevision, setCheckRevision] = useState(0);
  const latest = useRef(directory);
  latest.current = directory;
  useEffect(() => {
    if (!active || !directory.error) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (!document.hidden) void latest.current.refresh(controller.signal);
    }, 15000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [active, directory.error]);
  const goalsRef = useRef(goals);
  goalsRef.current = goals;
  const checked = useRef(new Map<string, { signature: string; at: number; failed: boolean }>(cached?.checks || []));
  useEffect(() => {
    const timer = window.setTimeout(() => writeLocalCache(cacheKey, { goals, checks: [...checked.current] }), 300);
    return () => window.clearTimeout(timer);
  }, [goals, checkRevision]);
  const eventVersions = useRef<Record<string, ThreadGoal | null>>({});
  useEffect(() => {
    const changed = Object.fromEntries(Object.entries(directory.goalByThread).filter(([id, goal]) => eventVersions.current[id] !== goal));
    eventVersions.current = directory.goalByThread;
    if (Object.keys(changed).length) setGoals((current) => ({ ...current, ...changed }));
  }, [directory.goalByThread]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      const entries = latest.current.projects.flatMap((project) => (project.conversations || [])
        .filter((entry) => !entry.archived && !entry.pendingOpen && entry.threadId)
        .map((entry) => ({ ...entry, employee: Boolean(project.employeeId) })));
      const unique = [...new Map(entries.map((entry) => [entry.threadId!, entry])).values()];
      const queue = unique.filter((entry) => {
        const previous = checked.current.get(entry.threadId!);
        const signature = latest.current.statusByThread[entry.threadId!]?.turnId || entry.status?.turnId || "";
        if (!previous) return true;
        if (previous.failed) return Date.now() - previous.at > 60_000;
        const goal = goalsRef.current[entry.threadId!];
        return previous.signature !== signature || Date.now() - previous.at > 300_000
          || (goal && goal.status !== "complete" && Date.now() - previous.at > 15_000);
      });
      const hasChecks = queue.length > 0;
      queue.sort((a, b) => Number(Boolean(latest.current.statusByThread[b.threadId!]?.active || goalsRef.current[b.threadId!])) - Number(Boolean(latest.current.statusByThread[a.threadId!]?.active || goalsRef.current[a.threadId!])));
      setChecking(queue.length > 0);
      // Read-only native goal queries; bounded concurrency and no model generation.
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length && !controller.signal.aborted && document.visibilityState !== "hidden") {
          const entry = queue.shift()!;
          const id = entry.threadId!;
          const version = eventVersions.current[id];
          const signature = latest.current.statusByThread[id]?.turnId || entry.status?.turnId || "";
          const query = new URLSearchParams({ threadId: id });
          if (entry.employee && entry.conversationId) query.set("conversationId", entry.conversationId);
          try {
            const result = await fetchJson<GoalResponse>(`/api/session/goal?${query}`, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
            if (controller.signal.aborted) return;
            if (eventVersions.current[id] === version) setGoals((current) => JSON.stringify(current[id] ?? null) === JSON.stringify(result.goal || null) ? current : ({ ...current, [id]: result.goal || null }));
            checked.current.set(id, { signature, at: Date.now(), failed: false });
          } catch {
            if (controller.signal.aborted) return;
            checked.current.set(id, { signature, at: Date.now(), failed: true });
          }
        }
      }));
      if (!controller.signal.aborted) {
        if (hasChecks) setCheckRevision((value) => value + 1);
        setGoalError(unique.some((entry) => checked.current.get(entry.threadId!)?.failed));
        setChecking(false);
        busy = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [active, directory.projects.length, revision]);
  const tasks = useMemo(() => collectCurrentTasks(directory.projects, directory.statusByThread, goals), [directory.projects, directory.statusByThread, goals]);
  const retry = () => {
    for (const [id, value] of checked.current) if (value.failed) checked.current.delete(id);
    setRevision((value) => value + 1);
    void directory.refresh();
  };
  return { tasks, checking, goalError, retry };
}
