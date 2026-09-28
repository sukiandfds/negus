import type { SessionMessage } from "../../conversations/model/types";
import type { ThreadGoal } from "./types";

// Codex selects the last turn started no later than goal completion, and only
// attaches the result after that turn has completed.
export function completedGoalMessageId(messages: SessionMessage[], goal?: ThreadGoal | null): string | null {
  if (!goal || goal.status !== "complete") return null;
  const cutoff = goal.updatedAt * 1000;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message.turnId || (message.turnStartedAtMs != null && message.turnStartedAtMs > cutoff)) continue;
    if (message.turnStatus !== "completed") return null;
    for (let item = index; item >= 0 && messages[item].turnId === message.turnId; item--) {
      if (messages[item].role === "assistant") return messages[item].id;
    }
    return null;
  }
  return null;
}
