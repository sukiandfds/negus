import { isOccupied } from "../../../shared/api/occupation";
import { optimisticMessageId } from "../../../../../windows/server/message-identity.mjs";
import type { MediaFile } from "../../../shared/model/media";
import type { FollowUpQueueItem } from "../model/followUpQueue";
import type { ContentBlock, SessionMessage } from "../model/types";

export const createSubmissionId = (): string => {
  const timestamp = Date.now().toString(36);
  const unique = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `msg-${timestamp}-${unique}`;
};

export const messageContentBlocks = (messageId: string, text: string, attachments: MediaFile[]): ContentBlock[] => {
  const blocks: ContentBlock[] = text
    ? [{ id: `${messageId}-text`, type: "markdown", text }]
    : [];
  for (const file of attachments) {
    const common = { id: `${messageId}-${file.id}`, source: file.url, file };
    if (file.mimeType.startsWith("image/")) blocks.push({ ...common, type: "image", alt: file.name });
    else if (file.mimeType.startsWith("audio/")) blocks.push({ ...common, type: "audio" });
    else if (file.mimeType.startsWith("video/")) blocks.push({ ...common, type: "video" });
    else blocks.push({ ...common, type: "file", name: file.name });
  }
  return blocks;
};

export const createOptimisticMessage = (
  text: string,
  attachments: MediaFile[],
  submissionId: string = createSubmissionId(),
  createdAt = new Date().toISOString(),
): SessionMessage & { submissionId: string; createdAt: string } => {
  const id = optimisticMessageId(submissionId);
  return { id, role: "user", text, blocks: messageContentBlocks(id, text, attachments), createdAt, submissionId };
};

// Every send publishes its local row before starting asynchronous delivery.
export function beginOptimisticSend<T>(text: string, files: MediaFile[], publish: (message: SessionMessage & { submissionId: string; createdAt: string }) => T, id = createSubmissionId()) {
  return publish(createOptimisticMessage(text, files, id));
}

export function queuedTranscriptMessage(item: FollowUpQueueItem, dispatchedId?: string) {
  return { ...createOptimisticMessage(item.text, item.attachments, dispatchedId || item.submissionId,
    dispatchedId ? item.sentAt || item.createdAt : item.createdAt),
    authorId: item.authorId, authorName: item.authorName, displaySourceAgentId: item.displaySourceAgentId };
}

// A receipt updates the existing row; the caller owns its storage and retry policy.
export function deliveryPatch(state: SessionMessage["deliveryState"], error?: string, turnId?: string) {
  const deliveryState = state === "failed" && isOccupied(error) ? "occupied" as const : state;
  return { deliveryState, deliveryError: error, ...(turnId ? { turnId } : {}) };
}
