import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createCcSwitchConfigService } from "../server/cc-switch-config-service.mjs";
import { createModelProviderService } from "../server/model-provider-service.mjs";
import { createProviderProbe } from "../server/provider-probe.mjs";
import { createSystemRoutes } from "../server/routes/system-routes.mjs";

const fixture = async (t, options = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-provider-boundaries-"));
  const shared = createCcSwitchConfigService({ database: path.join(root, "cc.db") });
  const rows = {};
  for (const name of ["alpha", "native", "owned", "race", "busy"]) {
    rows[name] = (await shared.save({ name, model: "fixture-model", baseUrl: "https://example.invalid/" + name, apiKey: "fixture-" + name })).id;
  }
  const providers = createModelProviderService({
    projectRoot: root,
    sharedConfig: { ...shared, ...(options.sharedOverrides?.(shared) || {}) },
    currentApiConfiguration: async () => ({ key: "fixture-native", baseUrl: "https://example.invalid/native" }),
    fetchModels: async () => Response.json({ data: [] }),
    ...options.providers,
  });
  t.after(async () => { providers.close(); await fs.rm(root, { recursive: true, force: true }); });
  const system = createSystemRoutes({ projectRoot: root, modelProviders: providers });
  const post = async (pathname, body) => {
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: "POST" });
    let payload;
    const response = { setHeader() {}, writeHead() {}, end(text) { payload = JSON.parse(text); } };
    try { await system(request, response, new URL(pathname, "http://localhost")); return payload; }
    catch (error) { return { status: error.statusCode, error: error.message }; }
  };
  const id = name => "ccswitch_" + rows[name];
  const catalog = (action, body) => post("/api/model-channels/catalog", { action, ...body }).then(result => result.results[0]);
  const remove = name => post("/api/model-channels", { action: "delete", id: rows[name] });
  const has = async name => (await shared.list(undefined, { force: true })).some(row => row.id === rows[name]);
  return { providers, id, rows, catalog, remove, has, root };
};

test("目录和探测拒绝 200 业务失败，刷新与删除确认均保留隔离库", async t => {
  let payload = { data: [{ id: "fixture-model" }] };
  const f = await fixture(t, { providers: { fetchModels: async () => Response.json(payload) } });
  const refresh = () => f.catalog("refresh", { providerId: f.id("alpha") });
  assert.equal((await refresh()).count, 1);
  const filename = path.join(f.root, "runtime/model-providers/model-catalog.json");
  const original = await fs.readFile(filename, "utf8");
  const probe = createProviderProbe({ resolveDraft: async () => ({ baseUrl: "https://example.invalid", key: "fixture" }),
    fetchImpl: async () => Response.json(payload) });
  for (const failure of [{ success: false }, { error: { message: "fixture" } }, { status: "failed" }]) {
    payload = { ...failure, data: [] };
    const result = await refresh();
    assert.match(result.error, /供应商未成功/);
    assert.equal(result.ticket, undefined);
    await assert.rejects(probe({ action: "discover" }), /供应商未成功/);
  }
  assert.equal(await fs.readFile(filename, "utf8"), original);
  assert.equal(await f.has("alpha"), true);
  payload = { success: true, data: [] };
  const { ticket } = await refresh();
  assert.ok(ticket);
  const empty = await fs.readFile(filename, "utf8");
  payload = { success: false, data: [] };
  const refused = await f.catalog("delete-empty", { tickets: [ticket] });
  assert.match(refused.error, /供应商未成功/);
  assert.equal(await fs.readFile(filename, "utf8"), empty);
  assert.equal(await f.has("alpha"), true);
  payload = { data: [] };
  const valid = await refresh();
  assert.equal((await f.catalog("delete-empty", { tickets: [valid.ticket] })).deleted, true);
  assert.equal(await f.has("alpha"), false);
});

test("真实直连直到响应体完成均占用，多个请求独立释放，删除先获得占用时拦截新请求", async t => {
  const body = [Promise.withResolvers(), Promise.withResolvers()];
  const entered = [Promise.withResolvers(), Promise.withResolvers()];
  const removing = Promise.withResolvers(), releaseDelete = Promise.withResolvers();
  let requestCount = 0;
  const f = await fixture(t, {
    providers: { fetchResponse: async () => {
      const index = requestCount++;
      return { ok: true, json: async () => { entered[index].resolve(); return body[index].promise; } };
    }},
    sharedOverrides: shared => ({ remove: async (id, version) => {
      removing.resolve();
      await releaseDelete.promise;
      return shared.remove(id, version);
    }}),
  });
  const connect = name => f.providers.complete({ model: "fixture-model", modelProviderId: f.id(name) });
  const direct = connect("busy");
  const failing = connect("busy");
  await Promise.all(entered.map(gate => gate.promise));
  try {
    assert.equal((await f.remove("busy")).status, 409);
    body[0].resolve({ output: [{ content: [{ text: "fixture complete" }] }] });
    assert.equal((await direct).text, "fixture complete");
    assert.equal((await f.remove("busy")).status, 409);
    body[1].reject(new Error("fixture body interrupted"));
    await assert.rejects(failing, /没有返回文本/);
    assert.equal(await f.has("busy"), true);
    const deleting = f.remove("busy");
    await removing.promise;
    await assert.rejects(connect("busy"), /正在删除或已不存在/);
    await assert.rejects(f.providers.getClient({ modelProviderId: f.id("busy") }), /正在删除或已不存在/);
    assert.equal(requestCount, 2);
    releaseDelete.resolve();
    assert.equal((await deleting).deleted, true);
    assert.equal(await f.has("busy"), false);
  } finally {
    body.forEach(gate => gate.resolve({})); releaseDelete.resolve();
    await Promise.allSettled([direct, failing]);
  }
});

test("真实原生匹配和已获得的原生客户端受保护，受控关闭客户端后允许删共享行", async t => {
  let closed = 0;
  const f = await fixture(t, { providers: { createClient: () => ({ close: () => closed++ }) } });
  assert.equal((await f.remove("native")).status, 409);
  assert.equal(await f.has("native"), true);
  await f.providers.getClient({ modelProviderId: f.id("owned") });
  assert.equal((await f.remove("owned")).status, 409);
  assert.equal(await f.has("owned"), true);
  f.providers.close();
  assert.equal(closed, 1);
  assert.equal((await f.remove("owned")).deleted, true);
  assert.equal(await f.has("owned"), false);
  assert.equal((await f.remove("native")).status, 409);
});

test("删除成功后迟到的共享配置读不能把行复活", async t => {
  const captured = Promise.withResolvers(), release = Promise.withResolvers();
  let stall = false, realShared;
  const f = await fixture(t, { sharedOverrides: shared => {
    realShared = shared;
    return { runtimeProviders: async options => {
      const snapshot = await shared.runtimeProviders(options);
      if (stall) { captured.resolve(); await release.promise; }
      return snapshot;
    }};
  } });
  await f.providers.refreshShared();
  stall = true;
  const stale = f.providers.refreshShared({ force: true });
  try {
    await captured.promise;
    await f.providers.removeSharedProvider(f.id("race"), () => realShared.remove(f.rows.race));
    assert.equal(await f.has("race"), false);
  } finally {
    stall = false;
    release.resolve();
    await stale;
  }
  assert.equal(f.providers.providers().some(provider => provider.id === f.id("race")), false);
});
