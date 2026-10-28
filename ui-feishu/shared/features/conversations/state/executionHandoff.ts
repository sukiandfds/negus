import type { SessionMessage } from "../model/types";
import type { ExecutionStatus } from "../../execution/model/types";

export const executionHandoff = (threadId: string, messages: SessionMessage[], status: ExecutionStatus) => {
  const showExecution = status.threadId === threadId && (Boolean(status.notices?.length) || (Boolean(status.startedAt) && status.phase !== "idle"));
  const replies = showExecution ? messages.filter(message => message.role === "assistant"
    && Boolean(status.turnId) && (message.protocolTurnId || message.turnId) === status.turnId) : [];
  const historyConfirmsNoReply = status.hasFinalAnswer !== true && messages.some(message =>
    Boolean(status.turnId) && (message.protocolTurnId || message.turnId) === status.turnId
    && message.turnStatus === "completed" && message.turnHasFinalAnswer === false);
  const waitingForReply = showExecution && status.phase === "completed" && status.hasFinalAnswer !== false
    && !historyConfirmsNoReply && !replies.some(message => message.phase === "final_answer" && !message.superseded);
  const latestReplyAt = replies.reduce<string | undefined>((latest, message) => {
    if (!message.createdAt || !Number.isFinite(Date.parse(message.createdAt))) return latest;
    return !latest || Date.parse(message.createdAt) > Date.parse(latest) ? message.createdAt : latest;
  }, undefined);
  return { showExecution, waitingForReply, latestReplyAt };
};
