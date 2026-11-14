import type { SessionMessage } from "../model/types";

export interface LiveTranscriptInput {
  threadId: string;
  messages: SessionMessage[];
  turnId: string;
  active: boolean;
  showExecution: boolean;
  retainPlaceholder?: boolean;
}

// Completed messages are ordinary history entries; execution never creates text fragments.
export const projectTranscript = (input: LiveTranscriptInput) => {
  const messages = input.messages;
  const target = messages.filter(message => message.role === "assistant"
    && Boolean(input.turnId) && (message.protocolTurnId || message.turnId) === input.turnId).at(-1);
  const placeholder: SessionMessage | null = !target && (input.active || input.retainPlaceholder) ? {
    id: "execution-placeholder", role: "assistant", text: "", turnId: input.turnId,
  } : null;
  return {
    persisted: messages,
    placeholder,
    executionMessageId: input.showExecution ? target?.id || placeholder?.id || "" : "",
  };
};
