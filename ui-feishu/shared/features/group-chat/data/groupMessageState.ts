import type { GroupMessage } from "../model/types";

interface PendingAgentMessageSource {
  workId: string;
  agentId: string;
  agentName?: string;
  startedAt: string;
}

export const createPendingAgentMessage = ({ workId, agentId, agentName, startedAt }: PendingAgentMessageSource): GroupMessage => ({
  id: `pending-${workId}`,
  workId,
  pending: true,
  type: "agent",
  authorId: agentId,
  authorName: agentName || agentId,
  agentId,
  text: "",
  attachments: [],
  artifactIds: [],
  createdAt: startedAt,
});

export const removePendingAgentMessages = (messages: GroupMessage[], agentId = "") => messages
  .filter((message) => !(message.pending && message.type === "agent" && (!agentId || message.agentId === agentId)));
