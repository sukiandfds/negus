export type ContextPhase = "idle" | "queued" | "compacting" | "completed" | "failed";

export interface ContextStatus {
  type: "context_status";
  threadId: string;
  model: string;
  reasoningEffort: string;
  selectedSettings?: { model: string; reasoningEffort: string };
  lastSuccessfulSettings?: { model: string; reasoningEffort: string; providerName?: string; modelProviderId?: string } | null;
  usedTokens: number | null;
  contextWindow: number | null;
  percentage: number | null;
  autoCompactThreshold: number | null;
  phase: ContextPhase;
  message: string;
  updatedAt: string | null;
  compactionUpdatedAt?: string | null;
  compactionRevision?: number;
  usageSourceRevision?: string;
}
