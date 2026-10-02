import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFushengUsageService } from "../server/fusheng-usage-service.mjs";

test("aggregates Fusheng usage without exposing credentials and caches duplicate reads", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fusheng-usage-"));
  const credentialsFile = path.join(root, "credentials.json");
  const calls = [];
  try {
    await fs.writeFile(credentialsFile, JSON.stringify({
      base_url: "https://example.test",
      user_id: 1241,
      access_token: "private-test-token",
    }), "utf8");

    const responses = {
      "/api/user/self": { data: { id: 1241, quota: 24_500_000, used_quota: 33_000_000, request_count: 6765 } },
      "/api/data/self": { data: [
        { count: 2, token_used: 1_500, quota: 125_000 },
        { count: 3, token_used: 2_500, quota: 250_000 },
      ] },
      "/api/status": { data: { quota_per_unit: 500_000 } },
      "/api/pricing": { group_ratio: { "gpt 易燃易爆炸": 0.12, vip: 0.2 } },
    };
    const fetchImpl = async (input, options = {}) => {
      const url = new URL(String(input));
      calls.push({ pathname: url.pathname, headers: options.headers });
      return {
        ok: true,
        status: 200,
        json: async () => responses[url.pathname],
      };
    };
    const service = createFushengUsageService({
      credentialsFile,
      fetchImpl,
      now: () => new Date("2026-08-02T16:10:00.000Z"),
    });

    const first = await service.read({ cacheKey: "turn-1" });
    const second = await service.read({ cacheKey: "turn-1" });
    assert.equal(calls.length, 4);
    assert.deepEqual(second, first);
    assert.equal(first.queryDate, "2026-08-03");
    assert.deepEqual(first.today, { amountUsd: 0.75, requests: 5, tokens: 4_000 });
    assert.deepEqual(first.account, { balanceUsd: 49, historicalUsageUsd: 66, historicalRequests: 6765 });
    assert.deepEqual(first.featuredGroup, { name: "gpt 易燃易爆炸", ratio: 0.12 });
    assert.equal(JSON.stringify(first).includes("private-test-token"), false);
    assert.equal(calls.find((call) => call.pathname === "/api/user/self").headers.Authorization, "Bearer private-test-token");

    await service.read({ cacheKey: "turn-2" });
    assert.equal(calls.length, 8);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test("credentials save privately, survive reload and supersede legacy credentials", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-credentials-'));
  try {
    const credentialsFile = path.join(root, 'new', 'credentials.json');
    const legacyCredentialsFile = path.join(root, 'legacy.json');
    await fs.writeFile(legacyCredentialsFile, JSON.stringify({ base_url: 'https://fushengyunsuan.cn', user_id: 12, access_token: 'old-secret' }));
    const service = createFushengUsageService({ credentialsFile, legacyCredentialsFile });
    assert.deepEqual(await service.credentialStatus(), { configured: true, userId: 12 });
    await assert.rejects(service.saveCredentials({ userId: 0, accessToken: 'new-secret' }), { statusCode: 400 });
    assert.deepEqual(await service.saveCredentials({ userId: '34', accessToken: 'new-secret' }), { configured: true, userId: 34 });
    const reloaded = createFushengUsageService({ credentialsFile, legacyCredentialsFile });
    assert.deepEqual(await reloaded.credentialStatus(), { configured: true, userId: 34 });
    assert.equal(JSON.stringify(await reloaded.credentialStatus()).includes('secret'), false);
    assert.equal(JSON.parse(await fs.readFile(credentialsFile)).access_token, 'new-secret');
    if (process.platform !== 'win32') assert.equal((await fs.stat(credentialsFile)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await fs.readFile(legacyCredentialsFile)).access_token, 'old-secret');
    await assert.rejects(service.saveCredentials({ userId: 34, accessToken: '' }), { statusCode: 400 });
    assert.equal(JSON.parse(await fs.readFile(credentialsFile)).access_token, 'new-secret');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
