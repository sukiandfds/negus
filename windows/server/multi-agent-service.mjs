import { randomUUID } from "node:crypto";
import { createAppServerClient } from "./app-server-client.mjs";
import { inputFromAttachments } from "./app-server-conversation-store.mjs";
import { buildDiscussionPrompt, cleanAgentIds, mentionedAgentIds } from "./multi-agent/discussion-prompt.mjs";
import { completeOutputJob } from "./multi-agent/output-job.mjs";
import { agentStateFromItem, terminalAgentPhases } from "./multi-agent/protocol-state.mjs";

const maxDiscussionTurns = 4;

export { buildDiscussionPrompt, mentionedAgentIds } from "./multi-agent/discussion-prompt.mjs";

export const createMultiAgentService = ({
  projectRoot, room, broadcast, webOutputs, client = createAppServerClient(),
}) => {
  const threadAgents = new Map();
  const activeModes = new Map();
  let currentRun = null;
  let workQueue = Promise.resolve();
  let closed = false;
  // Bumped by every stop request: a discussion only keeps going while the
  // generation it was queued under is still the current one.
  let generation = 0;

  for (const agent of room.snapshot().agents) {
    if (agent.threadId) threadAgents.set(agent.threadId, agent.id);
  }

  const setStatus = (agentId, patch) => room.updateAgent(agentId, {
    active: !terminalAgentPhases.has(patch.phase) && patch.phase !== "idle",
    ...patch,
  }).catch((error) => console.warn(`[multi-agent] status update failed: ${error.message}`));

  const finishStatus = (agentId, patch) => {
    activeModes.delete(agentId);
    void setStatus(agentId, { active: false, ...patch });
  };

  const settleRun = (threadId, status, errorMessage = "") => {
    const run = currentRun;
    if (!run || run.threadId !== threadId) return;
    currentRun = null;
    clearTimeout(run.timer);
    finishStatus(run.agentId, {
      phase: status,
      label: status === "failed" ? "执行失败" : status === "interrupted" ? "任务已中断" : "任务已完成",
      detail: errorMessage,
    });
    Promise.resolve(run.messageWrite)
      .then((message) => run.resolve({ status, text: run.finalText, message: message || null }))
      .catch(() => run.resolve({ status, text: run.finalText, message: null }));
  };

  const requestInterrupt = (run) => client
    .request("turn/interrupt", { threadId: run.threadId, turnId: run.turnId })
    .catch((error) => console.warn(`[multi-agent] interrupt failed: ${error.message}`));

  // A stop can arrive before Codex has reported the turn id it needs.
  const rememberTurn = (threadId, turnId) => {
    const run = currentRun;
    if (!turnId || run?.threadId !== threadId || run.turnId) return;
    run.turnId = String(turnId);
    if (run.interruptRequested) void requestInterrupt(run);
  };

  const handleProtocolMessage = (message) => {
    const { method, params = {} } = message || {};
    const agentId = threadAgents.get(params.threadId);
    if (!agentId) return;

    if (method === "turn/started") {
      rememberTurn(params.threadId, params.turn?.id);
      void setStatus(agentId, { phase: "working", label: "正在处理任务", detail: "", active: true });
      return;
    }
    if (method === "turn/completed") {
      const status = params.turn?.status || "completed";
      settleRun(params.threadId, status, params.turn?.error?.message || "");
      return;
    }
    if (method === "item/started") {
      const state = agentStateFromItem(params.item);
      if (state) void setStatus(agentId, { ...state, active: true });
      return;
    }
    if (method === "item/agentMessage/delta") {
      broadcast({ type: "group_agent_delta", agentId, ...params });
      return;
    }
    if (method === "item/completed" && params.item?.type === "agentMessage" && params.item.phase !== "commentary") {
      const messageWrite = room.addMessage({
        type: "agent",
        authorId: agentId,
        authorName: room.getAgent(agentId)?.name || "Codex Agent",
        agentId,
        mode: activeModes.get(agentId) || "discussion",
        text: params.item.text,
      });
      if (currentRun?.threadId === params.threadId) {
        currentRun.finalText = params.item.text;
        currentRun.messageWrite = messageWrite;
      }
      void messageWrite.catch((error) => console.warn(`[multi-agent] message write failed: ${error.message}`));
      return;
    }
    if (method?.endsWith("/requestApproval")) {
      void setStatus(agentId, { phase: "waitingOnApproval", label: "等待电脑端审批", detail: "", active: true });
      return;
    }
    if (method === "item/tool/requestUserInput" || method === "mcpServer/elicitation/request") {
      void setStatus(agentId, { phase: "waitingOnUserInput", label: "等待补充信息", detail: "", active: true });
    }
  };

  const unsubscribe = client.subscribe(handleProtocolMessage);
  // Without this a crashed app-server would leave the running Agent, and the
  // whole queue behind it, waiting for the 30 minute reply timeout.
  const unsubscribeHealth = client.subscribeHealth?.((event) => {
    if (event?.phase === "exited" && currentRun) settleRun(currentRun.threadId, "failed", "Codex 进程已退出");
  }) || (() => {});

  const ensureThread = async (agent) => {
    if (agent.threadId) {
      await client.request("thread/resume", { threadId: agent.threadId, persistExtendedHistory: true });
      threadAgents.set(agent.threadId, agent.id);
      return agent.threadId;
    }
    const result = await client.request("thread/start", {
      cwd: projectRoot,
      developerInstructions: agent.instructions,
      ephemeral: false,
      serviceName: "codex-collab-panel-demo",
    });
    const threadId = result.thread.id;
    threadAgents.set(threadId, agent.id);
    await client.request("thread/name/set", { threadId, name: `${agent.name} · ${agent.responsibility}` });
    // Only record the new thread: the Agent is in the middle of starting a
    // task, so its visible status must not drop back to idle here.
    await room.updateAgent(agent.id, { threadId });
    return threadId;
  };

  const runAgent = async ({ agentId, mode, requestText, followUp, attachments, outputJob, stopped }) => {
    if (closed) throw new Error("多 Agent 服务已关闭");
    const agent = room.getAgent(agentId);
    if (!agent) throw Object.assign(new Error("Agent 不存在"), { statusCode: 404 });

    await setStatus(agentId, { phase: "submitted", label: "已接收群聊任务", detail: "正在连接 Codex", active: true });
    const threadId = await ensureThread(agent);
    if (stopped()) {
      // Stopped while the thread was still being prepared: never start the turn.
      finishStatus(agentId, { phase: "interrupted", label: "任务已取消", detail: "" });
      return { status: "interrupted", text: "" };
    }
    const outputInstructions = outputJob && outputJob.agentId === agentId
      ? webOutputs.buildAgentInstructions(outputJob)
      : "";
    const prompt = buildDiscussionPrompt({ agent, mode, requestText, snapshot: room.snapshot(), followUp, outputInstructions });
    activeModes.set(agentId, mode);

    let resolveRun;
    const completion = new Promise((resolve) => { resolveRun = resolve; });
    const timer = setTimeout(() => {
      if (currentRun?.threadId !== threadId) return;
      currentRun = null;
      activeModes.delete(agentId);
      void setStatus(agentId, { phase: "failed", label: "等待回复超时", detail: "", active: false });
      resolveRun({ status: "failed", text: "" });
    }, 30 * 60 * 1000);
    timer.unref?.();
    currentRun = { agentId, threadId, resolve: resolveRun, timer, finalText: "", messageWrite: null };

    try {
      const started = await client.request("turn/start", {
        threadId,
        input: inputFromAttachments(prompt, attachments),
        cwd: projectRoot,
      });
      rememberTurn(threadId, started?.turn?.id);
      return await completion;
    } catch (error) {
      if (currentRun?.threadId === threadId) currentRun = null;
      clearTimeout(timer);
      finishStatus(agentId, { phase: "failed", label: "任务启动失败", detail: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };

  const runDiscussion = async ({ agentIds, mode, requestText, attachments, outputJob, queuedGeneration }) => {
    const agents = room.snapshot().agents;
    const pending = cleanAgentIds(agentIds, agents);
    const runCounts = new Map();
    let needsManagerFollowUp = pending.some((id) => id !== "manager");
    let turns = 0;
    const stopped = () => generation !== queuedGeneration;

    if (stopped()) {
      // Stopped while still waiting behind another discussion.
      if (outputJob) webOutputs.abandonJob(outputJob.jobId);
      finishStatus(pending[0], { phase: "interrupted", label: "任务已取消", detail: "" });
      return;
    }

    while (turns < maxDiscussionTurns && !stopped()) {
      if (!pending.length && needsManagerFollowUp && (runCounts.get("manager") || 0) < 2) {
        pending.push("manager");
        needsManagerFollowUp = false;
      }
      const agentId = pending.shift();
      if (!agentId) break;
      const limit = agentId === "manager" ? 2 : 1;
      if ((runCounts.get(agentId) || 0) >= limit) continue;
      if (agentId === "manager" && needsManagerFollowUp) needsManagerFollowUp = false;

      const followUp = turns > 0;
      try {
        const result = await runAgent({ agentId, mode, requestText, followUp, attachments, outputJob, stopped });
        turns += 1;
        runCounts.set(agentId, (runCounts.get(agentId) || 0) + 1);
        if (stopped()) {
          if (outputJob) webOutputs.abandonJob(outputJob.jobId);
          return;
        }
        if (outputJob && outputJob.agentId === agentId) {
          await completeOutputJob({ outputJob, result, agentId, mode, room, webOutputs, setStatus, finishStatus });
          return;
        }
        if (agentId !== "manager") needsManagerFollowUp = true;

        for (const mentionedId of mentionedAgentIds(result.text, room.snapshot().agents)) {
          const mentionedLimit = mentionedId === "manager" ? 2 : 1;
          if (mentionedId !== agentId
            && (runCounts.get(mentionedId) || 0) < mentionedLimit
            && !pending.includes(mentionedId)) {
            pending.push(mentionedId);
          }
        }
      } catch (error) {
        if (outputJob) webOutputs.abandonJob(outputJob.jobId);
        turns += 1;
        runCounts.set(agentId, (runCounts.get(agentId) || 0) + 1);
        await room.addMessage({
          type: "system",
          authorId: "system",
          authorName: "系统",
          agentId,
          mode,
          text: `${room.getAgent(agentId)?.name || "Agent"}启动失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  };

  const enqueueDiscussion = async ({ agentIds, mode, requestText, attachments = [], sourceMessageId = "" }) => {
    const agents = room.snapshot().agents;
    let targets = cleanAgentIds(agentIds, agents);
    if (!targets.length) throw Object.assign(new Error("请选择一个可用 Agent"), { statusCode: 404 });
    const outputJob = webOutputs?.isRequest(requestText)
      ? await webOutputs.createJob({ sourceMessageId, agentId: "developer" })
      : null;
    if (outputJob) targets = ["developer"];
    const executionMode = outputJob ? "development" : mode;
    const jobId = outputJob?.jobId || randomUUID();
    const queuedGeneration = generation;
    void setStatus(targets[0], { phase: "queued", label: "已加入讨论队列", detail: "", active: true });
    workQueue = workQueue
      .catch(() => {})
      .then(() => runDiscussion({
        agentIds: targets, mode: executionMode, requestText, attachments, outputJob, queuedGeneration,
      }))
      .catch((error) => console.warn(`[multi-agent] discussion ${jobId} failed: ${error.message}`));
    return { jobId, agentIds: targets, status: "queued" };
  };

  // Stops the Agent that is running and drops every discussion queued behind
  // it. Returns the Agents that were actually affected.
  const interrupt = async () => {
    const agentIds = room.snapshot().agents.filter((agent) => agent.active).map((agent) => agent.id);
    generation += 1;
    const run = currentRun;
    if (run) {
      run.interruptRequested = true;
      if (run.turnId) await requestInterrupt(run);
    }
    return { interrupted: agentIds.length > 0, agentIds };
  };

  const close = () => {
    closed = true;
    if (currentRun) {
      clearTimeout(currentRun.timer);
      currentRun.resolve({ status: "interrupted", text: currentRun.finalText });
      currentRun = null;
    }
    unsubscribe();
    unsubscribeHealth();
    client.close();
  };

  return { enqueueDiscussion, interrupt, close };
};
