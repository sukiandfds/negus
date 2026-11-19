import { useCallback, useEffect, useRef, useState } from "react";
import { uploadAttachment } from "../data/attachmentApi";
import { withAccessToken } from "../../../shared/api/http";
import type { MediaFile } from "../../../shared/model/media";

export interface DraftAttachment {
  id: string;
  file: File | MediaFile;
  previewUrl: string;
  phase?: "上传中" | "已上传" | "上传失败";
}

const maxFiles = 6;
const maxFileBytes = 20 * 1024 * 1024;
let nextDraftId = 1;

export function useAttachmentDraft() {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadSlow, setUploadSlow] = useState(false);
  const attachmentsRef = useRef(attachments);
  const transfers = useRef(new Map<string, { controller: AbortController; submit: () => void; result: Promise<MediaFile> }>());
  const uploadPromiseRef = useRef<Promise<MediaFile[]> | null>(null);

  const uploadSlowTimerRef = useRef(0);
  attachmentsRef.current = attachments;

  useEffect(() => () => {
    window.clearTimeout(uploadSlowTimerRef.current);
    for (const transfer of transfers.current.values()) transfer.controller.abort();
    transfers.current.clear();
    for (const attachment of attachmentsRef.current) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
  }, []);

  const start = useCallback((attachment: DraftAttachment, sending = false): Promise<MediaFile> => {
    if (!(attachment.file instanceof File)) return Promise.resolve(attachment.file);
    const existing = transfers.current.get(attachment.id);
    if (existing) {
      if (sending) existing.submit();
      return existing.result;
    }
    const controller = new AbortController();
    const phase = (value: DraftAttachment["phase"]) => {
      if (!attachmentsRef.current.some(item => item.id === attachment.id)) return;
      const next = attachmentsRef.current.map(item => item.id === attachment.id ? { ...item, phase: value } : item);
      attachmentsRef.current = next;
      setAttachments(next);
    };
    let submit!: () => void;
    const submitted = new Promise<void>(resolve => { submit = resolve; });
    controller.signal.addEventListener("abort", submit, { once: true });
    if (sending) submit();
    const result = uploadAttachment(attachment.file, controller.signal, submitted, () => phase("上传中")).then(file => {
      if (!controller.signal.aborted) phase("已上传");
      return file;
    }).catch(reason => {
      if (transfers.current.get(attachment.id)?.controller === controller) {
        transfers.current.delete(attachment.id);
        phase("上传失败");
      }
      throw reason;
    });
    transfers.current.set(attachment.id, { result, controller, submit });
    return result;
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    if (uploadPromiseRef.current) return;
    const selected = Array.from(files);
    const current = attachmentsRef.current;
    const room = Math.max(0, maxFiles - current.length);
    const accepted = selected.filter((file) => file.size <= maxFileBytes).slice(0, room);
    setError("");
    if (accepted.length !== selected.length) {
      setError(selected.some((file) => file.size > maxFileBytes)
        ? "每个附件不能超过 20 MB，最多选择 6 个"
        : "一次最多选择 6 个附件");
    }
    const next = [...current, ...accepted.map((file) => ({
        id: `draft-${Date.now().toString(36)}-${nextDraftId++}`,
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
      }))];
    attachmentsRef.current = next;
    setAttachments(next);
    for (const item of next.slice(current.length)) void start(item).catch(() => {});
  }, [start]);

  const restoreFiles = useCallback((files: MediaFile[]) => {
    const next = files.map(file => ({ id: file.id, file, previewUrl: file.mimeType.startsWith("image/") ? withAccessToken(file.url) : "" }));
    attachmentsRef.current = next;
    setAttachments(next);
    setError("");
  }, []);

  const removeFile = useCallback((id: string) => {
    if (uploadPromiseRef.current) return;
    const current = attachmentsRef.current;
    const removed = current.find((attachment) => attachment.id === id);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    transfers.current.get(id)?.controller.abort();
    transfers.current.delete(id);
    const next = current.filter((attachment) => attachment.id !== id);
    attachmentsRef.current = next;
    setAttachments(next);
    setError("");
  }, []);

  const clear = useCallback((retained?: Set<string>) => {
    for (const attachment of attachmentsRef.current) {
      if (attachment.previewUrl && !retained?.has(attachment.previewUrl)) URL.revokeObjectURL(attachment.previewUrl);
    }
    attachmentsRef.current = [];
    for (const transfer of transfers.current.values()) transfer.controller.abort();
    transfers.current.clear();
    setAttachments([]);
    setError("");
  }, []);

  const uploadAll = useCallback(() => {
    if (uploadPromiseRef.current) return uploadPromiseRef.current;

    setUploading(true);
    setUploadSlow(false);
    setError("");
    uploadSlowTimerRef.current = window.setTimeout(() => setUploadSlow(true), 10000);
    const operation = Promise.all(attachmentsRef.current.map(item => start(item, true))).catch((reason) => {
      if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
      setError(reason instanceof Error ? reason.message : "附件上传失败");
      throw reason;
    }).finally(() => {
      window.clearTimeout(uploadSlowTimerRef.current);
      uploadSlowTimerRef.current = 0;

      uploadPromiseRef.current = null;
      setUploading(false);
      setUploadSlow(false);
    });
    uploadPromiseRef.current = operation;
    return operation;
  }, [start]);

  const cancelUpload = useCallback(() => {
    for (const item of attachmentsRef.current) {
      if (item.phase !== "已上传") transfers.current.get(item.id)?.controller.abort();
    }
  }, []);

  return {
    attachments, error, uploading, uploadSlow,
    addFiles, restoreFiles, removeFile, clear, uploadAll, cancelUpload, setError,
  };
}
