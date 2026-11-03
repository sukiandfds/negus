import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../../ui-feishu/node_modules/typescript/lib/typescript.js';
const source=await fs.readFile(new URL('../../ui-feishu/shared/features/conversations/state/conversationBatch.ts',import.meta.url),'utf8');
const {readConversationBatches}=await import(`data:text/javascript;base64,${Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64')}`);
test('fixed ten publish together, remainder begins afterwards',async()=>{
 const calls=[],publications=[];let release;const held=new Promise(resolve=>release=resolve);
 const promise=readConversationBatches(Array.from({length:12},(_,i)=>i),async i=>{calls.push(i);if(i===9)await held;},r=>publications.push(r),new AbortController().signal,1000);
 await new Promise(r=>setTimeout(r,5));assert.equal(calls.length,10);assert.equal(publications.length,0);
 release();await promise;assert.deepEqual(publications.map(p=>p.length),[10,2]);assert.deepEqual(calls,Array.from({length:12},(_,i)=>i));
});
test('one slow read cannot hold nine successes or restart deadline; late completion never republishes',async()=>{
 const publications=[],signals=[];let release;const held=new Promise(resolve=>release=resolve);
 await readConversationBatches(Array.from({length:10},(_,i)=>i),(i,signal)=>{if(i===9){signals.push(signal);return held;}return Promise.resolve();},r=>publications.push(r),new AbortController().signal,20);
 assert.equal(publications[0].filter(r=>!r.error).length,9);
 const failures=publications.flat().filter(r=>r.error);assert.equal(failures.length,3);assert.ok(failures.every(r=>/同步超时/.test(r.error)));
 assert.equal(failures.at(-1).retry,false);assert.ok(signals.every(signal=>signal.aborted));
 const count=publications.length;release();await new Promise(r=>setTimeout(r,5));assert.equal(publications.length,count);
});
test('cancelled view cannot publish old batch',async()=>{
 const abort=new AbortController(),publications=[];let release;const held=new Promise(resolve=>release=resolve);
 const promise=readConversationBatches([1,2],()=>held,r=>publications.push(r),abort.signal,1000);
 abort.abort();release();await promise;assert.equal(publications.length,0);
});
test('large batches bound concurrent conversation reads while publishing together',async()=>{
 let active=0,peak=0;const publications=[];
 await readConversationBatches(Array.from({length:94},(_,i)=>i),async()=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,1));active--;},r=>publications.push(r),new AbortController().signal,1000);
 assert.equal(peak,4);assert.deepEqual(publications.map(p=>p.length),[10,84]);
});

test('queued conversations are read later, never reported as failed before starting', async () => {
 const publications=[],calls=[];
 await readConversationBatches(Array.from({length:94},(_,i)=>i),i=>{calls.push(i);return new Promise(()=>{});},r=>{assert.ok(r.every(result=>calls.includes(result.entry)),'only attempted reads may fail');publications.push(r);},new AbortController().signal,30);
 assert.equal(calls.length,94*3);
 assert.equal(publications.flat().length,94*3);
 assert.ok(publications.flat().every(r=>r.error.includes('同步超时')));
});

test('transient failures retry after remaining conversations and eventually clear', async () => {
 const calls=[], publications=[], counts=new Map();
 await readConversationBatches([0,1,2],async i=>{calls.push(i);const count=(counts.get(i)||0)+1;counts.set(i,count);if(i===0&&count<3)throw Error('unavailable');},
   results=>publications.push(results),new AbortController().signal,100,2);
 assert.deepEqual(calls,[0,1,2,0,0]);
 assert.deepEqual(publications.flat().filter(r=>r.entry===0).map(r=>[r.error,r.retry]),[['unavailable',true],['unavailable',true],['',undefined]]);
});

test('cancelling a batch aborts a stalled read and publishes nothing', async () => {
 const controller=new AbortController(),publications=[];let readSignal;
 const pending=readConversationBatches([1],(_entry,signal)=>{readSignal=signal;return new Promise(()=>{});},r=>publications.push(r),controller.signal,1000);
 controller.abort();await pending;
 assert.equal(readSignal.aborted,true);assert.deepEqual(publications,[]);
});

test('deadline publishes successes without starving reads started near the deadline', async () => {
 const publications=[],calls=[];let release;
 const first=new Promise(resolve=>release=resolve);
 const pending=readConversationBatches(Array.from({length:8},(_,i)=>i),async i=>{
   calls.push(i);if(i<4)await first;else await new Promise(resolve=>setTimeout(resolve,60));
 },results=>publications.push(results),new AbortController().signal,100);
 await new Promise(resolve=>setTimeout(resolve,60));release();
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.deepEqual(publications.flat().map(r=>r.entry),[0,1,2,3]);
 await pending;
 assert.equal(calls.length,8);assert.equal(publications.flat().length,8);
 assert.ok(publications.flat().every(r=>!r.error));
});
