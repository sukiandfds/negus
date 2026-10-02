import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { initializeCredentials, startManaged } from "../../scripts/negus-deployment.mjs";
import { createMacWatchdog } from "../../scripts/negus-watchdog-macos.mjs";
const temp = async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "negus-deploy-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};
test("deployment credentials persist, stay private and reject inconsistent environment", async (t) => {
  const dir = await temp(t);
  await initializeCredentials(dir, "");
  const file = path.join(dir, "access-token"), first = await fs.readFile(file, "utf8");
  assert.match(first.trim(), /^[a-f0-9]{64}$/u);
  await initializeCredentials(dir, "");
  assert.equal(await fs.readFile(file, "utf8"), first);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  await assert.rejects(initializeCredentials(dir, "different"), /differs/u);
  assert.equal(await fs.readFile(file, "utf8"), first);
});
test("normal startup installs recovery only after healthy service; failures remain visible", async () => {
  const order = [];
  const options = { platform: "darwin", initialize: async () => order.push("init"),
    start: async () => { order.push("start"); return { state: "healthy", frontend: "healthy" }; },
    install: async () => { order.push("install"); return { state: "installed", intervalSeconds: 10800 }; } };
  assert.equal((await startManaged(options)).watchdog.intervalSeconds, 10800);
  assert.deepEqual(order, ["init", "start", "install"]);
  order.length = 0;
  await assert.rejects(startManaged({ ...options, start: async () => ({ state: "auth-error" }) }), /not ready/u);
  assert.deepEqual(order, ["init"]);
  await assert.rejects(startManaged({ ...options, install: async () => { throw Error("denied"); } }), /Backend is running.*denied/u);
  order.length = 0;
  await assert.rejects(startManaged({ ...options, platform: "linux" }), /macOS only/u);
  assert.deepEqual(order, []);
});
test("installation is repeatable, updates stale interval and protects other deployment", async (t) => {
  const home = await temp(t), projectRoot = path.join(home, "project & space");
  let active = false;
  const calls = [];
  const execute = async (program, args) => {
    calls.push([program, ...args]);
    if (args[0] === "print" && !active) throw Error("not loaded");
    if (args[0] === "bootstrap") active = true;
    if (args[0] === "bootout") active = false;
    return { stdout: "" };
  };
  const options = { home, projectRoot, node: "/node path/bin/node", uid: 999, execute };
  const installer = createMacWatchdog(options);
  assert.equal((await installer.status()).intervalSeconds, null);
  assert.equal((await installer.install()).state, "installed");
  assert.equal((await installer.status()).intervalSeconds, 10800);
  assert.equal((await installer.install()).state, "already-installed");
  assert.equal(calls.filter(c => c[1] === "bootstrap").length, 1);
  const file = path.join(home, "Library/LaunchAgents/local.negus.watchdog.plist");
  const body = await fs.readFile(file, "utf8");
  assert.ok(body.includes("project &amp; space"));
  await fs.writeFile(file, body.replace("<integer>10800</integer>", "<integer>60</integer>"));
  assert.equal((await installer.install()).state, "updated");
  assert.equal((await installer.status()).intervalSeconds, 10800);
  const before = await fs.readFile(file, "utf8");
  await assert.rejects(createMacWatchdog({ ...options, projectRoot: "/different" }).install(), /another deployment/u);
  assert.equal(await fs.readFile(file, "utf8"), before);
  await installer.uninstall();
  assert.equal((await installer.status()).installed, false);
});
test("launchctl installation failure is reported and a later retry repairs it", async (t) => {
  const home = await temp(t);
  let fail = true, active = false;
  const installer = createMacWatchdog({ home, projectRoot: home, uid: 999,
    execute: async (_, args) => {
      if (args[0] === "print" && !active) throw Error("absent");
      if (args[0] === "bootstrap") { if (fail) throw Error("bootstrap denied"); active = true; }
    } });
  await assert.rejects(installer.install(), /bootstrap denied/u);
  fail = false;
  assert.equal((await installer.install()).state, "updated");
  assert.equal((await installer.status()).loaded, true);
});
