// Isolated built-UI test. All requests are fulfilled locally; no live APIs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.NEGUS_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const dist = path.resolve("web-ui/dist");
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const root = "D:/cache-fixture", threadId = "cache-fixture";
const messages = Array.from({ length: 36 }, (_, i) => ({ id: "m" + i, role: i % 2 ? "assistant" : "user", text: "Message " + i + "\n\n" + "Stable historical content. ".repeat(12), turnId: "turn" + Math.floor(i / 2), turnStatus: "completed", createdAt: new Date(1760000000000 + i * 1000).toISOString() }));
const session = { threadId, source: "codex", cwd: root, title: "Cache fixture", updatedAt: "2026-09-26T01:00:00Z", messages, messageCount: messages.length, contentVersion: 1, hasMore: false };
const status = { threadId, phase: "completed", active: false, label: "Completed fixture", activities: [], turnId: "turn17", startedAt: "2026-09-26T00:59:00Z", updatedAt: session.updatedAt, durationMs: 60000 };
const project = { id: "p", name: "Fixture", kind: "personal", root, conversations: [{ id: threadId, threadId, title: session.title, status }] };
const item = { id: "a", name: "Cached automation", status: "ACTIVE", schedule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", kind: "test", nextRunAt: null, lastRunAt: null, threadId: null, notificationPolicy: null, source: "fixture", runs: [] };
const automation = { items: [item], checkedAt: 1, warnings: [], coverage: "fixture" };
const room = { id: "room", name: "Fixture group", projectId: "p", project: "Fixture" };
const group = { room, project: "Fixture", projectId: "p", messages: [], agents: [], members: [], activeWorks: [] };
const reports = [];
try {
 for (const mobile of [true, false]) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(({ root, session, project, automation }) => {
    const put = (key, value) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, value })); };
    put("negus-project-directory-v1", [project]);
    put("negus:desktop-thread:v1:" + root, session.threadId);
    put("negus:desktop-automations:v1", automation);
    put("negus:desktop-workspace:v1", [0, 1].map((i) => ({ id: "automations-" + i, kind: "automations", title: "Automation", x: i * 6, y: 0, w: 6, h: 8 })).concat([{ id: "current-tasks", kind: "tasks", title: "Tasks", x: 0, y: 8, w: 12, h: 8 }]));
    if (!localStorage.getItem("negus-conversation-snapshot-v1")) localStorage.setItem("negus-conversation-snapshot-v1", JSON.stringify({ version: 1, savedAt: session.updatedAt, selectedId: session.threadId, sessions: [session], session }));
    window.fixtureSources = [];
    window.EventSource = class extends EventTarget {
      static OPEN = 1; static CLOSED = 2; readyState = 1;
      constructor() { super(); window.fixtureSources.push(this); setTimeout(() => this.onopen?.({}), 0); }
      close() { this.readyState = 2; }
    };
  }, { root, session, project, automation });
  const page = await context.newPage(); const errors = [], writes = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error(error.stack); });
  const directoryGate = deferred(), automationGate = deferred();
  let directoryCalls = 0, automationCalls = 0, currentAutomation = automation, sessionGate = null, freshSession = session;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      writes.push(url.pathname);
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.pathname.startsWith("/api/")) {
      let data = {};
      if (url.pathname === "/api/project-directory") { directoryCalls++; await directoryGate.promise; data = { projects: [project] }; }
      else if (url.pathname === "/api/desktop/automations") { automationCalls++; await automationGate.promise; data = currentAutomation; }
      else if (url.pathname === "/api/project") data = { root, name: "Fixture", mode: "interactive" };
      else if (url.pathname === "/api/sessions") data = [session];
      else if (url.pathname === "/api/session") { if (sessionGate) await sessionGate.promise; data = freshSession; }
      else if (url.pathname === "/api/execution-status") { await new Promise((resolve) => setTimeout(resolve, 1500)); data = status; }
      else if (url.pathname === "/api/models") data = [];
      else if (url.pathname === "/api/model-channels") data = { channels: [] };
      else if (url.pathname === "/api/group/rooms") data = { rooms: [room] };
      else if (url.pathname === "/api/group/snapshot") data = group;
      else if (url.pathname.includes("goal")) data = { goal: null };
      else if (url.pathname.includes("queue")) data = { items: [] };
      else if (url.pathname.includes("user-input")) data = { request: null };
      else if (url.pathname.includes("context")) data = { threadId, usedTokens: 0, maxTokens: 1000 };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    }
    if (url.pathname === "/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    try {
      const body = await fs.readFile(path.join(dist, relative));
      const extension = path.extname(relative);
      return route.fulfill({ status: 200, contentType: ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" })[extension] || "application/octet-stream", body });
    } catch { return route.fulfill({ status: 404, body: "" }); }
  });
  await page.goto("http://127.0.0.1:9360/?view=desktop", { waitUntil: "domcontentloaded" });
  const cachedRow = page.getByRole("button", { name: /Cached automation/ }).first();
  await cachedRow.waitFor();
  const taskRow = page.locator('[aria-label="当前任务"] a').first();
  await taskRow.waitFor();
  await taskRow.evaluate((element) => { window.originalTaskRow = element; });

  assert.equal(await page.getByRole("button", { name: /Cached automation/ }).count(), 2);
  await page.waitForFunction(() => !document.getElementById("negus-launch"));
  assert.equal(automationCalls, 1, "two widgets use one request");
  assert.equal(await taskRow.evaluate((element) => element === window.originalTaskRow), true, "initial execution recovery must not remove cached task");
  const before = await cachedRow.boundingBox();
  await cachedRow.evaluate((element) => { window.originalCacheRow = element; });
  currentAutomation = { ...automation, checkedAt: 2, items: [{ ...item, name: "Updated automation" }] };
  automationGate.resolve();
  const updatedRow = page.getByRole("button", { name: /Updated automation/ }).first();
  await updatedRow.waitFor();
  assert.equal(await updatedRow.evaluate((element) => element === window.originalCacheRow), true, "stable key preserves DOM");
  const after = await updatedRow.boundingBox();
  assert.ok(Math.abs(before.y - after.y) < 1 && Math.abs(before.height - after.height) < 1, "refresh does not move row");
  await page.getByRole("link", { name: "群聊", exact: true }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get("view") === "group");
  assert.equal(directoryCalls, 1, "group and conversation share pending directory request");
  directoryGate.resolve();
  // Reload restores the latest cached automation.
  await page.goto("http://127.0.0.1:9360/?view=desktop", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Updated automation/ }).first().waitFor();
  // Background session refresh must not drag a reader away from history.
  sessionGate = deferred();
  await page.goto("http://127.0.0.1:9360/?view=conversation&thread=" + threadId, { waitUntil: "domcontentloaded" });
  await page.getByText("Message 35", { exact: false }).first().waitFor();
  await page.waitForFunction(() => !document.getElementById("negus-launch"));
  const scroll = page.locator('[class*="scroll"]').filter({ has: page.getByText("Message 35", { exact: false }) }).last();
  // Locate the actual scrolling ancestor rather than relying on CSS module names.
  await page.getByText("Message 35", { exact: false }).first().evaluate((element) => {
    let node = element.parentElement;
    while (node && !(node.scrollHeight > node.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement;
    if (!node) throw new Error("Conversation scroller not found");
    window.cacheScroller = node;
    node.scrollTop = Math.max(0, node.scrollTop - 600);
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const scrollBefore = await page.evaluate(() => window.cacheScroller.scrollTop);
  freshSession = { ...session, contentVersion: 2, messages: [...messages, { ...messages[35], id: "new", text: "New background message", turnId: "new-turn" }], messageCount: 37 };
  sessionGate.resolve();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("negus-conversation-snapshot-v1")).session?.contentVersion === 2);
  const scrollAfter = await page.evaluate(() => window.cacheScroller.scrollTop);
  assert.ok(Math.abs(scrollBefore - scrollAfter) < 2, "background append preserves history position");
  await page.getByText("Completed fixture", { exact: true }).first().waitFor();
  assert.equal(await page.locator('[aria-label="Codex 工作过程"]').count(), 0, "historical completion must not insert a process row");
  await page.evaluate(({ threadId, status }) => {
    for (const source of window.fixtureSources) source.onmessage?.({ data: JSON.stringify({ ...status, type: "execution_status", threadId, phase: "working", active: true, label: "Working fixture" }) });
  }, { threadId, status });
  await page.getByText("Working fixture", { exact: true }).first().waitFor();
  await page.evaluate((status) => {
    for (const source of window.fixtureSources) source.onmessage?.({ data: JSON.stringify({ ...status, type: "execution_status" }) });
  }, status);
  await page.locator('[aria-label="Codex 工作过程"]').getByText("Completed fixture", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [], "test never attempts to send or create a task");
  reports.push({ viewport: mobile ? "390x844" : "1280x900", sharedAutomationRequest: true, sharedDirectoryRequest: true, stableRow: true, scrollBefore, scrollAfter });
  await context.close();
 }
 console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
