import test from "node:test";
import assert from "node:assert/strict";
import { isBroadcastRequest, resolveAgentRouting } from "./agent-routing.mjs";

const agents = [
  { id: "manager", name: "运营管理", aliases: ["项目经理"] },
  { id: "researcher", name: "产品分析", aliases: ["研究"] },
  { id: "developer", name: "技术研发", aliases: ["开发"] },
];

test("broadcast phrases address every employee", () => {
  for (const text of ["各位看一下最近情况", "所有人一起讨论一下", "每个人都检查一遍"]) {
    assert.equal(isBroadcastRequest(text), true);
    const route = resolveAgentRouting({ text, agents });
    assert.deepEqual(route.targetAgentIds, agents.map((agent) => agent.id));
    assert.equal(route.broadcast, true);
  }
  assert.equal(isBroadcastRequest("这是大家庭的普通说明"), false);
});

test("explicit mentions still win over broadcast wording", () => {
  const route = resolveAgentRouting({ text: "各位看看，@产品分析，先给意见", agents });
  assert.deepEqual(route.targetAgentIds, ["researcher"]);
  assert.equal(route.broadcast, false);
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

test("broadcast is not silently reduced to the output worker", () => {
  const route = resolveAgentRouting({ text: "所有人一起讨论", agents, outputRequested: true });
  assert.deepEqual(route.targetAgentIds, agents.map((agent) => agent.id));
  assert.equal(route.broadcast, true);
});
