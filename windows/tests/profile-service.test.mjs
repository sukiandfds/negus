import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendProfileRule,
  addProfileCandidate,
  approveProfileCandidate,
  listProfileCandidates,
  rejectProfileCandidate,
} from "../server/profile-service.mjs";

const COMMENT = "<!-- 助手被纠正或用户愤怒后，把教训蒸馏成一行祈使句追加到这里，格式：- 规则（日期，吐血表条目编号）。已有同义规则时不重复添加，只在原规则后补记新条目编号。本区由系统每轮自动注入，写在这里的规则对所有新对话立即生效。 -->";
const SCAFFOLD = `优先用简短、具体的中文汇报，称呼用户为“您”。\n\n## 纠正沉淀\n\n${COMMENT}\n`;

const createRoot = async (t, profile = SCAFFOLD) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-profile-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  if (profile !== null) await fs.writeFile(path.join(root, "USER_PROFILE.md"), profile, "utf8");
  return root;
};
const readProfile = (root) => fs.readFile(path.join(root, "USER_PROFILE.md"), "utf8");
const ruleLines = async (root) => (await readProfile(root)).split("\n").filter((line) => line.startsWith("- "));

test("新增规则按既有格式追加，原有正文不动", async (t) => {
  const root = await createRoot(t);
  const result = await appendProfileRule(root, { rule: "给结论前先核对远端状态", ref: "TB-001", date: "2026-11-24" });
  assert.equal(result.status, "added");
  assert.equal(result.line, "- 给结论前先核对远端状态（2026-11-24，TB-001）");
  const content = await readProfile(root);
  assert.ok(content.startsWith("优先用简短、具体的中文汇报"));
  assert.ok(content.includes(COMMENT));
  assert.deepEqual(await ruleLines(root), ["- 给结论前先核对远端状态（2026-11-24，TB-001）"]);
});

test("同义规则去重，只补记新编号", async (t) => {
  const root = await createRoot(t);
  await appendProfileRule(root, { rule: "给结论前先核对远端状态", ref: "TB-001", date: "2026-11-24" });
  const merged = await appendProfileRule(root, { rule: "给结论前先核对远端状态。", ref: "TB-002", date: "2026-11-25" });
  assert.equal(merged.status, "merged");
  const lines = await ruleLines(root);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("TB-001") && lines[0].includes("TB-002"));
});

test("写入后超过 12000 字则拒绝写入，文件不变", async (t) => {
  const filler = "充".repeat(11900);
  const root = await createRoot(t, `${filler}\n\n## 纠正沉淀\n\n${COMMENT}\n`);
  const before = await readProfile(root);
  const result = await appendProfileRule(root, { rule: "一条会让画像超限的新规则", ref: "TB-003", date: "2026-11-24" });
  assert.equal(result.status, "overflow");
  assert.equal(await readProfile(root), before);
});

test("纠正沉淀区缺失时自动创建，格式与现有注释一致", async (t) => {
  const root = await createRoot(t, "只有一行正文。\n");
  const result = await appendProfileRule(root, { rule: "先给计划再动手", ref: "TB-004", date: "2026-11-24" });
  assert.equal(result.status, "added");
  const content = await readProfile(root);
  assert.ok(content.startsWith("只有一行正文。"));
  assert.ok(content.includes("## 纠正沉淀"));
  assert.ok(content.includes(COMMENT));
  assert.ok(content.includes("- 先给计划再动手（2026-11-24，TB-004）"));
});

test("候选产生即落盘，不进待批准；已处理候选再 approve/reject 报错", async (t) => {
  const root = await createRoot(t);
  const { candidate, profile } = await addProfileCandidate(root, { rule: "汇报先说对用户的影响", ref: "TB-005", topicId: "topic-a", turnId: "turn-a" });
  assert.equal(profile.status, "added");
  assert.equal(candidate.status, "approved");
  assert.equal(candidate.resolution, "added");
  const lines = await ruleLines(root);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("- 汇报先说对用户的影响（") && lines[0].includes("TB-005"));
  assert.equal((await listProfileCandidates(root, { status: "pending" })).length, 0);
  await assert.rejects(() => approveProfileCandidate(root, candidate.id), /已处理/);
  await assert.rejects(() => rejectProfileCandidate(root, candidate.id), /已处理/);

  // 同义候选再次产生只补记编号，不新增行。
  const again = await addProfileCandidate(root, { rule: "汇报先说对用户的影响", ref: "TB-006" });
  assert.equal(again.profile.status, "merged");
  assert.equal(again.candidate.status, "approved");
  assert.equal((await ruleLines(root)).length, 1);
});

test("超限时候选留待人工处理，保持 pending 并注明原因", async (t) => {
  const filler = "充".repeat(11900);
  const root = await createRoot(t, `${filler}\n\n## 纠正沉淀\n\n${COMMENT}\n`);
  const { candidate, profile } = await addProfileCandidate(root, { rule: "一条会让画像超限的新规则", ref: "TB-003" });
  assert.equal(profile.status, "overflow");
  assert.equal(candidate.status, "pending");
  assert.ok(candidate.note.includes("画像已达上限"));
  assert.equal((await listProfileCandidates(root, { status: "pending" })).length, 1);
  assert.equal((await ruleLines(root)).length, 0);
});

test("愤怒候选直接落盘，不进待批准", async (t) => {
  const root = await createRoot(t);
  const { candidate, profile } = await addProfileCandidate(root, { rule: "同一个错误不许犯第二次", ref: "TB-007", anger: true, topicId: "topic-b", turnId: "turn-b" });
  assert.equal(profile.status, "added");
  assert.equal(candidate.status, "approved");
  assert.equal(candidate.resolution, "added");
  assert.equal((await listProfileCandidates(root, { status: "pending" })).length, 0);
  assert.equal((await ruleLines(root)).length, 1);
});
