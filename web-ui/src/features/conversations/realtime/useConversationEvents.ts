import { useEffect, useRef, useState } from "react";
import type { RealtimeRecoveryReason } from "../../../shared/model/realtime";
import { openRealtimeConnection } from "../../../shared/realtime/realtimeConnection";
import type { ProjectEvent } from "../../execution/model/types";

const staleExecutionRecoveryMs = 30000;

const isConversationProgressEvent = (event: ProjectEvent, threadId: string) => {
  if (event.type === "sessions_changed") return !event.threadId || event.threadId === threadId;
  if (["execution_status", "assistant_commentary", "assistant_delta", "context_status", "user_message_submitted"].includes(event.type)) {
    return "threadId" in event && event.threadId === threadId;
  }
  return false;
};

export function useConversationEvents(
  onSessionsChanged: (threadId?: string) => void,
  onEvent: (event: ProjectEvent) => void,
  onRecover: (reason: RealtimeRecoveryReason) => void,
  threadId: string,
  active: boolean,
  awaitingFirstEvent: boolean,
) {
  const [connected, setConnected] = useState(true);
  const onSessionsChangedRef = useRef(onSessionsChanged);
  const onEventRef = useRef(onEvent);
  const onRecoverRef = useRef(onRecover);
  const threadIdRef = useRef(threadId);
  const activeRef = useRef(active);
  const activeSinceRef = useRef(active ? Date.now() : 0);
  const awaitingFirstEventRef = useRef(awaitingFirstEvent);

  useEffect(() => { onSessionsChangedRef.current = onSessionsChanged; }, [onSessionsChanged]);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);
  useEffect(() => { onRecoverRef.current = onRecover; }, [onRecover]);
  useEffect(() => {
    threadIdRef.current = threadId;
    if (activeRef.current) activeSinceRef.current = Date.now();
  }, [threadId]);
  useEffect(() => {
    activeRef.current = active;
    if (active) activeSinceRef.current = Date.now();
    if (!active) setConnected(true);
  }, [active]);
  useEffect(() => { awaitingFirstEventRef.current = awaitingFirstEvent; }, [awaitingFirstEvent]);

  useEffect(() => {
    let eventTimer = 0;
    let lastProgressAt = Date.now();
    const connection = openRealtimeConnection<ProjectEvent>({
      // While nothing is running a quiet stream is expected, not a problem.
      reportsDisconnect: () => activeRef.current,
      onConnectedChange: setConnected,
      onRecover: (reason) => onRecoverRef.current(reason),
      onEvent: (payload) => {
        if (isConversationProgressEvent(payload, threadIdRef.current)) lastProgressAt = Date.now();
        onEventRef.current(payload);
        if (payload.type === "sessions_changed") {
          window.clearTimeout(eventTimer);
          eventTimer = window.setTimeout(() => onSessionsChangedRef.current(payload.threadId), 180);
        }
      },
    });

    // The stream can stay open while delivering nothing (a proxy holding a
    // dead connection). During a running turn, silence is checked two ways:
    // no bytes at all means reconnect; bytes but no progress means re-read
    // the authoritative state.
    const healthTimer = window.setInterval(() => {
      if (!activeRef.current || document.visibilityState === "hidden") return;
      const transportTimeout = awaitingFirstEventRef.current ? 8000 : 25000;
      const activeSince = activeSinceRef.current;
      const now = Date.now();
      if (now - Math.max(connection.lastTransportAt(), activeSince) > transportTimeout) {
        connection.reconnect();
        return;
      }
      if (now - Math.max(lastProgressAt, activeSince) > staleExecutionRecoveryMs
        && now - connection.lastRecoveryAt() > staleExecutionRecoveryMs) {
        connection.requestRecovery("stale-execution");
      }
    }, 5000);

    return () => {
      window.clearTimeout(eventTimer);
      window.clearInterval(healthTimer);
      connection.close();
    };
  }, []);

  return connected;
}
