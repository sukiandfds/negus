import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../../ui-feishu/node_modules/typescript/lib/typescript.js';
import { createExecutionTracker } from '../server/execution-tracker.mjs';
const load = async name => {
  const source = await fs.readFile(new URL(`../../ui-feishu/shared/features/conversations/state/${name}.ts`, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`);
};
const { executionHandoff } = await load('executionHandoff');
const { advanceLiveTranscript, createLiveTranscriptMemory } = await load('liveTranscript');
const { mergeMessageList } = await load('conversationMerge');
const status = {threadId:'a',turnId:'protocol',startedAt:'2026-10-27T05:55:04Z',phase:'completed',hasFinalAnswer:true};
const commentary = {id:'comment',role:'assistant',text:'checking',turnId:'internal',protocolTurnId:'protocol',phase:'commentary',createdAt:'2026-10-27T05:55:57.434Z'};
const final = {...commentary,id:'final',text:'done',phase:'final_answer',createdAt:'2026-10-27T05:56:25.045Z'};
test('completion before history, commentary only, remount, final handoff and different thread', () => {
  for (const messages of [[],[commentary]]) {
    const handoff = executionHandoff('a',messages,status);
    assert.equal(handoff.waitingForReply,true);
    const view = advanceLiveTranscript(createLiveTranscriptMemory(),{threadId:'a',messages,turnId:'protocol',streamingText:'',streamingItemId:'',active:false,showExecution:handoff.showExecution,retainPlaceholder:handoff.waitingForReply,now:'2026-10-27T06:30:00Z'});
    assert.ok(view.placeholder);
  }
  const handoff = executionHandoff('a',[final,commentary],status);
  assert.equal(handoff.waitingForReply,false);
  assert.equal(handoff.latestReplyAt,final.createdAt);
  assert.equal(executionHandoff('b',[final],status).showExecution,false);
  for (const phase of ['failed','interrupted','systemError']) assert.equal(executionHandoff('a',[],{...status,phase}).waitingForReply,false);
  assert.equal(executionHandoff('a',[],{...status,hasFinalAnswer:false}).waitingForReply,false);
});
test('submission identity confirms quick repeated text individually', () => {
  const local = id => ({id:`optimistic-${id}`,role:'user',text:'same',submissionId:id,turnId:'protocol'});
  const history = id => ({...local(id),id:`native-${id}`,turnId:'internal'});
  const messages = mergeMessageList([local('one'),local('two')],[history('one')]);
  assert.deepEqual(messages.map(m=>m.id),['native-one','optimistic-two']);
  assert.deepEqual(mergeMessageList(messages,[history('two')]).map(m=>m.id),['native-one','native-two']);
  assert.equal(mergeMessageList([local('one')],[{id:'unidentified',role:'user',text:'same',turnId:'protocol'}]).length,2);
});
test('tracker distinguishes commentary, final and empty completion and requests terminal history', async () => {
  const events=[];const tracker=createExecutionTracker({broadcast:e=>events.push(e)});
  const send=(method,params)=>tracker.handleProtocolMessage({method,params:{threadId:'a',...params}});
  send('turn/started',{turn:{id:'protocol'}});
  send('item/completed',{turnId:'protocol',item:{id:'c',type:'agentMessage',phase:'commentary',text:'checking'}});
  assert.equal(tracker.getStatus('a').hasFinalAnswer,undefined);
  send('item/completed',{turnId:'protocol',item:{id:'f',type:'agentMessage',phase:'final_answer',text:'done'}});
  send('turn/completed',{turn:{id:'protocol',status:'completed',items:[]}});
  assert.equal(tracker.getStatus('a').hasFinalAnswer,true);
  assert.equal(events.at(-1).type,'sessions_changed');
  send('turn/started',{turn:{id:'next'}});
  send('turn/completed',{turn:{id:'next',status:'completed',items:[]}});
  assert.equal(tracker.getStatus('a').hasFinalAnswer,undefined);
  await tracker.close();
});

test('empty completion keeps placeholder through late final, remount and next-turn isolation', async () => {
  const tracker=createExecutionTracker({broadcast:()=>{}});
  const send=(method,params)=>tracker.handleProtocolMessage({method,params:{threadId:'a',...params}});
  const check=(expected,messages=[])=>{
    const current=tracker.getStatus('a');
    const handoff=executionHandoff('a',messages,current);
    assert.equal(handoff.waitingForReply,expected);
    const view=advanceLiveTranscript(createLiveTranscriptMemory(),{threadId:'a',messages,turnId:current.turnId,streamingText:'',streamingItemId:'',active:false,showExecution:handoff.showExecution,retainPlaceholder:handoff.waitingForReply});
    if(expected) assert.ok(view.placeholder);
  };
  send('turn/started',{turn:{id:'protocol'}});
  send('turn/completed',{turn:{id:'protocol',status:'completed',items:[]}});
  assert.equal(tracker.getStatus('a').hasFinalAnswer,undefined);check(true);check(true,[commentary]);
  send('item/completed',{turnId:'protocol',item:{type:'agentMessage',phase:'final_answer',text:'done'}});
  check(true);check(false,[final]);
  send('turn/started',{turn:{id:'next'}});
  send('turn/completed',{turn:{id:'next',status:'completed'}});
  check(true,[final]);
  send('item/completed',{turnId:'protocol',item:{type:'agentMessage',phase:'final_answer',text:''}});
  assert.equal(tracker.getStatus('a').hasFinalAnswer,undefined);check(true);
  send('item/completed',{turnId:'next',item:{type:'agentMessage',phase:'final_answer',text:'  '}});
  check(false);check(false);
  await tracker.close();
});

test('only complete history evidence closes unknown no-reply, including after remount', () => {
  const unknown={...status,hasFinalAnswer:undefined};
  const user={id:'u',role:'user',text:'hello',protocolTurnId:'protocol',turnStatus:'completed',turnHasFinalAnswer:false};
  for(let remount=0;remount<2;remount++) {
    assert.equal(executionHandoff('a',[],unknown).waitingForReply,true);
    assert.equal(executionHandoff('a',[{...user,turnHasFinalAnswer:undefined}],unknown).waitingForReply,true);
    assert.equal(executionHandoff('a',[{...user,protocolTurnId:'old'}],unknown).waitingForReply,true);
    assert.equal(executionHandoff('a',[user],unknown).waitingForReply,false);
    assert.equal(executionHandoff('a',[{...user,turnHasFinalAnswer:true}],unknown).waitingForReply,true);
    assert.equal(executionHandoff('a',[user],status).waitingForReply,true);
  }
});
