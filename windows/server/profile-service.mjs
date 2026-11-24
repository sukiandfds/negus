import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFileAtomic, writeTextFileAtomic } from "./persistence/json-file.mjs";

// USER_PROFILE.md is injected into every turn by conversation-context.mjs, which
// trims the file and truncates it at 12000 characters. This service is the
// writing side of that channel: it appends distilled correction rules to the
// 纠正沉淀 section and refuses writes that would push the injected content past
// the limit. Per the user's decision (2026-11-24), profile candidates are
// written through immediately without approval; only a candidate that would
// overflow the limit stays queued for manual handling.
// Nothing here touches the injection path, its keys, or its revision logic.
export const PROFILE_LIMIT = 12000;
const SECTION_TITLE = "## 纠正沉淀";
const SECTION_COMMENT = "<!-- 助手被纠正或用户愤怒后，把教训蒸馏成一行祈使句追加到这里，格式：- 规则（日期，吐血表条目编号）。已有同义规则时不重复添加，只在原规则后补记新条目编号。本区由系统每轮自动注入，写在这里的规则对所有新对话立即生效。 -->";

const profileFile = (root) => path.join(root, "USER_PROFILE.md");
const candidatesFile = (root) => path.join(root, "runtime", "profile-candidates.json");

// Serialize operations per root so a topic publish and a candidate write
// cannot interleave reads and writes of the profile or the candidate queue.
const chains = new Map();
const withLock = (root, task) => {
  const previous = chains.get(root) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  chains.set(root, current);
  return current.finally(() => { if (chains.get(root) === current) chains.delete(root); });
};

const normalizeRule = (value) => String(value || "")
  .replace(/[，。：；！？]/g, (ch) => ({ "，": ",", "。": ".", "：": ":", "；": ";", "！": "!", "？": "?" }[ch]))
  .replace(/（/g, "(").replace(/）/g, ")")
  .replace(/\s+/g, " ").trim().replace(/\.+$/, "").trim();

// A stored line looks like "- 规则（日期，编号）". Split off the trailing
// parenthetical so rule texts can be compared without their references.
const parseRuleLine = (line) => {
  const match = /^\s*-\s+(.+)$/.exec(line);
  if (!match) return null;
  const body = match[1].trim();
  const suffix = /\(([^()]*)\)\s*$/.exec(body) || /（([^（）]*)）\s*$/.exec(body);
  return {
    text: suffix ? body.slice(0, suffix.index).trim() : body,
    refs: suffix ? suffix[1].split(/[,、，]/).map((x) => x.trim()).filter(Boolean) : [],
    hasSuffix: Boolean(suffix),
  };
};

const sectionRange = (lines) => {
  const start = lines.findIndex((line) => line.trim() === SECTION_TITLE);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
};

// Lock-free core; exported functions and candidate operations wrap it in
// withLock, and candidate flows call it directly while already holding it.
const internalAppend = async (root, { rule, ref = "", date = "" }) => {
  const text = String(rule || "").trim();
  if (!text) throw Object.assign(new Error("画像规则不能为空"), { statusCode: 400 });
  const reference = String(ref || "").trim();
  const day = String(date || "").trim() || new Date().toISOString().slice(0, 10);
  const file = profileFile(root);
  const original = await fs.readFile(file, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  const lines = original.split("\n");
  const range = sectionRange(lines);
  const target = normalizeRule(text);
  if (range) {
    for (let i = range.start + 1; i < range.end; i++) {
      const parsed = parseRuleLine(lines[i]);
      if (!parsed || normalizeRule(parsed.text) !== target) continue;
      if (reference && !parsed.refs.includes(reference)) {
        lines[i] = parsed.hasSuffix
          ? lines[i].replace(/[)）]\s*$/, `，${reference}）`)
          : `${lines[i].trimEnd()}（${day}，${reference}）`;
      }
      const next = lines.join("\n");
      if (next.trim().length > PROFILE_LIMIT) return { status: "overflow" };
      if (next !== original) await writeTextFileAtomic(file, next);
      return { status: "merged", line: lines[i].trim() };
    }
  }
  const entry = `- ${text}（${reference ? `${day}，${reference}` : day}）`;
  let next;
  if (range) {
    let insertAt = -1;
    for (let i = range.end - 1; i > range.start; i--) {
      if (parseRuleLine(lines[i]) || lines[i].includes("<!--")) { insertAt = i + 1; break; }
    }
    if (insertAt < 0) insertAt = range.start + 1;
    lines.splice(insertAt, 0, entry);
    next = lines.join("\n");
  } else {
    const base = original.replace(/\s*$/, "");
    next = `${base ? `${base}\n\n` : ""}${SECTION_TITLE}\n\n${SECTION_COMMENT}\n${entry}\n`;
  }
  if (next.trim().length > PROFILE_LIMIT) return { status: "overflow" };
  await writeTextFileAtomic(file, next.endsWith("\n") ? next : `${next}\n`);
  return { status: "added", line: entry };
};

export const appendProfileRule = (root, input) => withLock(root, () => internalAppend(root, input));

const readCandidates = async (root) => readJsonFile(candidatesFile(root), []);
const saveCandidates = (root, rows) => writeJsonFileAtomic(candidatesFile(root), rows, { mode: 0o600 });

export const listProfileCandidates = async (root, { status } = {}) => {
  const rows = await readCandidates(root);
  return (status ? rows.filter((row) => row.status === status) : rows).map((row) => ({ ...row }));
};

export const addProfileCandidate = (root, { rule, ref = "", anger = false, topicId = "", turnId = "" } = {}) =>
  withLock(root, async () => {
    const text = String(rule || "").trim();
    if (!text) throw Object.assign(new Error("画像候选规则不能为空"), { statusCode: 400 });
    const candidate = {
      id: randomUUID(),
      rule: text,
      ref: String(ref || "").trim(),
      anger: anger === true,
      topicId: String(topicId || ""),
      turnId: String(turnId || ""),
      status: "pending",
      at: new Date().toISOString(),
    };
    // 用户已决定画像规则不需要批准：候选产生即经画像写入落盘（保留去重与上限）。
    // 只有写不下（overflow）时才留待批准队列等人工处理。
    const profile = await internalAppend(root, candidate);
    if (profile.status === "overflow") {
      candidate.note = "画像已达上限，规则未写入，留待人工处理";
    } else {
      candidate.status = "approved";
      candidate.resolution = profile.status;
      candidate.resolvedAt = new Date().toISOString();
    }
    const rows = await readCandidates(root);
    rows.push(candidate);
    await saveCandidates(root, rows);
    return { candidate: { ...candidate }, profile };
  });

export const approveProfileCandidate = (root, id) => withLock(root, async () => {
  const rows = await readCandidates(root);
  const candidate = rows.find((row) => row.id === id);
  if (!candidate) throw Object.assign(new Error("画像候选不存在"), { statusCode: 404 });
  if (candidate.status !== "pending") throw Object.assign(new Error("该候选已处理"), { statusCode: 409 });
  const profile = await internalAppend(root, candidate);
  if (profile.status === "overflow") return { status: "overflow", candidate: { ...candidate }, profile };
  candidate.status = "approved";
  candidate.resolution = profile.status;
  candidate.resolvedAt = new Date().toISOString();
  await saveCandidates(root, rows);
  return { status: profile.status, candidate: { ...candidate }, profile };
});

export const rejectProfileCandidate = (root, id) => withLock(root, async () => {
  const rows = await readCandidates(root);
  const candidate = rows.find((row) => row.id === id);
  if (!candidate) throw Object.assign(new Error("画像候选不存在"), { statusCode: 404 });
  if (candidate.status !== "pending") throw Object.assign(new Error("该候选已处理"), { statusCode: 409 });
  candidate.status = "rejected";
  candidate.resolvedAt = new Date().toISOString();
  await saveCandidates(root, rows);
  return { status: "rejected", candidate: { ...candidate } };
});
