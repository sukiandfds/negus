export const currentConversationId = () => new URLSearchParams(window.location.search).get("conversation") || "";

export const conversationQuery = (conversationId = currentConversationId()) => {
  return conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : "";
};

export const withConversation = <T extends Record<string, unknown>>(body: T, conversationId = currentConversationId()) => {
  return conversationId ? { ...body, conversationId } : body;
};
