import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import test from 'node:test';
import { resolveConversationFile } from '../server/conversation-file.mjs';
import { createMediaService } from '../server/media-service.mjs';
import { createConversationRoutes } from '../server/routes/conversation-routes.mjs';

test('remote file links: resolve references, reject unrelated files and serve safe text', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'negus-link-')));
  try {
    const project = path.join(root, 'project');
    await fs.mkdir(project);
    const file = path.join(project, '文档 (1).md');
    await fs.writeFile(file, '# hello <script>never execute</script>');
    const session = { cwd: project, messages: [{ id: 'm', text: '' }] };
    for (const href of [file, file + ':12', '文档 (1).md', '文档%20(1).md#L12', new URL('file://' + file).href]) {
      session.messages[0].text = '[文档](<' + href + '>)';
      assert.equal(await resolveConversationFile(session, 'm', href), file);
    }
    session.messages[0].text = '[文档][doc]\n\n[doc]: <' + file + '>';
    assert.equal(await resolveConversationFile(session, 'm', file), file);
    await assert.rejects(resolveConversationFile(session, 'other', file), { statusCode: 404 });
    await assert.rejects(resolveConversationFile(session, 'm', 'unmentioned.md'), { statusCode: 404 });
    const outside = path.join(root, 'secret.txt');
    await fs.writeFile(outside, 'secret');
    await fs.symlink(outside, path.join(project, 'escape.txt'));
    for (const href of ['../secret.txt', 'escape.txt', 'missing.md', 'https://example.com/a.md']) {
      session.messages[0].text = '[file](' + href + ')';
      await assert.rejects(resolveConversationFile(session, 'm', href), { statusCode: 404 });
    }
    session.messages[0].text = '[文档](<' + file + ':12>)';
    const media = createMediaService();
    const route = createConversationRoutes({ conversations: { findSession: async () => session }, media });
    const chunks = [];
    const response = new Writable({ write(chunk, _encoding, next) { chunks.push(chunk); next(); } });
    response.writeHead = (status, headers) => { response.status = status; response.headers = headers; };
    const query = new URLSearchParams({ threadId: 't', messageId: 'm', href: file + ':12' });
    await route({ method: 'GET', headers: {} }, response, new URL('http://local/api/session/file?' + query));
    await finished(response);
    assert.equal(response.status, 200);
    assert.match(response.headers['Content-Type'], /^text\/plain/);
    assert.match(response.headers['Content-Disposition'], /^inline/);
    assert.match(response.headers['Content-Security-Policy'], /sandbox/);
    assert.equal(Buffer.concat(chunks).toString(), '# hello <script>never execute</script>');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('failed file navigation never receives cached Negus desktop; app offline fallback remains', async () => {
  const handlers = {};
  const context = { self: { location: { href: 'https://local/sw.js', origin: 'https://local' }, addEventListener: (event, fn) => { handlers[event] = fn; } }, URL,
    fetch: async () => ({ ok: false, status: 404 }), caches: { match: async (pathname) => pathname } };
  vm.runInNewContext(await fs.readFile('web-ui/public/sw.js', 'utf8'), context);
  for (const pathname of ['/Users/me/file.md', '/docs/file.md', '/api/session/file']) {
    let intercepted = false;
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://local' + pathname }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
  let result;
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://local/' }, respondWith: (value) => { result = value; } });
  assert.equal(await result, '/index.html');
});
