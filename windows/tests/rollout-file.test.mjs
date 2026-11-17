import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { createJsonlConversationStore } from '../server/jsonl-conversation-store.mjs';
import { latestAssistantReplyAtFromRollout, createAppServerConversationStore } from '../server/app-server-conversation-store.mjs';
import { latestRolloutFile } from '../server/rollout-file.mjs';
test('compressed history shares parsing, metadata and settings without rewriting the source', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'negus-zst-'));
 const file=path.join(root,'test.jsonl.zst');
 const content=[{type:'session_meta',payload:{id:'test',cwd:root}},
 {type:'response_item',timestamp:'2026-11-03T10:00:00Z',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'compressed reply'}]}}].map(JSON.stringify).join('\n')+'\n';
 const packed=zstdCompressSync(Buffer.from(content));await fs.writeFile(file,packed);
 const history=createJsonlConversationStore({sessionRoot:root,projectRoot:root});
 const client={request:async()=>{throw Error('thread not loaded')},subscribe:()=>()=>{},close:()=>{}};
 const store=createAppServerConversationStore({projectRoot:root,client,historyFallback:(...args)=>history.findSession(...args),autoTitleEnabled:false});
 try {const d=await history.findSession('test');assert.equal(d.messages.at(-1).text,'compressed reply');
 assert.equal((await history.findSession('test')).messages.length,1);
 assert.equal(await latestAssistantReplyAtFromRollout(file),'2026-11-03T10:00:00.000Z');
 await store.getRuntimeContext('test',{historyFile:file});assert.deepEqual(await fs.readFile(file),packed);
 } finally {history.close();store.close();await fs.rm(root,{recursive:true,force:true});}
});

test('compacted continuation rollout supplies the latest preview and runtime usage', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'negus-compacted-'));
 const id='00000000-0000-4000-8000-000000000002';
 const directory=path.join(root,'sessions','2026','11','07');
 await fs.mkdir(directory,{recursive:true});
 const original=path.join(directory,`rollout-2026-11-07T20-00-00-${id}.jsonl`);
 const continuation=path.join(directory,`rollout-2026-11-08T20-00-00-${id}_continuation.jsonl`);
 const record=(timestamp,payload,type='response_item')=>JSON.stringify({timestamp,type,payload})+'\n';
 await fs.writeFile(original,
  record('2026-11-07T12:00:00Z',{type:'message',role:'assistant',content:[{type:'output_text',text:'旧摘要'}]})
  + record('2026-11-07T12:00:01Z',{type:'token_count',info:{last_token_usage:{total_tokens:470103},model_context_window:996147}},'event_msg'));
 await new Promise(resolve=>setTimeout(resolve,20));
 await fs.writeFile(continuation,
  record('2026-11-08T12:00:00Z',{type:'message',role:'assistant',content:[{type:'output_text',text:'压缩后的最新摘要'}]})
  + record('2026-11-08T12:00:01Z',{type:'message',role:'assistant',content:[{type:'output_text',text:'after'}]})
  + record('2026-11-08T12:00:01.5Z',{model:'deepseek-flash',effort:'high'},'turn_context')
  + record('2026-11-08T12:00:02Z',{type:'token_count',info:{last_token_usage:{total_tokens:212348},model_context_window:996147}},'event_msg'));
 try {
  assert.equal(await latestRolloutFile(original),continuation);
  assert.equal((await latestAssistantReplyAtFromRollout(original,false,true)).latestMessage,'助手：after');
  assert.equal((await latestAssistantReplyAtFromRollout(original,'latest')).usage.usedTokens,212348);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('restarted employee context reads persisted usage through the provider history reader without a writer', async t => {
  const { createProviderConversationStore } = await import('../server/provider-conversation-store.mjs');
  const { createEmployeeRuntimeService } = await import('../server/employee-runtime-service.mjs');
  const { createContextManagementService } = await import('../server/context-management-service.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-employee-usage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout.jsonl'), calls = [];
  await fs.writeFile(file, [
    { type: 'turn_context', payload: { model: 'saved-model', effort: 'high' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 321 }, model_context_window: 1000 } } },
  ].map(JSON.stringify).join('\n'));
  const client = { close() {}, subscribe: () => () => {}, request: async method => {
    calls.push(method); assert.equal(method, 'thread/read');
    return { thread: { id: 'saved-thread', cwd: root, path: file } };
  } };
  const native = createAppServerConversationStore({ projectRoot: root, client, autoTitleEnabled: false });
  t.after(() => native.close());
  const providers = createProviderConversationStore({ current: native, providers: { getClient: async () => client },
    createStore: () => native, stateFile: path.join(root, 'routes.json') });
  const employee = { id: 'test', mainThreadId: 'saved-thread', model: 'saved-model', modelProviderId: 'current', reasoningEffort: 'high' };
  const runtime = createEmployeeRuntimeService({ registry: { list: () => [employee], require: () => employee },
    client, conversationStore: {}, projectRoot: root, readRuntimeContext: providers.getRuntimeContextForProvider });
  t.after(() => runtime.close());
  const events = [];
  const context = await createContextManagementService({ stateFile: path.join(root, 'context.json'), broadcast: event => events.push(event),
    getExecutionStatus: () => ({ active: false }), getRuntimeContext: runtime.getRuntimeContext, compactContext: () => assert.fail('no compact') });
  t.after(() => context.close());
  const result = await context.load('saved-thread');
  assert.equal(result.usedTokens, 321); assert.equal(result.percentage, 32);
  assert.ok(result.updatedAt); assert.deepEqual(events, []);
  assert.deepEqual(calls, ['thread/read']);
});
