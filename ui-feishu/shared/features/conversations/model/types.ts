import type { MediaFile } from "../../../shared/model/media";

export type MessageRole = "user" | "assistant";
export type SessionSource = "codex" | "happy";
export type ContentSyncState = "stable" | "syncing" | "recovering" | "degraded";

export interface ProjectInfo {
  name: string;
  root: string;
  mode: "read-only" | "interactive";
}

export interface MarkdownBlock { id: string; type: "markdown"; text: string }
export interface OptionsBlock { id: string; type: "options"; options: string[] }
export interface ImageBlock { id: string; type: "image"; source: string; alt?: string; width?: number; height?: number; file?: MediaFile }
export interface AudioBlock { id: string; type: "audio"; source: string; file?: MediaFile }
export interface VideoBlock { id: string; type: "video"; source: string; file?: MediaFile }
export interface FileBlock { id: string; type: "file"; source: string; name?: string; file?: MediaFile }
export type ContentBlock = MarkdownBlock | OptionsBlock | ImageBlock | AudioBlock | VideoBlock | FileBlock;

export interface SessionMessage {
  id: string;
  role: MessageRole;
  text: string;
  deliveryState?: "preparing" | "sending" | "pending" | "failed" | "occupied";
  deliveryError?: string;
  submissionId?: string;
  blocks?: ContentBlock[];
  createdAt?: string;
  serverTimestamp?: boolean;
  turnId?: string;
  protocolTurnId?: string;
  phase?: string;
  turnItemIndex?: number;
  turnStatus?: string;
  turnHasFinalAnswer?: boolean;
  turnStartedAtMs?: number | null;
  superseded?: boolean;
  itemId?: string;
  authorId?: string;
  authorName?: string;
  displaySourceAgentId?: string;
  sequence?: number;
  source?: string;
}

export interface SessionSummary {
  model?: string;
  modelProviderId?: string;
  threadId: string;
  source: SessionSource;
  title: string;
  updatedAt: string;
  messageCount: number | null;
  latestUser: string;
  latestAssistant: string;
  latestMessage?: string;
  archived?: boolean;
  archivable?: boolean;
  conversationKind?: string;
  createdBy?: 'user' | 'assistant';
  readOnly?: boolean;
  forkedFromId?: string | null;
  cwd?: string | null;
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[];
  contentVersion?: number;
  hasMore?: boolean;
  nextBefore?: number | null;
  nextCursor?: string | null;
}

export type SessionPatch = Partial<SessionSummary> & {
  hasMore?: boolean;
  nextBefore?: number | null;
  nextCursor?: string | null;
};

export interface SessionDelta {
  threadId: string;
  contentVersion: number;
  unchanged: boolean;
  upserts: SessionMessage[];
  deletes: string[];
  sessionPatch?: SessionPatch;
}

export type SessionResponse = SessionDetail | SessionDelta;

// FEAT-001 (2026-10-30): persist associated conversation display fields with its history snapshot.
export interface ConversationPresentation {
  executionStatus: import('../../execution/model/types').ExecutionStatus;
  contextStatus: import('../../context-management/model/types').ContextStatus;
  visibleModel: string;
  visibleEffort: string;
  usageModel: string;
  goal: import('../../goals/model/types').ThreadGoal | null;
  queueItems: import('./followUpQueue').FollowUpQueueItem[];
  userInputRequest: import('../../execution/model/types').UserInputRequest | null;
  streamingText: string;
  commentaryText: string;
}
