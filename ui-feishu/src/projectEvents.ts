// Secondary views subscribe to the conversation transport instead of opening more SSE sockets.
type StreamKind = 'open' | 'error' | 'message';
type Subscription = {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  close: () => void;
};
const subscribers = new Set<Subscription>();
let connected = false;

export function publishProjectStream(kind: StreamKind, event: Event) {
  if (kind === 'open') connected = true;
  if (kind === 'error') connected = false;
  for (const subscriber of [...subscribers]) {
    if (!subscribers.has(subscriber)) continue;
    try {
      if (kind === 'message') subscriber.onmessage?.(event as MessageEvent);
      else if (kind === 'open') subscriber.onopen?.(event);
      else subscriber.onerror?.(event);
    } catch (error) { console.error('[project-events] subscriber failed', error); }
  }
}

export function observeProjectStream(): Subscription {
  const subscriber: Subscription = { onopen: null, onerror: null, onmessage: null,
    close: () => { subscribers.delete(subscriber); },
  };
  subscribers.add(subscriber);
  queueMicrotask(() => {
    if (connected && subscribers.has(subscriber)) subscriber.onopen?.(new Event('open'));
  });
  return subscriber;
}
