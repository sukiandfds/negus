import type { MediaFile } from "../../../shared/model/media";

export type FollowUpQueueState = "pending" | "dispatching" | "failed";

export interface FollowUpQueueItem {
  authorId?: string;
  authorName?: string;
  displaySourceAgentId?: string;
  id: string;
  threadId: string;
  submissionId: string;
  dispatchSubmissionId?: string;
  text: string;
  attachmentIds: string[];
  attachments: MediaFile[];
  state: FollowUpQueueState;
  error: string;
  createdAt: string;
  sentAt?: string;
  updatedAt: string;
  position: number;
}
