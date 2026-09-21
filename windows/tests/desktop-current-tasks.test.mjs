import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "../../web-ui/node_modules/typescript/lib/typescript.js";

const source = await fs.readFile(new URL("../../web-ui/src/features/desktop/currentTasks.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { collectCurrentTasks, taskPreview } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const project = (entries) => [{ id: "p", name: "业务项目", conversations: entries.map(([id, phase, active = false]) => ({ id, threadId: id, title: id, status: { phase, active, updatedAt: "2026-09-20T04:00:00Z" } })) }];
const goal = (status) => ({ status, objective: "长期目标", updatedAt: 1789876800 });

test("running takes priority and preview is limited to three without losing remaining tasks", () => {
  const tasks = collectCurrentTasks(project([["done", "completed"], ...[1, 2, 3, 4].map((id) => [`r${id}`, "responding", true])]), {}, {});
  const preview = taskPreview(tasks);
  assert.equal(preview.running.length, 4);
  assert.equal(preview.items.length, 3);
  assert.ok(preview.items.every((item) => item.category === "running"));
});
test("idle and failures are never mistaken for completed; fallback uses explicit completion", () => {
  const tasks = collectCurrentTasks(project([["idle", "idle"], ["bad", "failed"], ["stopped", "interrupted"], ["done", "completed"]]), {}, {});
  assert.deepEqual(taskPreview(tasks).items.map((item) => item.id), ["done"]);
  assert.equal(tasks.find((item) => item.id === "bad").category, "other");
  assert.ok(!tasks.some((item) => item.id === "idle"));
});
test("active goal survives turn gap; paused or budget-limited goals are not completed turns", () => {
  const tasks = collectCurrentTasks(project([["long", "completed"], ["paused", "completed"], ["limited", "idle"], ["finished", "idle"]]), {}, { long: goal("active"), paused: goal("paused"), limited: goal("budgetLimited"), finished: goal("complete") });
  assert.equal(tasks.find((item) => item.id === "long").category, "running");
  assert.equal(tasks.find((item) => item.id === "paused").category, "other");
  assert.equal(tasks.find((item) => item.id === "limited").category, "other");
  assert.equal(tasks.find((item) => item.id === "finished").category, "completed");
});
test("live status overrides directory snapshot, including failure during active goal", () => {
  const tasks = collectCurrentTasks(project([["a", "working", true], ["b", "idle"]]), { a: { phase: "failed", active: false }, b: { phase: "waitingOnUserInput", active: true } }, { a: goal("active") });
  assert.equal(tasks.find((item) => item.id === "a").category, "other");
  assert.equal(tasks.find((item) => item.id === "b").label, "等待你回答");
  assert.equal(tasks.find((item) => item.id === "b").attention, true);
});
test("recent completion order ignores later conversation rename timestamps", () => {
  const projects = project([["old", "completed"], ["new", "completed"]]);
  projects[0].conversations[0].updatedAt = "2026-09-21T12:00:00Z";
  projects[0].conversations[1].status.updatedAt = "2026-09-20T08:00:00Z";
  assert.deepEqual(taskPreview(collectCurrentTasks(projects, {}, {})).items.map((task) => task.id), ["new", "old"]);
});

test("deduplicate same thread and exclude archived/placeholder entries", () => {
  const projects = project([["a", "working", true]]);
  projects.push({ id: "employee", name: "员工", conversations: [...projects[0].conversations, { id: "old", archived: true, status: { phase: "completed" } }, { id: "new", pendingOpen: true, status: { active: true } }] });
  assert.equal(collectCurrentTasks(projects, {}, {}).length, 1);
});
