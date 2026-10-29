// FEAT-001, 2026-10-30: fixed first ten, then remaining changes; publish each batch together.
export async function readConversationBatches<T>(
  entries: readonly T[],
  read: (entry: T) => Promise<void>,
  publish: (results: { entry: T; error: string }[]) => void,
  signal: AbortSignal,
  timeoutMs = 10000,
) {
  for (const batch of [entries.slice(0, 10), entries.slice(10)]) {
    if (signal.aborted) return;
    if (!batch.length) continue;
    const results: { entry: T; error: string }[] = new Array(batch.length);
    let next = 0;
    // Each conversation reads several resources. Bound reads, not the atomic publication.
    await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
      while (next < batch.length && !signal.aborted) {
        const index = next++, entry = batch[index];
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([read(entry), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('同步超时，正在保留当前内容')), timeoutMs);
          })]);
          results[index] = { entry, error: '' };
        } catch (reason) {
          results[index] = { entry, error: reason instanceof Error ? reason.message : String(reason) };
        } finally { clearTimeout(timer); }
      }
    }));
    if (!signal.aborted) publish(results);
  }
}
