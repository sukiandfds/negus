import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readTopics, topicWriter } from "../server/status-panel/topics.mjs";
import { listProfileCandidates } from "../server/profile-service.mjs";

const createRoot = async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-topics-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
};

const publish = async (root, threadId, turn, items) => {
  const writer = topicWriter(root);
  const { draft } = await writer.prepare(threadId);
  await fs.writeFile(draft, JSON.stringify(items), "utf8");
  writer.bind(threadId, turn, draft);
  await writer.finish(threadId, turn, "completed");
};

test("带 profileCandidate 的草稿发布后，候选进入待批准且话题照常发布", async (t) => {
  const root = await createRoot(t);
  await publish(root, "thread-1", "turn-1", [{
    title: "修复对话摘要", mainline: "开发 Negus", summary: "已修复。",
    profileCandidate: { rule: "给结论前先核对远端状态", ref: "TB-001", anger: false },
  }]);
  const topics = await readTopics(root, "thread-1");
  assert.equal(topics.length, 1);
  assert.equal(topics[0].title, "修复对话摘要");
  assert.ok(!("profileCandidate" in topics[0]));
  const pending = await listProfileCandidates(root, { status: "pending" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].rule, "给结论前先核对远端状态");
  assert.equal(pending[0].ref, "TB-001");
  assert.equal(pending[0].anger, false);
  assert.equal(pending[0].topicId, "turn-1");
  assert.equal(pending[0].turnId, "turn-1");
});

test("带 anger 候选的草稿发布后，规则直接写入画像", async (t) => {
  const root = await createRoot(t);
  await publish(root, "thread-2", "turn-2", [{
    title: "愤怒事件", mainline: "开发 Negus", summary: "用户愤怒，已写回。",
    profileCandidate: { rule: "同一个错误不许犯第二次", ref: "TB-002", anger: true },
  }]);
  const all = await listProfileCandidates(root);
  assert.equal(all.length, 1);
  assert.equal(all[0].status, "approved");
  const profile = await fs.readFile(path.join(root, "USER_PROFILE.md"), "utf8");
  assert.ok(profile.includes("- 同一个错误不许犯第二次"));
  assert.ok(profile.includes("TB-002"));
});

test("不带候选的旧草稿发布行为不变，也不产生候选", async (t) => {
  const root = await createRoot(t);
  await publish(root, "thread-3", "turn-3", [{ title: "普通话题", mainline: "主线", summary: "摘要。" }]);
  const topics = await readTopics(root, "thread-3");
  assert.equal(topics.length, 1);
  assert.equal(topics[0].summary, "摘要。");
  assert.deepEqual(await listProfileCandidates(root), []);
});
