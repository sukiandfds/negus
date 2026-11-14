import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { restartWithRecovery } from "../../scripts/negus-supervisor.mjs";

test("three real failed processes recover to a healthy fallback without changing user data", { timeout: 15000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "negus-supervisor-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "conversation.json"), '{"keep":"history"}');
  const good = path.join(dir, "good.mjs"), bad = path.join(dir, "bad.mjs");
  await fs.writeFile(bad, "process.exit(1);");
  await fs.writeFile(good, 'import http from "node:http";const s=http.createServer((q,r)=>r.end("fallback"));s.listen(0,"127.0.0.1",()=>console.log(s.address().port));process.on("SIGTERM",()=>{s.close();s.closeAllConnections()});');
  const launched = [], journal = [];
  let running, active;
  t.after(() => running?.kill("SIGTERM"));
  const result = await restartWithRecovery({
    candidate: { id: "candidate", script: bad }, fallback: { id: "fallback", script: good },
    stop: async () => journal.push("old-stopped"),
    publish: async r => journal.push("published:" + r.id),
    record: async r => journal.push(r.phase),
    saveActive: async r => { active = r.id; },
    cleanFailed: async () => assert.ok(!running || running.exitCode !== null),
    launch: async r => {
      launched.push(r.id);
      running = spawn(process.execPath, [r.script], { stdio: ["ignore", "pipe", "pipe"] });
      const child = running;
      const port = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", () => reject(Error("startup exited")));
        child.stdout.once("data", data => resolve(Number(String(data).trim())));
      });
      assert.equal(await (await fetch("http://127.0.0.1:" + port)).text(), "fallback");
      return { pid: child.pid };
    },
  });
  assert.equal(result.state, "rolled-back");
  assert.equal(result.attempts, 3);
  assert.deepEqual(launched, ["candidate", "candidate", "candidate", "fallback"]);
  assert.equal(active, "fallback");
  assert.equal(await fs.readFile(path.join(dir, "conversation.json"), "utf8"), '{"keep":"history"}');
  assert.equal(journal[0], "old-stopped");
});
test("failure to stop an owned attempt aborts instead of spawning another backend", async () => {
  let count = 0;
  await assert.rejects(restartWithRecovery({
    candidate: { id: "new" }, fallback: { id: "old" },
    stop: async () => {}, publish: async () => {}, record: async () => {}, saveActive: async () => {},
    launch: async () => { count++; throw Error("not healthy"); },
    cleanFailed: async () => { throw Error("PID ownership uncertain"); },
  }), /ownership uncertain/);
  assert.equal(count, 1);
});
test("stop refusal leaves old backend alone and performs no publication or launch", async () => {
  await assert.rejects(restartWithRecovery({
    stop: async () => { throw Error("old still running"); },
    publish: async () => assert.fail("must not publish"),
    launch: async () => assert.fail("must not launch"),
  }), /old still running/);
});
test("a successful candidate is promoted once with the fallback retained", async () => {
  const candidate = { id: "new" }, fallback = { id: "old" };
  const saved = [];
  const result = await restartWithRecovery({
    candidate, fallback, stop: async () => {}, publish: async () => {}, record: async () => {},
    cleanFailed: async () => assert.fail("not needed"),
    launch: async () => ({ pid: 123 }),
    saveActive: async (...args) => saved.push(args),
  });
  assert.equal(result.state, "started");
  assert.equal(result.attempts, 1);
  assert.deepEqual(saved, [[candidate, fallback]]);
});
