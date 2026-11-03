import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { createJsonlConversationStore } from '../server/jsonl-conversation-store.mjs';
import { latestAssistantReplyAtFromRollout, createAppServerConversationStore } from '../server/app-server-conversation-store.mjs';
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
