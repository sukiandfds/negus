import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createCcSwitchConfigService } from "../../windows/server/cc-switch-config-service.mjs";
import { createFushengUsageService } from "../../windows/server/fusheng-usage-service.mjs";
import { createModelProviderService } from "../../windows/server/model-provider-service.mjs";
import { createSystemRoutes } from "../../windows/server/routes/system-routes.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const reviewOnly = process.argv.includes("--review-fixes");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH
  || "/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root,
  configFile: false,
  esbuild: { jsx: "automatic" },
  define: { __APP_BUILD_ID__: JSON.stringify("fixture-refresh") },
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await vite.listen();
const address = vite.httpServer.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") pageErrors.push(message.text()); });

const stamp = "2026-11-19T02:00:00.000Z";
const threadId = "thread-refresh";
const calls = [];
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "negus-config-browser-"));
const database = path.join(fixtureRoot, "cc-switch.db");
const sharedConfig = createCcSwitchConfigService({ database });
const rows = {};
for (const name of ["alpha", "vip", "grok", "empty", "unauthorized", "forbidden", "slow", "bad", "inuse", "same1", "same2"]) {
  rows[name] = (await sharedConfig.save({ name: name.startsWith("same") ? "同名" : name, baseUrl: `https://fushengyunsuan.cn/${name}`,
    model: name === "alpha" ? "gpt-6.1-sol" : name === "same1" ? "" : name === "grok" ? "grok-4.7" : `gpt-${name}`,
    apiKey: "synthetic-" + name })).id;
}
let catalog = ["gpt-6.1-sol", "gpt-extra"];
let price = 0.12;
let alphaError = false;
let alphaBusinessFailure = false;
let emptyBusinessFailure = false;
let nativeReads = 0;
let accountStatus = 401;
let delayedList;
let legacyBackend = false;
const isActive = id => id === 'ccswitch_' + rows.inuse;
const credentialsFile = path.join(fixtureRoot, "account.json");
await fs.writeFile(credentialsFile, JSON.stringify({ base_url: "https://fushengyunsuan.cn", user_id: 1, access_token: "synthetic-account" }));
const usage = createFushengUsageService({ credentialsFile, fetchImpl: async url => {
  if (new URL(url).pathname === "/api/pricing") return Response.json({ success: true, group_ratio: { vip: price, 临促分组: 0.10 } });
  if (new URL(url).pathname === "/api/token/") return Response.json({ data: [] }, { status: accountStatus });
  return Response.json({ data: { name: "not-a-group" } });
}});
const optionsForService = {
  projectRoot: fixtureRoot, sharedConfig,
  currentApiConfiguration: async () => ({ baseUrl: "https://fushengyunsuan.cn/vip", key: "synthetic-vip", name: "native" }),
  fetchModels: async url => {
    const name = new URL(url).pathname.split("/")[1];
    if (name === "vip") nativeReads++;
    if (name === "slow") throw new DOMException("fixture deadline", "TimeoutError");
    if (name === "bad") return Response.json({ data: [{}] });
    if ((name === "alpha" && alphaBusinessFailure) || (name === "empty" && emptyBusinessFailure)) {
      return Response.json({ success: false, error: "fixture", data: [] });
    }
    if (name === "unauthorized" || (name === "alpha" && alphaError)) return Response.json({}, { status: 401 });
    if (name === "forbidden") return Response.json({}, { status: 403 });
    const ids = name === "alpha" ? catalog : name === "same1" ? (reviewOnly ? ["gpt-5.6-terra"] : ["gpt-first", "gpt-second", ...(employeeModelPublished ? ["gpt-6.2-sol"] : [])])
      : name === "same2" ? ["gpt-same2"] : [];
    return Response.json({ data: ids.map(id => ({ id })) });
  },
};
const providers = createModelProviderService(optionsForService);
let systemRoutes = createSystemRoutes({ projectRoot: fixtureRoot, modelProviders: { ...providers, isInUse: isActive }, fushengUsage: usage });
const keyed = (name, model) => `ccswitch_${rows[name]}::${model}`;
const sourceModel = keyed("alpha", "gpt-6.1-sol");
const sessions = new Map();
let copyCount = 0;
let failCopy = false;
let employeeMode = false;
let delayedEmployeeRefresh;
let employeeModelPublished = false;
let holdEmployeeSend;
let employeeFailure = false;
const employeeThread = "thread-employee";
const employeeBinding = "employee-conversation";
const scrollThread = "thread-scroll";
const scrollMessages = Array.from({ length: 20 }, (_, index) => ({
  id: "history-" + index, role: "assistant", text: "隔离历史 " + index + "\n\n" + "需要保持阅读位置的历史正文。".repeat(35),
  createdAt: new Date(Date.parse(stamp) + index * 1000).toISOString(),
}));
const summary = {
  threadId, source: "codex", sourceRevision: "r1", title: "刷新测试", cwd: "/fixture",
  updatedAt: stamp, messageCount: 1, latestUser: "", latestAssistant: "历史旧模型回复",
  latestMessage: "历史旧模型回复", model: sourceModel,
};
sessions.set(threadId, summary);
const executionStatus = { type: "execution_status", threadId, turnId: "", phase: "idle",
  active: false, activities: [], startedAt: null, label: "", detail: "", commentary: "", updatedAt: stamp };
const contextStatus = { type: "context_status", threadId, model: sourceModel,
  reasoningEffort: "high", phase: "idle", message: "", updatedAt: stamp, autoCompactThreshold: 80 };

await page.addInitScript(() => {
  const sources = [];
  window.EventSource = class {
    static CLOSED = 2;
    readyState = 1;
    constructor() { sources.push(this); setTimeout(() => this.onopen?.(), 0); }
    close() { this.readyState = 2; }
  };
  window.fixtureEvent = event => sources.forEach(source => source.onmessage?.({ data: JSON.stringify(event) }));
});
await page.route("**/api/**", async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (!url.pathname.startsWith("/api/")) return route.continue();
  const body = request.method() === "POST" && request.headers()["content-type"]?.includes("application/json") ? request.postDataJSON() : null;
  calls.push({ path: url.pathname, method: request.method(), query: url.search, body });
  const safeReply = (json, status = 200) => route.fulfill({ json, status });
  if (legacyBackend && ["/api/model-channels/catalog", "/api/model-defaults/selection"].includes(url.pathname)) {
    return safeReply({ error: "旧版后端无此接口" }, 404);
  }
  if (url.pathname.startsWith("/api/model-channels") || url.pathname.startsWith("/api/model-defaults")) {
    if (employeeMode && body?.action === "refresh" && delayedEmployeeRefresh) {
      delayedEmployeeRefresh.started.resolve();
      await delayedEmployeeRefresh.release.promise;
      delayedEmployeeRefresh = undefined;
    }
    let payload, status;
    const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), { method: request.method() });
    const res = { setHeader() {}, writeHead(value) { status = value; }, end(value) { payload = JSON.parse(value); } };
    try {
      await systemRoutes(req, res, url);
      return safeReply(payload, status);
    } catch (error) { return safeReply({ error: error.message }, error.statusCode || 500); }
  }
  if (url.pathname === "/api/project") return safeReply({ name: "刷新项目", root: "/fixture", mode: "interactive" });
  if (url.pathname === "/api/project-directory") return safeReply({ projects: employeeMode ? [{
    id: "fixture-employee", kind: "employee", employeeId: "fixture-employee", name: "隔离员工", root: "/fixture",
    mainThreadId: employeeThread, mainConversationId: employeeBinding,
    conversations: [{ threadId: employeeThread, id: employeeThread, main: true, conversationId: employeeBinding, title: "隔离员工" }],
  }] : [] });
  if (url.pathname === "/api/employee/session") return safeReply({ threadId: employeeThread, conversationId: employeeBinding, status: executionStatus });
  if (url.pathname === "/api/sessions") return safeReply([...sessions.values()]);
  if (url.pathname === "/api/session" && request.method() === "GET") {
    const id = url.searchParams.get("threadId") || threadId;
    const entry = sessions.get(id) || summary;
    return safeReply({ session: { ...entry, messages: id === scrollThread ? scrollMessages : [{ id: "history", role: "assistant", text: "历史旧模型回复", createdAt: stamp }] },
      sourceRevision: "r1", context: { ...contextStatus, threadId: id, model: entry.model }, status: { ...executionStatus, threadId: id }, goal: null, queue: [], input: null });
  }
  if (url.pathname === "/api/models") {
    const response = await providers.listModels([]);
    if (delayedList && !delayedList.started) {
      delayedList.started = true;
      delayedList.captured.resolve();
      await delayedList.release.promise;
    }
    return safeReply(response);
  }
  if (url.pathname === "/api/session/provider-copy") {
    if (failCopy) { failCopy = false; return safeReply({ error: "隔离复制失败" }, 409); }
    copyCount++;
    const id = "thread-copy-" + copyCount;
    const session = { ...summary, threadId: id, title: "复制对话", model: body.model };
    sessions.set(id, session);
    return safeReply({ session, model: body.model, modelProvider: body.model.split("::")[0], reasoningEffort: body.reasoningEffort });
  }
  if (url.pathname === "/api/uploads") return safeReply({ id: "fixture-file", name: "evidence.txt", mimeType: "text/plain", size: 5, url: "/fixture-file" });
  if (url.pathname === "/api/group/rooms") return route.fulfill({ json: { rooms: [] } });
  if (url.pathname === "/api/session/model") {
    return route.fulfill({ json: { threadId: body.threadId, model: body.model, modelProvider: body.model.split("::")[0], reasoningEffort: body.reasoningEffort || "" } });
  }
  if (url.pathname === "/api/session/message") {
    if (employeeMode && body.threadId === employeeThread) {
      if (holdEmployeeSend) await holdEmployeeSend.promise;
      if (employeeFailure) {
        employeeFailure = false;
        return safeReply({ error: "隔离员工切换失败" }, 502);
      }
    }
    return route.fulfill({ json: { threadId: body.threadId, turnId: "fixture-turn", status: "accepted" } });
  }
  return route.fulfill({ json: {} });
});

const settings = page.getByRole("dialog", { name: "模型设置" });
const openModels = async () => {
  if (!await settings.isVisible()) await page.locator('.chat-composer button[aria-haspopup="dialog"]:visible').first().click();
  await settings.waitFor();
};
const options = () => settings.getByLabel("切换模型").locator("option").allTextContents();
const choose = (model) => settings.getByLabel("切换模型").selectOption(model);
const pencil = () => settings.getByRole("button", { name: "编辑配置" }).click();
const manager = page.locator("dialog[open]").filter({ has: page.getByRole("heading", { name: "配置", exact: true }) });
const draft = page.locator(".chat-composer textarea:visible");
const writes = () => calls.filter(call => call.method === "POST" && (call.path.includes("/session/") || call.path === "/api/model-channels" || call.path === "/api/uploads"));
const checkDraft = async () => {
  assert.equal(await draft.inputValue(), "隔离草稿");
  await page.getByLabel("取消引用").waitFor();
  await page.getByText("evidence.txt", { exact: true }).waitFor();
};
const waitOption = text => settings.getByRole("option", { name: text, exact: true }).waitFor({ state: "attached" });
const verifyReviewFixes = async () => {
  await providers.refreshProviderModels("ccswitch_" + rows.same1);
  await providers.refreshProviderModels("ccswitch_" + rows.alpha);
  await page.goto(base + "/?thread=" + threadId);
  await page.getByText("历史旧模型回复", { exact: true }).waitFor();
  await openModels();
  const emptyDialog = page.getByRole("dialog", { name: "无可用模型的配置" });
  const businessError = /供应商未成功返回模型目录/;
  alphaBusinessFailure = true;
  await settings.getByRole("button", { name: "刷新配置模型" }).click();
  await settings.getByText(businessError).waitFor();
  assert.equal(await emptyDialog.count(), 0);
  await waitOption("GPT-6.1 Sol");
  assert.ok((await providers.listModels()).some(row => row.model === sourceModel));
  assert.ok((await sharedConfig.list(undefined, { force: true })).some(row => row.id === rows.alpha));
  await settings.getByLabel("配置", { exact: true }).selectOption("ccswitch_" + rows.empty);
  await settings.getByRole("button", { name: "刷新配置模型" }).click();
  const confirmDelete = emptyDialog.getByRole("button", { name: "确认删除 1 个配置" });
  await confirmDelete.waitFor();
  emptyBusinessFailure = true;
  await confirmDelete.click();
  await emptyDialog.getByText(businessError).waitFor();
  assert.ok((await sharedConfig.list(undefined, { force: true })).some(row => row.id === rows.empty));
  await emptyDialog.getByRole("button", { name: "关闭", exact: true }).click();
  console.log("PASS 真实输入框刷新业务失败保留上次成功目录且不弹删除窗，确认时业务失败保留 SQLite 行");

  await openModels();
  await settings.getByLabel("配置", { exact: true }).selectOption("ccswitch_" + rows.same1);
  const target = keyed("same1", "gpt-5.6-terra");
  assert.equal(await settings.getByLabel("切换模型").inputValue(), target);
  await settings.getByLabel("推理强度").selectOption("high");
  await page.locator('.chat-composer button[aria-haspopup="dialog"]:visible').first().click();
  await page.getByLabel("引用这条消息").first().click({ force: true });
  await draft.fill("隔离草稿");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "evidence.txt", mimeType: "text/plain", buffer: Buffer.from("draft") });
  await checkDraft();
  const firstPost = calls.filter(call => call.method === "POST").length;
  const queue = page.getByRole("button", { name: "等候队列", exact: true });
  const switchDialog = page.getByRole("dialog", { name: "切换模型配置" });
  await queue.click();
  await page.getByRole("button", { name: "加入等候队列", exact: true }).click();
  await page.getByText("切换配置需要先退出等候队列模式，再点击发送", { exact: true }).waitFor();
  assert.equal(await page.getByText(/当前任务运行中/).count(), 0);
  assert.equal(await switchDialog.count(), 0);
  await checkDraft();
  assert.equal(calls.filter(call => call.method === "POST").length, firstPost);
  await queue.click();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await switchDialog.getByRole("button", { name: "取消", exact: true }).click();
  await checkDraft();
  assert.equal(calls.filter(call => call.method === "POST").length, firstPost);
  await openModels();
  assert.equal(await settings.getByLabel("切换模型").inputValue(), target);
  assert.equal(await settings.getByLabel("推理强度").inputValue(), "high");
  await draft.press("Enter");
  const sent = page.waitForResponse(response => new URL(response.url()).pathname === "/api/session/message");
  await switchDialog.getByRole("button", { name: "创建新对话" }).click();
  const message = (await sent).request().postDataJSON();
  assert.equal(message.threadId, "thread-copy-1");
  assert.match(message.text, /隔离草稿/);
  assert.match(message.text, /历史旧模型回复/);
  assert.ok(JSON.stringify(message).includes("fixture-file"));
  assert.equal(copyCount, 1);
  assert.equal(calls.filter(call => call.path === "/api/session/message").length, 1);
  const copy = calls.find(call => call.path === "/api/session/provider-copy");
  assert.equal(copy.body.model, target);
  assert.equal(copy.body.reasoningEffort, "high");
  console.log("PASS 空闲跨配置显式排队按实际原因反馈，保留完整草稿且零提交，退出队列后按钮和回车均确认，取消后仍可确认并只发送一次");
};
try {
  if (reviewOnly) {
    await verifyReviewFixes();
  } else {
  await page.goto(`${base}/?thread=${threadId}`);
  await page.getByText("历史旧模型回复", { exact: true }).waitFor();
  await openModels();
  await waitOption("GPT-6.1 Sol");
  await page.getByLabel("引用这条消息").first().click({ force: true });
  await draft.fill("隔离草稿");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "evidence.txt", mimeType: "text/plain", buffer: Buffer.from("draft") });
  await checkDraft();
  await openModels();
  catalog = ["gpt-5.6-sol", "gpt-extra"];
  await settings.getByRole("button", { name: "刷新配置模型" }).click();
  await waitOption("GPT-5.6 Sol");
  assert.ok(!(await options()).includes("GPT-6.1 Sol"));
  await page.getByText("所选模型已下架，请换一个模型", { exact: true }).waitFor();
  assert.equal(writes().length, 0);
  await draft.press("Enter");
  await checkDraft();
  assert.equal(writes().length, 0);
  await openModels();
  await choose(keyed("alpha", "gpt-5.6-sol"));
  await settings.getByLabel("推理强度").selectOption("high");
  await pencil();
  await manager.getByText("ccswitch供codex使用中", { exact: true }).waitFor();
  assert.equal(await manager.getByText("vip", { exact: true }).count(), 1);
  assert.equal(await manager.getByText("同名", { exact: true }).count(), 2);
  await manager.getByText("vip 0.12×").waitFor();
  await manager.getByRole("button", { name: "返回", exact: true }).click();
  assert.equal(await settings.getByLabel("切换模型").inputValue(), keyed("alpha", "gpt-5.6-sol"));
  assert.equal(await settings.getByLabel("推理强度").inputValue(), "high");
  assert.equal(await settings.getByLabel("配置", { exact: true }).inputValue(), "ccswitch_" + rows.alpha);
  await checkDraft();
  assert.equal(writes().length, 0);
  console.log("PASS 下架阻断。铅笔往返保留配置、模型、等级、文字、引用、附件，零写入");

  await settings.getByLabel("配置", { exact: true }).selectOption("ccswitch_" + rows.empty);
  await settings.getByRole("button", { name: "刷新配置模型" }).click();
  const singleEmpty = page.getByRole("dialog", { name: "无可用模型的配置" });
  await singleEmpty.getByRole("button", { name: "确认删除 1 个配置" }).waitFor();
  assert.equal(await singleEmpty.locator("li").count(), 1);
  await singleEmpty.getByRole("button", { name: "取消", exact: true }).click();
  await settings.getByLabel("配置", { exact: true }).selectOption("ccswitch_" + rows.alpha);
  console.log("PASS 输入框单个成功空目录只开一个确认窗");

  await pencil();
  catalog = ["gpt-5.6-terra", "gpt-extra"];
  price = 0.27;
  await manager.getByRole("button", { name: "刷新配置", exact: true }).click();
  const empty = page.getByRole("dialog", { name: "无可用模型的配置" });
  await empty.waitFor();
  const text = await empty.innerText();
  assert.match(text, /grok/);
  assert.match(text, /empty/);
  assert.match(text, /inuse.*使用/);
  assert.match(text, /vip.*正在使用/);
  assert.doesNotMatch(text, /unauthorized|forbidden|slow|bad/);
  await empty.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(calls.filter(call => call.body?.action === "delete-empty").length, 0);
  assert.ok((await sharedConfig.list(undefined, { force: true })).some(row => row.id === rows.grok));
  await manager.getByText("vip 0.27×").waitFor();
  await manager.getByText(/密钥失效.*无权访问.*超时.*响应格式错误/).waitFor();
  await manager.getByRole("button", { name: "刷新配置", exact: true }).click();
  await empty.getByRole("button", { name: "确认删除 2 个配置" }).click();
  await empty.getByText("grok · CC Switch 共享 · 已删除").waitFor();
  await empty.getByRole("button", { name: "关闭", exact: true }).click();
  const remaining = await sharedConfig.list(undefined, { force: true });
  assert.ok(!remaining.some(row => row.id === rows.grok || row.id === rows.empty));
  assert.ok(remaining.some(row => row.id === rows.vip) && remaining.some(row => row.id === rows.inuse));
  assert.equal(calls.filter(call => call.body?.action === "delete-empty").length, 1);
  await manager.getByRole("button", { name: "返回", exact: true }).click();
  await waitOption("GPT-5.6 Terra");
  assert.equal(await settings.getByLabel("切换模型").inputValue(), "");
  await checkDraft();
  console.log("PASS 批量空目录取消零删除，一次确认删隔离库两条，保护项和四类错误，公开价表 0.12→0.27");

  alphaError = true;
  await settings.getByRole("button", { name: "刷新配置模型" }).click();
  await settings.getByText(/密钥失效/).waitFor();
  assert.ok((await options()).includes("GPT-5.6 Terra"));
  alphaError = false;
  await settings.getByLabel("配置", { exact: true }).selectOption("ccswitch_" + rows.same1);
  assert.equal(await settings.getByLabel("切换模型").inputValue(), keyed("same1", "gpt-first"));
  const running = { ...executionStatus, phase: "working", active: true, turnId: "ordinary-active", updatedAt: new Date().toISOString() };
  await page.evaluate(event => window.fixtureEvent(event), running);
  await page.getByText("助手正在运行...", { exact: true }).first().waitFor();
  await draft.press("Enter");
  await page.getByText("当前任务运行中，请完成后再发送到其他配置", { exact: true }).waitFor();
  await checkDraft();
  assert.equal(writes().length, 0);
  await page.evaluate(event => window.fixtureEvent(event), { ...running, phase: "completed", active: false, updatedAt: new Date().toISOString() });
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  console.log("PASS 普通在途时跨配置发送零写入，草稿保留");

  await draft.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "切换模型配置" });
  await confirmation.waitFor();
  await checkDraft();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await checkDraft();
  assert.equal(writes().length, 0);
  await draft.press("Enter");
  failCopy = true;
  await confirmation.getByRole("button", { name: "创建新对话" }).click();
  await confirmation.getByText("隔离复制失败").waitFor();
  await checkDraft();
  const sent = page.waitForResponse(response => new URL(response.url()).pathname === "/api/session/message");
  await confirmation.getByRole("button", { name: "创建新对话" }).click();
  const submitted = (await sent).request().postDataJSON();
  assert.equal(copyCount, 1);
  assert.equal(submitted.threadId, "thread-copy-1");
  assert.match(submitted.text, /隔离草稿/);
  assert.match(submitted.text, /历史旧模型回复/);
  assert.ok(JSON.stringify(submitted).includes("fixture-file"));
  assert.equal(calls.filter(call => call.path === "/api/session/message").length, 1);
  console.log("PASS 刷新失败保留，首个模型，普通跨配置取消/失败保留草稿，重试创建并发送一次");

  await openModels();
  await pencil();
  const defaultBefore = calls.filter(call => call.path === "/api/model-defaults/selection" && call.method === "POST").length;
  await manager.getByRole("button", { name: "操作 同名" }).first().click();
  await manager.getByRole("menuitem", { name: "设为默认" }).click();
  assert.equal(calls.filter(call => call.path === "/api/model-defaults/selection" && call.method === "POST").length, defaultBefore);
  const defaultsFile = path.join(fixtureRoot, "runtime/model-defaults.json");
  await fs.writeFile(defaultsFile, JSON.stringify({ providerId: "ccswitch_" + rows.alpha, model: keyed("alpha", "gpt-5.6-terra"), effort: "", archivedProviderIds: ["previous-archive", "concurrent-archive"] }));
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/model-defaults/selection" && response.request().method() === "POST");
  await manager.getByRole("button", { name: "保存", exact: true }).click();
  const saveResponse = await saved;
  assert.equal(saveResponse.status(), 200);
  assert.equal(Object.hasOwn(saveResponse.request().postDataJSON(), "archivedProviderIds"), false);
  assert.deepEqual(JSON.parse(await fs.readFile(defaultsFile, "utf8")).archivedProviderIds, ["previous-archive", "concurrent-archive"]);
  console.log("PASS 默认选择须保存，真实请求只提交选择，最新归档保留");

  await manager.getByRole("button", { name: "返回", exact: true }).click();
  await page.goto(`${base}/?thread=${threadId}`);
  await openModels();
  assert.equal(await settings.getByLabel("切换模型").inputValue(), keyed("same1", "gpt-first"), "original thread remembers its draft across reload");
  await page.context().setOffline(true);
  await settings.getByLabel("配置", { exact: true }).selectOption("ccswitch_" + rows.alpha);
  await choose(keyed("alpha", "gpt-5.6-terra"));
  assert.equal(await settings.getByLabel("切换模型").inputValue(), keyed("alpha", "gpt-5.6-terra"));
  await page.context().setOffline(false);
  console.log("PASS 会话模型草稿重开保留，真实浏览器断网时可选缓存目录");

  await pencil();
  delayedList = { captured: Promise.withResolvers(), release: Promise.withResolvers() };
  await page.evaluate(() => window.dispatchEvent(new Event("negus-channels-updated")));
  await delayedList.captured.promise;
  catalog = ["gpt-5.6-terra", "gpt-6.1-terra"];
  await fs.rm(credentialsFile);
  price = 0.31;
  const batchResult = page.waitForResponse(response => new URL(response.url()).pathname === "/api/model-channels/catalog");
  await manager.getByRole("button", { name: "刷新配置", exact: true }).click();
  await batchResult;
  delayedList.release.resolve();
  await page.getByRole("dialog", { name: "无可用模型的配置" }).getByRole("button", { name: "关闭", exact: true }).click();
  await manager.getByText("vip 0.31×").waitFor();
  await fs.writeFile(credentialsFile, JSON.stringify({ base_url: "https://fushengyunsuan.cn", user_id: 1, access_token: "synthetic-account" }));
  accountStatus = 200;
  price = 0.22;
  await manager.getByRole("button", { name: "刷新配置", exact: true }).click();
  await page.getByRole("dialog", { name: "无可用模型的配置" }).getByRole("button", { name: "关闭", exact: true }).click();
  await manager.getByText("vip 0.22×").waitFor();
  assert.equal(await manager.getByText(/not-a-group/).count(), 0);
  await manager.getByRole("button", { name: "返回", exact: true }).click();
  await waitOption("GPT-6.1 Terra");
  assert.ok(!(await options()).includes("GPT-Extra"));
  console.log("PASS 迟到读没有覆盖刷新后的目录，无账号和账号恢复后继续显示实时公开倍率");

  await pencil();
  legacyBackend = true;
  const oldSelections = calls.filter(call => call.path === "/api/model-defaults" && call.method === "POST").length;
  await manager.getByRole("button", { name: "操作 alpha", exact: true }).click();
  await manager.getByRole("menuitem", { name: "设为默认" }).click();
  await manager.getByRole("button", { name: "保存", exact: true }).click();
  await manager.getByText("旧版后端无此接口", { exact: true }).waitFor();
  assert.equal(calls.filter(call => call.path === "/api/model-defaults" && call.method === "POST").length, oldSelections);
  await manager.getByRole("button", { name: "刷新配置", exact: true }).click();
  await manager.getByText("旧版后端无此接口", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "无可用模型的配置" }).count(), 0);
  legacyBackend = false;
  page.once("dialog", dialog => dialog.accept());
  await manager.getByRole("button", { name: "返回", exact: true }).click();
  console.log("PASS 新前端遇到旧版后端时不回退到旧默认写入，不弹空目录删除确认");

  const nextProviders = createModelProviderService(optionsForService);
  const models = await nextProviders.listModels([]);
  assert.ok(models.some(row => row.model === keyed("alpha", "gpt-5.6-terra")));
  assert.ok(!models.some(row => row.model === sourceModel || row.modelProviderId === "ccswitch_" + rows.grok));
  const stored = JSON.parse(await fs.readFile(path.join(fixtureRoot, "runtime/model-providers/model-catalog.json"), "utf8"));
  assert.ok(stored["ccswitch_" + rows.vip] && !stored.current);
  const count = nativeReads;
  await Promise.all([providers.refreshProviderModels("current"), providers.refreshProviderModels("ccswitch_" + rows.vip)]);
  assert.equal(nativeReads, count + 1);
  console.log("PASS 重载目录，已删配置不复活，原生/共享别名单一实际刷新");
  employeeMode = true;
  sessions.set(employeeThread, { ...summary, threadId: employeeThread, title: "隔离员工",
    conversationKind: "direct", modelProviderId: "ccswitch_" + rows.alpha, model: keyed("alpha", "gpt-5.6-terra") });
  await page.goto(`${base}/?view=conversation&agent=fixture-employee&thread=${employeeThread}&conversation=${employeeBinding}`);
  await page.locator(".chat-messages").getByText("历史旧模型回复", { exact: true }).waitFor();
  await openModels();
  await settings.getByLabel("配置", { exact: true }).selectOption("ccswitch_" + rows.same1);
  const employeeRefresh = { started: Promise.withResolvers(), release: Promise.withResolvers() };
  delayedEmployeeRefresh = employeeRefresh;
  employeeModelPublished = true;
  const priorCatalogRequests = calls.length;
  await settings.getByRole("button", { name: "刷新配置模型" }).click();
  await employeeRefresh.started.promise;
  // Simulate the active URL changing while the provider responds. The request still owns its originating catalog.
  const employeeUrl = page.url();
  await page.evaluate(thread => history.replaceState(null, "", `/?thread=${thread}`), threadId);
  const refreshed = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === "/api/models" && url.searchParams.get("conversationId") === employeeBinding; });
  employeeRefresh.release.resolve();
  assert.equal(new URL((await refreshed).url()).searchParams.get("conversationId"), employeeBinding);
  await page.evaluate(url => history.replaceState(null, "", url), employeeUrl);
  await waitOption("GPT-6.2 Sol");
  await choose(keyed("same1", "gpt-6.2-sol"));
  await settings.getByLabel("推理强度").selectOption("high");
  assert.equal(await settings.getByLabel("推理强度").inputValue(), "high");
  assert.equal(calls.slice(priorCatalogRequests).filter(call => call.path.startsWith("/api/session/") && call.method === "POST").length, 0);
  await draft.fill("员工隔离跨配置");
  holdEmployeeSend = Promise.withResolvers();
  employeeFailure = true;
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const switching = page.getByRole("status").filter({ hasText: /正在切换至.*gpt-6.2-sol/ });
  await switching.waitFor();
  assert.equal(await switching.locator("svg").count(), 1);
  await page.locator("article").filter({ hasText: "员工隔离跨配置" }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "切换模型配置" }).count(), 0);
  const outgoing = page.waitForResponse(response => new URL(response.url()).pathname === "/api/session/message");
  holdEmployeeSend.resolve();
  const employeeResponse = await outgoing;
  assert.equal(employeeResponse.request().postDataJSON().threadId, employeeThread);
  assert.equal(employeeResponse.status(), 502);
  const failed = page.getByRole("status").filter({ hasText: "模型切换失败" });
  await failed.waitFor();
  assert.equal(await failed.locator("svg").count(), 0);
  holdEmployeeSend = Promise.withResolvers();
  const retried = page.waitForRequest(request => new URL(request.url()).pathname === "/api/session/message");
  await page.getByRole("button", { name: "重新确认指令" }).click();
  const retryBody = (await retried).postDataJSON();
  await switching.waitFor();
  await page.evaluate(event => window.fixtureEvent(event), { type: "employee_model_switched", threadId: employeeThread,
    model: "gpt-6.2-sol", modelProviderId: "ccswitch_" + rows.same1, submissionId: retryBody.submissionId, updatedAt: new Date().toISOString() });
  const switched = page.getByRole("status").filter({ hasText: "已切换至 gpt-6.2-sol" });
  await switched.waitFor();
  assert.equal(await switched.locator("svg").count(), 0);
  holdEmployeeSend.resolve();
  assert.equal(retryBody.threadId, employeeThread);
  const employeeSettings = calls.filter(call => call.path === "/api/session/model" && call.body?.threadId === employeeThread);
  assert.equal(employeeSettings.at(-1).body.model, keyed("same1", "gpt-6.2-sol"));
  assert.equal(employeeSettings.at(-1).body.reasoningEffort, "high");
  assert.equal(employeeSettings.at(-1).body.conversationId, employeeBinding);
  assert.equal(await switched.evaluate(node => !node.closest("article") && getComputedStyle(node).justifyContent === "center"), true);
  assert.equal(copyCount, 1, "ordinary copy was the only provider-copy call");
  console.log("PASS 员工真实控件，跨配置即时原文，独立切换提示启动、失败、重试及成功，保持可见对话 ID");
  employeeMode = false;
  sessions.set(scrollThread, { ...summary, threadId: scrollThread, title: "隔离历史滚动", messageCount: scrollMessages.length });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/?view=conversation&thread=${scrollThread}`);
  const mobileThread = page.getByRole("region", { name: "真实项目对话" }).filter({ hasText: "隔离历史 19" });
  await mobileThread.waitFor();
  const scroller = mobileThread.locator("..");
  const distance = () => scroller.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop);
  await scroller.evaluate(node => { window.fixtureScroller = node; });
  await page.waitForFunction(() => {
    const node = window.fixtureScroller;
    return node.scrollHeight > node.clientHeight + 600 && node.scrollHeight - node.clientHeight - node.scrollTop <= 2;
  });
  const append = async id => {
    await page.evaluate(event => window.fixtureEvent(event), { type: "assistant_message_completed", threadId: scrollThread,
      message: { id, role: "assistant", text: id, createdAt: new Date().toISOString() } });
    await mobileThread.getByText(id, { exact: true }).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await append("底部追加消息");
  assert.ok(await distance() <= 2, "底部继续跟随");
  await scroller.evaluate(node => { node.scrollTop -= 450; });
  await page.getByRole("button", { name: /回到最新|回到底部/ }).waitFor();
  const readingTop = await scroller.evaluate(node => node.scrollTop);
  await append("浏览历史时追加消息");
  assert.ok(Math.abs(await scroller.evaluate(node => node.scrollTop) - readingTop) <= 2, "阅读历史时保持位置");
  await page.getByRole("button", { name: /回到最新|回到底部/ }).click();
  await page.waitForFunction(() => {
    const node = window.fixtureScroller;
    return node.scrollHeight - node.clientHeight - node.scrollTop <= 2;
  });
  console.log("PASS 手机宽度下初次定位底部、底部跟随、阅读历史位置和返回底部");
  nextProviders.close();
  }
  assert.deepEqual(pageErrors.filter(e => !e.includes("409") && !e.includes("502") && !e.includes("404")), []);
} catch (error) {
  console.error("PAGE ERRORS", pageErrors);
  console.error("LAST TEST ROUTES", calls.filter(call => call.method === "POST").slice(-9).map(call => call.path));
  console.error("BODY", (await page.locator("body").innerText()).slice(0, 6000));
  throw error;
} finally {
  await browser.close();
  await vite.close();
  providers.close();
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
