import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from '../../ui-feishu/node_modules/typescript/lib/typescript.js';
import { createExecutionTracker } from '../server/execution-tracker.mjs';
import { messagesFromTurns } from '../server/codex-thread-history.mjs';
import { createFollowUpQueueService } from '../server/follow-up-queue-service.mjs';
const load = async name => {
  const source = await fs.readFile(new URL(`../../ui-feishu/shared/features/conversations/state/${name}.ts`, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`);
};
const { executionHandoff } = await load('executionHandoff');
test('connection placeholder stays hidden while submitted, but errors and notices stay visible', () => {
  const status = { threadId: 'a', phase: 'submitted', active: true, startedAt: '2026-10-29T00:00:00Z' };
  assert.equal(executionHandoff('a', [], status).showExecution, false);
  assert.equal(executionHandoff('a', [], { ...status, notices: ['connection error'] }).showExecution, true);
  assert.equal(executionHandoff('a', [], { ...status, phase: 'failed' }).showExecution, true);
  assert.equal(executionHandoff('a', [], { ...status, phase: 'waitingOnApproval' }).showExecution, true);
  assert.equal(executionHandoff('a', [], { ...status, phase: 'working' }).showExecution, true);
});
const { advanceLiveTranscript, createLiveTranscriptMemory } = await load('liveTranscript');
const { mergeMessageList, mergeSessionRefresh, mergeSessionDelta } = await load('conversationMerge');
const { createOptimisticMessage } = await load('optimisticMessage');
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

test('server turn order survives skewed device clocks, steers, images and delayed queue handoff', () => {
  const started = 1793245362000;
  const actualId = 'msg-mvsiu69q-d6211270-087f-4b83-94fe-5b8e43b2f823';
  const content = [{type:'text',text:'text with image'}, {type:'image',url:'https://example.test/image.png'}];
  for (const offset of [-8, 8]) {
    const id = offset === -8 ? actualId : `msg-${(started + offset * 3600000).toString(36)}-test`;
    const turn = {id:'turn',startedAt:started / 1000,completedAt:(started + 8000) / 1000,items:[
      {type:'userMessage',id:'u1',clientId:id,content},
      {type:'agentMessage',id:'a1',text:'working'},
      {type:'userMessage',id:'u2',clientId:'steer',content:[{type:'text',text:'additional'}]},
      {type:'agentMessage',id:'a2',text:'done'},
    ]};
    const earlier = {id:'older',role:'assistant',text:'older',createdAt:new Date(started - 30000).toISOString()};
    const later = {id:'later',role:'user',text:'later',turnId:'next',turnStartedAtMs:started+15000,createdAt:new Date(started+15000).toISOString()};
    const persisted = messagesFromTurns([turn]);
    assert.equal(persisted[0].createdAt, new Date(started).toISOString());
    assert.equal(persisted[2].createdAt, undefined);
    assert.deepEqual(persisted[0].blocks.map(b=>b.type), ['markdown','image']);
    const optimistic = {id:`optimistic-${id}`,role:'user',text:'text with image',submissionId:id,createdAt:new Date(started+offset*3600000).toISOString(),deliveryState:'sending',blocks:persisted[0].blocks};
    for (const deliveryState of ['sending','pending',undefined]) {
      assert.deepEqual(mergeMessageList([earlier],[{...optimistic,deliveryState}]).map(m=>m.id), ['older',optimistic.id]);
    }
    const current = {threadId:'t',messages:[earlier,{...optimistic,createdAt:new Date(started-1000).toISOString(),serverTimestamp:true,deliveryState:undefined}]};
    const incoming = {threadId:'t',messages:[earlier,...persisted,later]};
    const refresh = mergeSessionRefresh(current,incoming).messages;
    assert.deepEqual(refresh.map(m=>m.text), ['older','text with image','working','additional','done','later']);
    assert.deepEqual(refresh[1].blocks.map(b=>b.type), ['markdown','image']);
    const delta = mergeSessionDelta(current,{upserts:[...persisted,later],deletes:[],contentVersion:2,sessionPatch:{}}).messages;
    assert.deepEqual(delta.map(m=>m.text), refresh.map(m=>m.text));
    const waiting = mergeSessionRefresh(current,{threadId:'t',messages:[earlier]}).messages;
    assert.equal(waiting.at(-1).submissionId,id);
    assert.equal(waiting.at(-1).blocks[1].type,'image');
  }
});

test('queued image message remains present from dispatch through acceptance and history', async () => {
  const events = [];
  const attachment = {id:'image',name:'image.png',mimeType:'image/png',url:'https://example.test/image.png'};
  const tracker = createExecutionTracker({broadcast:event=>events.push(event)});
  const queue = createFollowUpQueueService({
    execution:{getStatus:()=>({active:true,turnId:'turn',phase:'working'})},
    media:{resolveMany:()=>[attachment]},
    publishThreadEvent:(_thread,event)=>events.push(event),
    conversations:{steerMessage:async (threadId,turnId,_text,_attachments,clientId)=>{
      tracker.handleProtocolMessage({method:'item/started',params:{threadId,turnId,item:{type:'userMessage',id:'native',clientId}}});
    }},
  });
  try {
    const item = await queue.enqueue({threadId:'t',text:'queued text',attachmentIds:['image'],attachments:[attachment],submissionId:'queue-device-id'});
    await queue.sendNow('t',item.id);
    const submitted = events.find(e=>e.type==='user_message_submitted');
    const accepted = events.find(e=>e.type==='user_message_accepted');
    const completed = events.find(e=>e.type==='queue_changed' && e.reason==='completed');
    assert.ok(events.indexOf(submitted) < events.indexOf(accepted));
    assert.ok(events.indexOf(accepted) < events.indexOf(completed));
    assert.notEqual(submitted.submissionId,item.submissionId);
    const local = {...createOptimisticMessage(submitted.text,submitted.attachments,submitted.submissionId,submitted.createdAt),turnId:accepted.turnId};
    const beforeHistory = mergeSessionRefresh({threadId:'t',messages:[local]}, {threadId:'t',messages:[]});
    assert.equal(beforeHistory.messages[0].blocks[1].source,attachment.url);
    const persisted = messagesFromTurns([{id:'turn',startedAt:Date.parse(submitted.createdAt)/1000,items:[
      {type:'userMessage',id:'native',clientId:submitted.submissionId,content:[{type:'text',text:submitted.text},{type:'image',url:attachment.url}]},
    ]}]);
    const afterHistory = mergeSessionRefresh(beforeHistory,{threadId:'t',messages:persisted});
    assert.equal(afterHistory.messages.length,1);
    assert.equal(afterHistory.messages[0].text,'queued text');
    assert.equal(afterHistory.messages[0].blocks[1].source,attachment.url);
  } finally { await queue.close(); await tracker.close(); }
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

test('partial refresh retains acknowledged follow-ups until history catches up', () => {
  const first = {id:'first',role:'user',text:'first'};
  const followup = {id:'followup',role:'user',text:'追加消息'};
  const current = {threadId:'t',messages:[first,followup]};
  const partial = mergeSessionRefresh(current,{threadId:'t',hasMore:true,messages:[first]});
  assert.deepEqual(partial.messages.map(m=>m.id),['first','followup']);
  const caughtUp = mergeSessionRefresh(partial,{threadId:'t',hasMore:true,messages:[first,followup]});
  assert.deepEqual(caughtUp.messages.map(m=>m.id),['first','followup']);
  const reverted = mergeSessionRefresh(current,{threadId:'t',hasMore:false,messages:[first]});
  assert.deepEqual(reverted.messages.map(m=>m.id),['first']);
});

// FEAT-001 2026-10-30: equal length is not equal content; metadata is part of the same message view.
test('transcript cache refreshes equal-length text and author changes', () => {
  const memory=createLiveTranscriptMemory();
  const input={threadId:'t',messages:[{id:'m',role:'assistant',text:'old',authorName:'A'}],streamingText:'',streamingItemId:'',turnId:'',active:false,showExecution:false};
  advanceLiveTranscript(memory,input);
  const result=advanceLiveTranscript(memory,{...input,messages:[{...input.messages[0],text:'new',authorName:'B'}]});
  assert.equal(result.persisted[0].text,'new');
  assert.equal(result.persisted[0].authorName,'B');
});
