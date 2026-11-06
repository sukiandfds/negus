// FEAT-001, 2026-10-30: fixed first ten, then remaining changes; publish each batch together.
export async function readConversationBatches<T>(
  entries: readonly T[],
  read: (entry: T, signal: AbortSignal) => Promise<void>,
  publish: (results: { entry: T; error: string }[]) => void,
  signal: AbortSignal,
  timeoutMs = 10000,
  firstBatchSize = 10,
  readTimeoutMs = timeoutMs * 6,
) {
  const batches = [entries.slice(0, firstBatchSize), entries.slice(firstBatchSize)];
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    if (signal.aborted) return;
    if (!batch.length) continue;
    const results: { entry: T; error: string }[] = new Array(batch.length);
    let next = 0;
    const deadline = Date.now() + timeoutMs;
    const published = new Set<number>();
    const flush = () => {
      const completed = results.filter((result, index) => result && !published.has(index) && published.add(index));
      if (!signal.aborted && completed.length) publish(completed);
    };
    // Publish completed reads on time; queued time must not shorten an active request's timeout.
    const publicationTimer = setTimeout(flush, timeoutMs);
    // Each conversation reads several resources. Bound reads, not the atomic publication.
    await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
      while (next < batch.length && !signal.aborted && Date.now() < deadline) {
        const index = next++, entry = batch[index];
        const attempt = new AbortController();
        const readSignal = AbortSignal.any([signal, attempt.signal]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancel: (() => void) | undefined;
        try {
          await Promise.race([read(entry, readSignal), new Promise<never>((_, reject) => {
            cancel = () => reject(readSignal.reason);
            readSignal.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(() => attempt.abort(new Error('同步超时，正在保留当前内容')), readTimeoutMs);
          })]);
          results[index] = { entry, error: '' };
        } catch (reason) {
          results[index] = { entry, error: reason instanceof Error ? reason.message : String(reason) };
        } finally { clearTimeout(timer); if (cancel) readSignal.removeEventListener('abort', cancel); }
      }
    }));
    clearTimeout(publicationTimer);
    flush();
    if (next < batch.length) batches.splice(batchIndex + 1, 0, batch.slice(next));
  }
}
