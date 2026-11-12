import { latestRolloutFile, openRollout } from './rollout-file.mjs';
import { communicationInstructions } from "./base-prompt.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { materializeGoalObjective, expandGoalObjective, readThreadGoal } from "./thread-goal-objective.mjs";
import { messageFromItem, messagePreview, previewText } from "./content-blocks.mjs";
import { createAppServerClient } from "./app-server-client.mjs";
import { messagesFromTurns, readRecentThreadPage } from "./codex-thread-history.mjs";
import { loadUserProfilePrompt } from "./user-profile-prompt.mjs";
import { readJsonFile, writeJsonFileAtomic } from "./persistence/json-file.mjs";
import { conversationSourceRevision } from "./conversation-version-store.mjs";

const sourceFromThread = (thread) => thread.source === "cli" && thread.cliVersion === "0.122.0" ? "happy" : "codex";

const isoFromUnixSeconds = (value) => {
  if (value === null || value === undefined) return "";
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "";
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
};

const latestIsoFromEpochMilliseconds = (values, fallback = "") => {
  const latest = values.filter(Number.isFinite).reduce(
    (current, value) => Math.max(current, value),
    Number.NEGATIVE_INFINITY,
  );
  if (!Number.isFinite(latest)) return fallback;
  const date = new Date(latest);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
};

const AUTO_TITLE_MODEL = "gpt-5.6-terra";
const AUTO_TITLE_TIMEOUT_MS = 60000;
const AUTO_TITLE_SCHEMA = {
  type: "object",
  properties: { title: { type: "string", minLength: 1, maxLength: 36 } },
  required: ["title"],
  additionalProperties: false,
};


const isAssistantReplyRecord = (item) => {
  const payload = item?.payload || {};
  const type = item?.type;
  const payloadType = payload.type;
  const role = payload.role;
  const phase = payload.phase;
  return (type === "event_msg" && payloadType === "agent_message" && phase === "final_answer")
    || (type === "response_item" && payloadType === "message" && role === "assistant" && (!phase || phase === "final_answer"));
};

const isConversationMessageRecord = (item) => isAssistantReplyRecord(item)
  || (item?.type === "response_item" && item.payload?.type === "message"
    && ["user", "assistant"].includes(item.payload?.role));

export const latestAssistantReplyAtFromRollout = async (file, readSettings = false, includeMessage = false) => {
  if (!file || typeof file !== "string") return "";
  let handle;
  try {
    file = await latestRolloutFile(file);
    handle = await openRollout(file);
    const stat = await handle.stat();
    const chunkSize = 256 * 1024;
    const maxBytes = readSettings ? stat.size : 4 * 1024 * 1024;
    let end = stat.size;
    let scanned = 0;
    let carry = "";
    let foundReply = false;
    let usage;
    let latestSettings;
    while (end > 0 && scanned < maxBytes) {
      const length = Math.min(chunkSize, end);
      const start = end - length;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      end = start;
      scanned += length;
      const lines = `${buffer.toString("utf8")}${carry}`.split(/\r?\n/u);
      carry = start > 0 ? (lines.shift() || "") : "";
      let latestMs = Number.NEGATIVE_INFINITY;
      let latest = "";
      for (const line of readSettings ? lines.reverse() : lines) {
        if (!line.trim()) continue;
        let item;
        try { item = JSON.parse(line); } catch { continue; }
        if (readSettings) {
          const info = item.type === "event_msg" && item.payload?.type === "token_count" ? item.payload.info : null;
          if (readSettings === "latest" && !usage && Number.isFinite(info?.last_token_usage?.total_tokens)
            && info.last_token_usage.total_tokens >= 0 && Number.isFinite(info.model_context_window) && info.model_context_window > 0) {
            usage = { usedTokens: info.last_token_usage.total_tokens, contextWindow: info.model_context_window };
            if (latestSettings) return { ...latestSettings, usage };
          }
          if (isAssistantReplyRecord(item)) foundReply = true;
          if (readSettings === "latest" && item.type === "turn_context" && item.payload?.model && !usage) {
            if (latestSettings && latestSettings.model !== item.payload.model) return latestSettings;
            latestSettings ||= { model: item.payload.model, reasoningEffort: item.payload.effort || item.payload.reasoning_effort || "" };
            continue;
          }
          if ((foundReply || readSettings === "latest") && item.type === "turn_context" && item.payload?.model) return {
            model: item.payload.model, reasoningEffort: item.payload.effort || item.payload.reasoning_effort || "",
            ...(usage ? { usage } : {}),
          };
          continue;
        }
        if (!isConversationMessageRecord(item)) continue;
        const message = includeMessage ? messageFromItem(item, () => null) : null;
        if (includeMessage && !message) continue;
        const parsed = Date.parse(item.timestamp || "");
        if (!Number.isFinite(parsed) || parsed < latestMs) continue;
        latestMs = parsed;
        latest = includeMessage ? { updatedAt: new Date(parsed).toISOString(), latestMessage: messagePreview(message) } : new Date(parsed).toISOString();
      }
      if (latest) return latest;
    }
    return latestSettings || "";
  } catch {
    return "";
  } finally {
    await handle?.close?.().catch(() => {});
  }
};

const sessionTime = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const cleanAutoTitle = (value) => {
  let title = String(value || "").replace(/\s+/gu, " ").trim();
  try { title = JSON.parse(title)?.title || title; } catch {}
  title = String(title).replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/gu, "").replace(/[。.!！?？]+$/gu, "").trim();
  return [...title].slice(0, 36).join("");
};

const titlePromptFrom = (text) => [
  "请为用户请求生成简洁的对话标题。",
  "使用用户的语言，尽量不超过 5 个词或 20 个汉字，最多 36 个字符。",
  "标题应概括实际主题，不要回答问题，不要使用引号、Markdown 或结尾标点。",
  "只填写结构化 title 字段。",
  "",
  "用户请求：",
  String(text || "").slice(0, 2000),
].join("\n");

export const inputFromAttachments = async (text, attachments = []) => {
  const files = attachments.filter((attachment) =>
    attachment.name && attachment.path
      && !String(attachment.mimeType || "").startsWith("image/")
      && !String(attachment.mimeType || "").startsWith("audio/"));
  const prompt = files.length
    ? [
        "# Files mentioned by the user:",
        "",
        ...files.map((attachment) => `## ${attachment.name}: ${attachment.path}`),
        "",
        "## My request for Codex:",
        "",
        text,
      ].join("\n")
    : text;
  const input = [];
  if (prompt) input.push({ type: "text", text: prompt, text_elements: [] });
  for (const attachment of attachments) {
    if (String(attachment.mimeType || "").startsWith("image/")) {
      input.push({ type: "localImage", path: attachment.path });
    } else if (String(attachment.mimeType || "").startsWith("audio/")) {
      input.push({ type: "localAudio", path: attachment.path });
    }
  }
  return input;
};

const promptFromSlashCommand = (text, attachments = []) => {
  const match = /^\s*\/(image|file|skill|app)(?:\s+([\s\S]*?))?\s*$/iu.exec(String(text || ""));
  if (!match) return text;
  const detail = String(match[2] || "").trim();
  const command = match[1].toLocaleLowerCase();
  if (command === "image") {
    return attachments.length
      ? `请直接调用已配置的图片生成 MCP 工具，使用我上传的图片作为参考并按以下要求修改：${detail || "请先分析参考图片，再给出适当的修改结果。"}`
      : `请直接调用已配置的图片生成 MCP 工具，按以下要求生成图片：${detail || "请根据当前对话中已经明确的画面要求生成图片。"}`;
  }
  if (command === "file") {
    return `请读取并处理我上传的文件。${detail || "先理解文件内容和结构，再回答我的问题。"}`;
  }
  if (command === "skill") {
    return `请使用与以下任务最匹配的 Codex Skill，并完成任务：${detail || "根据当前对话选择合适的 Skill。"}`;
  }
  return `请使用当前可用的 Codex App 或连接器完成以下任务：${detail || "根据当前对话选择合适的 App。"}`;
};

export const createAppServerConversationStore = ({
  projectRoot, projectRoots = [projectRoot], registerMedia, onProtocolMessage, onSubmitted, onFailed, onHealthState,
  goalAttachmentRoot = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "attachments"),
  autoTitleStateFile = "", onAutoTitleChanged,
  autoTitleEnabled = true,
  historyFallback,
  nativeSubagents,
  attachmentContent,
  threadRuntimeOptions = async () => null,
  client = createAppServerClient(),
  supervision = {},
}) => {
  const isAllowedProjectRoot = (cwd) => {
    if (!cwd) return false;
    try {
      const resolved = path.resolve(cwd).toLowerCase();
      return projectRoots.some((root) => path.resolve(root).toLowerCase() === resolved);
    } catch { return false; }
  };
  const foreignThreadError = () => Object.assign(
    new Error("This conversation does not belong to the current project."),
    { statusCode: 403 },
  );
  // The app-server knows every thread on this computer. A thread id sent by a
  // browser may only be read or driven when it belongs to a registered project
  // or to a runtime this service manages (employees, agents).
  const assertAccessibleThread = async (thread) => {
    if (isAllowedProjectRoot(thread?.cwd) || await threadRuntimeOptions(thread)) return thread;
    throw foreignThreadError();
  };
  const isSameProjectRoot = (left, right) => {
    if (!left || !right) return false;
    try { return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase(); } catch { return false; }
  };
  const activeRuns = new Map();
  const autoTitleAttempts = new Set();
  const autoTitleThreads = new Map();
  const autoTitles = new Map();
  let autoTitlesLoaded = false;
  let autoTitlesLoading = null;
  let userProfilePrompt;
  const getUserProfilePrompt = async () => {
    userProfilePrompt ??= loadUserProfilePrompt(projectRoot);
    return userProfilePrompt;
  };
  const monitorIntervalMs = supervision.intervalMs ?? 5000;
  const staleAfterMs = supervision.staleAfterMs ?? 30000;
  const finalizingAfterMs = supervision.finalizingAfterMs ?? 10000;
  const retryAfterMs = supervision.retryAfterMs ?? 10000;
  let monitorBusy = false;

  const loadAutoTitles = async () => {
    if (autoTitlesLoaded || !autoTitleStateFile) return;
    if (!autoTitlesLoading) {
      autoTitlesLoading = readJsonFile(autoTitleStateFile, {})
        .then((state) => state?.titles || {})
        .then((titles) => {
          for (const [threadId, value] of Object.entries(titles)) {
            const title = cleanAutoTitle(value?.title);
            if (title) autoTitles.set(threadId, { title, updatedAt: String(value?.updatedAt || "") });
          }
          autoTitlesLoaded = true;
        })
        .finally(() => { autoTitlesLoading = null; });
    }
    await autoTitlesLoading;
  };

  const saveAutoTitle = async (threadId, title) => {
    await loadAutoTitles();
    autoTitles.set(threadId, { title, updatedAt: new Date().toISOString() });
    if (!autoTitleStateFile) return;
    const state = { version: 1, titles: Object.fromEntries(autoTitles) };
    await writeJsonFileAtomic(autoTitleStateFile, state);
  };

  const handleProtocolMessage = (message) => {
    const { method, params = {} } = message || {};
    const threadId = params.threadId;
    const autoTitleThread = autoTitleThreads.get(threadId);
    if (autoTitleThread) {
      if (method === "item/completed" && params.item?.type === "agentMessage" && params.item?.phase !== "commentary") {
        autoTitleThread.text = String(params.item.text || "");
      }
      if (method === "turn/completed") autoTitleThread.resolve(autoTitleThread.text);
      return;
    }
    if (threadId) {
      const current = activeRuns.get(threadId) || {};
      const eventTurnId = String(params.turnId || params.turn?.id || params.item?.turnId || params.item?.turn?.id || "");
      const hasConflictingTurn = Boolean(current.turnId && eventTurnId && current.turnId !== eventTurnId);
      if (method === "turn/started") {
        activeRuns.set(threadId, {
          ...current,
          turnId: eventTurnId || current.turnId || "",
          lastEventAt: Date.now(),
          nextProbeAt: 0,
          finalAnswerCompleted: false,
        });
      } else if (method === "thread/status/changed" && params.status?.type === "active" && !current.turnId) {
        // An unscoped active notification may be the only event a goal
        // continuation emits. Monitor it so a missed terminal event cannot
        // leave submission and follow-up state busy forever.
        activeRuns.set(threadId, {
          turnId: "",
          lastEventAt: Date.now(),
          nextProbeAt: 0,
          finalAnswerCompleted: false,
        });
      } else if (hasConflictingTurn) {
        // Keep the current run monitor alive; the tracker handles the same
        // stale protocol event for the browser-facing state.
      } else if (method === "turn/completed") {
        // A terminal notification without a turn id cannot prove that the
        // currently monitored turn is the one that completed.
        if (!current.turnId || eventTurnId === current.turnId) activeRuns.delete(threadId);
      } else if (method === "thread/status/changed" && params.status?.type === "idle") {
        // An idle notification has no turn id. Keep a known run until its
        // turn/completed event or an authoritative probe confirms the end.
        if (!current.turnId) activeRuns.delete(threadId);
      } else if (activeRuns.has(threadId)) {
        activeRuns.set(threadId, {
          ...current,
          turnId: current.turnId || eventTurnId,
          lastEventAt: Date.now(),
          nextProbeAt: 0,
          finalAnswerCompleted: method === "turn/started"
            ? false
            : Boolean(current.finalAnswerCompleted) || (method === "item/completed"
              && params.item?.type === "agentMessage"
              && params.item?.phase !== "commentary"),
        });
      }
    }
    onProtocolMessage?.(message);
  };

  // Once the app-server process is gone or replaced, every turn it was
  // running is lost, not only the one whose health check noticed it.
  const processLostPhases = new Set(["recovered", "failed", "exited"]);

  const handleHealthState = (event) => {
    if (!processLostPhases.has(event?.phase)) {
      onHealthState?.(event);
      return;
    }
    const threadIds = new Set([...activeRuns.keys(), event.threadId].filter(Boolean));
    activeRuns.clear();
    for (const threadId of threadIds) onHealthState?.({ ...event, threadId });
  };

  const unsubscribe = client.subscribe(handleProtocolMessage);
  const unsubscribeHealth = client.subscribeHealth?.(handleHealthState) || (() => {});
  const threadCache = new Map();
  const previewCache = new Map();
  const freshThreadRuntime = new Map();

  const monitorActiveRuns = async () => {
    if (monitorBusy || !client.probe || activeRuns.size === 0) return;
    monitorBusy = true;
    try {
      const now = Date.now();
      for (const [threadId, run] of activeRuns) {
        const staleMs = run.finalAnswerCompleted ? finalizingAfterMs : staleAfterMs;
        if (now - run.lastEventAt < staleMs || now < (run.nextProbeAt || 0)) continue;
        run.nextProbeAt = now + retryAfterMs;
        try {
          const result = await client.probe(
            "thread/read",
            { threadId, includeTurns: false },
            { timeoutMs: 5000, threadId },
          );
          const status = result.thread?.status || null;
          onHealthState?.({
            phase: "authoritative",
            threadId,
            status,
            finalAnswerCompleted: Boolean(run.finalAnswerCompleted),
          });
          if (status?.type === "idle") activeRuns.delete(threadId);
        } catch {
          // The client emits checking/recovery events and owns the restart policy.
        }
      }
    } finally {
      monitorBusy = false;
    }
  };

  const monitorTimer = client.probe
    ? setInterval(() => void monitorActiveRuns(), monitorIntervalMs)
    : null;
  monitorTimer?.unref?.();

  const listThreads = async ({ archived = false } = {}) => {
    const threads = [];
    for (const root of projectRoots) {
      let cursor = null;
      const seenCursors = new Set();
      do {
        const params = {
          cursor,
          limit: 100,
          sortKey: "updated_at",
          sortDirection: "desc",
          cwd: root,
          sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther"],
        };
        // Older app-server versions omit the archived filter and return active threads by default.
        // Only send the new field when the caller explicitly requests the archive view.
        if (archived) params.archived = true;
        const result = await client.request("thread/list", params);
        threads.push(...result.data);
        cursor = result.nextCursor;
        if (cursor && seenCursors.has(cursor)) throw new Error("thread/list returned a repeated pagination cursor");
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
    }
    for (const thread of threads) threadCache.set(thread.id, thread);
    return threads;
  };

  const archivedFromThread = (thread) => {
    if (thread?.archived === true) return true;
    const threadPath = String(thread?.path || "").replaceAll("\\", "/").toLowerCase();
    return threadPath.includes("/archived_sessions/") || threadPath.endsWith("/archived_sessions");
  };

  const summaryFromThread = (thread, archived = archivedFromThread(thread)) => ({
    threadId: thread.id,
    source: sourceFromThread(thread),
    title: thread.name?.trim() || autoTitles.get(thread.id)?.title
      || cleanAutoTitle(thread.preview) || `新对话 · ${thread.id.slice(-6)}`,
    updatedAt: isoFromUnixSeconds(thread.updatedAt),
    messageCount: null,
    latestUser: "",
    latestAssistant: "",
    archived,
    forkedFromId: thread.forkedFromId || null,
    parentThreadId: thread.parentThreadId
      || thread.source?.subAgent?.thread_spawn?.parent_thread_id
      || thread.source?.subagent?.thread_spawn?.parent_thread_id
      || null,
    nativeSubagent: Boolean(thread.source && typeof thread.source === 'object'
      && (Object.hasOwn(thread.source, 'subAgent') || Object.hasOwn(thread.source, 'subagent'))),
    cwd: thread.cwd || null,
    ...(thread.model ? { model: thread.model } : {}),
  });

  const listSessions = async (source = "all", archived = false) => {
    await loadAutoTitles();
    const threads = await listThreads({ archived });
    const summaries = await Promise.all(threads
      .filter((thread) => source === "all" || sourceFromThread(thread) === source)
      .map(async (thread) => {
        const summary = summaryFromThread(thread, archived);
        if (thread.path) summary.sourceRevision = await latestRolloutFile(thread.path)
          .then(source => fs.stat(source))
          .then(conversationSourceRevision)
          .catch(() => undefined);
        const cached = previewCache.get(thread.id);
        const latest = summary.sourceRevision && cached?.revision === summary.sourceRevision
          ? cached.latest : await latestAssistantReplyAtFromRollout(thread.path, false, true);
        if (summary.sourceRevision) previewCache.set(thread.id, { revision: summary.sourceRevision, latest });
        if (latest) Object.assign(summary, latest, { latestMessageAt: latest.updatedAt });
        return summary;
      }));
    return summaries.sort((left, right) => sessionTime(right.updatedAt) - sessionTime(left.updatedAt));
  };
  const listNativeSubagents = async (archived = false) => nativeSubagents?.(archived) || [];

  const createSession = async (model = "", requestedProjectRoot = "", options = {}) => {
    const cwd = requestedProjectRoot ? path.resolve(requestedProjectRoot) : projectRoot;
    if (!options.managed && !isAllowedProjectRoot(cwd)) throw new Error("This project folder is not registered in Negus.");
    const profilePrompt = await getUserProfilePrompt();
    const runtimeOptions = options.managed ? null : await threadRuntimeOptions({ id: "", cwd, fresh: true });
    const params = { cwd, sandbox: options.sandbox || "danger-full-access", approvalPolicy: options.approvalPolicy || "never", developerInstructions: [profilePrompt, options.developerInstructions].filter(Boolean).join("\n"),
      ...(runtimeOptions?.resume || {}) };
    if (model) params.model = model;
    const result = await client.request("thread/start", params);
    let thread = result.thread;
    if (!thread?.id) throw new Error("Codex did not return the newly created Thread.");
    if (!thread.cwd) {
      const verified = await client.request("thread/read", { threadId: thread.id, includeTurns: false });
      thread = verified.thread || thread;
    }
    if (!isSameProjectRoot(thread.cwd, cwd)) {
      throw Object.assign(new Error("新对话未创建在所选项目中，请检查项目路径后重试。"), { statusCode: 502 });
    }
    runtimeOptions?.bindThread?.(thread.id);
    threadCache.set(thread.id, thread);
    freshThreadRuntime.set(thread.id, {
      ...result,
      model: result.model || model,
    });
    return summaryFromThread(thread);
  };

  const renameSession = async (threadId, name) => {
    await ensureProjectThread(threadId);
    const result = await client.request("thread/name/set", { threadId, name });
    const cached = threadCache.get(threadId) || { id: threadId };
    const thread = result?.thread || { ...cached, name };
    threadCache.set(threadId, thread);
    return summaryFromThread(thread, archivedFromThread(thread));
  };

  const generateAutoTitle = async (text, cwd) => {
    const started = await client.request("thread/start", {
      model: AUTO_TITLE_MODEL,
      cwd,
      approvalPolicy: "never",
      config: {
        model_reasoning_effort: "low",
        web_search: "disabled",
        "features.enable_fanout": false,
        "features.multi_agent": false,
        "features.multi_agent_v2": false,
        "features.plugins": false,
      },
      ephemeral: true,
      threadSource: "system",
      experimentalRawEvents: false,
    }, { timeoutMs: AUTO_TITLE_TIMEOUT_MS });
    const titleThreadId = started.thread.id;
    let timer;
    const response = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Automatic title generation timed out")), AUTO_TITLE_TIMEOUT_MS);
      timer.unref?.();
      autoTitleThreads.set(titleThreadId, { resolve, text: "" });
    });
    // turn/start can still be pending when the response deadline expires.
    void response.catch(() => {});
    try {
      await client.request("turn/start", {
        threadId: titleThreadId,
        input: [{ type: "text", text: titlePromptFrom(text), text_elements: [] }],
        outputSchema: AUTO_TITLE_SCHEMA,
      }, { timeoutMs: AUTO_TITLE_TIMEOUT_MS });
      return cleanAutoTitle(await response);
    } finally {
      clearTimeout(timer);
      autoTitleThreads.delete(titleThreadId);
      void client.request("thread/unsubscribe", { threadId: titleThreadId }, { timeoutMs: 2000 }).catch(() => {});
    }
  };

  const autoTitleSession = async (threadId, text) => {
    await loadAutoTitles();
    if (autoTitleAttempts.has(threadId) || autoTitles.has(threadId)) return;
    const cached = threadCache.get(threadId);
    if (cached?.name?.trim()) return;
    autoTitleAttempts.add(threadId);
    try {
      const generatedTitle = await generateAutoTitle(text, cached?.cwd || projectRoot);
      if (!generatedTitle) return;
      const current = await client.request("thread/read", { threadId, includeTurns: false });
      if (String(current.thread?.name || "").trim()) return;
      await saveAutoTitle(threadId, generatedTitle);
      onAutoTitleChanged?.(threadId);
    } catch (error) {
      console.warn(`[auto-title] generation failed for ${threadId}: ${error.message}`);
    } finally {
      autoTitleAttempts.delete(threadId);
    }
  };

  const listModels = async () => {
    const models = [];
    let cursor = null;
    const seenCursors = new Set();
    do {
      const result = await client.request("model/list", { cursor, limit: 100 });
      models.push(...result.data);
      cursor = result.nextCursor;
      if (cursor && seenCursors.has(cursor)) throw new Error("model/list returned a repeated pagination cursor");
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return models.map((entry) => ({
      id: entry.id,
      model: entry.model,
      displayName: entry.displayName,
      description: entry.description,
      isDefault: entry.isDefault,
      supportedReasoningEfforts: entry.supportedReasoningEfforts || [],
    }));
  };

  const detailFromMessages = (thread, messages, {
    messageCount = messages.length,
    hasMore = false,
    nextBefore = null,
    nextCursor = null,
    preferMessageUpdatedAt = false,
  } = {}) => {
    const latestUser = messages.findLast((item) => item.role === "user")?.text || "";
    const latestAssistant = messages.findLast((item) => item.role === "assistant")?.text || "";
    const summary = summaryFromThread(thread);
    const messageTimes = messages
      .map((message) => Date.parse(message.createdAt || ""))
      .filter(Number.isFinite);
    const updatedAt = preferMessageUpdatedAt && messageTimes.length
      ? latestIsoFromEpochMilliseconds([Date.parse(summary.updatedAt), ...messageTimes], summary.updatedAt)
      : summary.updatedAt;
    return {
      ...summary,
      updatedAt,
      messageCount,
      latestUser: previewText(latestUser, 260),
      latestAssistant: previewText(latestAssistant, 260),
      messages,
      hasMore,
      nextBefore,
      nextCursor,
    };
  };

  const readThreadMetadata = async (threadId) => {
    const cached = threadCache.get(threadId);
    if (cached) return cached;
    const result = await client.request("thread/read", { threadId, includeTurns: false });
    if (!result?.thread) throw new Error("Codex did not return the requested thread");
    threadCache.set(result.thread.id, result.thread);
    return result.thread;
  };

  const readNativeSession = async (threadId, source = "all", { before, cursor, limit } = {}) => {
    await loadAutoTitles();
    const cached = threadCache.get(threadId);
    if (cached && source !== "all" && sourceFromThread(cached) !== source) return null;

    // A bounded native page avoids expanding the complete rollout history for the common Web request.
    // Numeric `before` remains the legacy JSONL/app-server fallback contract.
    if (cursor !== undefined || (before === undefined && Number.isSafeInteger(limit) && limit > 0)) {
      try {
        const thread = await assertAccessibleThread(await readThreadMetadata(threadId));
        if (source !== "all" && sourceFromThread(thread) !== source) return null;
        const page = await readRecentThreadPage({
          client,
          threadId,
          limit,
          cursor,
          registerMedia,
        });
        return detailFromMessages(thread, page.messages, {
          messageCount: null,
          hasMore: Boolean(page.nextCursor),
          nextCursor: page.nextCursor,
          preferMessageUpdatedAt: before === undefined && cursor === undefined,
        });
      } catch (error) {
        if (cursor !== undefined || Number.isSafeInteger(limit) && limit > 0 || error?.statusCode === 403) throw error;
        console.warn(`[conversation-store] native paginated history unavailable, using thread/read: ${error.message}`);
      }
    }

    const result = await client.request("thread/read", { threadId, includeTurns: true });
    const thread = await assertAccessibleThread(result.thread);
    if (source !== "all" && sourceFromThread(thread) !== source) return null;
    threadCache.set(thread.id, thread);
    const messages = messagesFromTurns(thread.turns, registerMedia);
    const end = Math.min(Number.isSafeInteger(before) ? before : messages.length, messages.length);
    const start = limit ? Math.max(0, end - limit) : 0;
    return detailFromMessages(thread, messages.slice(start, end), {
      messageCount: messages.length,
      hasMore: start > 0,
      nextBefore: start || null,
      preferMessageUpdatedAt: before === undefined,
    });
  };

  const findSession = async (threadId, source = "all", options = {}) => {
    // Newly created threads have no persisted turns to read yet.
    if (freshThreadRuntime.has(threadId) && threadCache.has(threadId)) {
      return detailFromMessages(threadCache.get(threadId), [], { messageCount: 0 });
    }
    // Paged history is already read-only; never expand it into a complete rollout.
    if (options.cursor !== undefined || options.before === undefined && Number.isSafeInteger(options.limit) && options.limit > 0) {
      return readNativeSession(threadId, source, options);
    }
    let nativeReadCompleted = false;
    try {
      const session = await readNativeSession(threadId, source, options);
      nativeReadCompleted = true;
      // A successful empty native read can mean the thread is not loaded, not
      // that its persisted history is empty. Recheck only this store's owner.
      if (historyFallback && session && Array.isArray(session.messages) && session.messages.length === 0 && options.cursor === undefined) {
        const fallback = await historyFallback(threadId, source, options);
        if (fallback?.messages?.length) return fallback;
      }
      if (historyFallback && session?.messages.some((message) => (message.role === 'user' || message.phase === "commentary") && !message.createdAt)) {
        const history = await historyFallback(threadId, source, { includeEventTimes: true }).catch(() => null);
        session.messages = session.messages.map((message) => {
          if (message.createdAt || (message.role !== 'user' && message.phase !== 'commentary')) return message;
          const matches = message.role === 'user'
            ? (history?.userMessageEvents || []).filter(item => item.turnId === message.turnId && ((message.itemId && item.itemId === message.itemId) || (message.submissionId && item.submissionId === message.submissionId)))
            : (history?.messages || []).filter(item => item.itemId && item.itemId === message.itemId && item.createdAt);
          const times = [...new Set(matches.map(item => item.createdAt).filter(Boolean))];
          return times.length === 1 ? { ...message, createdAt: times[0] } : message;
        });
      }
      return session;
    }
    catch (error) {
      // A refusal is an answer: the history fallback must not serve it either.
      if (nativeReadCompleted || !historyFallback || options.cursor !== undefined || error?.statusCode === 403) throw error;
      const fallback = await historyFallback(threadId, source, options);
      if (!fallback) throw error;
      return fallback;
    }
  };

  const getThread = async (threadId) => threadCache.get(threadId)
    || (await client.request("thread/read", { threadId, includeTurns: false })).thread;

  const ensureProjectThread = async (threadId) => {
    const thread = await getThread(threadId);
    const belongsToProject = isAllowedProjectRoot(thread?.cwd);
    let runtimeOptions = await threadRuntimeOptions(thread);
    if (!belongsToProject && !runtimeOptions) throw foreignThreadError();
    if (belongsToProject && !runtimeOptions) {
      let permissions = {};
      try { permissions = JSON.parse(await fs.readFile(path.join(projectRoot, "runtime", "thread-permissions.json"), "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!permissions[threadId] || permissions[threadId] === "full-access") runtimeOptions = {
        resume: { sandbox: "danger-full-access", approvalPolicy: "never" },
        turn: { sandboxPolicy: { type: "dangerFullAccess" }, approvalPolicy: "never" },
      };
    }
    threadCache.set(thread.id, thread);
    return { thread, runtimeOptions };
  };

  const resumeThread = async (threadId) => {
    const { thread, runtimeOptions } = await ensureProjectThread(threadId).catch(async error => {
      if (!threadNotLoaded(error)) throw error;
      await loadThreadForResume(threadId);
      return ensureProjectThread(threadId);
    });
    const freshRuntime = freshThreadRuntime.get(threadId);
    // New threads already start with their requested policy;
    // empty threads cannot be resumed before their first persisted turn.
    if (freshRuntime) return freshRuntime;
    return client.request("thread/resume", {
      threadId, persistExtendedHistory: true,
      developerInstructions: await getUserProfilePrompt(), ...(runtimeOptions?.resume || {}),
    });
  };

  const forkSession = async (threadId, lastTurnId) => {
    const { thread, runtimeOptions } = await ensureProjectThread(threadId);
    if (!lastTurnId) throw new Error("请选择一个已完成的对话位置再继续");
    const forkOptions = await threadRuntimeOptions({ id: "", cwd: thread.cwd || projectRoot, fresh: true });
    const result = await client.request("thread/fork", {
      threadId,
      lastTurnId,
      cwd: thread.cwd || projectRoot,
      ...(runtimeOptions?.resume || {}),
      ...(forkOptions?.resume || {}),
    });
    if (!result?.thread) throw new Error("Codex 未返回新的分支会话");
    forkOptions?.bindThread?.(result.thread.id);
    threadCache.set(result.thread.id, result.thread);
    return summaryFromThread(result.thread, false);
  };

  const archiveSession = async (threadId) => {
    await ensureProjectThread(threadId);
    await client.request("thread/archive", { threadId });
    threadCache.delete(threadId);
    freshThreadRuntime.delete(threadId);
    return { threadId, archived: true };
  };

  const unarchiveSession = async (threadId) => {
    // Checked before unarchiving: a refused thread must not be changed.
    await assertAccessibleThread(await getThread(threadId));
    const result = await client.request("thread/unarchive", { threadId });
    if (!result?.thread) throw new Error("Codex 未返回恢复后的会话");
    threadCache.set(result.thread.id, result.thread);
    return summaryFromThread(result.thread, false);
  };

  const sendMessage = async (threadId, text, attachments = [], submissionId = "", settings = {}) => {
    onSubmitted?.(threadId);
    try {
      const runtime = await resumeThread(threadId);
      const { runtimeOptions } = await ensureProjectThread(threadId);
      const developerInstructions = await getUserProfilePrompt();
      const result = await client.request("turn/start", {
        threadId,
        input: await inputFromAttachments(promptFromSlashCommand(text, attachments), attachments, attachmentContent),
        additionalContext: {
          "negus.communication": { kind: "application", value: communicationInstructions },
          "negus.model": { kind: "application", value: `本轮调用模型：${settings.model || runtime?.model || "未取得"}。这是当前请求的模型标识，回答模型身份时以此为准；不得用 ~/.codex/config.toml 的全局默认值、Codex 工具名称或历史回复推断当前模型。未取得时如实说明。此标识不证明供应商内部的实际模型。` },
        },
        ...(developerInstructions ? { developerInstructions } : {}),
        ...(submissionId ? { clientUserMessageId: submissionId } : {}),
        ...(runtimeOptions?.turn || {}),
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.reasoningEffort ? { effort: settings.reasoningEffort } : {}),
      });
      freshThreadRuntime.delete(threadId);
      const cached = threadCache.get(threadId);
      if (cached && !cached.preview) {
        cached.preview = text.trim() || attachments.map((item) => item.name).filter(Boolean).join("、");
      }
      if (autoTitleEnabled) void autoTitleSession(threadId, text).catch((error) => {
        console.warn(`[auto-title] failed for ${threadId}: ${error.message}`);
      });
      return result;
    } catch (error) {
      onFailed?.(threadId, error);
      throw error;
    }
  };

  const steerMessage = async (threadId, turnId, text, attachments = [], submissionId = "") => {
    await assertAccessibleThread(await getThread(threadId));
    const developerInstructions = await getUserProfilePrompt();
    return client.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: await inputFromAttachments(promptFromSlashCommand(text, attachments), attachments, attachmentContent),
      ...(developerInstructions ? { developerInstructions } : {}),
      ...(submissionId ? { clientUserMessageId: submissionId } : {}),
    });
  };

  const interrupt = async (threadId, turnId) => {
    await assertAccessibleThread(await getThread(threadId));
    return client.request("turn/interrupt", { threadId, turnId });
  };

  const readSettingsThread = async (threadId, options = {}) => {
    try { return (await ensureProjectThread(threadId)).thread; }
    catch (error) {
      if (!threadNotLoaded(error)) throw error;
      const thread = await historyFallback?.(threadId, "all", { ...options, metadataOnly: true });
      if (!thread) throw error;
      return thread;
    }
  };

  const getRuntimeContext = async (threadId, options) => {
    // FEAT-001: reading settings must never acquire a writer.
    const thread = await readSettingsThread(threadId, options);
    const result = freshThreadRuntime.get(threadId) || {
      ...thread, ...await latestAssistantReplyAtFromRollout(thread.path, "latest"),
    };
    return {
      model: result.model || "",
      modelProvider: result.modelProvider || "",
      reasoningEffort: result.reasoningEffort || "",
      ...(result.usage ? { usage: result.usage } : {}),
    };
  };

  const getThreadStatus = async (threadId) => {
    const request = client.probe?.bind(client) || client.request.bind(client);
    const result = await request(
      "thread/read",
      { threadId, includeTurns: false },
      { timeoutMs: 5000, threadId },
    );
    if (result?.thread) await assertAccessibleThread(result.thread);
    return result.thread?.status || null;
  };

  const revertSession = async (threadId, beforeTurnId) => {
    await resumeThread(threadId);
    return client.request("thread/revert", { threadId, beforeTurnId });
  };

  const compactContext = async (threadId) => {
    await resumeThread(threadId);
    return client.request("thread/compact/start", { threadId });
  };

  const reviewSession = async (threadId) => {
    await ensureProjectThread(threadId);
    return client.request("review/start", { threadId });
  };

  const getGoal = async (threadId, options) => {
    const thread = await readSettingsThread(threadId, options);
    const historyHome = thread.path?.split(/[/\\](?:sessions|archived_sessions)[/\\]/)[0];
    const root = historyHome ? path.join(historyHome, 'attachments') : goalAttachmentRoot;
    const result = await readThreadGoal(client, threadId, root, options);
    return { ...result, goal: await expandGoalObjective(result.goal, root) };
  };

  const setGoal = async (threadId, patch = {}, options) => {
    if (patch.objective !== undefined || patch.status === "active") await resumeThread(threadId);
    else await ensureProjectThread(threadId);
    const params = { threadId };
    const materialized = patch.objective !== undefined ? await materializeGoalObjective(patch.objective, goalAttachmentRoot) : null;
    if (materialized) params.objective = materialized.objective;
    if (patch.status !== undefined) params.status = patch.status;
    if (patch.tokenBudget !== undefined) params.tokenBudget = patch.tokenBudget;
    // Retain the objective file on transport failure: the native goal may already reference it.
    const result = await client.request("thread/goal/set", params, options);
    if (patch.objective !== undefined || patch.status === 'active') freshThreadRuntime.delete(threadId);
    return { ...result, goal: await expandGoalObjective(result.goal, goalAttachmentRoot) };
  };

  const clearGoal = async (threadId) => {
    await ensureProjectThread(threadId);
    return client.request("thread/goal/clear", { threadId });
  };

  const updateModel = async (threadId, model) => {
    const runtime = await resumeThread(threadId);
    await client.request("thread/settings/update", { threadId, model });
    if (freshThreadRuntime.has(threadId)) {
      freshThreadRuntime.set(threadId, { ...runtime, model });
    }
    return { model, modelProvider: runtime.modelProvider || "", reasoningEffort: runtime.reasoningEffort || "" };
  };

  const threadNotLoaded = (error) => /thread not loaded/i.test(String(error?.message || ""));
  const missingPersistedThread = (error) => /thread not loaded|no rollout found|session not found|rollout path missing/i.test(String(error?.message || ""));
  const persistedThreadError = () => Object.assign(new Error("原会话记录尚未持久化，暂时无法切换配置"), { statusCode: 409 });

  const loadThreadForResume = async (threadId) => {
    let known;
    try {
      ({ thread: known } = await ensureProjectThread(threadId));
    } catch (error) {
      if (!threadNotLoaded(error)) throw error;
    }
    if (known?.path && known?.cwd) return known;
    const readThread = async () => (await client.request("thread/read", { threadId, includeTurns: false }).catch(error => {
      if (!threadNotLoaded(error)) throw error;
      return client.request("thread/read", { threadId, includeTurns: true });
    })).thread;
    try {
      const thread = await readThread();
      if (thread?.id) threadCache.set(thread.id, thread);
      if (thread?.path) return thread;
    } catch (error) {
      if (!threadNotLoaded(error)) throw error;
    }
    let resumed;
    try {
      resumed = await client.request("thread/resume", {
        threadId,
        excludeTurns: true,
        persistExtendedHistory: true,
      });
    } catch (error) {
      if (missingPersistedThread(error)) throw persistedThreadError();
      throw error;
    }
    const resumedThread = resumed?.thread;
    if (resumedThread?.id) threadCache.set(resumedThread.id, resumedThread);
    if (resumedThread?.path) return resumedThread;
    const thread = await readThread();
    if (thread?.id) threadCache.set(thread.id, thread);
    return thread;
  };

  const getSessionResumeInfo = async (threadId, { readOnly = false, ...options } = {}) => {
    let thread;
    try {
      thread = readOnly ? await readSettingsThread(threadId, options) : await loadThreadForResume(threadId);
    } catch (error) {
      if (error?.statusCode) throw error;
      if (missingPersistedThread(error)) throw persistedThreadError();
      throw error;
    }
    if (!readOnly) {
      if (!thread?.path || !isAllowedProjectRoot(thread.cwd)) throw persistedThreadError();
      await fs.access(thread.path).catch(() => { throw persistedThreadError(); });
    }
    return { path: thread.path, cwd: thread.cwd, model: thread.model, reasoningEffort: thread.reasoningEffort, manualTitle: thread.name?.trim() || "", summary: summaryFromThread(thread) };
  };

  const releaseSession = async (threadId) => {
    try {
      await ensureProjectThread(threadId);
      const result = await client.request("thread/read", { threadId, includeTurns: false });
      if (result.thread?.status?.type === "active") throw Object.assign(new Error("当前会话正在运行，请完成后再切换配置"), { statusCode: 409 });
      await client.request("thread/unsubscribe", { threadId });
    } catch (error) {
      if (error?.statusCode === 409) throw error;
      if (!threadNotLoaded(error)) throw error;
    }
    freshThreadRuntime.delete(threadId);
    threadCache.delete(threadId);
  };

  const resumeProviderSession = async (threadId, options) => {
    if (!isAllowedProjectRoot(options.cwd) || !path.isAbsolute(options.path)) throw new Error('无法验证原会话记录的位置');
    const params = {
      threadId, path: options.path, cwd: options.cwd, model: options.model,
      developerInstructions: await getUserProfilePrompt(),
      ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
      ...(options.reasoningEffort ? { config: { model_reasoning_effort: options.reasoningEffort } } : {}),
      excludeTurns: true,
    };
    const result = await client.request('thread/resume', params).catch(error => {
      if (!/with stale path:.*omit path and resume by thread id/su.test(String(error.message))) throw error;
      const { path: stalePath, ...byId } = params;
      return client.request('thread/resume', byId);
    });
    if (result.thread?.id !== threadId || !isSameProjectRoot(result.thread.cwd, options.cwd)) throw new Error('原会话恢复未通过校验，未发送消息');
    threadCache.set(threadId, result.thread);
    // This is a restored thread, not an empty freshly-created one.
    freshThreadRuntime.delete(threadId);
    return result;
  };

  const updateReasoningEffort = async (threadId, reasoningEffort) => {
    const runtime = await resumeThread(threadId);
    await client.request("thread/settings/update", { threadId, effort: reasoningEffort });
    if (freshThreadRuntime.has(threadId)) {
      freshThreadRuntime.set(threadId, { ...runtime, reasoningEffort });
    }
    return { model: runtime.model || "", modelProvider: runtime.modelProvider || "", reasoningEffort };
  };

  const getPendingUserInput = async (threadId) => client.getPendingUserInput?.(threadId) || null;

  const isFreshSession = (threadId) => freshThreadRuntime.has(threadId);

  const respondToUserInput = async (threadId, requestId, answers) => (
    client.respondToUserInput?.(threadId, requestId, answers)
  );

  const close = () => {
    if (monitorTimer) clearInterval(monitorTimer);
    unsubscribe();
    unsubscribeHealth();
    for (const pending of autoTitleThreads.values()) pending.resolve(pending.text);
    autoTitleThreads.clear();
    client.close();
  };

  return {
    listSessions, listNativeSubagents, createSession, renameSession, findSession, sendMessage, steerMessage, interrupt,
    forkSession, archiveSession, unarchiveSession,
    listModels, updateModel, updateReasoningEffort, getRuntimeContext, getThreadStatus,
    revertSession, compactContext, reviewSession, getGoal, setGoal, clearGoal,
    getPendingUserInput, respondToUserInput, isFreshSession, close,
    getSessionResumeInfo, releaseSession, resumeProviderSession,
  };
};
