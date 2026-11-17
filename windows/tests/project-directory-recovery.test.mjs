import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(realpathSync(new URL('../../ui-feishu/node_modules/vite/package.json', import.meta.url)));
const { build } = require('esbuild');
const storage = new Map();
globalThis.window = { location: { search: '' }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
const bundle = await build({ stdin: { contents: `export { projectDirectoryApi, projectDirectoryResource } from './shared/features/project-directory/data/projectDirectoryApi';
  export { HttpError, fetchJson, postJson } from './shared/shared/api/http';`, resolveDir: new URL('../../ui-feishu', import.meta.url).pathname, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false });
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { projectDirectoryApi: api, projectDirectoryResource: resource, HttpError, fetchJson, postJson } = loaded.exports;
const success = id => new Response(JSON.stringify({ projects: [{ id }] }), { headers: { 'content-type': 'application/json' } });
const failure = status => new Response(JSON.stringify({ error: `fixture ${status}` }), { status, headers: { 'content-type': 'application/json' } });

test('directory retries only recoverable failures, retains cache and stops after two attempts', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => success('seed'); await api.list();
  for (const [name, error, retry] of [
    ['network', new TypeError('Failed to fetch'), true], ['timeout', new DOMException('timeout', 'TimeoutError'), true],
    ['abort', new DOMException('aborted', 'AbortError'), true],
    ...[500, 501, 503, 599].map(status => [String(status), status, true]),
    ...[401, 403, 404, 429].map(status => [String(status), status, false]),
    ['invalid JSON', new Error('项目数据返回格式错误'), false],
  ]) await t.test(name, async () => {
    const before = resource.getSnapshot().data;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      assert.equal(resource.getSnapshot().data, before, 'old directory remains visible during recovery');
      if (calls === 1) { if (typeof error === 'number') return failure(error); throw error; }
      return success(name);
    };
    if (retry) { await api.list(undefined, true); assert.deepEqual(resource.getSnapshot().data, [{ id: name }]); }
    else { await assert.rejects(api.list(undefined, true)); assert.equal(resource.getSnapshot().data, before); }
    assert.equal(calls, retry ? 2 : 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, retry ? 2 : 1, 'no background retry loop');
  });
  const previous = resource.getSnapshot().data;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return failure(503); };
  await assert.rejects(api.list(undefined, true), e => e instanceof HttpError && e.status === 503);
  assert.equal(calls, 2); assert.equal(resource.getSnapshot().data, previous);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(calls, 2);
  globalThis.fetch = async () => { calls++; return success('next-event'); };
  await api.list(undefined, true);
  assert.equal(calls, 3); assert.deepEqual(resource.getSnapshot().data, [{ id: 'next-event' }]);
});

test('GET status metadata preserves messages and POST error behavior', async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => failure(401);
  await assert.rejects(fetchJson('/api/project-directory'), e => e.status === 401 && e.message === '访问令牌无效，请使用启动命令输出的完整链接');
  globalThis.fetch = async () => failure(404);
  await assert.rejects(fetchJson('/api/project-directory'), e => e.status === 404 && e.message === '请求的项目会话不存在');
  globalThis.fetch = async () => failure(403);
  await assert.rejects(postJson('/fixture', {}), e => e.name === 'Error' && e.message === 'fixture 403' && e.status === undefined);
});
