// App-server and multi-agent execution streams use the same terminal phases.
// Keep this contract in one place so a new terminal state cannot leave one
// surface polling forever while the other considers it finished.
export const turnOutcomes = new Set(["completed", "failed", "interrupted"]);
export const terminalPhases = new Set([...turnOutcomes, "systemError"]);
export const waitingPhaseFor = method => method?.endsWith("/requestApproval") ? "waitingOnApproval"
  : ["item/tool/requestUserInput", "mcpServer/elicitation/request"].includes(method) ? "waitingOnUserInput" : "";
export const startTurn = (client, params, ...options) => client.request("turn/start", params, ...options);
export const steerTurn = (client, params, expectedTurnId) => {
  if (!expectedTurnId) throw Object.assign(new Error("缺少要插入的轮次编号"), { statusCode: 409 });
  return client.request("turn/steer", { ...params, expectedTurnId });
};
export const interruptTurn = (client, threadId, turnId) => client.request("turn/interrupt", { threadId, turnId });

export function threadPhase(status) {
  if (status?.type !== "active") return status?.type === "idle" || status?.type === "systemError" ? status.type : "unknown";
  return ["waitingOnApproval", "waitingOnUserInput"].find(phase => status.activeFlags?.includes(phase)) || "working";
}

export const turnCompletion = (turn, fallback = "completed") => ({
  status: turn?.status || fallback, error: turn?.error?.message || "",
});

export const startConversationThread = (client, params) => client.request("thread/start", params);
export const resumeConversationThread = (client, params) =>
  client.request("thread/resume", { persistExtendedHistory: true, ...params });
