import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { createMaintenanceGate } from "../server/http/maintenance-gate.mjs";
import { validateBuild, publishBuild } from "../../scripts/negus-frontend.mjs";
import { createExecutionTracker } from "../server/execution-tracker.mjs";
import { recoveryDecision } from "../../scripts/negus-watchdog.mjs";
const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "../..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const temp = async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "negus-service-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};
const response = () => Object.assign(new EventEmitter(), {
  headers: {}, setHeader(k, v) { this.headers[k] = v; },
  writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); },
});
test("safe-drain refuses busy work, requires local secret, tracks async requests and expires", async (t) => {
  const dir = await temp(t);
  await fs.mkdir(path.join(dir, "runtime"));
  const key = "x".repeat(64);
  await fs.writeFile(path.join(dir, "runtime/maintenance-key"), key);
  let busy = true, time = 0;
  const gate = createMaintenanceGate({ projectRoot: dir, isBusy: () => busy, now: () => time, pid: 123 });
  const request = (method = "POST", remoteAddress = "127.0.0.1") => ({ method, headers: { "x-negus-maintenance-key": key }, socket: { remoteAddress } });
  const url = new URL("http://localhost/api/maintenance");
  let res = response();
  gate(request(), res, url);
  assert.equal(res.status, 409);
  busy = false;
  res = response(); gate(request("POST", "192.0.2.1"), res, url); assert.equal(res.status, 403);
  const incoming = request();
  assert.equal(gate(incoming, response(), new URL("http://localhost/api/session")), false);
  res = response(); gate(request(), res, url); assert.equal(res.status, 409);
  // A disconnected response must not release still-running handler work.
  gate.release(incoming);
  res = response(); gate(request(), res, url); assert.equal(res.body.draining, true);
  res = response(); gate(request(), res, new URL("http://localhost/api/session")); assert.equal(res.status, 503);
  time = 61000;
  const after = request();
  assert.equal(gate(after, response(), new URL("http://localhost/api/session")), false);
  gate.release(after);
});
test("native active goals block restart between turns until paused or cleared", () => {
  const tracker = createExecutionTracker({ broadcast() {} });
  tracker.handleProtocolMessage({ method: "thread/goal/updated", params: { threadId: "t", goal: { status: "active" } } });
  assert.equal(tracker.hasPendingWork(), true);
  tracker.handleProtocolMessage({ method: "thread/goal/updated", params: { threadId: "t", goal: { status: "paused" } } });
  assert.equal(tracker.hasPendingWork(), false);
});
const makeBuild = async (dir, id) => {
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  await fs.writeFile(path.join(dir, "assets", id + ".js"), "export default 1;");
  for (const name of ["index.html", "group.html", "progress.html", "project-management.html"]) {
    await fs.writeFile(path.join(dir, name), '<html><script src="/assets/' + id + '.js"></script></html>');
  }
  await fs.writeFile(path.join(dir, "version.json"), JSON.stringify({ buildId: id, builtAt: new Date().toISOString() }));
};
test("frontend publishing preserves old browser assets; incomplete build cannot replace live HTML", async (t) => {
  const dir = await temp(t), live = path.join(dir, "live"), next = path.join(dir, "next");
  await makeBuild(live, "old");
  await makeBuild(next, "new");
  await publishBuild(next, live);
  assert.equal((await validateBuild(live)).buildId, "new");
  await fs.access(path.join(live, "assets/old.js"));
  await fs.rm(path.join(next, "assets/new.js"));
  const before = await fs.readFile(path.join(live, "index.html"), "utf8");
  await assert.rejects(publishBuild(next, live));
  assert.equal(await fs.readFile(path.join(live, "index.html"), "utf8"), before);
});
test("recovery never restarts busy/unhealthy/auth/foreign states; missing service uses cooldown", () => {
  for (const health of ["healthy", "auth-error", "unknown", "unhealthy-or-foreign", "process-alive-not-ready"]) {
    assert.equal(recoveryDecision({ health }), "observe");
  }
  assert.equal(recoveryDecision({ health: "absent", retryAfter: 20, now: 10 }), "cooldown");
  assert.equal(recoveryDecision({ health: "absent", retryAfter: 20, now: 21 }), "recover");
});
test("isolated backend starts, detached restart waits for work, recovers exit and refuses foreign/auth services",
  { skip: process.platform !== "darwin", timeout: 45000 }, async (t) => {
  const dir = await temp(t);
  for (const sub of ["scripts", "windows/scripts", "windows/server/http", "runtime", "web-ui/dist"]) {
    await fs.mkdir(path.join(dir, sub), { recursive: true });
  }
  for (const file of ["scripts/negus-service-common.mjs", "scripts/negus-backend.mjs",
    "scripts/negus-releases.mjs", "scripts/negus-frontend.mjs",
    "windows/server/http/maintenance-gate.mjs", "windows/server/http/request-utils.mjs"]) {
    await fs.copyFile(path.join(repo, file), path.join(dir, file));
  }
  await fs.writeFile(path.join(dir, "runtime/access-token"), "fixture-secret");
  await fs.writeFile(path.join(dir, "runtime/busy"), "busy");
  await makeBuild(path.join(dir, "web-ui/dist"), "fixture");
  const fixture = `import http from "node:http";import fs from "node:fs";import path from "node:path";
import {createMaintenanceGate} from "../server/http/maintenance-gate.mjs";
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1],root=get("--project-root"),port=Number(get("--port"));
const gate=createMaintenanceGate({projectRoot:root,isBusy:()=>fs.existsSync(path.join(root,"runtime/busy"))});
const server=http.createServer((req,res)=>{const url=new URL(req.url,"http://localhost");
if(!String(req.headers.cookie).includes("fixture-secret")){res.writeHead(401);res.end();return;}
if(gate(req,res,url))return;try{if(url.pathname==="/api/project"){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({root,mode:"interactive"}));}
else {res.writeHead(200,{"content-type":"text/html"});res.end("<html></html>");}}finally{gate.release(req);}});
server.listen(port,"127.0.0.1");process.on("SIGTERM",()=>{server.close();server.closeAllConnections();});`;
  await fs.writeFile(path.join(dir, "windows/scripts/remote-room-demo.mjs"), fixture);
  const reserve = net.createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const env = { ...process.env, NEGUS_INSTALL_ROOT: dir, NEGUS_TOKEN: "", NEGUS_PORT: String(port) };
  await fs.writeFile(path.join(dir, "scripts/fixture-restart.mjs"), 'import {backendAction} from "./negus-backend.mjs";import {delay} from "./negus-service-common.mjs";await delay(3000);await backendAction("restart");');
  const command = (action) => action === "restart"
    ? exec(process.execPath, ["--input-type=module", "-e", 'import {detached} from ' + JSON.stringify(new URL("file://" + path.join(dir, "scripts/negus-service-common.mjs")).href) + ';await detached(' + JSON.stringify(path.join(dir, "scripts/fixture-restart.mjs")) + ',[],"fixture-worker.log");'], { env, timeout: 20000 })
    : exec(process.execPath, [path.join(dir, "scripts/negus-backend.mjs"), action], { env, timeout: 20000 });

  const state = async () => JSON.parse(await fs.readFile(path.join(dir, "runtime/negus-web-demo.json"), "utf8"));
  const owned = new Set();
  t.after(async () => {
    try { owned.add((await state()).pid); } catch {}
    for (const pid of owned) { try { process.kill(pid, "SIGTERM"); } catch {} }
    await sleep(200);
  });
  await command("start");
  const first = (await state()).pid; owned.add(first);
  await command("restart");
  await sleep(4200);
  assert.equal((await state()).pid, first, "active work must block shutdown");
  await fs.rm(path.join(dir, "runtime/busy"));
  let second;
  for (let i = 0; i < 60; i++) {
    try { const candidate = await state(); if (candidate.pid !== first) { second = candidate.pid; break; } } catch {}
    await sleep(200);
  }
  assert.ok(second, "restart should finish after idle"); owned.add(second);
  await sleep(1200);
  await command("check");

  // Snapshot A is the backend recovery source; publish frontend B independently.
  const releaseDir = path.join(dir, "runtime/releases/A");
  await fs.cp(path.join(dir, "windows"), path.join(releaseDir, "windows"), { recursive: true });
  await makeBuild(path.join(releaseDir, "web-ui/dist"), "A");
  const hash = createHash("sha256");
  const digest = async (relative = "") => {
    for (const name of (await fs.readdir(path.join(releaseDir, relative))).sort()) {
      const key = path.join(relative, name), file = path.join(releaseDir, key), stat = await fs.lstat(file);
      hash.update(key + "\0");
      if (stat.isDirectory()) await digest(key);
      else hash.update(await fs.readFile(file));
    }
  };
  await digest();
  await fs.writeFile(path.join(releaseDir, "release.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), digest: hash.digest("hex") }));
  await fs.writeFile(path.join(dir, "runtime/negus-release-state.json"), JSON.stringify({ active: {
    id: "A", directory: releaseDir, entryScript: path.join(releaseDir, "windows/scripts/remote-room-demo.mjs"),
  } }));
  const frontendB = path.join(dir, "frontend-B");
  await makeBuild(frontendB, "B");
  await publishBuild(frontendB, path.join(dir, "web-ui/dist"));

  process.kill(second, "SIGTERM");
  await sleep(500);
  await command("recover");
  const third = (await state()).pid; owned.add(third);
  assert.notEqual(third, second);
  assert.equal((await state()).entryScript, path.join(releaseDir, "windows/scripts/remote-room-demo.mjs"));
  assert.equal((await validateBuild(path.join(dir, "web-ui/dist"))).buildId, "B", "normal backend recovery must retain separately published frontend B");
  await command("check");
  const wrong = await exec(process.execPath, [path.join(dir, "scripts/negus-backend.mjs"), "recover"],
    { env: { ...env, NEGUS_TOKEN: "wrong-secret" } }).then(() => null, (e) => e);
  assert.ok(wrong); assert.match(wrong.stdout, /auth-error/);
  assert.equal((await state()).pid, third);
});
