import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { materializeGoalObjective, expandGoalObjective, goalFilePrefix } from "../server/thread-goal-objective.mjs";
test("Codex long-objective reference round-trips without exposing arbitrary files", async t => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"negus-goal-objective-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const short="a".repeat(4000);
 assert.deepEqual(await materializeGoalObjective(short,root),{objective:short,directory:null});
 const long="goal\n".repeat(1000);
 const value=await materializeGoalObjective(long,root);
 assert.ok(value.objective.startsWith(goalFilePrefix));
 assert.ok(Array.from(value.objective).length<=4000);
 const native={objective:value.objective,status:"active"};
 assert.equal((await expandGoalObjective(native,root)).displayObjective,long);
 const outside={objective:goalFilePrefix+path.join(root,"../secrets.txt")+" before continuing."};
 assert.equal(await expandGoalObjective(outside,root),outside);
});

test('unloaded goals read the current provider database without starting work', async () => {
  const { readThreadGoal } = await import('../server/thread-goal-objective.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-goal-read-'));
  const calls = [];
  const client = { request: async method => { calls.push(method); throw Error('thread not loaded'); } };
  try {
    assert.deepEqual(await readThreadGoal(client, 'none', path.join(root, 'attachments')), { goal: null });
    const db = new DatabaseSync(path.join(root, 'goals_1.sqlite'));
    db.exec("CREATE TABLE thread_goals(thread_id TEXT PRIMARY KEY, objective TEXT, status TEXT, token_budget INTEGER, tokens_used INTEGER, time_used_seconds INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER)");
    db.prepare('INSERT INTO thread_goals VALUES(?,?,?,?,?,?,?,?)').run('old', '真实目标', 'usage_limited', 100, 12, 3, 1000, 2000);
    db.close();
    assert.deepEqual((await readThreadGoal(client, 'old', path.join(root, 'attachments'))).goal, {
      threadId: 'old', objective: '真实目标', status: 'usageLimited', tokenBudget: 100,
      tokensUsed: 12, timeUsedSeconds: 3, createdAt: 1, updatedAt: 2,
    });
    assert.deepEqual(await readThreadGoal(client, 'none', path.join(root, 'attachments')), { goal: null });
    await assert.rejects(() => readThreadGoal({ request: async () => { throw Error('connection lost'); } }, 'old', root), /connection lost/);
    assert.ok(calls.every(method => method === 'thread/goal/get'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
