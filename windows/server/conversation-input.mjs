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

export async function sendQueuedConversation(conversations,threadId,text,attachments,requestId) {
  let session;
  try { session=await conversations.findSession(threadId,"all",{limit:1}); }
  catch(error){ if(error.statusCode!==404 && (error.statusCode || !/no persisted turns/i.test(error.message)))throw error; }
  // New threads are registered before their first turn has any history.
  session ??= (await conversations.listSessions("all",false)).find(s=>s.threadId===threadId);
  if(!session || session.archived)throw new Error("目标对话已归档或不可用");
  return conversations.sendMessage(threadId,text,attachments,requestId);
}
