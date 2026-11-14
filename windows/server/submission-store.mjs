import fs from "node:fs";
import { cloneJson, writeJsonFileAtomic } from "./persistence/json-file.mjs";

const maxEntries = 500;
const defaultTtlMs = 24 * 60 * 60 * 1000;

export const createSubmissionStore = ({ stateFile = "", ttlMs = defaultTtlMs } = {}) => {
  const submissions = new Map();
  let persistTimer;
  let persistChain = Promise.resolve();

  const removeExpired = () => {
    const now = Date.now();
    for (const [submissionId, entry] of submissions) {
      if (Date.parse(entry.expiresAt || "") <= now) submissions.delete(submissionId);
    }
  };

  try {
    if (stateFile && fs.existsSync(stateFile)) {
      const stored = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      const entries = Array.isArray(stored?.submissions) ? stored.submissions : [];
      for (const entry of entries) {
        if (!entry?.submissionId || !entry?.fingerprint || !entry?.threadId) continue;
        submissions.set(String(entry.submissionId), entry);
      }
      removeExpired();
    }
  } catch {
    // A malformed submission snapshot must not prevent the project service from starting.
  }

  const snapshot = () => ({
    version: 1,
    submissions: [...submissions.values()].slice(-maxEntries),
  });

  const persist = () => {
    if (!stateFile) return Promise.resolve();
    persistChain = persistChain.catch(() => {}).then(async () => {
      await writeJsonFileAtomic(stateFile, snapshot());
    }).catch((error) => console.warn(`[submission-store] state persistence failed: ${error.message}`));
    return persistChain;
  };

  const schedulePersist = () => {
    if (!stateFile) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => void persist(), 100);
    persistTimer.unref?.();
  };

  const get = (submissionId) => {
    removeExpired();
    return cloneJson(submissions.get(String(submissionId || "")));
  };

  const begin = (entry) => {
    const submissionId = String(entry?.submissionId || "");
    if (!submissionId) return null;
    const existing = submissions.get(submissionId);
    if (existing) return cloneJson(existing);
    const createdAt = String(entry.createdAt || new Date().toISOString());
    const next = {
      submissionId,
      threadId: String(entry.threadId || ""),
      fingerprint: String(entry.fingerprint || ""),
      messageId: String(entry.messageId || `optimistic-${submissionId}`),
      createdAt,
      expiresAt: new Date((Date.parse(createdAt) || Date.now()) + ttlMs).toISOString(),
      state: "pending",
    };
    submissions.set(submissionId, next);
    while (submissions.size > maxEntries) submissions.delete(submissions.keys().next().value);
    schedulePersist();
    return cloneJson(next);
  };

  const complete = (submissionId, result) => {
    const current = submissions.get(String(submissionId || ""));
    if (!current) return null;
    const next = { ...current, state: "accepted", result };
    submissions.set(current.submissionId, next);
    schedulePersist();
    return cloneJson(next);
  };

  const fail = (submissionId, error) => {
    const current = submissions.get(String(submissionId || ""));
    if (!current) return null;
    const next = { ...current, state: "failed", error: String(error?.message || error || "指令发送失败") };
    submissions.set(current.submissionId, next);
    schedulePersist();
    return cloneJson(next);
  };

  const close = async () => {
    clearTimeout(persistTimer);
    await persist();
  };

  return { get, begin, complete, fail, close };
};
