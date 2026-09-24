import type { ContentBlock, SessionMessage } from "../model/types";

interface StreamSegment {
  id: string;
  itemId: string;
  text: string;
  createdAt: string;
  turnId: string;
}

interface StreamCut {
  itemId: string;
  prefix: string;
  at: string;
}

export interface LiveTranscriptView {
  persisted: SessionMessage[];
  preceding: SessionMessage[];
  optimistic: SessionMessage[];
  live: { message: SessionMessage; streaming: boolean } | null;
  placeholder: SessionMessage | null;
  executionMessageId: string;
  streamingMessageId: string;
  answerStreaming: boolean;
}

export interface LiveTranscriptMemory {
  threadId: string;
  starts: Map<string, string>;
  frozen: StreamSegment[];
  liveItemId: string;
  liveText: string;
  liveStartedAt: string;
  serverText: string;
  optimisticIds: string[];
  cut: StreamCut | null;
  signature: string;
  view: LiveTranscriptView | null;
}

export interface LiveTranscriptInput {
  threadId: string;
  messages: SessionMessage[];
  streamingText: string;
  streamingItemId: string;
  turnId: string;
  active: boolean;
  showExecution: boolean;
  now: string;
}

const normalized = (value: string) => value.replace(/\s+/gu, " ").trim();

const isOptimistic = (message: SessionMessage) => message.id.startsWith("optimistic-");

const timestampOf = (message: SessionMessage) => {
  const timestamp = Date.parse(message.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : null;
};

const byCreatedAt = (left: SessionMessage, right: SessionMessage) => (
  (timestampOf(left) ?? Number.MAX_SAFE_INTEGER) - (timestampOf(right) ?? Number.MAX_SAFE_INTEGER)
);

const markdownBlock = (id: string, text: string): ContentBlock => ({ id, type: "markdown", text });

export const createLiveTranscriptMemory = (): LiveTranscriptMemory => ({
  threadId: "",
  starts: new Map(),
  frozen: [],
  liveItemId: "",
  liveText: "",
  liveStartedAt: "",
  serverText: "",
  optimisticIds: [],
  cut: null,
  signature: "",
  view: null,
});

const rememberStart = (memory: LiveTranscriptMemory, itemId: string, now: string) => {
  if (!itemId) return now;
  const known = memory.starts.get(itemId);
  if (known) return known;
  memory.starts.set(itemId, now);
  return now;
};

const toMessage = (segment: StreamSegment): SessionMessage => ({
  id: segment.id,
  role: "assistant",
  text: segment.text,
  blocks: [markdownBlock(`${segment.id}-text`, segment.text)],
  createdAt: segment.createdAt,
  ...(segment.turnId ? { turnId: segment.turnId } : {}),
  ...(segment.itemId ? { itemId: segment.itemId } : {}),
});

const coveredByHistory = (messages: SessionMessage[], itemId: string, text: string) => {
  const wanted = normalized(text);
  if (!wanted) return false;
  return messages.some((message) => {
    if (message.role !== "assistant" || isOptimistic(message)) return false;
    const got = normalized(message.text);
    if (got === wanted) return true;
    return Boolean(itemId) && message.itemId === itemId && got.includes(wanted);
  });
};

const freezeDisplayed = (memory: LiveTranscriptMemory, turnId: string, now: string) => {
  if (!normalized(memory.liveText)) return;
  const itemId = memory.liveItemId || `local-${memory.frozen.length}`;
  const duplicate = memory.frozen.some((segment) => normalized(segment.text) === normalized(memory.liveText));
  if (duplicate) return;
  const createdAt = memory.liveStartedAt || rememberStart(memory, itemId, now);
  memory.frozen.push({
    id: `stream-segment:${itemId}:${createdAt}:${memory.frozen.length}`,
    itemId,
    text: memory.liveText,
    createdAt,
    turnId,
  });
};

const historySplitAfterCut = (messages: SessionMessage[], cut: StreamCut, turnId: string) => {
  const cutAt = Date.parse(cut.at);
  return messages.some((message, index, all) => {
    const createdAt = Date.parse(message.createdAt || "");
    if (message.role !== "user" || isOptimistic(message) || message.turnId !== turnId) return false;
    if (!Number.isFinite(createdAt) || createdAt + 5000 < cutAt) return false;
    return all.slice(index + 1).some((later) => (
      later.role === "assistant"
      && later.turnId === message.turnId
      && later.itemId !== cut.itemId
    ));
  });
};

export const advanceLiveTranscript = (memory: LiveTranscriptMemory, input: LiveTranscriptInput): LiveTranscriptView => {
  if (memory.threadId !== input.threadId) {
    const next = createLiveTranscriptMemory();
    next.threadId = input.threadId;
    Object.assign(memory, next);
    memory.starts = new Map();
    memory.frozen = [];
  }

  const optimistic = input.messages.filter(isOptimistic);
  const optimisticIds = optimistic.map((message) => message.id);
  const signature = [
    input.threadId,
    input.streamingText,
    input.streamingItemId,
    input.turnId,
    input.active ? "1" : "0",
    input.showExecution ? "1" : "0",
    optimisticIds.join(","),
    input.messages.map((message) => [
      message.id,
      message.itemId || "",
      message.createdAt || "",
      message.turnItemIndex ?? "",
      message.text.length,
    ].join("|")).join("\n"),
  ].join("\n");
  if (memory.signature === signature && memory.view) return memory.view;

  const text = input.streamingText || "";
  const itemId = input.streamingItemId || "";
  const removed = memory.optimisticIds.filter((id) => !optimisticIds.includes(id));
  if (removed.length && optimisticIds.length === 0 && memory.cut && text === memory.cut.prefix) {
    const prefix = normalized(memory.cut.prefix);
    memory.frozen = memory.frozen.filter((segment) => normalized(segment.text) !== prefix);
    memory.cut = null;
    memory.liveText = text;
    memory.liveItemId = itemId;
    memory.liveStartedAt = (itemId && memory.starts.get(itemId)) || memory.liveStartedAt || input.now;
  }

  const added = optimisticIds.filter((id) => !memory.optimisticIds.includes(id));
  if (added.length && normalized(memory.liveText)) {
    const prefix = memory.serverText || memory.liveText;
    freezeDisplayed(memory, input.turnId, input.now);
    memory.cut = { itemId: memory.liveItemId, prefix, at: input.now };
    memory.liveText = "";
    memory.liveStartedAt = input.now;
  }
  memory.optimisticIds = optimisticIds;

  const streamClearedDuringCut = Boolean(memory.cut && !itemId && !text);
  if (streamClearedDuringCut) {
    memory.liveItemId = memory.cut?.itemId || memory.liveItemId;
  } else if (itemId !== memory.liveItemId) {
    freezeDisplayed(memory, input.turnId, input.now);
    memory.liveItemId = itemId;
    memory.liveStartedAt = itemId ? rememberStart(memory, itemId, input.now) : "";
    if (memory.cut && itemId && memory.cut.itemId !== itemId) memory.cut = null;
    memory.liveText = text;
  } else if (memory.cut && itemId === memory.cut.itemId && (text === memory.cut.prefix || text.startsWith(memory.cut.prefix))) {
    memory.liveText = text.slice(memory.cut.prefix.length);
    memory.liveStartedAt = memory.cut.at;
  } else if (itemId || text) {
    if (itemId) memory.liveStartedAt = rememberStart(memory, itemId, memory.liveStartedAt || input.now);
    memory.liveText = text;
  }
  if (!streamClearedDuringCut) memory.serverText = text;

  if (memory.cut && historySplitAfterCut(input.messages, memory.cut, input.turnId)) {
    memory.cut = null;
  }

  let persisted = input.messages.filter((message) => !isOptimistic(message)).map((message) => {
    if (message.createdAt || message.role !== "assistant" || !message.itemId) return message;
    const createdAt = memory.starts.get(message.itemId);
    return createdAt ? { ...message, createdAt } : message;
  });

  let overlayId = "";
  if (!memory.cut && itemId && normalized(memory.liveText)) {
    const index = persisted.findIndex((message) => message.role === "assistant" && message.itemId === itemId);
    const current = index >= 0 ? persisted[index] : undefined;
    if (current && memory.liveText.startsWith(current.text)) {
      const createdAt = current.createdAt || memory.liveStartedAt || input.now;
      persisted[index] = {
        ...current,
        text: memory.liveText,
        blocks: [markdownBlock(`${current.id}-live`, memory.liveText)],
        createdAt,
      };
      overlayId = current.id;
    }
  }

  if (memory.cut) {
    const cut = memory.cut;
    persisted = persisted.filter((message) => !(message.role === "assistant" && message.itemId && message.itemId === cut.itemId));
    if (normalized(cut.prefix) && !memory.frozen.some((segment) => normalized(segment.text) === normalized(cut.prefix))) {
      const createdAt = (cut.itemId && memory.starts.get(cut.itemId)) || cut.at;
      memory.frozen.push({
        id: `stream-cut:${cut.itemId || "pending"}:${cut.at}`,
        itemId: cut.itemId,
        text: cut.prefix,
        createdAt,
        turnId: input.turnId,
      });
    }
  }

  memory.frozen = memory.frozen.filter((segment) => normalized(segment.text) && !coveredByHistory(persisted, segment.itemId, segment.text));
  const liveCovered = Boolean(normalized(memory.liveText)) && !memory.cut && coveredByHistory(persisted, itemId, memory.liveText);
  const showLive = Boolean(normalized(memory.liveText)) && !overlayId && !liveCovered;
  const liveId = `stream-live:${itemId || "current"}`;
  const live = showLive ? {
    message: toMessage({
      id: liveId,
      itemId,
      text: memory.liveText,
      createdAt: memory.liveStartedAt || input.now,
      turnId: input.turnId,
    }),
    streaming: input.active,
  } : null;
  const placeholder = input.active && !showLive && !overlayId ? {
    id: "execution-placeholder",
    role: "assistant" as const,
    text: "",
    ...(input.turnId ? { turnId: input.turnId } : {}),
  } : null;

  let executionMessageId = "";
  if (input.showExecution) {
    if (placeholder) executionMessageId = placeholder.id;
    else if (live) executionMessageId = live.message.id;
    else if (overlayId) executionMessageId = overlayId;
    else {
      const preceding = [...memory.frozen].reverse().find((segment) => segment.turnId === input.turnId) || memory.frozen.at(-1);
      const persistedTarget = [...persisted].reverse().find((message) => (
        message.role === "assistant" && (!input.turnId || message.turnId === input.turnId)
      ));
      executionMessageId = preceding?.id || persistedTarget?.id || "";
    }
  }

  const pendingAtTail = optimistic;

  const view: LiveTranscriptView = {
    persisted,
    preceding: memory.frozen.map(toMessage),
    optimistic: pendingAtTail.sort(byCreatedAt),
    live,
    placeholder,
    executionMessageId,
    streamingMessageId: input.active && normalized(memory.liveText) ? overlayId || live?.message.id || "" : "",
    answerStreaming: Boolean(input.active && normalized(memory.liveText)),
  };
  memory.signature = signature;
  memory.view = view;
  return view;
};
