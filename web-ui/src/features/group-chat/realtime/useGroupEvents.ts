import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { openRealtimeConnection } from "../../../shared/realtime/realtimeConnection";
import type { ArtifactRealtimeEvent } from "../../artifacts/model/types";
import type { GroupEvent, GroupSnapshot } from "../model/types";

type StreamingDrafts = Record<string, { itemId: string; text: string }>;

const without = (drafts: StreamingDrafts, agentId: string) => {
  if (!(agentId in drafts)) return drafts;
  const next = { ...drafts };
  delete next[agentId];
  return next;
};

export function useGroupEvents(
  setSnapshot: Dispatch<SetStateAction<GroupSnapshot | null>>,
  onResync: () => void,
) {
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState<StreamingDrafts>({});
  const [artifactEvent, setArtifactEvent] = useState<ArtifactRealtimeEvent | null>(null);
  const streamingBuffer = useRef<StreamingDrafts>({});
  const streamingFrame = useRef(0);
  const onResyncRef = useRef(onResync);
  useEffect(() => { onResyncRef.current = onResync; }, [onResync]);

  useEffect(() => {
    const dropDraft = (agentId: string) => {
      streamingBuffer.current = without(streamingBuffer.current, agentId);
      setStreaming((current) => without(current, agentId));
    };

    const handle = (event: GroupEvent) => {
      if (event.type === "group_message_created") {
        setSnapshot((current) => current && current.messages.some((item) => item.id === event.message.id)
          ? current
          : current && { ...current, messages: [...current.messages, event.message] });
        // The stored message replaces the draft that was streaming for it.
        if (event.message.agentId) dropDraft(event.message.agentId);
      } else if (event.type === "group_message_updated") {
        setSnapshot((current) => current && {
          ...current,
          messages: current.messages.map((item) => item.id === event.message.id ? event.message : item),
        });
      } else if (event.type === "group_agent_updated") {
        setSnapshot((current) => current && {
          ...current,
          agents: current.agents.map((agent) => agent.id === event.agent.id ? event.agent : agent),
        });
        // A stopped or failed Agent never sends the message that would have
        // replaced its draft, so the half-written text must not linger.
        if (!event.agent.active) dropDraft(event.agent.id);
      } else if (event.type === "group_members_changed") {
        setSnapshot((current) => current && { ...current, members: event.members });
      } else if (event.type === "group_agent_delta") {
        const previous = streamingBuffer.current[event.agentId];
        streamingBuffer.current = {
          ...streamingBuffer.current,
          [event.agentId]: {
            itemId: event.itemId,
            text: previous?.itemId === event.itemId ? previous.text + event.delta : event.delta,
          },
        };
        if (!streamingFrame.current) {
          streamingFrame.current = window.requestAnimationFrame(() => {
            streamingFrame.current = 0;
            setStreaming(streamingBuffer.current);
          });
        }
      } else if (event.type === "artifact.ready" || event.type === "artifact.reviewed") {
        setArtifactEvent(event);
      }
    };

    const connection = openRealtimeConnection<GroupEvent>({
      reportsDisconnect: () => true,
      onConnectedChange: setConnected,
      // Whatever was missed while offline is in the room snapshot.
      onRecover: () => onResyncRef.current(),
      onEvent: handle,
    });
    return () => {
      connection.close();
      if (streamingFrame.current) window.cancelAnimationFrame(streamingFrame.current);
    };
  }, [setSnapshot]);

  return { connected, streaming, artifactEvent };
}
