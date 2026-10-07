// Keep the original files intact while reusing their event handlers in this UI.
export function realtimeIntegration(streamModule) {
  return { name: 'negus-shared-project-events', enforce: 'pre', transform(source, id) {
    const file = id.split('?')[0];
    if (!file.includes('/web-ui/src/')) return null;
    const owner = file.endsWith('/conversations/realtime/useConversationEvents.ts');
    if (owner) {
      for (const kind of ['open', 'error', 'message']) {
        const marker = `source.on${kind} = (${kind === 'message' ? 'event' : ''}) => {\n        if (events !== source) return;`;
        if (!source.includes(marker)) throw Error(`Conversation event integration changed: ${kind}`);
        source = source.replace(marker, `${marker}\n        publishProjectStream('${kind}', ${kind === 'message' ? 'event' : `new Event('${kind}')`});`);
      }
      return { code: `import { publishProjectStream } from ${JSON.stringify(streamModule)};\n${source}`, map: null };
    }
    const subscriptions = /new EventSource\((?:withAccessToken\("\/events"\)|groupApi.eventsUrl\(\))(?:, \{ withCredentials: true \})?\)/g;
    if (!subscriptions.test(source)) return null;
    source = source.replace(subscriptions, 'observeProjectStream()')
      .replaceAll('EventSource | null', 'ReturnType<typeof observeProjectStream> | null');
    return { code: `import { observeProjectStream } from ${JSON.stringify(streamModule)};\n${source}`, map: null };
  } };
}
