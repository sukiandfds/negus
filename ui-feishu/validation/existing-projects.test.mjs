import test from 'node:test';
import assert from 'node:assert/strict';
import { combineConversations } from '../server/existing-projects.mjs';

test('existing chats retain their owner for reads, edits, send, archive and forks', async () => {
 const calls=[];
 const store=(name,items)=>Object.fromEntries([
  ['listSessions',async()=>items],['createSession',async()=>name],['listModels',async()=>name],['close',()=>calls.push([name,'close'])],
  ...['findSession','renameSession','sendMessage','archiveSession','unarchiveSession','updateModel','forkSession'].map(method=>[method,async(id)=>{calls.push([name,method,id]);return method==='forkSession'?{threadId:'fork'}:{threadId:id};}]),
 ]);
 const current=store('current',[{threadId:'new'},{threadId:'duplicate',title:'current'}]);
 const old=store('old',[{threadId:'old'},{threadId:'duplicate',title:'old'}]);
 const combined=combineConversations(current,old,new Set(['old','duplicate']));
 const listed=await combined.listSessions('all',false);
 assert.equal(listed.length,3);assert.equal(listed.find(s=>s.threadId==='duplicate').title,'current');
 for(const method of ['findSession','renameSession','sendMessage','archiveSession','unarchiveSession','updateModel'])await combined[method]('old');
 assert.ok(calls.every(([owner])=>owner==='old'));
 await combined.findSession('duplicate');assert.equal(calls.at(-1)[0],'current');
 await combined.forkSession('old');await combined.sendMessage('fork');assert.deepEqual(calls.at(-1),['old','sendMessage','fork']);
 assert.equal(await combined.createSession(),'current');combined.close();assert.deepEqual(calls.slice(-2),[['current','close'],['old','close']]);
});
