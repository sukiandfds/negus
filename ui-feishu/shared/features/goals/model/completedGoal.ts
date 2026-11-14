import type { SessionMessage } from "../../conversations/model/types";
import type { ThreadGoal } from "./types";

// Codex selects the last turn started no later than goal completion, and only
// attaches the result after that turn has completed.
export function completedGoalMessageId(messages: SessionMessage[], goal?: ThreadGoal | null): string | null {
  if (!goal || goal.status !== "complete") return null;
  const cutoff = goal.updatedAt * 1000;
  const turns = new Map<string, SessionMessage[]>();
  for (const message of messages) {
    if (!message.turnId || (message.turnStartedAtMs != null && message.turnStartedAtMs > cutoff)) continue;
    turns.set(message.turnId, [...(turns.get(message.turnId) || []), message]);
  }
  const candidates = [...turns.values()].sort((left, right) =>
    (right[0].turnStartedAtMs ?? 0) - (left[0].turnStartedAtMs ?? 0));
  const latest = candidates[0];
  if (!latest || !latest.some(message => message.turnStatus === "completed")) return null;
  return latest.filter(message => message.role === "assistant").at(-1)?.id || null;
}
