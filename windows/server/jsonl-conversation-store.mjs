import { latestRolloutFile, openRollout, orderedRolloutFiles } from './rollout-file.mjs';
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { blocksFromContent, messageFromItem, messagePreview, previewText } from "./content-blocks.mjs";
import { conversationSourceRevision } from "./conversation-version-store.mjs";

const walkJsonl = async (directory) => {
  let entries = [];
  try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const groups = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJsonl(fullPath);
    return entry.isFile() && /\.jsonl(?:\.zst)?$/.test(entry.name) ? [fullPath] : [];
  }));
  return groups.flat();
};

const threadIdFromFile = (file) => path.basename(file).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/iu)?.[0] || path.basename(file);

export const createJsonlConversationStore = ({ sessionRoot, fallbackSessionRoots = [], projectRoot, projectRoots = [projectRoot], registerMedia, onChange }) => {
  const historyRoots = [...new Set([sessionRoot, ...fallbackSessionRoots])];
  const archivedRoots = historyRoots.map(root => path.join(path.dirname(root), 'archived_sessions'));
  const headerCache = new Map();
  const projectHeaders = new Map();
  const sessionCache = new Map();
  const reading = new Map();
  let initializePromise;
  let reconcileTimer;

  const sameProject = (cwd) => {
    if (!cwd) return false;
    try {
      const resolved = path.resolve(cwd).toLowerCase();
      return projectRoots.some((root) => path.resolve(root).toLowerCase() === resolved);
    } catch { return false; }
  };

  const isArchivedFile = (file) => {
    const candidate = path.resolve(file).toLowerCase();
    return archivedRoots.some(directory => {
      const root = path.resolve(directory).toLowerCase();
      return candidate === root || candidate.startsWith(`${root}${path.sep}`);
    });
  };

  const readHeader = async (file, refresh = false) => {
    if (!refresh && headerCache.has(file)) return headerCache.get(file);
    let handle;
    try {
      handle = await openRollout(file);
      const decoder = new StringDecoder("utf8");
      const buffer = Buffer.alloc(32768);
      let offset = 0;
      let carry = "";
      while (offset < 1024 * 1024) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        offset += bytesRead;
        const lines = (carry + decoder.write(buffer.subarray(0, bytesRead))).split(/\r?\n/u);
        carry = lines.pop() || "";
        for (const line of lines) {
          try {
            const item = JSON.parse(line);
            if (item?.type !== "session_meta") continue;
            const header = {
              file,
              cwd: item.payload?.cwd || "",
              cliVersion: item.payload?.cli_version || "",
              threadId: item.payload?.id || item.payload?.session_id || threadIdFromFile(file),
              title: item.payload?.name || item.payload?.title || null,
              archived: isArchivedFile(file),
              forkedFromId: item.payload?.forked_from_id || null,
              nativeSubagent: Boolean(item.payload?.source?.subagent || item.payload?.source?.subAgent),
              parentThreadId: item.payload?.source?.subagent?.thread_spawn?.parent_thread_id
                || item.payload?.source?.subAgent?.thread_spawn?.parent_thread_id || null,
            };
            headerCache.set(file, header);
            return header;
          } catch {}
        }
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    finally { await handle?.close().catch(() => {}); }
    return null;
  };

  const addFile = async (file) => {
    if (!/\.jsonl(?:\.zst)?$/.test(file)) return false;
    let header;
    try { header = await readHeader(file, true); }
    catch (error) { headerCache.set(file, { file, threadId: threadIdFromFile(file), error }); return false; }
    if (!header) headerCache.set(file, { file, threadId: threadIdFromFile(file), invalid: true });
    if (!header || !sameProject(header.cwd)) return false;
    projectHeaders.set(file, header);
    return true;
  };

  const reconcile = async () => {
    const files = (await Promise.all([...historyRoots, ...archivedRoots].map(walkJsonl))).flat();
    const existing = new Set(files);
    for (const file of projectHeaders.keys()) {
      if (!existing.has(file)) {
        projectHeaders.delete(file);
        headerCache.delete(file);
        sessionCache.delete(file);
      }
    }
    await Promise.all(files.filter((file) => !headerCache.has(file)).map(addFile));
  };

  const initialize = () => {
    initializePromise ||= reconcile();
    return initializePromise;
  };

  const withCurrentIndex = async (read) => {
    await initialize();
    try { return await read(); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      await reconcile();
      return read();
    }
  };

  const scheduleReconcile = () => {
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => void reconcile().then(() => onChange({ type: "sessions_changed" })), 500);
  };

  let watcher;
  try {
    watcher = fs.watch(sessionRoot, { recursive: true }, (event, filename) => {
      if (!filename || !/\.jsonl(?:\.zst)?$/.test(String(filename))) return;
      if (event === "rename") { scheduleReconcile(); return; }
      const file = path.resolve(sessionRoot, String(filename));
      const header = projectHeaders.get(file);
      if (header) {
        onChange({ type: "sessions_changed", threadId: header.threadId });
      } else {
        scheduleReconcile();
      }
    });
    watcher.on("error", scheduleReconcile);
  } catch {}

  const fallbackTimer = setInterval(() => void reconcile(), 60000);
  fallbackTimer.unref?.();

  const createSessionState = (header) => ({
    ...header,
    offset: 0,
    carry: "",
    lastKey: "",
    messageSequence: 0,
    messages: [],
    userMessageEvents: new Map(),
    pendingAssistantMedia: [],
    decoder: new StringDecoder("utf8"),
  });

  const blockKey = (block) => `${block.type}:${block.source || block.text || ""}`;

  const mergeBlocks = (current, incoming) => {
    const seen = new Set(current.map(blockKey));
    return [...current, ...incoming.filter((block) => !seen.has(blockKey(block)))];
  };

  const isFinalAssistantItem = (item) => (
    (item?.type === "event_msg" && item.payload?.type === "agent_message" && item.payload?.phase === "final_answer")
    || (item?.type === "response_item" && item.payload?.type === "message" && item.payload?.role === "assistant"
      && (!item.payload?.phase || item.payload.phase === "final_answer"))
  );

  const processLine = (state, line) => {
    if (!line.trim()) return;
    try {
      const item = JSON.parse(line);
      const precedingUserInput = state.precedingUserInput;
      state.precedingUserInput = null;
      if (item.type === "event_msg" && item.payload?.item?.type === "ContextCompaction" && item.payload.type === "item_completed") {
        const { turn_id, started_at_ms, completed_at_ms } = item.payload;
        // Codex exposes this operation as ContextCompaction, not as an assistant answer.
        state.messages = state.messages.filter(message => !(message.protocolTurnId === turn_id && message.role === "assistant"
          && message.phase === "final_answer" && Date.parse(message.createdAt) >= started_at_ms && Date.parse(message.createdAt) <= completed_at_ms));
        return;
      }
      if (item.type === "event_msg" && item.payload?.type === "item_completed" && item.payload.item?.type === "UserMessage") {
        const event = item.payload;
        if (state.userMessageEvents.has(event.item.id)) {
          state.precedingUserInput = precedingUserInput;
          return;
        }
        const completed = new Date(event.completed_at_ms);
        const time = Number.isFinite(event.completed_at_ms) && Number.isFinite(completed.getTime()) ? completed.toISOString() : item.timestamp;
        if (time && Number.isFinite(Date.parse(time))) {
          state.userMessageEvents.set(event.item.id, { itemId: event.item.id, submissionId: event.item.client_id, turnId: event.turn_id, createdAt: time });
          // Codex writes the actual input response immediately before its confirmation.
          // They share the turn but can have different item IDs. Pair individual records,
          // never all the inputs in the turn or all messages with the same text.
          const message = state.messages.findLast(message => message.role === "user" && message.itemId === event.item.id)
            || (precedingUserInput?.turnId === event.turn_id && !precedingUserInput?.submissionId ? precedingUserInput : null);
          if (message) Object.assign(message, { createdAt: time, ...(event.item.client_id ? { submissionId: event.item.client_id } : {}) });
        }
      }
      if (item.type === "event_msg" && item.payload?.type === "task_started") state.currentTurnId = item.payload.turn_id;
      if (item.type === "event_msg" && ["task_complete", "turn_aborted"].includes(item.payload?.type)) {
        const turnId = item.payload.turn_id || state.currentTurnId;
        const hasFinalAnswer = state.messages.some(message => (message.protocolTurnId || message.turnId) === turnId
          && message.role === "assistant" && message.phase === "final_answer" && Boolean(message.text?.trim()));
        for (const previous of state.messages) {
          if (turnId && (previous.protocolTurnId || previous.turnId) === turnId) {
            previous.turnStatus = item.payload.type === "turn_aborted" ? "interrupted" : "completed";
            previous.turnHasFinalAnswer = hasFinalAnswer;
          }
        }
      }
      if (item?.type === "response_item" && item.payload?.type === "custom_tool_call_output") {
        const media = blocksFromContent(item.payload.output, registerMedia)
          .filter((block) => ["image", "audio", "video"].includes(block.type));
        state.pendingAssistantMedia = mergeBlocks(state.pendingAssistantMedia, media);
        return;
      }

      const message = messageFromItem(item, registerMedia);
      if (!message) return;
      const timestamp = Date.parse(item.timestamp || "");
      if (Number.isFinite(timestamp)) message.createdAt = new Date(timestamp).toISOString();
      if (isFinalAssistantItem(item) && state.pendingAssistantMedia.length) {
        message.blocks = mergeBlocks(message.blocks, state.pendingAssistantMedia);
        state.pendingAssistantMedia = [];
      }

      const messageIndex = state.messageSequence;
      state.messageSequence += 1;
      const itemId = item.id || item.payload?.id || item.payload?.client_id || message.itemId || "";
      const turnId = message.turnId || item.turnId || state.currentTurnId || "";
      if (state.currentTurnId) message.protocolTurnId = state.currentTurnId;
      if (turnId) {
        message.turnId = turnId;
        message.turnItemIndex = messageIndex;
        if (message.role === "user") {
          const previousReply = state.messages.findLast((entry) => entry.role === "assistant" && entry.turnId === turnId);
          if (previousReply) previousReply.superseded = true;
        }
      }
      const identity = itemId || `${item.timestamp || "unknown"}:${messageIndex}`;
      message.id = itemId && turnId ? `codex:${encodeURIComponent(state.currentTurnId || turnId)}:${encodeURIComponent(String(itemId))}`
        : `jsonl:${encodeURIComponent(state.threadId)}:${encodeURIComponent(String(turnId || "unknown"))}:${encodeURIComponent(String(identity))}`;
      const event = state.userMessageEvents.get(itemId);
      if (message.role === 'user' && event) Object.assign(message, { createdAt: event.createdAt, ...(event.submissionId ? { submissionId: event.submissionId } : {}) });
      const metadata = item.payload?.internal_chat_message_metadata_passthrough;
      if (message.role === "user" && item.type === "response_item" && metadata?.turn_id
        && metadata.content_item_metadata?.some(entry => entry.provenance?.type === "user")) {
        state.precedingUserInput = message;
      }
      const previous = state.messages.at(-1);
      const mirrored = previous && state.lastOrigin !== item.type && ['event_msg', 'response_item'].includes(state.lastOrigin)
        && previous.role === message.role && previous.text === message.text
        && (previous.protocolTurnId || previous.turnId) === (message.protocolTurnId || message.turnId)
        && (previous.phase || 'final_answer') === (message.phase || 'final_answer');
      state.lastOrigin = item.type;
      if (mirrored) {
        const preferred = item.type === 'response_item' ? message : previous;
        const merged = { ...preferred, blocks: mergeBlocks(previous.blocks, message.blocks) };
        state.messages[state.messages.length - 1] = merged;
        if (state.precedingUserInput) state.precedingUserInput = merged;
        return;
      }
      const logicalKey = `${message.role}:${turnId}:${identity}:${item.timestamp || ""}`;
      if (previous?.role === message.role && previous.text === message.text && state.lastKey.startsWith(`${logicalKey}:`)) {
        previous.blocks = mergeBlocks(previous.blocks, message.blocks);
        if (state.precedingUserInput) state.precedingUserInput = previous;
        state.lastKey = `${logicalKey}:${previous.blocks.map(blockKey).join("|")}`;
        return;
      }
      const key = `${logicalKey}:${message.blocks.map((block) => `${block.type}:${block.source || block.text || ""}`).join("|")}`;
      if (key !== state.lastKey) state.messages.push(message);
      state.lastKey = key;
    } catch (error) { throw new Error(`历史记录解析失败：${path.basename(state.file)}：${error.message}`); }
  };

  const readAppend = async (file, start, length) => {
    if (length <= 0) return Buffer.alloc(0);
    const handle = await openRollout(file);
    try {
      const buffer = Buffer.alloc(length);
      let total = 0;
      while (total < length) {
        const { bytesRead } = await handle.read(buffer, total, length - total, start + total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      return buffer.subarray(0, total);
    } finally { await handle.close(); }
  };

  const readSessionData = async (header) => {
    const stat = await fsp.stat(header.file);
    let size = stat.size;
    if (header.file.endsWith(".zst")) { const handle = await openRollout(header.file); size = (await handle.stat()).size; await handle.close(); }
    let state = sessionCache.get(header.file);
    if (!state || size < state.offset || (size === state.offset && state.modifiedAt !== stat.mtimeMs)) state = createSessionState(header);
    state.modifiedAt = stat.mtimeMs;
    const appended = await readAppend(header.file, state.offset, size - state.offset);
    state.offset += appended.length;
    if (appended.length) {
      const lines = (state.carry + state.decoder.write(appended)).split(/\r?\n/u);
      state.carry = lines.pop() || "";
      try {
        for (let index = 0; index < lines.length; index++) {
          processLine(state, lines[index]);
          if (index % 1024 === 1023) await new Promise(setImmediate);
        }
      }
      catch (error) { sessionCache.delete(header.file); throw error; }
    }
    sessionCache.set(header.file, state);

    const latestUser = state.messages.findLast((item) => item.role === "user")?.text || "";
    const latestAssistant = state.messages.findLast((item) => item.role === "assistant")?.text || "";
    return {
      threadId: state.threadId,
      sourceRevision: conversationSourceRevision(stat),
      file: path.basename(header.file),
      source: state.cliVersion === "0.122.0" ? "happy" : "codex",
      title: header.title?.trim()
        || previewText(state.messages.find((item) => item.role === "user" && item.text?.trim())?.text || "", 36)
        || `新对话 · ${state.threadId.slice(-6)}`,
      updatedAt: state.messages.findLast((item) => (item.role === "user" || item.role === "assistant") && item.createdAt)?.createdAt || stat.mtime.toISOString(),
      messageCount: state.messages.length,
      latestUser: previewText(latestUser, 260),
      latestAssistant: previewText(latestAssistant, 260),
      latestMessage: messagePreview(state.messages.at(-1)),
      archived: Boolean(header.archived),
      cwd: header.cwd || null,
      forkedFromId: header.forkedFromId,
      nativeSubagent: header.nativeSubagent === true,
      parentThreadId: header.parentThreadId || null,
      messages: state.messages,
    };
  };

  const readSession = (header) => {
    if (!reading.has(header.file)) {
      const request = readSessionData(header).finally(() => reading.delete(header.file));
      reading.set(header.file, request);
    }
    return reading.get(header.file);
  };

  const listSessions = async (source = "all", archived = false) => withCurrentIndex(async () => {
    const sessions = await Promise.all([...projectHeaders.values()].map(readSession));
    return sessions
      .filter((session) => session.messages.length
        && Boolean(session.archived) === Boolean(archived)
        && (source === "all" || session.source === source))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  });

  const listNativeSubagents = async (archived = false) => withCurrentIndex(async () => {
    return Promise.all([...projectHeaders.values()].filter(header => header.nativeSubagent && header.parentThreadId
      && header.archived === archived).map(async header => ({
      threadId: header.threadId, source: 'codex', title: header.title || `新对话 · ${header.threadId.slice(-6)}`,
      cwd: header.cwd, archived, nativeSubagent: true, parentThreadId: header.parentThreadId,
      updatedAt: (await fsp.stat(header.file)).mtime.toISOString(), messageCount: null,
    })));
  });

  const findSession = async (threadId, source = "all", { before, beforeMessageId, cursor, limit, metadataOnly = false, includeEventTimes = false, historyFile } = {}) => withCurrentIndex(async () => {
    for (const cached of headerCache.values()) if (cached.threadId === threadId && cached.error) {
      await addFile(cached.file);
      if (headerCache.get(cached.file)?.error) throw headerCache.get(cached.file).error;
    }
    let headers = [...projectHeaders.values()].filter(item => item.threadId === threadId);
    if (!headers.length || historyFile) {
      if (!headers.length) await reconcile();
      headers = [...projectHeaders.values()].filter(item => item.threadId === threadId);
      if (historyFile) {
        const recorded = await readHeader(await latestRolloutFile(historyFile), true);
        if (recorded && (recorded.threadId !== threadId || !sameProject(recorded.cwd))) {
          throw Object.assign(new Error("无权读取该项目的对话"), { statusCode: 403 });
        }
        if (recorded && !headers.some(item => item.file === recorded.file)) headers.push(recorded);
      }
    }
    if (!headers.length) {
      const known = [...headerCache.values()].find(item => item.threadId === threadId
        && [...historyRoots, ...archivedRoots].some(root => path.resolve(item.file).startsWith(path.resolve(root) + path.sep)));
      if (!known) return null;
      const header = await readHeader(known.file, true);
      if (!header) throw new Error("历史文件缺少有效的会话元数据");
      if (!sameProject(header.cwd)) throw Object.assign(new Error("无权读取该项目的对话"), { statusCode: 403 });
      headers = [header];
    }
    const files = await orderedRolloutFiles(headers.map(header => header.file));
    const ordered = await Promise.all(files.map(async file => ({ header: headers.find(header => header.file === file), stat: await fsp.stat(file) })));
    const header = ordered.at(-1).header;
    const fileRevision = ordered.map(({ stat }) => conversationSourceRevision(stat)).join('|');
    const sourceRevision = fileRevision;
    if (metadataOnly) return { id: threadId, path: header.file, paths: files, cwd: header.cwd, name: header.title, sourceRevision };
    const parts = await Promise.all(ordered.map(({ header }) => readSession(header)));
    const after = await Promise.all(files.map(file => fsp.stat(file).then(conversationSourceRevision)));
    if (after.join('|') !== fileRevision) throw Object.assign(new Error("对话更新中，请重试同步"), { statusCode: 409 });
    const messages = [...new Map(parts.flatMap(part => part.messages).map(message => [message.id, message])).values()];
    let session = { ...parts.at(-1), messages: messages.map((message, sequence) => ({ ...message, sequence })), messageCount: messages.length, sourceRevision };
    if (source !== "all" && session.source !== source) return null;
    if (includeEventTimes) session = { ...session, userMessageEvents: ordered.flatMap(({ header }) => [...sessionCache.get(header.file).userMessageEvents.values()]) };
    if (!limit) return session;
    const anchor = beforeMessageId ? session.messages.findIndex(message => message.id === beforeMessageId || message.itemId === beforeMessageId) : -1;
    if (beforeMessageId && anchor < 0) throw Object.assign(new Error("历史分页位置已变化，请刷新对话后重试"), { statusCode: 409 });
    if (cursor && !beforeMessageId) throw Object.assign(new Error("历史分页游标已变化，请刷新对话后重试"), { statusCode: 409 });
    const end = Math.min(anchor >= 0 ? anchor : Number.isSafeInteger(before) ? before : session.messages.length, session.messages.length);
    const start = Math.max(0, end - limit);
    return { ...session, messages: session.messages.slice(start, end), hasMore: start > 0, nextBefore: start || null };
  });

  const close = () => {
    clearTimeout(reconcileTimer);
    clearInterval(fallbackTimer);
    watcher?.close();
  };

  return { listSessions, listNativeSubagents, findSession, close };
};
