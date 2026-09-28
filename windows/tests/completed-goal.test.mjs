import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "../../web-ui/node_modules/typescript/lib/typescript.js";
const source = await fs.readFile(new URL("../../web-ui/src/features/goals/model/completedGoal.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { completedGoalMessageId } = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
const goal = { status: "complete", updatedAt: 20 };
const message = (id, turnId, turnStartedAtMs, turnStatus = "completed", role = "assistant") => ({ id, turnId, turnStartedAtMs, turnStatus, role });
test("completion belongs to its final assistant reply, not subsequent turns", () => {
 const messages = [message("u", "first", 10000, "completed", "user"), message("a", "first", 10000), message("final", "first", 10000), message("later", "next", 21000)];
 assert.equal(completedGoalMessageId(messages, goal), "final");
});
test("in-progress, failed and interrupted turns cannot display achieved results", () => {
 for (const state of ["inProgress", "failed", "interrupted"]) assert.equal(completedGoalMessageId([message("old", "old", 1000), message("current", "current", 10000, state)], goal), null);
});
test("user-only completion cannot attach result to an older assistant turn", () => {
 assert.equal(completedGoalMessageId([message("old", "old", 1000), message("user", "current", 10000, "completed", "user")], goal), null);
 assert.equal(completedGoalMessageId([message("old", "old", 1000)], { ...goal, status: "active" }), null);
});
