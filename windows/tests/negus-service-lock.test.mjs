import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const moduleUrl = new URL("../../scripts/negus-service-common.mjs", import.meta.url).href;
const exec = promisify(execFile);
const workerSource = `
import fs from "node:fs/promises";
const { withLock, runtime } = await import(process.env.LOCK_MODULE);
const file = runtime + "/operation.lock";
const commands = new Set(), waiters = new Map();
process.on("message", command => {
  if (waiters.has(command)) { waiters.get(command)(); waiters.delete(command); }
  else commands.add(command);
});
const wait = command => commands.delete(command) ? Promise.resolve() : new Promise(resolve => waiters.set(command, resolve));
if (process.env.PAUSE_DELETE === "1") {
  const unlink = fs.unlink.bind(fs);
  fs.unlink = async name => {
    if (name === file) {
      process.send({ event: "before-delete" });
      await wait("delete");
    }
    return unlink(name);
  };
}
try {
  await withLock("operation", async () => {
    process.send({ event: "entered" });
    await wait("finish");
    if (process.env.FAIL_TASK === "1") throw Error("fixture task failed");
  });
  process.send({ event: "done" });
} catch (error) {
  process.send({ event: "rejected", message: error.message });
}
process.disconnect();
`;

const fixture = async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "negus-lock-test-"));
  const children = [];
  await fs.mkdir(path.join(dir, "runtime"));
  t.after(async () => {
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await Promise.all(children.map(({ closed }) => closed));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const start = (extra = {}) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", workerSource], {
      env: { ...process.env, NEGUS_INSTALL_ROOT: dir, LOCK_MODULE: moduleUrl, ...extra },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const events = [], waiters = [];
    let ended = false, stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("message", event => {
      if (waiters.length) waiters.shift().resolve(event);
      else events.push(event);
    });
    const closed = new Promise(resolve => child.once("close", () => {
      ended = true;
      for (const waiter of waiters.splice(0)) waiter.reject(Error("Worker closed: " + stderr));
      resolve();
    }));
    children.push({ child, closed });
    return {
      child, closed,
      send: command => child.send(command),
      next: () => events.length ? Promise.resolve(events.shift()) : ended
        ? Promise.reject(Error("Worker already closed: " + stderr))
        : new Promise((resolve, reject) => waiters.push({ resolve, reject })),
    };
  };
  const file = path.join(dir, "runtime/operation.lock");
  const stale = async () => {
    // Use a real, already-exited PID, not a guessed unused system PID.
    const { stdout } = await exec(process.execPath, ["-e", "console.log(process.pid)"]);
    await fs.writeFile(file, JSON.stringify({ pid: Number(stdout.trim()), id: "fixture-old", createdAt: new Date().toISOString() }));
  };
  return { start, file, stale };
};

test("concurrent stale-lock recovery never admits a second maintainer", { timeout: 10000 }, async t => {
  const { start, file, stale } = await fixture(t);
  await stale();
  const first = start({ PAUSE_DELETE: "1" });
  assert.equal((await first.next()).event, "before-delete");
  const second = start();
  assert.equal((await second.next()).event, "rejected", "second recovery must not enter while first owns recovery");
  await second.closed;
  first.send("delete");
  assert.equal((await first.next()).event, "entered");
  assert.equal(JSON.parse(await fs.readFile(file)).pid, first.child.pid);
  first.send("finish");
  // The test pause also intercepts normal release.
  assert.equal((await first.next()).event, "before-delete");
  first.send("delete");
  assert.equal((await first.next()).event, "done");
  await first.closed;
  await assert.rejects(fs.access(file), { code: "ENOENT" });
  await assert.rejects(fs.access(file + ".recovery"), { code: "ENOENT" });
});

test("live owners exclude competitors and task failure releases the lock", { timeout: 10000 }, async t => {
  const { start, file } = await fixture(t);
  const first = start({ FAIL_TASK: "1" });
  assert.equal((await first.next()).event, "entered");
  const second = start();
  assert.equal((await second.next()).event, "rejected");
  assert.equal(JSON.parse(await fs.readFile(file)).pid, first.child.pid);
  first.send("finish");
  assert.match((await first.next()).message, /fixture task failed/);
  await first.closed;
  const third = start();
  assert.equal((await third.next()).event, "entered");
  third.send("finish");
  assert.equal((await third.next()).event, "done");
});

test("partial locks and interrupted recovery fail closed without changing the original lock", { timeout: 10000 }, async t => {
  const { start, file, stale } = await fixture(t);
  await fs.writeFile(file, '{"pid":');
  let worker = start();
  assert.equal((await worker.next()).event, "rejected");
  await worker.closed;
  assert.equal(await fs.readFile(file, "utf8"), '{"pid":');
  await assert.rejects(fs.access(file + ".recovery"), { code: "ENOENT" });
  await stale();
  const before = await fs.readFile(file, "utf8");
  worker = start({ PAUSE_DELETE: "1" });
  assert.equal((await worker.next()).event, "before-delete");
  worker.child.kill("SIGKILL"); // Isolated fixture only; simulate a crashed recovery owner.
  await worker.closed;
  const later = start();
  assert.equal((await later.next()).event, "rejected");
  await later.closed;
  assert.equal(await fs.readFile(file, "utf8"), before);
  await fs.access(file + ".recovery");
});
