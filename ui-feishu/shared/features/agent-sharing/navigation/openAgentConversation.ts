import { postJson } from "../../../shared/api/http";

interface OpenAgentConversationResponse {
  conversationId: string;
  runtimeKind: string;
  threadId: string | null;
}

export async function openAgentConversation({ agentId, threadId = "", conversationId = "", projectContext }: {
  agentId: string;
  threadId?: string | null;
  conversationId?: string | null;
  projectContext?: {
    id?: string | null;
    title?: string | null;
    phase?: string | null;
    goal?: string | null;
  };
}) {
  const opened = threadId ? { threadId, conversationId } : await postJson<OpenAgentConversationResponse>(
    "/api/agent-conversations/open",
    { agentId },
  );
  if (!opened.threadId) throw new Error("当前 Runtime 暂不支持此单聊页面");

  const params = new URLSearchParams(window.location.search);
  params.delete("view");
  params.delete("archived");
  params.delete("employee");
  params.delete("employeeId");
  params.set("agent", agentId);
  if (projectContext?.id) params.set("managerProjectId", projectContext.id);
  else params.delete("managerProjectId");
  if (projectContext?.title) params.set("managerProjectTitle", projectContext.title);
  else params.delete("managerProjectTitle");
  if (projectContext?.phase) params.set("managerProjectPhase", projectContext.phase);
  else params.delete("managerProjectPhase");
  if (projectContext?.goal) params.set("managerProjectGoal", projectContext.goal);
  else params.delete("managerProjectGoal");
  params.set("thread", opened.threadId);
  if (opened.conversationId) params.set("conversation", opened.conversationId);
  else params.delete("conversation");
  const query = params.toString();
  window.history.pushState({ surface: "conversation", agentId, threadId: opened.threadId }, "", `/${query ? `?${query}` : ""}`);
  window.dispatchEvent(new Event("negus:navigate"));
  return opened;
}
