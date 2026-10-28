import { projectDirectoryApi, projectDirectoryResource } from "../../features/project-directory/data/projectDirectoryApi";

export const conversationIdentity = (threadId: string) => {
  for (const project of projectDirectoryResource.getSnapshot().data || []) {
    const entry = project.conversations?.find(item => item.threadId === threadId);
    if (entry?.conversationId || (threadId && project.mainThreadId === threadId)) return {
      conversationId: entry?.conversationId || project.mainConversationId || "",
      agentId: project.employeeId || "",
    };
  }
  return null;
};

export const currentConversationId = (threadId = new URLSearchParams(window.location.search).get("thread") || "") => {
  const params = new URLSearchParams(window.location.search);
  return conversationIdentity(threadId)?.conversationId
    || (params.get("thread") === threadId ? params.get("conversation") || "" : "");
};

export const conversationQuery = (conversationId = currentConversationId()) => {
  return conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : "";
};

export const withConversation = <T extends Record<string, unknown>>(body: T, conversationId = currentConversationId(typeof body.threadId === "string" ? body.threadId : undefined)) => {
  return conversationId ? { ...body, conversationId } : body;
};

export const resolveConversationId = async (threadId: string) => {
  if (!projectDirectoryResource.getSnapshot().data) await projectDirectoryApi.list();
  return currentConversationId(threadId);
};
