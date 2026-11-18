import fs from 'node:fs';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
const root = '/Users/hans/myproject/negus';
const require = createRequire(realpathSync(`${root}/ui-feishu/node_modules/vite/package.json`));
const { build } = require('esbuild');
const before = JSON.parse(fs.readFileSync(new URL('before.json', import.meta.url), 'utf8'));
const files = new Set(['ui-feishu/shared/features/conversations/state/conversationStore.ts', 'ui-feishu/src/conversationDirectory.ts']);
const bundle = await build({ stdin: { contents: `export { ConversationStore } from './shared/features/conversations/state/conversationStore'; export { snapshotStatusByThread } from './src/conversationDirectory';`, resolveDir: `${root}/ui-feishu`, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'before-this-task', setup(build) { build.onLoad({ filter: /\.ts$/ }, args => {
    const file = args.path.slice(root.length + 1);
    if (files.has(file)) return { contents: before[file], loader: 'ts' };
  }); } }] });
globalThis.window = { location: { search: '' }, localStorage: { getItem: () => null, setItem: () => {} } };
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
const { ConversationStore, snapshotStatusByThread } = loaded.exports;
const store = new ConversationStore({ cachedSessions: [], partialSessionIds: [] });
const old = { ...store.empty('a').executionStatus, active: true, phase: 'working', turnId: 'turn', eventEpoch: 'e', eventSeq: 1 };
store.update('a', { executionStatus: old }, true);
const revision = store.revisions.get('a') || 0;
store.update('a', { contextStatus: { ...store.empty('a').contextStatus, usedTokens: 10 } });
store.invalidate('a');
const terminal = { ...old, active: false, phase: 'completed', eventSeq: 2 };
store.commit('a', { ...store.empty('a'), executionStatus: terminal }, revision);
console.log(JSON.stringify({ baseline: 'working tree before FEAT-002, includes FEAT-001 fix',
  committed: store.committed.get('a').executionStatus.phase, live: store.live.get('a').executionStatus.phase,
  selectedActive: store.get('a').executionStatus.active,
  directoryProjectionActive: snapshotStatusByThread(store, 'a', [{ conversations: [{ threadId: 'a', status: terminal }] }]).a.active }));
