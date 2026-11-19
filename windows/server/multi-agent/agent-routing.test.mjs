import test from "node:test";
import assert from "node:assert/strict";
import { resolveAgentRouting } from "./agent-routing.mjs";

const agents = [
  { id: "manager", name: "运营管理", aliases: ["项目经理"] },
  { id: "researcher", name: "产品分析", aliases: ["研究"] },
  { id: "developer", name: "技术研发", aliases: ["开发"] },
];

test("text alone never expands a target set", () => {
  const route = resolveAgentRouting({ text: "各位看一下最近情况，请所有人都出来发言", agents });
  assert.deepEqual(route.targetAgentIds, []);
  assert.equal(route.broadcast, false);
});

test("explicit mentions remain authoritative", () => {
  const route = resolveAgentRouting({ text: "各位看看，@产品分析，先给意见", agents });
  assert.deepEqual(route.targetAgentIds, ["researcher"]);
  assert.equal(route.broadcast, false);
});

test("structured employee targets remain authoritative over message wording", () => {
  const route = resolveAgentRouting({ text: "请不要让其他人参与，大家都休息", explicitAgentIds: ["developer"], agents });
  assert.deepEqual(route.targetAgentIds, ["developer"]);
  assert.deepEqual(route.explicitAgentIds, ["developer"]);
});

test("unaddressed messages remain visible without silently dispatching", () => {
  const route = resolveAgentRouting({ text: "记录一下这个决定", agents });
  assert.deepEqual(route.targetAgentIds, []);
  assert.equal(route.broadcast, false);
});

test("a quoted employee can receive a follow-up without a second mention", () => {
  const route = resolveAgentRouting({ text: "请补充刚才的依据", requestedAgentIds: ["researcher"], agents });
  assert.deepEqual(route.targetAgentIds, ["researcher"]);
  assert.equal(route.broadcast, false);
});

test("output routing applies only when no explicit target exists", () => {
  const route = resolveAgentRouting({ text: "分析一下", agents, outputRequested: true });
  assert.deepEqual(route.targetAgentIds, ["developer"]);
  const explicit = resolveAgentRouting({ text: "分析一下", explicitAgentIds: ["researcher"], agents, outputRequested: true });
  assert.deepEqual(explicit.targetAgentIds, ["researcher"]);
});
