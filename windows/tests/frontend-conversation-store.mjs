import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(realpathSync(new URL('../../ui-feishu/node_modules/vite/package.json', import.meta.url)));
export const storage = new Map();
globalThis.window = { location: { search: '' }, localStorage: {
  getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
} };
const { build } = require('esbuild');
const bundle = await build({ stdin: { contents: `export { ConversationStore } from './shared/features/conversations/state/conversationStore';
  export { readInitialConversationState } from './shared/features/conversations/state/initialConversation';
  export * from './shared/features/conversations/state/conversationMerge';
  export { conversationApi } from './shared/features/conversations/data/conversationApi';
  export { writeConversationSnapshot, readConversationSnapshot } from './shared/features/conversations/data/conversationSnapshot';`,
  resolveDir: new URL('../../ui-feishu', import.meta.url).pathname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, require);
export const { ConversationStore, conversationApi, mergeMessageList, mergeOlderMessages, mergePendingOptimisticMessages,
  writeConversationSnapshot, readConversationSnapshot, readInitialConversationState } = loaded.exports;
