import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(realpathSync(new URL('../node_modules/vite/package.json', import.meta.url)));
const { build } = require('esbuild');
const bundle = await build({
  entryPoints: [new URL('../shared/features/conversations/state/forwardMessages.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { composeForwardedMessages, forwardableMessage } = loaded.exports;

test('combines non-adjacent selections in displayed order with original authors and times', () => {
  const items = [
    { id: 'first', message: { id: 'a', role: 'user', authorName: '我', text: '第一条', createdAt: '2026-10-28T01:02:03Z' } },
    { id: 'middle', message: { id: 'b', role: 'assistant', text: '跳过' } },
    { id: 'last', message: { id: 'c', role: 'assistant', authorName: '员工', text: '最后一条' } },
  ];
  const result = composeForwardedMessages('对话 A', items, new Set(['last', 'first']));
  assert.equal(result.text, '来源：对话 A\n\n我 · 2026-10-28T01:02:03Z\n第一条\n\n员工\n最后一条');
  assert.equal(result.hasAttachments, false);
});

test('uses displayed markdown only, flags mixed attachments and excludes attachment-only messages', () => {
  const mixed = { id: 'a', role: 'user', text: 'raw', blocks: [
    { id: 'text', type: 'markdown', text: '正文' }, { id: 'image', type: 'image', source: '/image' },
  ] };
  const attachment = { id: 'b', role: 'assistant', text: '', blocks: [{ id: 'file', type: 'file', source: '/file' }] };
  assert.deepEqual(forwardableMessage(mixed), { text: '正文', hasAttachments: true });
  assert.deepEqual(forwardableMessage(attachment), { text: '', hasAttachments: true });
  assert.deepEqual(composeForwardedMessages('A', [{ id: 'a', message: mixed }, { id: 'b', message: attachment }], new Set(['a', 'b'])),
    { text: '来源：A\n\n我\n正文', hasAttachments: true });
  assert.deepEqual(composeForwardedMessages('A', [{ id: 'b', message: attachment }], new Set(['b'])),
    { text: '', hasAttachments: false });
});
