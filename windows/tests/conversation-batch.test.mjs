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
 const publications=[];let release;const held=new Promise(resolve=>release=resolve);
 await readConversationBatches(Array.from({length:10},(_,i)=>i),i=>i===9?held:Promise.resolve(),r=>publications.push(r),new AbortController().signal,20);
 assert.equal(publications.length,1);assert.equal(publications[0].filter(r=>!r.error).length,9);assert.match(publications[0][9].error,/同步超时/);
 release();await new Promise(r=>setTimeout(r,5));assert.equal(publications.length,1);
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
