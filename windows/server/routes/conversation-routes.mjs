import { createConversationMessageRoutes } from "./conversation-message-routes.mjs";
import { createConversationHistoryRoutes } from "./conversation-history-routes.mjs";
import { createConversationSettingsRoutes } from "./conversation-settings-routes.mjs";
import { createConversationInteractionRoutes } from "./conversation-interaction-routes.mjs";

const publicAttachment = ({ id, name, mimeType, url, width, height, readStatus, readError }) => ({
  id,
  name,
  mimeType,
  url,
  ...(Number.isSafeInteger(width) && Number.isSafeInteger(height) ? { width, height } : {}),
  ...(readStatus ? { readStatus } : {}),
  ...(readError ? { readError } : {}),
});

const publicUserInputRequest = (message) => {
  if (!message || message.method !== "item/tool/requestUserInput") return null;
  const params = message.params || {};
  return {
    requestId: message.id,
    threadId: String(params.threadId || ""),
    turnId: String(params.turnId || ""),
    itemId: String(params.itemId || ""),
    isBlocking: params.isBlocking !== false,
    questions: (Array.isArray(params.questions) ? params.questions : []).slice(0, 3).map((question) => ({
      id: String(question?.id || ""),
      header: String(question?.header || "").slice(0, 120),
      question: String(question?.question || "").slice(0, 4000),
      isOther: question?.isOther === true,
      isSecret: question?.isSecret === true,
      options: Array.isArray(question?.options) ? question.options.slice(0, 20).map((option) => ({
        label: String(option?.label || "").slice(0, 240),
        description: String(option?.description || "").slice(0, 1000),
      })) : null,
    })).filter((question) => question.id && question.question),
  };
};

export const createConversationRoutes = ({
  conversations, execution, followUpQueue, contextManagement, media, submissionStore,
  broadcast = () => {}, publishThreadEvent = (_threadId, event) => broadcast(event), agentConversationStore,
  employeeRuntime, roomDirectory, modelProviders, agentTasks,
}) => {
  const authorizeAgentThread = async ({ threadId, conversationId, allowGroup = false }) => {
    if (!agentConversationStore) return null;
    const cleanThreadId = String(threadId || "").trim();
    const cleanConversationId = String(conversationId || "").trim();
    const boundByThread = cleanThreadId
      ? agentConversationStore.findByRuntimeSession?.("codex", cleanThreadId)
      : null;
    if (!cleanConversationId && boundByThread) {
      throw Object.assign(new Error("conversationId is required for an Agent conversation"), { statusCode: 409 });
    }
    if (!cleanConversationId && !boundByThread) return null;
    const binding = cleanConversationId
      ? await agentConversationStore.resolve({ conversationId: cleanConversationId })
      : boundByThread;
    const allowed = binding.runtimeSessionId === cleanThreadId;
    if (!allowed) throw Object.assign(new Error("conversationId 与 threadId 不匹配"), { statusCode: 409 });
    if (binding.conversationKind === "group" && allowGroup) return binding;
    if (binding.conversationKind === "task" && agentTasks?.ownsThread(cleanThreadId)) return binding;
    if (binding.conversationKind !== "direct") {
      throw Object.assign(new Error("Agent 单聊尚未绑定独立 Thread"), { statusCode: 409 });
    }
    return binding;
  };

  const isEmployeeDirectBinding = (binding) => Boolean(
    binding?.conversationKind === "direct"
      && binding?.agentId
      && employeeRuntime?.supportsEmployee?.(binding.agentId)
      && employeeRuntime?.ownsConversation?.(binding),
  );
  const sessionSource = (binding) => isEmployeeDirectBinding(binding) ? employeeRuntime : conversations;

  const readGroupAgentSession = async (binding, source, pagination = {}) => {
    const options = binding.conversationKind === "task" && pagination ? { ...pagination, contentVersion: undefined } : pagination;
    const session = await conversations.findSession(binding.runtimeSessionId, source, options);
    if (!session) return null;
    return {
      ...session,
      conversationKind: "group",
      readOnly: true,
      conversationId: binding.conversationId,
    };
  };

  const readAgentSession = async (binding, source, pagination) => {
    if (binding.conversationKind === "group") return readGroupAgentSession(binding, source, pagination);
    if (isEmployeeDirectBinding(binding)) return employeeRuntime.readSession(binding.agentId, pagination);
    const session = await conversations.findSession(binding.runtimeSessionId, source, pagination);
    return binding.conversationKind === "task" ? agentTasks?.decorateTaskSession?.(binding.runtimeSessionId, session) ?? session : session;
  };
  const readOrdinarySession = async (threadId, source, pagination) => {
    const session = await conversations.findSession(threadId, source, pagination);
    return agentTasks?.decorateTaskSession?.(threadId, session) ?? session;
  };

  const context = { conversations, execution, followUpQueue, contextManagement, media, submissionStore, publishThreadEvent, agentConversationStore, employeeRuntime, roomDirectory, modelProviders, agentTasks, authorizeAgentThread, isEmployeeDirectBinding, sessionSource, readAgentSession, readOrdinarySession, publicUserInputRequest, publicAttachment };
  const routes = [
    createConversationMessageRoutes(context),
    createConversationHistoryRoutes(context),
    createConversationSettingsRoutes(context),
    createConversationInteractionRoutes(context),
  ];
  return async (request, response, url) => {
    for (const route of routes) if (await route(request, response, url)) return true;
    return false;
  };
};
