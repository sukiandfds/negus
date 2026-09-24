import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadEmployeeDefinitions } from "./employee-definitions.mjs";
import { mentionedAgentIds } from "./multi-agent/agent-routing.mjs";
import { CURRENT_MODEL_PROVIDER_ID } from "./model-provider-service.mjs";

const cleanText = (value, maxLength) => String(value || "").trim().slice(0, maxLength);
const replyExcerpt = (message) => {
  const text = cleanText(message?.text, 160);
  if (text) return text;
  const names = (Array.isArray(message?.attachments) ? message.attachments : [])
    .map((file) => cleanText(file?.name, 80))
    .filter(Boolean);
  return cleanText(names.join("、"), 160);
};
const safeSequence = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const pageSize = (value) => Math.max(1, Math.min(100, Number.parseInt(value, 10) || 50));
// Keep each Agent turn bounded even when a room has a long-lived public history.
// The full history remains available through getMessagePage()/the history API.
const agentContextMessageLimit = 80;
const initialContextMessageLimit = 12;
const agentContextCharacterLimit = 48000;
const messageCharacters = (message) => String(message?.text || "").length
  + (Array.isArray(message?.attachments)
    ? message.attachments.reduce((sum, file) => sum + String(file?.name || "").length, 0)
    : 0);
const promptTextCap = 6000;
const countedCharacters = (message) => Math.min(messageCharacters(message), promptTextCap);
const selectContextMessages = (available, assignment, messageLimit) => {
  if (!available.length) return [];
  const newest = available.at(-1);
  const pinned = [];
  if (assignment) pinned.push(assignment);
  if (newest && newest.id !== assignment?.id) pinned.push(newest);
  const selectedIds = new Set(pinned.map((message) => message.id));
  let characterCount = pinned.reduce((sum, message) => sum + countedCharacters(message), 0);
  let added = 0;
  const room = Math.max(0, messageLimit - pinned.length);
  for (let index = available.length - 1; index >= 0 && added < room; index -= 1) {
    const candidate = available[index];
    if (selectedIds.has(candidate.id)) continue;
    const chars = countedCharacters(candidate);
    if (characterCount > 0 && characterCount + chars > agentContextCharacterLimit) break;
    characterCount += chars;
    selectedIds.add(candidate.id);
    added += 1;
  }
  return available.filter((message) => selectedIds.has(message.id));
};
const dateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""));

const initialAgent = (definition, saved = {}) => ({
  ...definition,
  modelProviderId: cleanText(saved.modelProviderId, 80)
    || cleanText(definition.modelProviderId, 80)
    || CURRENT_MODEL_PROVIDER_ID,
  model: cleanText(saved.model, 120) || cleanText(definition.model, 120) || "",
  reasoningEffort: cleanText(saved.reasoningEffort, 40) || cleanText(definition.reasoningEffort, 40) || "",
  threadId: cleanText(saved.threadId, 80) || null,
  phase: "idle",
  label: saved.threadId ? "等待新任务" : "尚未启动",
  detail: "",
  active: false,
  updatedAt: saved.updatedAt || null,
});

export const createGroupRoomStore = async ({ stateFile, project, projectId = "", roomId = "", agentDefinitions = null, broadcast = () => {}, onMessageCreated = () => {} }) => {
  const definitions = agentDefinitions || await loadEmployeeDefinitions();
  let stored = {};
  try {
    stored = JSON.parse(await fs.readFile(stateFile, "utf8"));
  } catch {}

  const projectName = cleanText(project, 160) || "project";
  const linkedProjectId = cleanText(projectId, 200) || cleanText(stored.projectId, 200) || projectName;
  const linkedRoomId = cleanText(roomId, 120) || cleanText(stored.roomId, 120) || "current-project";

  const savedAgents = new Map((Array.isArray(stored.agents) ? stored.agents : []).map((agent) => [agent.id, agent]));
  const storedContextSequences = stored.agentContextSequences && typeof stored.agentContextSequences === "object"
    && !Array.isArray(stored.agentContextSequences) ? stored.agentContextSequences : {};
  const agents = new Map(definitions.map((definition) => [definition.id, initialAgent(definition, savedAgents.get(definition.id))]));
  const agentContextSequences = new Map(definitions.map((definition) => [
    definition.id,
    safeSequence(storedContextSequences[definition.id]),
  ]));
  const messages = (Array.isArray(stored.messages) ? stored.messages : [])
    .filter((message) => message?.id && message?.createdAt
      && (message?.text
        || (Array.isArray(message?.attachments) && message.attachments.length)
        || (Array.isArray(message?.artifactIds) && message.artifactIds.length)))
    .map((message, index) => ({
      ...message,
      clientMessageId: cleanText(message.clientMessageId, 80) || null,
      workId: cleanText(message.workId, 160) || null,
      sequence: Number.isSafeInteger(message.sequence) && message.sequence > 0 ? message.sequence : index + 1,
      artifactIds: [...new Set((Array.isArray(message.artifactIds) ? message.artifactIds : [])
        .map((id) => cleanText(id, 80)).filter(Boolean))],
      failure: message.failure === true,
    }));
  const members = new Map();
  const activeWorks = new Map();
  let nextMessageSequence = messages.reduce((latest, message) => Math.max(latest, message.sequence), 0);
  let writeQueue = Promise.resolve();

  const persist = () => {
    const payload = JSON.stringify({
      version: 4,
      projectId: linkedProjectId,
      roomId: linkedRoomId,
      messages,
      agents: [...agents.values()].map(({ instructions, ...agent }) => agent),
      agentContextSequences: Object.fromEntries(agentContextSequences),
    }, null, 2);
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(stateFile), { recursive: true });
        await fs.writeFile(stateFile, payload, "utf8");
      });
    return writeQueue;
  };

  const publicAgent = ({ instructions, ...agent }) => agent;
  const emit = (value) => broadcast({ ...value, roomId: linkedRoomId });
  const activeMembers = () => {
    const cutoff = Date.now() - 60000;
    return [...members.values()].filter((member) => Date.parse(member.lastSeenAt) >= cutoff);
  };

  const snapshot = () => ({
    project: projectName,
    projectId: linkedProjectId,
    room: { id: linkedRoomId, projectId: linkedProjectId, name: `${projectName} 项目群` },
    messages: messages.slice(-300),
    agents: [...agents.values()].map(publicAgent),
    members: activeMembers(),
    activeWorks: [...activeWorks.values()],
  });

  const getMessagePage = ({ beforeSequence = 0, afterSequence = 0, aroundSequence = 0, date = "", limit = 50 } = {}) => {
    const size = pageSize(limit);
    const cleanDate = validDate(date) ? String(date) : "";
    const before = safeSequence(beforeSequence);
    const after = safeSequence(afterSequence);
    const around = safeSequence(aroundSequence);
    let start = Math.max(0, messages.length - size);
    let found = true;

    if (cleanDate) {
      start = messages.findIndex((message) => dateKey(message.createdAt) === cleanDate);
      found = start >= 0;
      if (!found) {
        return {
          messages: [],
          date: cleanDate,
          found: false,
          hasOlder: false,
          hasNewer: false,
          oldestSequence: 0,
          newestSequence: 0,
        };
      }
    } else if (before) {
      const firstNewerIndex = messages.findIndex((message) => message.sequence >= before);
      const end = firstNewerIndex < 0 ? messages.length : firstNewerIndex;
      start = Math.max(0, end - size);
      const page = messages.slice(start, end);
      return {
        messages: page,
        date: "",
        found: true,
        hasOlder: start > 0,
        hasNewer: end < messages.length,
        oldestSequence: page[0]?.sequence || 0,
        newestSequence: page.at(-1)?.sequence || 0,
      };
    } else if (after) {
      start = messages.findIndex((message) => message.sequence > after);
      if (start < 0) start = messages.length;
    } else if (around) {
      const exact = messages.findIndex((message) => message.sequence === around);
      if (exact < 0) {
        return {
          messages: [],
          date: "",
          found: false,
          hasOlder: false,
          hasNewer: false,
          oldestSequence: 0,
          newestSequence: 0,
        };
      }
      const beforeCount = Math.floor((size - 1) / 2);
      start = Math.max(0, exact - beforeCount);
      const page = messages.slice(start, Math.min(messages.length, start + size));
      return {
        messages: page,
        date: "",
        found: true,
        hasOlder: start > 0,
        hasNewer: start + page.length < messages.length,
        oldestSequence: page[0]?.sequence || 0,
        newestSequence: page.at(-1)?.sequence || 0,
      };
    }

    const page = messages.slice(start, start + size);
    return {
      messages: page,
      date: cleanDate,
      found,
      hasOlder: start > 0,
      hasNewer: start + page.length < messages.length,
      oldestSequence: page[0]?.sequence || 0,
      newestSequence: page.at(-1)?.sequence || 0,
    };
  };

  const beginAgentWork = ({ workId, agentId, agentName, startedAt }) => {
    const id = cleanText(workId, 160);
    const cleanAgentId = cleanText(agentId, 80);
    const agent = agents.get(cleanAgentId);
    if (!id || !agent) return null;
    const work = {
      workId: id,
      agentId: cleanAgentId,
      agentName: cleanText(agentName, 80) || agent.name,
      startedAt: cleanText(startedAt, 40) || new Date().toISOString(),
      phase: "working",
    };
    activeWorks.set(id, work);
    return work;
  };

  const finishAgentWork = (workId) => activeWorks.delete(cleanText(workId, 160));

  const touchMember = (memberId, name) => {
    const id = cleanText(memberId, 80);
    const displayName = cleanText(name, 24);
    if (!id || !displayName) throw Object.assign(new Error("成员名称不能为空"), { statusCode: 400 });
    const member = { id, name: displayName, lastSeenAt: new Date().toISOString() };
    members.set(id, member);
    emit({ type: "group_members_changed", members: activeMembers() });
    return member;
  };

  const addMessageWithStatus = async ({
    type = "human",
    authorId,
    authorName,
    agentId = null,
    targetAgentIds = [],
    text,
    attachments = [],
    clientMessageId = null,
    workId = null,
    preserveText = false,
    replyTo = null,
    failure = false,
  }) => {
    const content = preserveText
      ? String(text || "").slice(0, 12000)
      : cleanText(text, 12000);
    const cleanAuthorId = cleanText(authorId, 80);
    const cleanClientMessageId = cleanText(clientMessageId, 80) || null;
    const cleanWorkId = cleanText(workId, 160) || null;
    const existing = messages.find((message) => (
      (cleanClientMessageId && message.authorId === cleanAuthorId && message.clientMessageId === cleanClientMessageId)
      || (cleanWorkId && message.workId === cleanWorkId)
    ));
    if (existing) return { message: existing, created: false };
    const files = (Array.isArray(attachments) ? attachments : []).slice(0, 6).map((file) => ({
      id: cleanText(file.id, 80),
      name: cleanText(file.name, 160),
      mimeType: cleanText(file.mimeType, 120),
      url: cleanText(file.url, 240),
    })).filter((file) => file.id && file.name && file.url);
    if (!content.trim() && !files.length) throw Object.assign(new Error("消息不能为空"), { statusCode: 400 });
    const targets = [...new Set((Array.isArray(targetAgentIds) ? targetAgentIds : [])
      .map((id) => cleanText(id, 80))
      .filter((id) => agents.has(id)))];
    const replySource = replyTo && typeof replyTo === "object" ? replyTo : null;
    const replyId = cleanText(replySource?.id, 80);
    const replyMessage = replyId ? messages.find((message) => message.id === replyId) : null;
    const reply = replyMessage ? {
      id: replyMessage.id,
      authorName: cleanText(replyMessage.authorName, 40) || "成员",
      text: replyExcerpt(replyMessage),
      sequence: replyMessage.sequence,
    } : null;
    const message = {
      id: randomUUID(),
      clientMessageId: cleanClientMessageId,
      workId: cleanWorkId,
      sequence: ++nextMessageSequence,
      type,
      authorId: cleanAuthorId,
      authorName: cleanText(authorName, 40),
      agentId: agentId || targets[0] || null,
      targetAgentIds: targets,
      replyTo: reply,
      text: content,
      attachments: files,
      artifactIds: [],
      failure: failure === true,
      createdAt: new Date().toISOString(),
    };
    messages.push(message);
    await persist();
    emit({ type: "group_message_created", message });
    if (message.type === "agent") {
      try {
        await onMessageCreated({
          message: { ...message },
          projectId: linkedProjectId,
          roomId: linkedRoomId,
        });
      } catch (error) {
        console.warn(`[group-room] employee message link failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { message, created: true };
  };

  const addMessage = async (params) => (await addMessageWithStatus(params)).message;

  const getAgent = (agentId) => agents.get(agentId) || null;
  const getMessage = (messageId) => messages.find((message) => message.id === messageId) || null;
  const messageTargetsAgent = (message, agentId) => {
    if (!message || message.type === "system") return false;
    if (message.type !== "human" && message.type !== "agent") return false;
    if (message.type === "agent" && (message.agentId === agentId || message.authorId === agentId)) return false;
    if (Array.isArray(message.targetAgentIds) && message.targetAgentIds.includes(agentId)) return true;
    const agent = agents.get(agentId);
    return Boolean(agent) && mentionedAgentIds(message.text, [agent]).includes(agentId);
  };

  const getAgentContext = (agentId, { assignmentId = "" } = {}) => {
    const afterSequence = agentContextSequences.get(agentId) || 0;
    const firstParticipation = afterSequence === 0;
    const messageLimit = firstParticipation ? initialContextMessageLimit : agentContextMessageLimit;
    const available = messages.filter((message) => message.sequence > afterSequence);
    const requestedId = cleanText(assignmentId, 80);
    const explicit = requestedId ? messages.find((message) => message.id === requestedId) : null;
    const explicitPending = explicit && explicit.sequence > afterSequence ? explicit : null;
    let assignment = null;
    if (explicitPending && messageTargetsAgent(explicitPending, agentId)) assignment = explicitPending;
    else if (explicit) {
      assignment = available.find((message) => message.sequence > explicit.sequence
        && message.type === "agent"
        && messageTargetsAgent(message, agentId)) || null;
    } else {
      assignment = [...available].reverse().find((message) => messageTargetsAgent(message, agentId)) || null;
    }
    const nextUserTask = available.find((message) => message.type === "human"
      && message.id !== assignment?.id
      && messageTargetsAgent(message, agentId)
      && (!assignment || message.sequence > assignment.sequence));
    const pool = nextUserTask
      ? available.filter((message) => message.sequence < nextUserTask.sequence)
      : available;
    const selected = selectContextMessages(
      pool,
      assignment && pool.some((message) => message.id === assignment.id) ? assignment : null,
      messageLimit,
    );
    const quotedId = cleanText(assignment?.replyTo?.id, 80);
    const quotedInView = quotedId && selected.some((message) => message.id === quotedId);
    const quotedMessage = quotedId && !quotedInView
      ? messages.find((message) => message.id === quotedId) || null
      : null;
    const throughSequence = pool.reduce((latest, message) => Math.max(latest, safeSequence(message.sequence)), afterSequence);
    const omittedBeforeCount = selected.length
      ? pool.filter((message) => message.sequence < selected[0].sequence).length
      : pool.length;
    const heldBackCount = nextUserTask
      ? available.filter((message) => message.sequence >= nextUserTask.sequence
        && message.type === "human"
        && messageTargetsAgent(message, agentId)).length
      : 0;
    return {
      afterSequence,
      throughSequence,
      firstParticipation,
      assignment,
      quotedMessage,
      messages: selected,
      omittedMessageCount: Math.max(0, pool.length - selected.length),
      omittedBeforeCount,
      heldBackCount,
      totalMessageCount: pool.length,
    };
  };

  const advanceAgentContext = async (agentId, sequence) => {
    if (!agents.has(agentId)) throw Object.assign(new Error("Agent does not exist"), { statusCode: 404 });
    const current = agentContextSequences.get(agentId) || 0;
    const next = Math.max(current, safeSequence(sequence));
    if (next === current) return current;
    agentContextSequences.set(agentId, next);
    await persist();
    return next;
  };

  const attachArtifact = async (messageId, artifactId) => {
    const message = getMessage(cleanText(messageId, 80));
    if (!message) throw Object.assign(new Error("群消息不存在"), { statusCode: 404 });
    const id = cleanText(artifactId, 80);
    if (!id) throw Object.assign(new Error("artifactId 不能为空"), { statusCode: 400 });
    if (message.artifactIds.includes(id)) return message;
    message.artifactIds.push(id);
    await persist();
    emit({ type: "group_message_updated", message: { ...message } });
    return message;
  };

  const updateAgent = async (agentId, patch) => {
    const current = agents.get(agentId);
    if (!current) throw Object.assign(new Error("Agent 不存在"), { statusCode: 404 });
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    agents.set(agentId, next);
    await persist();
    const agent = publicAgent(next);
    emit({ type: "group_agent_updated", agent });
    return agent;
  };

  await persist();
  return {
    snapshot,
    touchMember,
    addMessage,
    addMessageWithStatus,
    getAgent,
    getMessage,
    getMessagePage,
    getAgentContext,
    advanceAgentContext,
    beginAgentWork,
    finishAgentWork,
    attachArtifact,
    updateAgent,
    close: () => writeQueue,
  };
};
