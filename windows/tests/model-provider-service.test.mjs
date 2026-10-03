import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildAppServerEnvironment } from "../server/app-server-client.mjs";
import {
  CURRENT_MODEL_PROVIDER_ID,
  GROK_MODEL_ID,
  GROK_MODEL_PROVIDER_ID,
  createModelProviderCredentialStore,
  createModelProviderService,
} from "../server/model-provider-service.mjs";

const withTemporaryRoot = async (run) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-model-provider-"));
  try { await run(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
};

test("manual provider discovery adds new Grok models, persists routing and retains cache on failure", async () => {
  await withTemporaryRoot(async (root) => {
    let fail = false;
    let calls = 0;
    const options = { currentApiConfiguration: async () => null, projectRoot: root,
      sharedConfig: { runtimeProviders: async () => [] },
      credentialStore: { read: async () => 'test-key', isConfigured: async () => true },
      fetchModels: async (url, init) => {
        calls += 1;
        assert.equal(url.href, 'https://fushengyunsuan.cn/v1/models');
        assert.equal(init.headers.Authorization, 'Bearer test-key');
        assert.equal(init.redirect, 'error');
        if (fail) throw new Error('offline');
        return { ok: true, json: async () => ({ data: [{ id: 'grok-4.7' }, { id: 'gpt-other' }] }) };
      },
    };
    const service = createModelProviderService(options);
    await Promise.all([service.refreshProviderModels('fusheng-grok'), service.refreshProviderModels('fusheng-grok')]);
    assert.equal(calls, 1);
    assert.equal(service.resolveRoute({ model: 'grok-4.7' }).modelProviderId, 'fusheng-grok');
    assert.equal(service.resolveRoute({ model: 'gpt-other' }).modelProviderId, 'current');
    const restored = createModelProviderService(options);
    assert.ok((await restored.listModels()).some((entry) => entry.model === 'grok-4.7'));
    assert.equal(restored.resolveRoute({ model: 'grok-4.7' }).modelProviderId, 'fusheng-grok');
    fail = true;
    await assert.rejects(service.refreshProviderModels('fusheng-grok'), /目录读取失败/);
    assert.ok((await service.listModels()).some((entry) => entry.model === 'grok-4.7'));
    service.close(); restored.close();
  });
});

test("all provider environments share GitHub tools and login while isolating model secrets", () => {
  const base = {
    PATH: "C:\\tools",
    GH_CONFIG_DIR: "/shared/github-config",
    NEGUS_GITHUB_PROXY: "http://127.0.0.1:7892",
    OPENAI_API_KEY: "do-not-copy",
    FUSHENG_GROK_API_KEY: "do-not-copy-either",
  };
  const ordinary = buildAppServerEnvironment({ baseEnvironment: base });
  assert.equal(ordinary.OPENAI_API_KEY, base.OPENAI_API_KEY);
  assert.ok(ordinary.PATH.endsWith(path.delimiter + base.PATH));
  assert.ok(ordinary.GH_CONFIG_DIR);

  const isolated = buildAppServerEnvironment({
    baseEnvironment: base,
    codexHome: "C:\\runtime\\grok",
    sanitizeEnvironment: true,
    environment: { NEGUS_RUNTIME: "provider" },
  });
  assert.equal(isolated.PATH, ordinary.PATH);
  assert.equal(isolated.GH_CONFIG_DIR, ordinary.GH_CONFIG_DIR);
  assert.equal(isolated.GH_CONFIG_DIR, base.GH_CONFIG_DIR);
  assert.equal(isolated.NEGUS_GITHUB_PROXY, base.NEGUS_GITHUB_PROXY);
  assert.equal(isolated.CODEX_HOME, path.resolve("C:\\runtime\\grok"));
  assert.equal(isolated.NEGUS_RUNTIME, "provider");
  assert.equal(isolated.OPENAI_API_KEY, undefined);
  assert.equal(isolated.FUSHENG_GROK_API_KEY, undefined);
  assert.equal(base.OPENAI_API_KEY, "do-not-copy");
});

test("provider routing keeps GPT current and sends Grok to the isolated provider", async () => {
  await withTemporaryRoot(async (root) => {
    const defaultClient = { id: "default" };
    const credentials = createModelProviderCredentialStore({
      root: path.join(root, "credentials"),
      protect: async () => Buffer.from("encrypted-test-value").toString("base64"),
    });
    const service = createModelProviderService({ currentApiConfiguration: async () => null, projectRoot: root, defaultClient, credentialStore: credentials });

    assert.equal(service.resolveRoute({ model: "gpt-5.6-terra" }).modelProviderId, CURRENT_MODEL_PROVIDER_ID);
    assert.equal(service.resolveRoute({ model: GROK_MODEL_ID }).modelProviderId, GROK_MODEL_PROVIDER_ID);
    assert.equal(service.resolveRoute({ model: GROK_MODEL_ID, modelProviderId: CURRENT_MODEL_PROVIDER_ID }).modelProviderId, CURRENT_MODEL_PROVIDER_ID);
    assert.equal(await service.getClient({ model: "gpt-5.6-terra" }), defaultClient);
    service.close();
  });
});

test("credential storage never writes the plaintext token", async () => {
  await withTemporaryRoot(async (root) => {
    const plaintext = "test-secret-that-must-not-be-written";
    const encrypted = Buffer.from(`protected:${plaintext}`).toString("base64");
    const credentials = createModelProviderCredentialStore({
      root,
      protect: async (secret) => {
        assert.equal(secret, plaintext);
        return encrypted;
      },
    });
    const saved = await credentials.save(GROK_MODEL_PROVIDER_ID, plaintext);
    const stored = await fs.readFile(saved.file, "utf8");
    assert.equal(stored.trim(), encrypted);
    assert.equal(stored.includes(plaintext), false);
    assert.equal(await credentials.isConfigured(GROK_MODEL_PROVIDER_ID), true);
  });
});

test("external client is lazy, reused, and configured with command auth", async () => {
  await withTemporaryRoot(async (root) => {
    const credentials = createModelProviderCredentialStore({
      root: path.join(root, "credentials"),
      protect: async () => Buffer.from("encrypted-test-value").toString("base64"),
    });
    await credentials.save(GROK_MODEL_PROVIDER_ID, "synthetic-token");
    const created = [];
    const service = createModelProviderService({ currentApiConfiguration: async () => null,
      projectRoot: root,
      defaultClient: { id: "default" },
      credentialStore: credentials,
      createClient: (options) => {
        const client = { options, closeCount: 0, close() { this.closeCount += 1; } };
        created.push(client);
        return client;
      },
    });

    const models = await service.listModels([{ model: "gpt-5.6-terra", displayName: "Terra" }]);
    assert.equal(models.find((model) => model.model === GROK_MODEL_ID)?.available, true);
    const first = await service.getClient({ model: GROK_MODEL_ID });
    const second = await service.getClient({ model: GROK_MODEL_ID });
    assert.equal(first, second);
    assert.equal(created.length, 1);
    assert.equal(first.options.sanitizeEnvironment, true);
    const config = await fs.readFile(path.join(first.options.codexHome, "config.toml"), "utf8");
    assert.match(config, /model_provider = "fusheng-grok"/u);
    assert.match(config, /\[model_providers\.fusheng-grok\.auth\]/u);
    assert.match(config, /command = "powershell\.exe"/u);
    assert.doesNotMatch(config, /env_key|requires_openai_auth|synthetic-token/u);
    service.close();
    assert.equal(first.closeCount, 1);
  });
});

test("DPAPI helper protects and reads a synthetic token on Windows", { skip: process.platform !== "win32" }, async () => {
  await withTemporaryRoot(async (root) => {
    const helper = path.resolve("windows", "scripts", "model-provider-credential.ps1");
    const token = "synthetic-dpapi-token";
    const protectedResult = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", helper, "-Mode", "protect",
    ], { input: token, encoding: "utf8", windowsHide: true });
    assert.equal(protectedResult.status, 0, protectedResult.stderr);
    const credentialFile = path.join(root, "credential.dpapi");
    await fs.writeFile(credentialFile, protectedResult.stdout, "utf8");
    assert.equal(protectedResult.stdout.includes(token), false);

    const readResult = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", helper, "-Mode", "read", "-CredentialFile", credentialFile,
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(readResult.status, 0, readResult.stderr);
    assert.equal(readResult.stdout, token);
  });
});

test("current API configuration refresh reads supplier models, keeps native IDs and rejects stale cached source", async () => {
  await withTemporaryRoot(async root => {
    let fail = false, requests = 0;
    const sharedConfig = { runtimeProviders: async () => [{ id: "ccswitch_vip", displayName: "vip", baseUrl: "https://supplier.test/v1", key: "synthetic", defaultModel: "gpt-6-sol" }] };
    const options = { projectRoot: root, sharedConfig,
      currentApiConfiguration: async () => ({ baseUrl: "https://supplier.test/v1", key: "synthetic", name: "native-name" }),
      fetchModels: async (url, init) => {
        requests++; assert.equal(url.href, "https://supplier.test/v1/models");
        assert.equal(init.headers.Authorization, "Bearer synthetic");
        if (fail) throw Error("offline");
        return { ok: true, json: async () => ({ data: [{ id: "gpt-6-sol" }, { id: "gpt-6.1-sol" }] }) };
      },
    };
    const native = [{ model: "gpt-6-sol", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }, { model: "native-only" }];
    const service = createModelProviderService(options);
    await service.refreshProviderModels("current");
    const current = (await service.listModels(native)).filter(m => m.modelProviderId === "current");
    assert.deepEqual(current.map(m => m.model), ["gpt-6-sol", "gpt-6.1-sol"]);
    assert.ok(current.every(m => m.providerDisplayName === "vip"));
    assert.equal(current[0].supportedReasoningEfforts[0].reasoningEffort, "high");
    assert.deepEqual(current[1].supportedReasoningEfforts, []);
    assert.equal(service.resolveRoute({ model: "gpt-6.1-sol" }).modelProviderId, "current");
    fail = true;
    await assert.rejects(service.refreshProviderModels("current"), /目录读取失败/);
    assert.ok((await service.listModels(native)).some(m => m.model === "gpt-6.1-sol"));
    const changed = createModelProviderService({ ...options, currentApiConfiguration: async () => ({ baseUrl: "https://different.test/v1", key: "other", name: "other" }) });
    assert.ok(!(await changed.listModels(native)).some(m => m.model === "gpt-6.1-sol"));
    assert.equal(requests, 2);
    service.close(); changed.close();
  });
});

test("verified 6.1 reasoning fills cached empty capabilities only for the tested endpoint", async () => {
  await withTemporaryRoot(async root => {
    const efforts = list => list.map(e => e.reasoningEffort);
    const sharedConfig = { runtimeProviders: async () => [
      { id: "ccswitch_verified", baseUrl: "https://fushengyunsuan.cn/v1", defaultModel: "gpt-6.1-sol", models: [{ model: "gpt-6.1-sol" }] },
      { id: "ccswitch_other", baseUrl: "https://other.test/v1", defaultModel: "gpt-6.1-sol", models: [{ model: "gpt-6.1-sol" }] },
    ], readCredential: async () => "synthetic" };
    const options = { projectRoot: root, sharedConfig,
      currentApiConfiguration: async () => ({ baseUrl: "https://fushengyunsuan.cn/v1", key: "synthetic" }),
      fetchModels: async () => ({ ok: true, json: async () => ({ data: [{ id: "gpt-6.1-sol" }, { id: "unknown-model" }] }) }),
    };
    let service = createModelProviderService(options);
    await service.refreshProviderModels("current");
    service.close();
    service = createModelProviderService(options);
    const models = await service.listModels([]);
    for (const id of ["gpt-6.1-sol", "ccswitch_verified::gpt-6.1-sol"]) {
      assert.deepEqual(efforts(models.find(m => m.model === id).supportedReasoningEfforts), ["low", "medium", "high", "xhigh"]);
    }
    assert.deepEqual(models.find(m => m.model === "ccswitch_other::gpt-6.1-sol").supportedReasoningEfforts, []);
    assert.deepEqual(models.find(m => m.model === "unknown-model").supportedReasoningEfforts, []);
    const authoritative = await service.listModels([{ model: "gpt-6.1-sol", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }]);
    assert.deepEqual(efforts(authoritative.find(m => m.model === "gpt-6.1-sol").supportedReasoningEfforts), ["high"]);
    service.close();
  });
});

test("current catalog collisions retain explicit routing and legacy Grok routing stays compatible", async () => {
  await withTemporaryRoot(async root => {
    const defaultClient = { id: "current-client" };
    const service = createModelProviderService({ projectRoot: root, defaultClient,
      currentApiConfiguration: async () => ({ baseUrl: "https://supplier.test/v1", key: "synthetic" }),
      sharedConfig: { runtimeProviders: async () => [] },
      credentialStore: { isConfigured: async () => false },
      fetchModels: async () => ({ ok: true, json: async () => ({ data: [{ id: "grok-4.5" }] }) }),
    });
    await service.refreshProviderModels("current");
    const current = (await service.listModels([])).find(m => m.modelProviderId === "current");
    assert.equal(current.model, "current::grok-4.5");
    assert.equal(await service.getClient({ model: current.model }), defaultClient);
    assert.equal(service.resolveRoute({ model: "grok-4.5", modelProviderId: "current" }).modelProviderId, "current");
    assert.equal(service.resolveRoute({ model: "grok-4.5" }).modelProviderId, "fusheng-grok", "old saved unqualified routes remain unchanged");
    assert.throws(() => service.resolveRoute({ model: "fusheng-grok::unknown" }), /does not belong/);
    service.close();
  });
});

test('fresh installations and arbitrary shared config IDs reuse supplier Grok capabilities after reload', async () => {
  await withTemporaryRoot(async root => {
    const { createProviderProbe } = await import('../server/provider-probe.mjs');
    const { randomUUID } = await import('node:crypto');
    const ids = [randomUUID(), randomUUID()];
    const baseUrl = 'https://fushengyunsuan.cn/v1';
    const providers = ids.map(id => ({ id: 'ccswitch_' + id, baseUrl, models: [{ model: 'grok-4.7' }] }));
    providers.push({ id: 'ccswitch_foreign', baseUrl: 'https://other.test/v1', models: [{ model: 'grok-4.7' }] });
    providers.push({ id: 'ccswitch_authoritative', baseUrl, models: [{ model: 'grok-4.7', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] });
    const options = { projectRoot: root, currentApiConfiguration: async () => null,
      sharedConfig: { runtimeProviders: async () => providers, readCredential: async () => 'synthetic' } };
    for (let launch = 0; launch < 2; launch++) {
      const service = createModelProviderService(options);
      try {
        const models = await service.listModels([]);
        for (const id of ids) {
          const model = 'ccswitch_' + id + '::grok-4.7';
          assert.deepEqual(models.find(m => m.model === model).supportedReasoningEfforts.map(e => e.reasoningEffort), ['low', 'medium', 'high']);
          assert.equal(service.resolveRoute({ model }).modelProviderId, 'ccswitch_' + id);
        }
        assert.deepEqual(models.find(m => m.model === 'ccswitch_foreign::grok-4.7').supportedReasoningEfforts, []);
        assert.deepEqual(models.find(m => m.model === 'ccswitch_authoritative::grok-4.7').supportedReasoningEfforts.map(e => e.reasoningEffort), ['high']);
      } finally { service.close(); }
    }
    const probe = createProviderProbe({ resolveDraft: async () => ({ baseUrl, key: 'synthetic' }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ id: 'grok-4.7' }, { id: 'unverified' }] }) }) });
    const result = await probe({ action: 'discover' });
    assert.deepEqual(result.capabilities.find(m => m.model === 'grok-4.7').supportedReasoningEfforts.map(e => e.reasoningEffort), ['low', 'medium', 'high']);
    assert.deepEqual(result.capabilities.find(m => m.model === 'unverified').supportedReasoningEfforts, []);
  });
});
