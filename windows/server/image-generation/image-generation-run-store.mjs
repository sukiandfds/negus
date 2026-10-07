import fs from "node:fs/promises";
import path from "node:path";

const fileVersion = 1;
const unfinishedStatuses = new Set(["queued", "submitting", "generating", "running", "provider_ready", "saving"]);
const activeStatuses = new Set(["queued", "submitting", "generating", "running", "provider_ready", "saving"]);

const safeText = (value, limit = 8000) => String(value || "").trim().slice(0, limit);
const safeMedia = (value = {}) => ({
  id: safeText(value.id, 80),
  name: safeText(value.name, 160),
  mimeType: safeText(value.mimeType, 120),
  url: safeText(value.url, 500),
  ...(Number.isSafeInteger(value.width) && Number.isSafeInteger(value.height)
    ? { width: value.width, height: value.height }
    : {}),
});

const attachmentBlock = (messageId, file) => {
  const common = { id: `${messageId}-${file.id}`, source: file.url, file };
  if (file.mimeType.startsWith("image/")) return { ...common, type: "image", alt: file.name };
  if (file.mimeType.startsWith("audio/")) return { ...common, type: "audio" };
  if (file.mimeType.startsWith("video/")) return { ...common, type: "video" };
  return { ...common, type: "file", name: file.name };
};

const userMessageFrom = (record) => {
  const id = `image-user-${record.runId}`;
  const blocks = record.text ? [{ id: `${id}-text`, type: "markdown", text: record.text }] : [];
  blocks.push(...record.attachments.map((file) => attachmentBlock(id, file)));
  return { id, role: "user", text: record.text, blocks, createdAt: record.createdAt };
};

const specText = (record) => `${record.intent.resolution} · ${record.intent.size} · ${record.intent.n} 张`;

const assistantMessageFrom = async (record, media) => {
  const id = `image-assistant-${record.runId}`;
  if (activeStatuses.has(record.status)) {
    const labels = { queued: "排队中", submitting: "正在提交供应商", generating: "供应商生成中", running: "正在生成图片", provider_ready: "供应商已返回图片", saving: "本地保存中" };
    const elapsed = Math.max(0, Date.now() - Date.parse(record.createdAt));
    const text = `Negus Image ${labels[record.status]}…（已耗时 ${Math.round(elapsed / 1000)} 秒）\n\n规格：${specText(record)}`;
    return { id, role: "assistant", text, blocks: [{ id: `${id}-text`, type: "markdown", text }], createdAt: record.createdAt };
  }
  if (record.status === "failed" || record.status === "unknown") {
    const label = record.status === "unknown" ? "任务状态无法确认" : "生成失败";
    const text = `Negus Image ${label}：${record.error || "未知错误"}`;
    return { id, role: "assistant", text, blocks: [{ id: `${id}-text`, type: "markdown", text }], createdAt: record.createdAt };
  }

  const files = [];
  let unavailable = 0;
  for (const output of record.outputs) {
    try {
      await fs.access(output.path);
      files.push(media.register(output.path, {
        name: path.basename(output.path),
        mimeType: output.mimeType,
        dimensions: { width: output.width, height: output.height },
      }));
    } catch {
      unavailable += 1;
    }
  }
  const remoteFiles = record.outputs.filter(output => output.url && !files.some(file => file.url === output.url));
  const text = record.status === "partial"
    ? `Negus Image 已生成 ${files.length + remoteFiles.length} 张图片，本地副本保存失败，可继续查看或下载远程结果。`
    : files.length
      ? `Negus Image 已生成 ${files.length} 张图片。${unavailable ? `另有 ${unavailable} 张文件已不可用。` : ""}`
      : remoteFiles.length ? `Negus Image 已生成 ${remoteFiles.length} 张图片，本地副本保存中。` : "Negus Image 已完成，但生成文件当前不可用。";
  return {
    id,
    role: "assistant",
    text,
    blocks: [
      { id: `${id}-text`, type: "markdown", text },
      ...files.map((file, index) => ({
        id: `${id}-${file.id}`,
        type: "image",
        source: file.url,
        alt: `Negus Image 生成图片 ${index + 1}`,
        width: file.width,
        height: file.height,
        file,
      })),
      ...remoteFiles.map((output, index) => ({
        id: `${id}-remote-${index}`,
        type: "image",
        source: output.url,
        alt: `Negus Image 生成图片 ${files.length + index + 1}`,
        width: output.width,
        height: output.height,
      })),
    ],
    createdAt: record.createdAt,
  };
};

export const createImageGenerationRunStore = ({ stateFile = "", media }) => {
  let loaded = false;
  let records = new Map();
  let queue = Promise.resolve();

  const persist = async () => {
    if (!stateFile) return;
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    const payload = `${JSON.stringify({ version: fileVersion, runs: [...records.values()] }, null, 2)}\n`;
    await fs.writeFile(temporary, payload, "utf8");
    await fs.rename(temporary, stateFile);
  };

  const load = async () => {
    if (loaded) return;
    loaded = true;
    if (!stateFile) return;
    try {
      const stored = JSON.parse(await fs.readFile(stateFile, "utf8"));
      if (stored?.version !== fileVersion || !Array.isArray(stored.runs)) return;
      let normalized = false;
      records = new Map(stored.runs.filter((run) => run?.runId && run?.threadId).map((run) => {
        if (!unfinishedStatuses.has(run.status)) return [run.runId, run];
        normalized = true;
        return [run.runId, {
          ...run,
          status: "unknown",
          error: "项目服务重启后无法确认上游结果；为避免重复计费，没有自动重试。",
          updatedAt: new Date().toISOString(),
        }];
      }));
      if (normalized) await persist();
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn(`[image-generation-run-store] state ignored: ${error.message}`);
    }
  };

  const run = (operation) => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => {});
    return next;
  };

  const create = (value) => run(async () => {
    await load();
    const duplicate = [...records.values()].find((record) => record.threadId === value.threadId
      && value.submissionId && record.submissionId === value.submissionId);
    if (duplicate) return { record: duplicate, created: false };
    const now = value.createdAt || new Date().toISOString();
    const record = {
      runId: value.runId,
      turnId: value.turnId,
      threadId: value.threadId,
      submissionId: value.submissionId,
      text: safeText(value.text),
      attachments: (Array.isArray(value.attachments) ? value.attachments : []).map(safeMedia),
      intent: value.intent,
      status: "queued",
      outputs: [],
      error: "",
      providerTaskId: "",
      model: "",
      createdAt: now,
      updatedAt: now,
    };
    records.set(record.runId, record);
    while (records.size > 200) records.delete(records.keys().next().value);
    await persist();
    return { record, created: true };
  });

  const update = (runId, values) => run(async () => {
    await load();
    const current = records.get(runId);
    if (!current) throw new Error(`Unknown image generation run: ${runId}`);
    const next = { ...current, ...values, updatedAt: new Date().toISOString() };
    records.set(runId, next);
    await persist();
    return next;
  });

  const get = (runId) => run(async () => {
    await load();
    return records.get(runId) || null;
  });

  const list = (threadId) => run(async () => {
    await load();
    const selected = [...records.values()]
      .filter((record) => record.threadId === threadId)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    const messages = [];
    for (const record of selected) {
      messages.push(userMessageFrom(record), await assistantMessageFrom(record, media));
    }
    return messages;
  });

  const listSessions = () => run(async () => {
    await load();
    const byThread = new Map();
    for (const record of records.values()) {
      const selected = byThread.get(record.threadId) || [];
      selected.push(record);
      byThread.set(record.threadId, selected);
    }
    return [...byThread.entries()]
      .filter(([, selected]) => selected.some((record) => !record.migratedToThreadId))
      .map(([threadId, selected]) => {
      selected.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      const latest = selected.at(-1);
      const outputCount = latest.outputs?.length || 0;
      const latestAssistant = latest.status === "succeeded"
        ? `Negus Image 已生成 ${outputCount} 张图片。`
        : latest.status === "partial"
          ? `Negus Image 已生成 ${outputCount} 张图片，本地副本保存失败。`
        : latest.status === "failed" || latest.status === "unknown"
          ? `Negus Image ${latest.status === "unknown" ? "任务状态无法确认" : "生成失败"}：${latest.error || "未知错误"}`
          : "Negus Image 正在生成图片...";
      return {
        threadId,
        source: "codex",
        title: latest.text.slice(0, 80) || "Negus Image",
        updatedAt: latest.updatedAt || latest.createdAt,
        messageCount: selected.length * 2,
        latestUser: latest.text,
        latestAssistant,
        archived: false,
        forkedFromId: null,
      };
      });
  });

  const migrationContext = (threadId) => run(async () => {
    await load();
    const selected = [...records.values()]
      .filter((record) => record.threadId === threadId && !record.migratedToThreadId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    const latest = selected.find((record) => record.status === "succeeded" && record.outputs?.length);
    if (!latest) return null;
    const attachments = [];
    for (const output of latest.outputs) {
      try {
        await fs.access(output.path);
        attachments.push({
          path: output.path,
          name: path.basename(output.path),
          mimeType: output.mimeType || "image/png",
        });
      } catch {}
    }
    return attachments.length ? { text: latest.text, attachments } : null;
  });

  const markMigrated = (threadId, migratedToThreadId) => run(async () => {
    await load();
    let changed = false;
    const migratedAt = new Date().toISOString();
    for (const [runId, record] of records) {
      if (record.threadId !== threadId || record.migratedToThreadId) continue;
      records.set(runId, { ...record, migratedToThreadId, migratedAt, updatedAt: migratedAt });
      changed = true;
    }
    if (changed) await persist();
    return changed;
  });

  return {
    create,
    markRunning: (runId) => update(runId, { status: "generating", error: "" }),
    markSubmitting: (runId) => update(runId, { status: "submitting", error: "" }),
    markGenerating: (runId) => update(runId, { status: "generating", error: "" }),
    providerReady: (runId, result) => update(runId, {
      status: "provider_ready", outputs: result.outputs || [], providerTaskId: result.taskId || "", model: result.model || "", error: "",
    }),
    markSaving: (runId) => update(runId, { status: "saving", error: "" }),
    complete: (runId, result) => update(runId, {
      status: "succeeded",
      outputs: result.outputs || [],
      providerTaskId: result.taskId || "",
      model: result.model || "",
      error: "",
    }),
    partial: (runId, result, error) => update(runId, {
      status: "partial", outputs: result.outputs || [], providerTaskId: result.taskId || "", model: result.model || "", error: safeText(error, 1000),
    }),
    fail: (runId, error) => update(runId, { status: "failed", error: safeText(error, 1000) }),
    get,
    list,
    listSessions,
    migrationContext,
    markMigrated,
    close: () => queue,
  };
};
