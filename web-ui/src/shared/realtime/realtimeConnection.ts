import { withAccessToken } from "../api/http";
import type { RealtimeConnectedEvent, RealtimeRecoveryReason } from "../model/realtime";

const reconnectDelays = [1000, 2000, 5000, 10000];
const disconnectNoticeDelayMs = 5000;
const recoveryPriority: Record<RealtimeRecoveryReason, number> = {
  "stale-execution": 1,
  resumed: 2,
  reconnected: 3,
  "event-gap": 4,
};

const eventIdFrom = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

export interface RealtimeConnectionOptions<TEvent> {
  /** Every project event, in order and at most once. */
  onEvent: (event: TEvent) => void;
  /**
   * Events may have been missed (history gap, reconnect, page resumed):
   * the caller must reload its state from the server.
   */
  onRecover: (reason: RealtimeRecoveryReason) => void;
  onConnectedChange: (connected: boolean) => void;
  /** Whether a silent connection is worth telling the user about right now. */
  reportsDisconnect: () => boolean;
}

export interface RealtimeConnection {
  reconnect: () => void;
  requestRecovery: (reason: RealtimeRecoveryReason) => void;
  lastTransportAt: () => number;
  lastRecoveryAt: () => number;
  close: () => void;
}

/**
 * One resilient connection to the project event stream, shared by every page.
 *
 * The server numbers events and replays the ones a client missed. This keeps
 * the last seen id across reconnects, drops duplicates, and asks the caller to
 * reload when the replay window was not enough to close the gap.
 */
export function openRealtimeConnection<TEvent extends { type: string }>(
  options: RealtimeConnectionOptions<TEvent>,
): RealtimeConnection {
  let reconnectTimer = 0;
  let disconnectedTimer = 0;
  let recoveryTimer = 0;
  let events: EventSource | null = null;
  let openedOnce = false;
  let reconnectAttempt = 0;
  let lastEventId = 0;
  let lastTransportAt = Date.now();
  let lastRecoveryAt = 0;
  let pendingRecovery: RealtimeRecoveryReason | null = null;

  const clearReconnectTimers = () => {
    window.clearTimeout(reconnectTimer);
    window.clearTimeout(disconnectedTimer);
  };
  const markAlive = () => {
    lastTransportAt = Date.now();
    window.clearTimeout(disconnectedTimer);
    options.onConnectedChange(true);
  };
  // A brief drop is normal on mobile networks; only a lasting one is shown.
  const scheduleDisconnectNotice = () => {
    if (!options.reportsDisconnect()) return;
    disconnectedTimer = window.setTimeout(() => options.onConnectedChange(false), disconnectNoticeDelayMs);
  };
  // Several triggers often fire together (reconnect + page shown); they are
  // merged into one reload carrying the most significant reason.
  const requestRecovery = (reason: RealtimeRecoveryReason) => {
    lastRecoveryAt = Date.now();
    if (!pendingRecovery || recoveryPriority[reason] > recoveryPriority[pendingRecovery]) {
      pendingRecovery = reason;
    }
    window.clearTimeout(recoveryTimer);
    recoveryTimer = window.setTimeout(() => {
      const requested = pendingRecovery;
      pendingRecovery = null;
      if (requested) options.onRecover(requested);
    }, 50);
  };

  const connect = () => {
    clearReconnectTimers();
    events?.close();
    const reconnecting = openedOnce;
    let replayGap = false;
    let handshakeComplete = false;
    const eventsPath = lastEventId > 0 ? `/events?lastEventId=${lastEventId}` : "/events";
    const source = new EventSource(withAccessToken(eventsPath));
    events = source;
    scheduleDisconnectNotice();
    source.onopen = () => {
      if (events !== source) return;
      openedOnce = true;
      markAlive();
    };
    source.onerror = () => {
      if (events !== source) return;
      // The browser's own retry does not carry the last event id in the URL,
      // so the connection is always reopened here instead.
      source.close();
      events = null;
      scheduleDisconnectNotice();
      const delay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };
    source.onmessage = (message) => {
      if (events !== source) return;
      markAlive();
      try {
        const payload = JSON.parse(message.data) as TEvent | RealtimeConnectedEvent | { type: "heartbeat" };
        if (payload.type === "heartbeat") return;
        if (payload.type === "connected") {
          const handshake = payload as RealtimeConnectedEvent;
          reconnectAttempt = 0;
          const serverEventId = eventIdFrom(handshake.eventId);
          const serverGap = handshake.gap === true;
          if (serverGap) lastEventId = serverEventId;
          else lastEventId = Math.max(lastEventId, serverEventId);
          if (serverGap || replayGap) {
            console.warn("[realtime] event history gap detected; restoring from server snapshot", {
              requestedEventId: handshake.requestedEventId,
              oldestEventId: handshake.oldestEventId,
              eventId: handshake.eventId,
            });
            requestRecovery("event-gap");
          } else if (reconnecting) {
            requestRecovery("reconnected");
          }
          handshakeComplete = true;
          return;
        }

        const receivedEventId = eventIdFrom(message.lastEventId);
        if (receivedEventId > 0) {
          if (receivedEventId <= lastEventId) return;
          if (lastEventId > 0 && receivedEventId !== lastEventId + 1) {
            replayGap = true;
            if (handshakeComplete) requestRecovery("event-gap");
          }
          lastEventId = receivedEventId;
        }
        options.onEvent(payload as TEvent);
      } catch {
        console.warn("[realtime] ignored malformed event payload");
      }
    };
  };

  const ensureCurrent = () => {
    if (document.visibilityState === "hidden") return;
    requestRecovery("resumed");
    if (!events || events.readyState === EventSource.CLOSED) connect();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") ensureCurrent();
  };

  connect();
  window.addEventListener("online", ensureCurrent);
  window.addEventListener("pageshow", ensureCurrent);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    reconnect: connect,
    requestRecovery,
    lastTransportAt: () => lastTransportAt,
    lastRecoveryAt: () => lastRecoveryAt,
    close: () => {
      window.clearTimeout(recoveryTimer);
      clearReconnectTimers();
      window.removeEventListener("online", ensureCurrent);
      window.removeEventListener("pageshow", ensureCurrent);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      events?.close();
      events = null;
    },
  };
}
