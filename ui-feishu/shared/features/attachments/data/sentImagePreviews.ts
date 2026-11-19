// Transfer the decoded draft URL to the confirmed media path. Mounted thumbnails
// keep their URL even if their entry leaves the recent-preview cache.
type Preview = { url: string; size: number; owners: number };
const recent = new Map<string, Preview>();
let bytes = 0;

function release(preview: Preview) {
  if (--preview.owners === 0) URL.revokeObjectURL(preview.url);
}

export function rememberSentImage(submissionId: string, index: number, url: string, size: number) {
  const key = submissionId + ":" + index;
  const previous = recent.get(key);
  if (previous) {
    recent.delete(key);
    bytes -= previous.size;
    release(previous);
  }
  recent.set(key, { url, size, owners: 1 });
  bytes += size;
  while (recent.size > 48 || bytes > 128 * 1024 * 1024) {
    const [key, oldest] = recent.entries().next().value!;
    recent.delete(key);
    bytes -= oldest.size;
    release(oldest);
  }
}

export const sentImage = (submissionId?: string, index?: number) =>
  submissionId ? recent.get(submissionId + ":" + index) : undefined;

export function moveSentImages(previous?: string, next?: string) {
  if (!previous || !next || previous === next) return;
  for (const [key, preview] of recent) {
    if (!key.startsWith(previous + ":")) continue;
    recent.delete(key);
    recent.set(next + key.slice(previous.length), preview);
  }
}

export function retainSentImage(preview?: Preview) {
  if (!preview) return;
  ++preview.owners;
  return () => release(preview);
}
