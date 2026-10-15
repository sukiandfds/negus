import { useCallback, useEffect, useRef, useState } from "react";
import { currentConversationId } from "../../../shared/api/conversationScope";
import { goalApi } from "../data/goalApi";
import type { ProjectEvent } from "../../execution/model/types";
import type { EditableGoalStatus, ThreadGoal } from "../model/types";

interface Snapshot {
  goal: ThreadGoal | null;
  completed: ThreadGoal | null;
  error: string;
  busy: boolean;
  revision: number;
  mutation: number;
  conversationId: string;
  hydrated: boolean;
  resumePrompt: boolean;
}
const empty = (): Snapshot => ({ goal: null, completed: null, error: "", busy: false, revision: 0, mutation: 0, conversationId: "", hydrated: false, resumePrompt: false });

export function useThreadGoal(threadId: string) {
  const conversationId = currentConversationId();
  const entries = useRef(new Map<string, Snapshot>());
  const [, render] = useState(0);
  const entry = useCallback((id: string) => {
    if (!entries.current.has(id)) entries.current.set(id, empty());
    return entries.current.get(id)!;
  }, []);
  const notify = useCallback((_id: string) => {
    render((n) => n + 1);
  }, []);
  const accept = useCallback((id: string, goal: ThreadGoal | null) => {
    const value = entry(id);
    if (goal && !goal.displayObjective && value.goal?.objective === goal.objective && value.goal.displayObjective) {
      goal = { ...goal, displayObjective: value.goal.displayObjective };
    }
    value.goal = goal;
    if (goal) value.completed = goal.status === "complete" ? goal : null;
    if (!goal || !["paused", "blocked", "usageLimited"].includes(goal.status)) value.resumePrompt = false;
    value.error = "";
    notify(id);
  }, [entry, notify]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!threadId) return null;
    const value = entry(threadId);
    value.conversationId = conversationId;
    if (value.busy) return value.goal;
    const revision = ++value.revision;
    try {
      const result = await goalApi.get(threadId, signal, value.conversationId);
      if (!signal?.aborted && value.revision === revision) {
        if (!value.hydrated) value.resumePrompt = Boolean(result.goal && ["paused", "blocked", "usageLimited"].includes(result.goal.status));
        value.hydrated = true;
        accept(threadId, result.goal);
      }
      return result.goal;
    } catch (reason) {
      if (!signal?.aborted && value.revision === revision) {
        value.error = reason instanceof Error ? reason.message : String(reason);
        notify(threadId);
      }
      return null;
    }
  }, [threadId, conversationId, entry, accept, notify]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const update = useCallback(async (
    patch: { objective?: string; status?: EditableGoalStatus; tokenBudget?: number; attachmentIds?: string[] },
    targetId = threadId,
  ) => {
    if (!targetId) return null;
    const value = entry(targetId);
    value.conversationId = conversationId;
    if (value.busy) return null;
    const mutation = ++value.mutation;
    const revision = ++value.revision;
    value.busy = true;
    value.error = "";
    notify(targetId);
    try {
      const result = await goalApi.set(targetId, patch, undefined, value.conversationId);
      // A newer native notification or snapshot wins over an older HTTP response.
      if (value.revision === revision) accept(targetId, result.goal);
      return result.goal;
    } catch (reason) {
      if (value.mutation === mutation) {
        value.error = reason instanceof Error ? reason.message : String(reason);
        notify(targetId);
      }
      return null;
    } finally {
      if (value.mutation === mutation) { value.busy = false; notify(targetId); }
    }
  }, [threadId, conversationId, entry, accept, notify]);

  const clear = useCallback(async (preserveCompletion = false, targetId = threadId) => {
    if (!targetId) return false;
    const value = entry(targetId);
    if (value.busy) return false;
    const mutation = ++value.mutation;
    const revision = ++value.revision;
    value.busy = true;
    value.error = "";
    notify(targetId);
    try {
      await goalApi.clear(targetId, undefined, value.conversationId);
      if (value.revision === revision) {
        value.goal = null;
        if (!preserveCompletion) value.completed = null;
        notify(targetId);
      }
      return true;
    } catch (reason) {
      if (value.mutation === mutation) {
        value.error = reason instanceof Error ? reason.message : String(reason);
        notify(targetId);
      }
      return false;
    } finally {
      if (value.mutation === mutation) { value.busy = false; notify(targetId); }
    }
  }, [threadId, entry, notify]);

  const handleEvent = useCallback((event: ProjectEvent) => {
    if (event.type !== "goal_status") return;
    const value = entry(event.threadId);
    if (event.conversationId) value.conversationId = event.conversationId;
    value.revision += 1;
    accept(event.threadId, event.goal);
  }, [entry, accept]);

  const value = entry(threadId);
  useEffect(() => {
    if (value.goal?.objective.startsWith("Read the Codex goal objective file at ") && !value.goal.displayObjective) void refresh();
  }, [value.goal?.objective, value.goal?.updatedAt, value.busy, refresh]);
  const completedCleanup = useRef(new Map<string, string>());
  useEffect(() => {
    // Native completion applies to every observed conversation, including background tabs.
    for (const [id, snapshot] of entries.current) {
      const goal = snapshot.goal;
      if (goal?.status !== "complete" || snapshot.busy) continue;
      const key = JSON.stringify([goal.createdAt, goal.updatedAt, goal.objective]);
      if (completedCleanup.current.get(id) === key) continue;
      completedCleanup.current.set(id, key);
      void clear(true, id);
    }
  });

  const dismissResumePrompt = useCallback(() => {
    entry(threadId).resumePrompt = false;
    notify(threadId);
  }, [threadId, entry, notify]);
  return { goal: value.goal || value.completed, busy: value.busy, error: value.error,
    resumePrompt: value.resumePrompt, dismissResumePrompt, refresh, update, clear, handleEvent };
}
