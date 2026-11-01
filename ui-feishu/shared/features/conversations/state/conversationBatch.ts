// FEAT-001, 2026-10-30: fixed first ten, then remaining changes; publish each batch together.
export async function readConversationBatches<T>(
  entries: readonly T[],
  read: (entry: T, signal: AbortSignal) => Promise<void>,
  publish: (results: { entry: T; error: string; retry?: boolean }[]) => void,
  signal: AbortSignal,
  timeoutMs = 10000,
  firstBatchSize = 10,
) {
  const batches = [entries.slice(0, firstBatchSize), entries.slice(firstBatchSize)];
  const attempts = new Map<T, number>();
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    if (signal.aborted) return;
    if (!batch.length) continue;
    const results: { entry: T; error: string; retry?: boolean }[] = new Array(batch.length);
    let next = 0;
    const deadline = Date.now() + timeoutMs;
    // Each conversation reads several resources. Bound reads, not the atomic publication.
    await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
      while (next < batch.length && !signal.aborted && Date.now() < deadline) {
        const index = next++, entry = batch[index];
        const attempt = new AbortController();
        const readSignal = AbortSignal.any([signal, attempt.signal]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let cancel: (() => void) | undefined;
        try {
          const remaining = deadline - Date.now();
          await Promise.race([read(entry, readSignal), new Promise<never>((_, reject) => {
            cancel = () => reject(readSignal.reason);
            readSignal.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(() => attempt.abort(new Error('同步超时，正在保留当前内容')), remaining);
          })]);
          results[index] = { entry, error: '' };
        } catch (reason) {
          const count = (attempts.get(entry) || 0) + 1;
          attempts.set(entry, count);
          results[index] = { entry, error: reason instanceof Error ? reason.message : String(reason), retry: count < 3 };
        } finally { clearTimeout(timer); if (cancel) readSignal.removeEventListener('abort', cancel); }
      }
    }));
    if (!signal.aborted) publish(results.filter(Boolean));
    if (next < batch.length) batches.splice(batchIndex + 1, 0, batch.slice(next));
    const retry = results.filter(result => result?.retry).map(result => result.entry);
    if (retry.length) batches.push(retry);
  }
}
