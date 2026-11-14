import { useCallback, useEffect, useRef, useState } from "react";
import { currentConversationId } from "../../../shared/api/conversationScope";
import { goalApi } from "../data/goalApi";
import type { ProjectEvent } from "../../execution/model/types";
import { goalCompletionKey, type EditableGoalStatus, type ThreadGoal } from "../model/types";

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

import type { ConversationStore } from "../../conversations/state/conversationStore";

export function useThreadGoal(threadId: string, store: ConversationStore) {
  const conversationId = currentConversationId();
  const entries = useRef(new Map<string, Snapshot>());
  const [, render] = useState(0);
  const entry = useCallback((id: string) => {
    if (!entries.current.has(id)) entries.current.set(id, { ...empty(),
      get goal() { return store.get(id).goal; },
      set goal(goal: ThreadGoal | null) { store.update(id, { goal }); } });
    return entries.current.get(id)!;
  }, [store]);
  const notify = useCallback((_id: string) => {
    render((n) => n + 1);
  }, []);
  const accept = useCallback((id: string, goal: ThreadGoal | null, remote = false) => {
    const value = entry(id);
    if (goal?.status === "complete" && store.dismissedGoals.get(id) === goalCompletionKey(goal)) return;
    if (goal && !goal.displayObjective && value.goal?.objective === goal.objective && value.goal.displayObjective) {
      goal = { ...goal, displayObjective: value.goal.displayObjective };
    }
    store.update(id, { goal }, remote);
    if (goal && !remote) value.completed = goal.status === "complete" ? goal : null;
    if (!goal || !["paused", "blocked", "usageLimited"].includes(goal.status)) value.resumePrompt = false;
    value.error = "";
    notify(id);
  }, [store, entry, notify]);

  const refresh = useCallback(async (_signal?: AbortSignal) => {
    if (!threadId) return null;
    await store.request(threadId);
    return store.get(threadId).goal;
  }, [store, threadId]);

  const update = useCallback(async (
    patch: { objective?: string; status?: EditableGoalStatus; tokenBudget?: number; attachmentIds?: string[]; submissionId?: string },
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
    const completed = !preserveCompletion ? value.completed || (value.goal?.status === "complete" ? value.goal : null) : null;
    if (completed && !value.goal) {
      store.dismissedGoals.set(targetId, goalCompletionKey(completed));
      value.completed = null;
      notify(targetId);
      return true;
    }
    const mutation = ++value.mutation;
    const revision = ++value.revision;
    value.busy = true;
    value.error = "";
    notify(targetId);
    try {
      await goalApi.clear(targetId, undefined, value.conversationId);
      if (completed) {
        store.dismissedGoals.set(targetId, goalCompletionKey(completed));
        if (value.completed && goalCompletionKey(value.completed) === goalCompletionKey(completed)) value.completed = null;
        if (value.goal?.status === "complete" && goalCompletionKey(value.goal) === goalCompletionKey(completed)) value.goal = null;
        notify(targetId);
      }
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
    accept(event.threadId, event.goal, true);
  }, [entry, accept]);

  const value = entry(threadId);
  useEffect(() => {
    if (!value.hydrated && store.synced.has(threadId)) {
      value.hydrated = true;
      value.resumePrompt = Boolean(value.goal && ['paused', 'blocked', 'usageLimited'].includes(value.goal.status));
      notify(threadId);
    }
  });
  useEffect(() => {
    if (value.goal?.objective.startsWith("Read the Codex goal objective file at ") && !value.goal.displayObjective) void refresh();
  }, [value.goal?.objective, value.goal?.updatedAt, value.busy, refresh]);
  const completedCleanup = useRef(new Map<string, string>());
  useEffect(() => {
    // Native completion applies to every observed conversation, including background tabs.
    for (const [id, snapshot] of entries.current) {
      const goal = store.committed.get(id)?.goal;
      if (!store.synced.has(id) || goal?.status !== "complete" || snapshot.busy) continue;
      snapshot.completed = goal;
      const key = goalCompletionKey(goal);
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
