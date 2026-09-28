// Full Negus server + native EventSource + real Codex, isolated project state.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.NEGUS_PLAYWRIGHT_MODULE).href);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-goal-http-"));
await fs.cp(path.resolve("employees"), path.join(root, "employees"), { recursive: true, filter: source => !source.includes(path.sep + "runtime" + path.sep) && !source.includes(path.sep + ".git") });
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const employeeMode = process.env.NEGUS_GOAL_EMPLOYEE_TEST === "1";
const providerMode = process.env.NEGUS_GOAL_PROVIDER_TEST === "1";
let conversationId = "";
const token = process.env.NEGUS_GOAL_TEST_TOKEN || randomBytes(24).toString("hex");
const externalOrigin = process.env.NEGUS_GOAL_TEST_ORIGIN || "";
const origin = externalOrigin || "http://127.0.0.1:" + port;
const child = externalOrigin ? null : spawn(process.execPath, [path.resolve("windows/scripts/remote-room-demo.mjs"), "--port", String(port), "--project-root", root, "--web-root", path.resolve("web-ui/dist"), "--token", token], {
  cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, CODEX_HOME: path.resolve("runtime/model-providers/ccswitch_default/codex-home"), CODEX_SESSION_DIR: path.join(root, "sessions") },
});
let logs = "";
for (const stream of child ? [child.stdout, child.stderr] : []) stream.on("data", data => { logs = (logs + data.toString().replaceAll(token, "[redacted]")).slice(-16000); });
const api = async (pathname, method = "GET", body) => {
 if (conversationId && pathname.startsWith("/api/session") || conversationId && pathname.startsWith("/api/execution-status")) {
  if (method === "GET") pathname += (pathname.includes("?") ? "&" : "?") + "conversationId=" + encodeURIComponent(conversationId);
  else body = { ...body, conversationId };
 }
 const response = await fetch(origin + pathname + (pathname.includes("?") ? "&" : "?") + "token=" + token, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
 const result = await response.json();
 if (!response.ok) throw Error(pathname + " " + response.status + " " + JSON.stringify(result));
 return result;
};
let browser, threadId;
try {
 let ready = false;
 for (let i = 0; i < 100; i++) {
  if (child && child.exitCode !== null) throw Error("test server exited: " + logs);
  try { await api("/api/project"); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 300)); }
 }
 assert.ok(ready, "full test server becomes ready");
 if (employeeMode) {
  const opened = await api("/api/employee/open", "POST", { employeeId: "developer" });
  threadId = opened.conversation.threadId;
  conversationId = opened.conversation.id;
 } else {
  const testProjectRoot = externalOrigin ? (await api("/api/project")).root : root;
  const created = await api("/api/session", "POST", { projectRoot: testProjectRoot });
  threadId = created.threadId;
 }
 assert.ok(threadId);
 if (providerMode) {
  const switched = await api("/api/session/model", "POST", { threadId, model: "ccswitch_default::gpt-6-astra", allowProviderSwitch: true });
  threadId = switched.threadId || threadId;
  assert.equal(switched.modelProvider, "ccswitch_default");
 }
 browser = await chromium.launch({ channel: "msedge", headless: true });
 const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
 page.setDefaultTimeout(20000);
 const errors = [], calls = [];
 page.on("pageerror", error => errors.push(error.message));
 page.on("request", request => { const url = new URL(request.url()); if (url.pathname === "/api/session/message" || url.pathname === "/api/session/goal") calls.push({ path: url.pathname, method: request.method() }); });
 await page.addInitScript(() => {
  window.__goalEvents = [];
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
   constructor(...args) { super(...args); this.addEventListener("message", event => { const value = JSON.parse(event.data); if (value.type === "goal_status") window.__goalEvents.push(value); }); }
  };
 });
 await page.goto(origin + "/?token=" + token + "&view=conversation&thread=" + threadId + (conversationId ? "&conversation=" + encodeURIComponent(conversationId) : ""), { waitUntil: "domcontentloaded" });
 await page.getByPlaceholder("给 Codex 发送指令").fill("/goal Reply GOAL_HTTP_OK and immediately mark this goal complete using update_goal. Do not access files or networks. Do not use any other tools.");
 await page.getByRole("button", { name: "发送", exact: true }).click();
 await page.getByText("已达成目标", { exact: true }).waitFor({ timeout: 120000 });
 for (let i = 0; i < 50; i++) {
  if ((await api("/api/session/goal?threadId=" + threadId)).goal === null) break;
  await new Promise(resolve => setTimeout(resolve, 200));
 }
 assert.equal((await api("/api/session/goal?threadId=" + threadId)).goal, null);
 const events = await page.evaluate(() => window.__goalEvents);
 assert.ok(events.some(event => event.threadId === threadId && event.goal?.status === "active"));
 assert.ok(events.some(event => event.threadId === threadId && event.goal?.status === "complete"));
 assert.ok(events.some(event => event.threadId === threadId && event.goal === null));
 if (employeeMode) assert.ok(events.some(event => event.threadId === threadId && event.conversationId === conversationId), "employee native events carry their owner");
 assert.equal(calls.filter(call => call.path === "/api/session/message").length, 0);
 assert.deepEqual(errors, []);
 for (let i = 0; i < 120; i++) {
  if (!(await api("/api/execution-status?threadId=" + threadId)).active) break;
  await new Promise(resolve => setTimeout(resolve, 500));
 }
 assert.equal((await api("/api/execution-status?threadId=" + threadId)).active, false, "final native turn finishes after marking the goal complete");
 await page.getByPlaceholder("给 Codex 发送指令").waitFor();
 if (!employeeMode) await page.getByLabel("目标达成结果", { exact: true }).waitFor({ timeout: 20000 });
 await page.getByText("已达成目标", { exact: true }).waitFor();
 assert.equal(await page.getByRole("button", { name: "停止当前任务", exact: true }).count(), 0);
 const displayed = await page.locator("article").allTextContents();
 assert.ok(displayed.findIndex(text => text.includes("/goal ")) < displayed.findIndex(text => text.includes("内达成目标")), "goal command must precede its achieved reply");

 await page.screenshot({ path: employeeMode ? "runtime/goal-employee-http-complete.png" : "runtime/goal-http-complete.png" });
 console.log(JSON.stringify({ result: "PASS", threadId, conversationId, providerMode, deployment: externalOrigin ? "existing service" : "isolated service", transport: "unmocked HTTP/SSE", statuses: events.filter(event => event.threadId === threadId).map(event => event.goal?.status || "cleared"), checks: ["full production server entrypoint in isolated project", "browser direct goal creation without ordinary message", "real native completion and SSE display", "native goal cleared", "final turn settles and composer returns to idle"] }));
} catch (error) {
 console.error(error);
 if (threadId) console.error(JSON.stringify(await api("/api/session?threadId=" + threadId).catch(() => null)));
 console.error(logs);
 process.exitCode = 1;
} finally {
 if (threadId) {
  const current = await api("/api/session/goal?threadId=" + threadId).catch(() => null);
  if (current?.goal?.status === "active") await api("/api/session/goal", "POST", { threadId, status: "paused" }).catch(() => {});
  await api("/api/session/goal", "DELETE", { threadId }).catch(() => {});
  await api("/api/session/archive", "POST", { threadId }).catch(() => {});
 }
 await browser?.close();
 // Stop only this test server and its children, never the user's running service.
 if (child && child.exitCode === null) await new Promise(resolve => { const stop = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); stop.once("exit", resolve); });
}
