import { optimisticMessageId } from "./message-identity.mjs";

export function assertTurnReady(status) {
  if (status.active && !status.turnId) throw Object.assign(new Error("Codex 正在启动当前任务，请稍后再试"), { statusCode: 409 });
}

export const submitThreadInput = (conversations, status, threadId, text, attachments, submissionId) =>
  status.active ? conversations.steerMessage(threadId, status.turnId, text, attachments, submissionId)
    : conversations.sendMessage(threadId, text, attachments, submissionId);

export function publishSubmitted(publish, { threadId, submissionId, text, attachments, createdAt, messageId = optimisticMessageId(submissionId), ...metadata }) {
  publish(threadId, { ...metadata, type: "user_message_submitted", threadId, submissionId, messageId, text, attachments, createdAt });
}

export const acceptedInputEvent = (threadId, submissionId, turnId, extra) => ({
  ...extra, type: "user_message_accepted", threadId, submissionId, turnId,
});
