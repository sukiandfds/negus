const clean = (value, maxLength = 160) => String(value || "").trim().slice(0, maxLength);

/**
 * Resolves a native Codex child to an employee only through trusted thread
 * relationships. Native ancestry may be nested; ordinary forks and unknown
 * parents never establish an owner.
 */
export const createNativeSubagentResolver = ({ registry, employeeConversations }) => {
  const employeeById = new Map((registry?.list?.() || []).map(employee => [clean(employee.id, 80), employee]));
  const employeeByMainThread = new Map((registry?.list?.() || [])
    .map(employee => [clean(employee.mainThreadId, 120), employee])
    .filter(([threadId]) => threadId));

  const ownerForParent = (parentThreadId) => {
    const threadId = clean(parentThreadId, 120);
    const mainEmployee = employeeByMainThread.get(threadId);
    if (mainEmployee) return mainEmployee;
    const binding = employeeConversations?.findByRuntimeSession?.("codex", threadId);
    if (binding?.conversationKind !== "group") return null;
    return employeeById.get(clean(binding.agentId, 80)) || null;
  };

  const resolve = async (session, { sessionsById, findSession } = {}) => {
    const childThreadId = clean(session?.threadId, 120);
    if (!childThreadId || session?.nativeSubagent !== true) return null;
    let parentThreadId = clean(session?.parentThreadId, 120);
    const visited = new Set([childThreadId]);
    while (parentThreadId && !visited.has(parentThreadId)) {
      visited.add(parentThreadId);
      const employee = ownerForParent(parentThreadId);
      if (employee) {
        return {
          employee: { id: clean(employee.id, 80), name: clean(employee.name, 160) || clean(employee.id, 80) },
          parentThreadId,
        };
      }
      let parent = sessionsById?.get?.(parentThreadId);
      if (!parent && findSession) {
        try {
          parent = await findSession(parentThreadId, "all", { limit: 1 });
        } catch {
          parent = null;
        }
      }
      if (parent?.nativeSubagent !== true) return null;
      parentThreadId = clean(parent?.parentThreadId, 120);
    }
    return null;
  };

  return { resolve };
};
