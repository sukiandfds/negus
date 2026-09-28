import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "../../web-ui/node_modules/typescript/lib/typescript.js";

const source = await fs.readFile(new URL("../../web-ui/src/shared/state/localCache.ts", import.meta.url), "utf8");
const moduleUrl = (text) => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64");
const cacheUrl = moduleUrl(source);
const { createCachedResource } = await import(cacheUrl);
const storage = new Map();
globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
const valid = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const seed = (key, value) => storage.set(key, JSON.stringify({ version: 1, value }));
const tick = () => new Promise(setImmediate);

test("cached empty list is loaded data; malformed and incompatible caches are ignored", () => {
  seed("empty", []);
  assert.deepEqual(createCachedResource("empty", valid).getSnapshot().data, []);
  storage.set("broken", "{");
  seed("wrong", 123);
  for (const key of ["missing", "broken", "wrong"]) assert.equal(createCachedResource(key, valid).getSnapshot().data, null);
});

test("two subscribers share a request; leaving one keeps the other's update", async () => {
  const resource = createCachedResource("shared", valid);
  const request = deferred(); let calls = 0, first = 0, second = 0;
  const unsubscribe = resource.subscribe(() => first++);
  resource.subscribe(() => second++);
  const load = () => { calls++; return request.promise; };
  const a = resource.refresh(load), b = resource.refresh(load);
  assert.equal(a, b);
  await tick(); unsubscribe(); const firstBefore = first;
  request.resolve(["new"]); await a;
  assert.equal(calls, 1); assert.equal(first, firstBefore); assert.ok(second > first);
  assert.deepEqual(resource.getSnapshot().data, ["new"]);
});

test("refresh preserves content and identical data retains object identity", async () => {
  seed("stable", ["visible"]);
  const resource = createCachedResource("stable", valid), before = resource.getSnapshot().data;
  const request = deferred(), loading = resource.refresh(() => request.promise);
  await tick();
  assert.equal(resource.getSnapshot().data, before);
  assert.equal(resource.getSnapshot().refreshing, true);
  request.resolve(["visible"]); await loading;
  assert.equal(resource.getSnapshot().data, before);
  assert.equal(resource.getSnapshot().refreshing, false);
});

test("invalidation rejects stale completion and coalesces repeated invalidations", async () => {
  seed("invalidate", ["cached"]);
  const resource = createCachedResource("invalidate", valid), first = deferred(), second = deferred();
  const observed = [];
  resource.subscribe(() => observed.push(resource.getSnapshot().data?.[0]));
  const loading = resource.refresh(() => first.promise);
  await tick();
  let calls = 0;
  const latest = () => { calls++; return second.promise; };
  resource.refresh(latest, true); resource.refresh(latest, true);
  first.resolve(["stale"]); await tick();
  assert.equal(calls, 1); assert.ok(!observed.includes("stale"));
  assert.deepEqual(resource.getSnapshot().data, ["cached"]);
  second.resolve(["latest"]); await loading;
  assert.deepEqual(resource.getSnapshot().data, ["latest"]);
});

test("failure and invalid response preserve last good data and allow retry", async () => {
  seed("failure", ["good"]);
  const resource = createCachedResource("failure", valid);
  await assert.rejects(resource.refresh(async () => { throw new Error("offline"); }), /offline/);
  assert.deepEqual(resource.getSnapshot().data, ["good"]);
  assert.equal(resource.getSnapshot().refreshing, false);
  await assert.rejects(resource.refresh(async () => null), /Invalid/);
  assert.deepEqual(resource.getSnapshot().data, ["good"]);
  await resource.refresh(async () => []);
  assert.deepEqual(resource.getSnapshot().data, []);
  assert.equal(resource.getSnapshot().error, "");
});

test("a synchronous loader failure does not leave the resource stuck", async () => {
  const resource = createCachedResource("sync-failure", valid);
  await assert.rejects(resource.refresh(() => { throw new Error("sync"); }), /sync/);
  await resource.refresh(async () => ["recovered"]);
  assert.deepEqual(resource.getSnapshot().data, ["recovered"]);
});

test("failed invalidated request does not block the queued fresh read", async () => {
  const resource = createCachedResource("queued-failure", valid), first = deferred();
  const request = resource.refresh(() => first.promise); await tick();
  resource.refresh(async () => ["fresh"], true);
  first.reject(new Error("obsolete")); await request;
  assert.deepEqual(resource.getSnapshot().data, ["fresh"]);
  assert.equal(resource.getSnapshot().error, "");
});

test("storage quota failure keeps live content usable", async () => {
  const resource = createCachedResource("quota", valid);
  const original = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error("QuotaExceeded"); };
  try { await resource.refresh(async () => ["live"]); assert.deepEqual(resource.getSnapshot().data, ["live"]); }
  finally { window.localStorage.setItem = original; }
});

test("resource merge policy preserves partial data but permits confirmed deletion", async () => {
  const isSnapshot = (value) => value && Array.isArray(value.items);
  seed("partial", { items: ["old"], partial: false });
  const resource = createCachedResource("partial", isSnapshot, (next, previous) => next.partial && previous
    ? { ...next, items: [...new Set([...previous.items, ...next.items])] } : next);
  await resource.refresh(async () => ({ items: ["new"], partial: true }));
  assert.deepEqual(resource.getSnapshot().data.items, ["old", "new"]);
  await resource.refresh(async () => ({ items: [], partial: false }));
  assert.deepEqual(resource.getSnapshot().data.items, []);
});

test("model catalogs isolate employee scopes and never reuse ambiguous legacy data", async () => {
  const text = (await fs.readFile(new URL("../../web-ui/src/features/models/data/modelCatalogCache.ts", import.meta.url), "utf8"))
    .replace('"../../../shared/state/localCache"', JSON.stringify(cacheUrl))
    .replace('import { currentConversationId } from "../../../shared/api/conversationScope";', 'const currentConversationId = () => "";');
  const { modelCatalogFor } = await import(moduleUrl(text));
  const model = { model: "employee-model", supportedReasoningEfforts: [] };
  seed("negus-models-v1", [model]);
  assert.equal(modelCatalogFor().getSnapshot().data, null);
  const employee = modelCatalogFor("employee-a"), other = modelCatalogFor("employee-b");
  assert.equal(employee, modelCatalogFor("employee-a"));
  await employee.refresh(async () => [model]);
  assert.equal(other.getSnapshot().data, null);
  assert.equal(modelCatalogFor().getSnapshot().data, null);
});
