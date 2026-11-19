import { postJson, withAccessToken } from "../../../shared/api/http";
import type { MediaFile } from "../../../shared/model/media";

export const uploadAttachment = async (file: File, signal: AbortSignal, submitted: Promise<void>, onUpload: () => void): Promise<MediaFile> => {
  if (window.location.protocol === "https:" && crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    const plan = await postJson<{ direct: true } | { putUrl: string; file: MediaFile }>("/api/uploads/plan", {
      name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, digest,
    }, signal);
    if ("putUrl" in plan) {
      onUpload();
      const sent = await fetch(plan.putUrl, { method: "PUT", body: file, credentials: "omit", referrerPolicy: "no-referrer", signal });
      if (!sent.ok) throw new Error("云端上传失败（" + sent.status + "），请重试发送");
      return plan.file;
    }
  }
  await submitted;
  signal.throwIfAborted();
  onUpload();
  const response = await fetch(withAccessToken(`/api/uploads?name=${encodeURIComponent(file.name)}`), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
    signal,
  });
  const payload = await response.json().catch(() => ({})) as MediaFile & { error?: string };
  if (!response.ok) throw new Error(payload.error || `附件上传失败（${response.status}）`);
  return payload;
};
