import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createImageSettingsStore } from "../server/image-generation/image-settings.mjs";
import { createConfiguredImageClient } from "../server/image-generation/configured-image-client.mjs";
import { createImageSettingsRoutes } from "../server/routes/image-settings-routes.mjs";
const setup = async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-image-settings-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: createImageSettingsStore(path.join(root, "settings.json")) };
};
const credentials = { name: "Example", baseUrl: "https://example.test/v1", model: "custom-image", userKeyMode: "replace", userKey: "account-private", groupKeyMode: "replace", groupKey: "image-private" };

test("optional settings, secret redaction, copy, clear, stale writes and private file permissions", async t => {
  const { root, store } = await setup(t);
  let result = await store.mutate({ revision: "", ...credentials });
  const originalId = result.configurations[0].id;
  assert.equal(result.defaultId, originalId);
  assert.equal(result.configurations[0].hasUserKey, true);
  assert.doesNotMatch(JSON.stringify(result), /account-private|image-private/);
  assert.equal((await fs.stat(path.join(root, "settings.json"))).mode & 0o777, 0o600);
  const oldRevision = result.revision;
  result = await store.mutate({ revision: result.revision, sourceId: originalId, name: "Copy" });
  const copyId = result.configurations[1].id;
  assert.equal((await store.read()).configurations[1].groupKey, "image-private");
  await assert.rejects(store.mutate({ revision: oldRevision }), { statusCode: 409 });
  result = await store.mutate({ revision: result.revision, id: copyId, userKeyMode: "clear", groupKeyMode: "clear", model: "", baseUrl: "" });
  assert.equal(result.configurations[1].hasGroupKey, false);
  assert.equal(result.configurations[1].baseUrl, "");
  result = await store.mutate({ revision: result.revision, action: "delete", id: originalId });
  assert.equal(result.defaultId, "");
  await store.mutate({ revision: result.revision, name: "" });
});

test("next tool call reads changed default credentials and model; explicit GPT resolution remains supported", async t => {
  const { store } = await setup(t);
  let result = await store.mutate({ revision: "", ...credentials });
  const calls = [];
  const client = createConfiguredImageClient({ store, createClient: options => ({
    generate: request => { calls.push({ options, request }); return { outputs: [] }; },
    edit: request => { calls.push({ options, request }); return { outputs: [] }; },
  }) });
  await client.generate({ prompt: "one" });
  assert.equal(calls[0].options.apiKey, "image-private");
  assert.equal(calls[0].request.model, "custom-image");
  result = await store.mutate({ revision: result.revision, id: result.defaultId, model: "gpt-image-2-2k", groupKeyMode: "replace", groupKey: "new-key" });
  await client.generate({ prompt: "two" });
  assert.equal(calls[1].options.apiKey, "new-key");
  assert.equal(calls[1].request.model, "gpt-image-2-2k");
  await client.edit({ prompt: "edit", resolution: "4K", image_paths: ["/tmp/reference.png"] });
  assert.equal(calls[2].request.model, "gpt-image-2-4k");
  assert.deepEqual(calls[2].request.imagePaths, ["/tmp/reference.png"]);
  await store.mutate({ revision: result.revision, action: "delete", id: result.defaultId });
  await assert.rejects(client.generate({ prompt: "three" }), /默认配置/);
  assert.equal(calls.length, 3);
});

test("query uses only group key, rejects endpoint credential reuse, and never generates an image", async t => {
  const { store, root } = await setup(t);
  const saved = await store.mutate({ revision: "", ...credentials });
  const draft = { id: saved.defaultId, groupKeyMode: "keep" };
  const requests = [];
  const route = createImageSettingsRoutes({ projectRoot: root, store,
    fetchImpl: async (url, init) => { requests.push({ url, init }); return Response.json({ data: [{ id: "image-a" }, { id: "image-a" }, { id: "other-model" }] }); },
    createClient: () => { throw new Error("Must not generate during model discovery"); },
  });
  const response = { setHeader() {}, writeHead() {}, end(value) { this.body = JSON.parse(value); } };
  const call = input => route(Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]), { method: "POST" }), response, new URL("http://localhost/api/settings/image-generation"));
  await call({ ...draft, action: "discover" });
  assert.deepEqual(response.body.models, ["image-a", "other-model"]);
  assert.equal(requests[0].init.headers.Authorization, "Bearer image-private");
  assert.equal(requests[0].init.redirect, "error");
  assert.doesNotMatch(JSON.stringify(requests), /account-private/);
  await assert.rejects(call({ ...draft, baseUrl: "https://other.test/v1", action: "discover" }), /重新填写/);
  assert.equal(requests.length, 1);
});

test("corrupt configuration fails closed and is never replaced", async t => {
  const { root, store } = await setup(t);
  await fs.writeFile(path.join(root, "settings.json"), "broken");
  await assert.rejects(store.mutate({ revision: "", ...credentials }), /读取失败/);
  assert.equal(await fs.readFile(path.join(root, "settings.json"), "utf8"), "broken");
});


test("Sunburst edit retains reference aspect at requested resolution", async t => {
  const { store, root } = await setup(t);
  await store.mutate({ revision: "", ...credentials, model: "gpt-image-2.5-sunburst" });
  const buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  buffer.writeUInt32BE(160, 16); buffer.writeUInt32BE(90, 20);
  const reference = path.join(root, "reference.png"); await fs.writeFile(reference, buffer);
  let sent;
  const client = createConfiguredImageClient({ store, createClient: () => ({ edit: request => { sent = request; return { outputs: [] }; } }) });
  await client.edit({ prompt: "edit", resolution: "4K", image_paths: [reference] });
  const [w, h] = sent.size.split("x").map(Number);
  assert.equal(w, 3840); assert.equal(h, 2160);
});
