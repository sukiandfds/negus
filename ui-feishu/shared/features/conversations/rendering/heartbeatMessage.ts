import type { ContentBlock, SessionMessage } from "../model/types";

export const QUIET_HEARTBEAT_TEXT = "Heartbeat completed quietly.";

export interface HeartbeatUser {
  automationId: string | null;
  currentTimeIso: string;
  instructions: string;
}

const tagValue = (source: string, name: string) => {
  const match = new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i").exec(source);
  if (!match) return null;
  return match[1].trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/u, "$1").trim();
};

const lastHeartbeat = (text: string) => Array.from(text.matchAll(/<heartbeat>[\s\S]*?<\/heartbeat>/giu)).at(-1)?.[0] ?? null;

const textOutsideHeartbeat = (text: string) => text
  .replace(/```(?:xml)?\s*<heartbeat>[\s\S]*?<\/heartbeat>\s*```/giu, "")
  .replace(/<heartbeat>[\s\S]*?<\/heartbeat>/giu, "")
  .trim();

export function parseHeartbeatUser(text: string): HeartbeatUser | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<heartbeat>") || !trimmed.endsWith("</heartbeat>")) return null;
  const currentTimeIso = tagValue(trimmed, "current_time_iso");
  const instructions = tagValue(trimmed, "instructions");
  if (currentTimeIso == null || instructions == null) return null;
  return {
    automationId: tagValue(trimmed, "automation_id"),
    currentTimeIso,
    instructions,
  };
}

export function heartbeatAssistantText(text: string): string | null {
  const trimmed = text.trim();
  const cdata = trimmed.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/u)?.[1]?.trim() ?? trimmed;
  if (cdata === "DONT_NOTIFY") return QUIET_HEARTBEAT_TEXT;

  const block = lastHeartbeat(trimmed);
  const decision = block?.match(/<decision>\s*(NOTIFY|DONT_NOTIFY)\s*<\/decision>/iu)?.[1]?.toUpperCase();
  if (block && (decision === "NOTIFY" || decision === "DONT_NOTIFY")) {
    const outside = textOutsideHeartbeat(trimmed);
    const message = tagValue(block, "message") ?? "";
    if (outside) return outside;
    if (message) return message;
    return decision === "DONT_NOTIFY" ? QUIET_HEARTBEAT_TEXT : "";
  }

  if (!/<heartbeat[\s>]/iu.test(trimmed)) return null;
  const outside = trimmed
    .replace(/```(?:xml)?\s*<heartbeat>[\s\S]*?<\/heartbeat>\s*```/giu, "")
    .replace(/<heartbeat>[\s\S]*?<\/heartbeat>/giu, "")
    .replace(/<heartbeat[\s\S]*$/iu, "")
    .trim();
  const message = tagValue(trimmed, "message") ?? "";
  if (outside || message) return outside || message;
  return "";
}

const isHeartbeatMarkdown = (text: string) => Boolean(parseHeartbeatUser(text)) || heartbeatAssistantText(text) !== null;

function replaceHeartbeatMarkdown(message: SessionMessage, text: string): SessionMessage {
  if (!message.blocks?.length) return { ...message, text };
  let replaced = false;
  const blocks: ContentBlock[] = [];
  for (const block of message.blocks) {
    if (block.type !== "markdown" || !isHeartbeatMarkdown(block.text)) {
      blocks.push(block);
      continue;
    }
    if (!replaced && text) blocks.push({ ...block, text });
    replaced = true;
  }
  if (!replaced && text) blocks.unshift({ id: `${message.id}-heartbeat`, type: "markdown", text });
  return { ...message, text, blocks };
}

export function presentConversationMessage(message: SessionMessage) {
  if (message.role === "user") {
    const user = parseHeartbeatUser(message.text);
    if (!user) return { message, user: null, assistantText: null as string | null };
    return { message: replaceHeartbeatMarkdown(message, user.instructions), user, assistantText: null as string | null };
  }
  const assistantText = heartbeatAssistantText(message.text);
  if (assistantText === null) return { message, user: null, assistantText: null as string | null };
  return { message: replaceHeartbeatMarkdown(message, assistantText), user: null, assistantText };
}
