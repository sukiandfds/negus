import test from 'node:test';
import assert from 'node:assert/strict';
import { StringDecoder } from 'node:string_decoder';
import { performance } from 'node:perf_hooks';
import { createProtocolLineReader } from '../server/app-server-client.mjs';
import { createAppServerConversationStore } from '../server/app-server-conversation-store.mjs';

test('chunked JSONL preserves UTF8, CRLF, multiple records, empty lines and malformed-record isolation', () => {
  const messages = [{ id: 1, result: { text: '中文🙂' } }, { method: 'item/tool/requestUserInput', id: 2, params: {} }, { method: 'item/agentMessage/delta', params: { delta: 'done' } }];
  const bytes = Buffer.from(messages.map(JSON.stringify).join('\r\n') + '\n\ninvalid\n{"id":3}\n');
  const decoder = new StringDecoder('utf8'), read = createProtocolLineReader(), lines = [];
  for (let i = 0; i < bytes.length; i++) lines.push(...read(decoder.write(bytes.subarray(i, i + 1))));
  lines.push(...read(decoder.end()));
  const parsed = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  assert.deepEqual(parsed, [...messages, { id: 3 }]);
});
test('partial records are isolated per child and emitted only when complete', () => {
  const old = createProtocolLineReader(); assert.deepEqual(old('{"old":'), []);
  const fresh = createProtocolLineReader(); assert.deepEqual(fresh('{"new":true}\n'), ['{"new":true}']);
  assert.deepEqual(old('true}\n'), ['{"old":true}']);
});
test('large chunked record is preserved without rescanning preceding chunks', () => {
  const read = createProtocolLineReader(), chunk = '测'.repeat(32768), count = 1024;
  const start = performance.now();
  assert.deepEqual(read('{"text":"'), []);
  for (let i = 0; i < count; i++) assert.deepEqual(read(chunk), []);
  const lines = read('"}\n{"id":2}\n');
  assert.equal(JSON.parse(lines[0]).text, chunk.repeat(count));
  assert.equal(lines[1], '{"id":2}');
  console.log('64MiB JSONL assembled and parsed in', Math.round(performance.now() - start), 'ms');
});
for (const method of ['thread/list', 'model/list']) {
  const setup = cursors => {
    let calls = 0;
    const store = createAppServerConversationStore({ projectRoot: process.cwd(), autoTitleEnabled: false,
      client: { subscribe: () => () => {}, close() {}, request: async name => {
        assert.equal(name, method);
        if (calls >= cursors.length) throw Error('Unbounded pagination');
        return { data: [], nextCursor: cursors[calls++] };
      } },
    });
    return { store, calls: () => calls, run: () => method === 'thread/list' ? store.listSessions() : store.listModels() };
  };
  test(method + ' preserves normal pagination and terminates repeated/cyclic cursors', async () => {
    for (const cursors of [['a', 'b', null], ['a', 'a'], ['a', 'b', 'a']]) {
      const f = setup(cursors);
      try {
        if (cursors.at(-1) === null) assert.deepEqual(await f.run(), []);
        else await assert.rejects(f.run(), /repeated pagination cursor/);
        assert.equal(f.calls(), cursors.length);
      } finally { f.store.close(); }
    }
  });
}
