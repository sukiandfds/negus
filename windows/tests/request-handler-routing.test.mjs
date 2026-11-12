import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequestHandler } from "../server/request-handler.mjs";

const createFixture = (projectRoot = "C:\\demo") => {
  const serveStatic = async (_url, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("static");
  };
  return createRequestHandler({
    token: "test-token",
    project: "demo",
    projectRoot,
    device: { name: "test-device" },
    observerPort: 1,
    conversations: {
      listModels: async () => [{ id: "model" }],
      listSessions: async () => [],
    },
    execution: {},
    media: {},
    realtime: {},
    contextManagement: {},
    groupRoom: { snapshot: () => ({ room: { id: "room" }, messages: [], agents: [], members: [] }) },
    multiAgent: {},
    artifacts: { list: () => [{ id: "artifact" }] },
    webOutputs: {},
    fushengUsage: { read: async ({ force, cacheKey } = {}) => ({ provider: "fusheng", force: Boolean(force), cacheKey }) },
    readWebVersion: async () => ({ buildId: "web-test", builtAt: "2026-07-28T00:00:00.000Z" }),
    serveStatic,
  });
};

const withServer = async (run, projectRoot) => {
  const server = http.createServer(createFixture(projectRoot));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test("dispatches feature routes and preserves static fallback", async () => {
  await withServer(async (baseUrl) => {
    const request = (pathname) => fetch(`${baseUrl}${pathname}${pathname.includes("?") ? "&" : "?"}token=test-token`);
    assert.deepEqual(await (await request("/api/project")).json(), { name: "demo", root: "C:\\demo", mode: "interactive" });
    assert.deepEqual(await (await request("/api/share-link")).json(), { token: "test-token" });
    assert.deepEqual(await (await request("/api/models")).json(), [{ id: "model" }]);
    assert.equal((await (await request("/api/group/snapshot")).json()).room.id, "room");
    assert.deepEqual(await (await request("/api/artifacts")).json(), [{ id: "artifact" }]);
    assert.deepEqual(await (await request("/api/usage/fusheng")).json(), { provider: "fusheng", force: false, cacheKey: "" });
    assert.deepEqual(await (await request("/api/usage/fusheng?refresh=1&turnId=turn-1")).json(), { provider: "fusheng", force: true, cacheKey: "turn-1" });
    assert.deepEqual(await (await request("/api/version")).json(), {
      buildId: "web-test",
      builtAt: "2026-07-28T00:00:00.000Z",
    });
    assert.equal(await (await request("/page")).text(), "static");
  });
});

test("keeps API routes protected after route extraction", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/project`);
    assert.equal(response.status, 401);
    assert.equal(await response.text(), "Unauthorized");
  });
});

test("answers unknown API paths as JSON instead of falling through to static files", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/no-such-endpoint?token=test-token`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found" });
  });
});

test("accepts the access cookie and temporarily refuses an address that keeps guessing", async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/project?token=test-token`);
    const cookie = first.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${baseUrl}/api/project`, { headers: { Cookie: cookie } })).status, 200);

    // Requests without any credential are refused but never counted.
    for (let attempt = 0; attempt < 15; attempt += 1) {
      assert.equal((await fetch(`${baseUrl}/api/project`)).status, 401);
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await fetch(`${baseUrl}/api/project?token=guess-${attempt}`)).status, 401);
    }
    const locked = await fetch(`${baseUrl}/api/project?token=test-token`);
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
  });
});
