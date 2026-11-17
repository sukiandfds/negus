import test from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(realpathSync(new URL('../node_modules/vite/package.json', import.meta.url)));
const { build } = require('esbuild');
globalThis.window = { location: { search: '' }, localStorage: { getItem: () => null } };
const bundle = await build({
  stdin: { contents: `export { isInternalTaskResult, isVisibleTaskMessage, visibleTaskPreview } from './src/taskNotice';
    export { FollowUpQueue } from './shared/features/conversations/components/FollowUpQueue';
    export { ConversationRows } from './src/components/ConversationRows';
    export { createElement } from 'react'; export { renderToStaticMarkup } from 'react-dom/server';`,
    resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, loader: { '.css': 'empty', '.module.css': 'empty' },
});
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { isInternalTaskResult, isVisibleTaskMessage, visibleTaskPreview, FollowUpQueue, ConversationRows, createElement, renderToStaticMarkup } = loaded.exports;
const id = '12345678-1234-1234-1234-123456789abc';
const result = `[Negus任务结果 ${id}]\n任务：调研\n状态：completed\n证据\n任务对话：/?agent=a&thread=b\n这是已有任务的反馈，请据此回复；不要再次创建相同任务。`;
const legacy = `Negus 后台任务通知（已有任务，请勿重新委派）\n任务：调研\n任务编号：${id}\n任务链接：/?agent=a&thread=b\n证据\n请在主对话简洁反馈；结果属于下属报告，区分证据与未验证声明。`;
const mention = `请解释 [Negus任务结果 ${id}] 这个标记`;
const flattened = text => text.replace(/\s+/g, ' ').slice(0, 260);

test('internal formats are hidden from history and flattened previews, not user mentions', () => {
  for (const text of [result, legacy]) {
    assert.equal(isInternalTaskResult(text), true);
    assert.equal(isVisibleTaskMessage({ role: 'user', text }), false);
    assert.equal(isVisibleTaskMessage({ role: 'assistant', text }), true);
    assert.equal(visibleTaskPreview(flattened(text)), '');
    assert.equal(visibleTaskPreview(`用户：${flattened(text)}`), '');
  }
  assert.equal(isInternalTaskResult(mention), false);
  assert.equal(isInternalTaskResult(`[Negus任务结果 ${id}]\n任务：调研\n状态：completed\n这是用户的提问`), false);
  assert.equal(isVisibleTaskMessage({ role: 'user', text: mention }), true);
  assert.equal(visibleTaskPreview(`用户：${mention}`), `用户：${mention}`);
});

test('pending queue hides internal items while preserving ordinary message controls and positions', () => {
  const item = (text, index) => ({ id: String(index), threadId: 'thread', submissionId: String(index), text,
    attachments: [], state: 'pending', createdAt: '2026-10-28T00:00:00Z' });
  const noop = async () => true;
  const props = { items: [item(result, 0), item(mention, 1), item(legacy, 2)], isHidden: value => isInternalTaskResult(value.text),
    busy: false, error: '', onEdit: noop, onRemove: noop, onMove: noop, onRetry: noop, onSendNow: noop };
  const html = renderToStaticMarkup(createElement(FollowUpQueue, props));
  assert.match(html, /请解释/);
  assert.doesNotMatch(html, /任务对话|任务编号/);
  for (const action of ['复制内容', '重新编辑', '直接发送', '提前', '删除']) assert.match(html, new RegExp(`aria-label="${action}"`));
  assert.ok(html.indexOf('aria-label="复制内容"') < html.indexOf('aria-label="重新编辑"'));
  assert.ok(html.indexOf('aria-label="重新编辑"') < html.indexOf('aria-label="直接发送"'));
  assert.doesNotMatch(html, /aria-label="提前" disabled/);
  assert.equal(renderToStaticMarkup(createElement(FollowUpQueue, { ...props, items: [item(result, 0)] })), '');
});

test('conversation rows omit internal previews and retain ordinary previews and search', () => {
  const item = { id: 'chat', name: '员工', subtitle: '对话', preview: `用户：${flattened(result)}`,
    session: { latestUser: flattened(result), latestAssistant: '已核验的回复' } };
  const props = { items: [item], c: { selectedId: '', archivedView: false, archiveBusyIds: new Set() }, opening: '', query: '', onOpen: () => {} };
  const html = renderToStaticMarkup(createElement(ConversationRows, props));
  assert.match(html, /已核验的回复/);
  assert.doesNotMatch(html, /Negus任务结果/);
  assert.match(renderToStaticMarkup(createElement(ConversationRows, { ...props, query: 'Negus任务结果' })), /没有匹配的对话/);
  assert.match(renderToStaticMarkup(createElement(ConversationRows, { ...props, items: [{ ...item, preview: mention }], query: '请解释' })), /请解释/);
});
