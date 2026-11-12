export const createConversationService = ({ primary, fallback, contentVersionStore }) => {
  const inFlightFinds = new Map();

  const withFallback = async (operation, ...args) => {
    try {
      return await primary[operation](...args);
    } catch (error) {
      // A refusal is an answer, not an outage: the fallback must not serve
      // what the primary store deliberately declined.
      if (error?.statusCode === 403) throw error;
      console.warn(`[conversation-service] app-server request failed, using JSONL fallback: ${error.message}`);
      return fallback[operation](...args);
    }
  };

  const findSession = (...args) => {
    const key = JSON.stringify({
      threadId: String(args[0] || ""),
      source: String(args[1] || "all"),
      options: args[2] || {},
    });
    const existing = inFlightFinds.get(key);
    if (existing) return existing;

    const request = (async () => {
      const session = await withFallback("findSession", ...args);
      if (!session || !contentVersionStore) return session;
      const threadId = String(args[0] || "");
      const options = args[2] || {};
      const recentWindow = options.before === undefined && options.cursor === undefined;
      if (!recentWindow) return contentVersionStore.decorate(threadId, session);
      return contentVersionStore.sync(threadId, session, {
        requestedVersion: options.contentVersion,
        incremental: Number.isSafeInteger(options.contentVersion),
      });
    })();
    inFlightFinds.set(key, request);
    void request.finally(() => {
      if (inFlightFinds.get(key) === request) inFlightFinds.delete(key);
    }).catch(() => {});
    return request;
  };

  // Reads fall back to the JSONL files when the app-server is unavailable;
  // everything that changes or runs a thread needs the app-server itself.
  const primaryOperations = [
    "createSession", "sendMessage", "steerMessage", "interrupt", "forkSession", "archiveSession",
    "unarchiveSession", "listModels", "updateModel", "updateReasoningEffort", "getRuntimeContext",
    "getThreadStatus", "compactContext", "assertProjectThread",
  ];

  return {
    ...Object.fromEntries(primaryOperations.map((operation) => [operation, (...args) => primary[operation](...args)])),
    listSessions: (...args) => withFallback("listSessions", ...args),
    findSession,
    close: () => {
      inFlightFinds.clear();
      primary.close();
      fallback.close();
      void contentVersionStore?.close?.();
    },
  };
};
