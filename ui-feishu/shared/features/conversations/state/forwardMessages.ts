import type { SessionMessage } from "../model/types";
import { presentConversationMessage } from "../rendering/heartbeatMessage";

export function forwardableMessage(message: SessionMessage) {
  const shown = presentConversationMessage(message).message;
  const text = shown.blocks?.length
    ? shown.blocks.filter(block => block.type === "markdown").map(block => block.text).join("\n")
    : shown.text;
  return {
    text,
    hasAttachments: Boolean(shown.blocks?.some(block => ["image", "audio", "video", "file"].includes(block.type))),
  };
}

export function composeForwardedMessages(
  source: string,
  items: { id: string; message: SessionMessage }[],
  selected: ReadonlySet<string>,
) {
  const messages = items.filter(item => selected.has(item.id)).map(({ message }) => ({
    message,
    ...forwardableMessage(message),
  })).filter(item => item.text.trim());
  return {
    text: messages.length ? [`来源：${source}`, ...messages.map(({ message, text }) => [
      [message.authorName || (message.role === "user" ? "我" : "助手"), message.createdAt].filter(Boolean).join(" · "),
      text,
    ].join("\n"))].join("\n\n") : "",
    hasAttachments: messages.some(item => item.hasAttachments),
  };
}
