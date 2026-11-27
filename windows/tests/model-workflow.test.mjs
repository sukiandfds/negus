import test from 'node:test';
import assert from 'node:assert/strict';
import { modelWorkflow, migrationTargets, vip } from './model-workflow.fixture.mjs';
import { selectTaskRoute } from '../server/background-tasks/model-policy.mjs';
import { createNativeTaskRuntime } from '../../ui-feishu/kernel/native-task-runtime.mjs';

test('A–D: live submission 402 without turn, durable read, alias rejection at submission and task fallback', async t => {
  const f=await modelWorkflow(t), id=f.ids['fixture-1'], project='worker-1', other=f.ids['fixture-0'];
  const identity=f.registry.require('fixture-1').conversationId;
  const args={project,thread:id}, pick={...args,model:'fixture-b',modelProviderId:'ccswitch_b'};
  const policy={defaultModel:'fixture-a',reasoningEffort:'high',channels:['a','alias','b','c'].map(name=>({name}))};
  assert.equal((await f.call('conversation_model_get',{project,thread:other})).isError,true);
  assert.equal((await f.call('conversation_model_set',{...pick,thread:other})).isError,true);
  assert.equal((await f.call('conversation_model_set',{...pick,actor:'owner'})).isError,true);
  const defaults=(await f.call('model_defaults_get',{project}));
  assert.deepEqual(defaults.configured,(await f.api('/api/model-defaults')).body);
  assert.equal((await f.call('conversation_model_get',args)).current.model,'fixture-a');
  assert.equal((await selectTaskRoute(f.providers,{model:'fixture-a',modelProviderId:'ccswitch_a'},{policy})).modelProviderId,'ccswitch_a');
  const ordinary=(submissionId,text,attachmentIds)=>f.api('/api/session/message',{threadId:id,conversationId:identity,submissionId,text,attachmentIds});
  f.controls.failStart=Object.assign(Error('request refused: token=fixture-private-value'),{httpStatus:402,statusCode:502});
  const a=await ordinary('first-402','这条提交在分配轮次前失败',['fixture-file']);
  assert.equal(a.status,502);
  assert.match(a.body.error,/402/);
  assert.doesNotMatch(JSON.stringify(a.body),/fixture-private-value/);
  assert.equal(f.controls.starts.length,1);
  const getMessages=async()=> (await f.call('message_list',args)).messages;
  const first=(await getMessages()).find(m=>m.submissionId==='first-402');
  assert.equal(first.state,'failed');
  assert.equal(first.failure.turnId,'');
  assert.equal(first.failure.billingChannelId,'ccswitch_a');
  assert.match(first.text,/分配轮次前失败/);
  const body=await f.api('/api/session?threadId='+id+'&conversationId='+identity);
  const original=body.body.messages.find(m=>m.submissionId==='first-402');
  assert.equal(original.deliveryState,'failed');
  assert.equal(original.attachments[0].url,'/api/media/fixture-file');
  assert.doesNotMatch(JSON.stringify(original),/private-fixture/);
  await f.restart();
  assert.deepEqual((await getMessages()).find(m=>m.submissionId==='first-402'),first);
  const channels=(await f.call('channel_list',{project})).channels;
  for(const alias of ['current','ccswitch_a','ccswitch_alias'])
    assert.equal(channels.find(c=>c.modelProviderId===alias).available,false);
  assert.equal((await f.api('/api/model-channels')).body.some?.(c=>c.id==='alias'&&c.switchable===false) ??
    (await f.api('/api/model-channels')).body.channels.some(c=>c.id==='alias'&&c.switchable===false),true);
  assert.equal((await ordinary('second-reject','同配置请拒绝')).status,409);
  const muse=await f.call('message_submit',{...args,submissionId:'muse-reject',text:'不要入队'});
  assert.equal(muse.isError,true);
  assert.match(muse.error,/余额不足/);
  assert.equal((await f.api('/api/session/queue',{threadId:id,submissionId:'queue-reject',text:'不要入队'})).status,409);
  assert.deepEqual(f.queue.list(id),[]);
  assert.equal(f.controls.starts.length,1);
  const route=await selectTaskRoute(f.providers,{model:'fixture-a',modelProviderId:'ccswitch_a'},{policy});
  assert.equal(route.modelProviderId,'ccswitch_b');
  assert.equal(route.model,'fixture-a');
  const stale=createNativeTaskRuntime({modelProviders:f.providers,resolve:async()=>({
    client:{subscribe:()=>()=>{},request:async()=>assert.fail('stale route must never call generation')},
    threadId:'queued-task-thread',input:[],modelExecution:{modelProviderId:'ccswitch_alias',model:'fixture-a'},
  })});
  const stopped=await stale.execute({id:'old-task',modelProviderId:'ccswitch_alias',runtime:{}},
    {signal:new AbortController().signal,checkpoint:async()=>{}});
  assert.equal(stopped.status,'failed');
  assert.equal(f.providers.executionRecords.task('old-task').code,'channel_unavailable');
  assert.equal((await f.call('conversation_model_set',pick)).state,'pending_application');
  f.controls.failStart=null;
  const sent=await ordinary('later-send','切换后继续处理原文');
  assert.equal(sent.status,202);
  assert.equal(f.controls.starts.at(-1).provider,'ccswitch_b');
  assert.equal(f.controls.starts.at(-1).model,'fixture-b');
  assert.ok((await getMessages()).some(m=>m.submissionId==='later-send'&&m.state==='running'));
  const provider=f.clients.get('ccswitch_b'), native=f.controls.starts.at(-1).threadId;
  const balance={message:'402: fixture-private-value',httpStatus:402};
  provider.notice(native,'retired-turn',balance);
  provider.notice(native,sent.body.turnId,balance,true);
  assert.equal((await getMessages()).find(m=>m.submissionId==='later-send').state,'running');
  provider.notice(native,sent.body.turnId,{message:'quoted prior 402: fixture-private-value',httpStatus:429});
  assert.equal((await getMessages()).find(m=>m.submissionId==='later-send').failure.code,'rate_limit');
  await provider.finish(native,{message:'generic terminal failure'});
  assert.equal((await getMessages()).find(m=>m.submissionId==='later-send').failure.code,'rate_limit');
  assert.equal(f.providers.channelAvailability('ccswitch_b').available,true);
  assert.equal((await getMessages()).find(m=>m.submissionId==='first-402').state,'failed');
  assert.deepEqual((await f.call('model_defaults_get',{project})).configured,defaults.configured);
  await f.replaceChannelList('ccswitch_a','ccswitch_second_alias');
  await f.restart();
  for(const id of ['current','ccswitch_alias','ccswitch_second_alias']) assert.equal(f.providers.channelAvailability(id).available,false);
  assert.doesNotMatch(JSON.stringify(await f.call('channel_list',{project})),/billingAccountId|fake-a/);
});

test('error before start response binds only to the confirmed submission, for browser sends and task execution', async t=>{
  const f=await modelWorkflow(t);
  const error={message:'quoted prior 402: fixture-private-value',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:408}}};
  f.controls.earlyError=error;
  const direct=f.registry.require('fixture-0'), directArgs={project:'worker-0',thread:direct.mainThreadId};
  for(const [args,conversationId] of [[directArgs,direct.conversationId],[{project:'ordinary',thread:f.ordinaryId},undefined]]) {
    const submissionId='early-'+args.project;
    const response=await f.api('/api/session/message',{threadId:args.thread,conversationId,submissionId,text:'原提交仍可找回'});
    assert.equal(response.status,202,JSON.stringify(response.body));
    const {messages:[failed]}=await f.call('message_list',{...args,submissionId});
    assert.equal(failed.state,'failed');
    assert.equal(failed.failure.code,'timeout');
    assert.equal(failed.failure.turnId,response.body.turnId);
    assert.doesNotMatch(JSON.stringify(failed),/fixture-private-value/);
  }
  assert.equal(f.providers.channelAvailability('current').available,true);
  let notice;
  const client={subscribe(fn){notice=fn;return ()=>{};},async request(method){
    assert.equal(method,'turn/start');
    for(const turnId of ['old','new'])notice({method:'error',params:{threadId:'task-thread',turnId,willRetry:false,
      error:turnId==='old'?{httpStatusCode:402}:error}});
    await Promise.resolve();
    return {turn:{id:'new',status:'inProgress'}};
  }};
  const runtime=createNativeTaskRuntime({modelProviders:f.providers,
    resolve:async()=>({client,threadId:'task-thread',input:[],modelExecution:{modelProviderId:'ccswitch_b',model:'fixture-b'}})});
  const task={id:'task-early',source:{messageId:'source-post'},modelProviderId:'ccswitch_b',runtime:{}};
  const result=await runtime.execute(task,{signal:new AbortController().signal,checkpoint:async()=>{},started:async()=>{}});
  assert.equal(result.status,'failed');
  await f.restart();
  const recorded=f.providers.executionRecords.task(task.id);
  assert.equal(recorded.submissionId,'source-post');
  assert.equal(recorded.turnId,'new');
  assert.equal(recorded.code,'timeout');
  assert.equal(recorded.billingChannelId,'ccswitch_b');
  assert.equal(f.providers.channelAvailability('ccswitch_b').available,true);
});

test('three isolated employee migrations and failed handoff preserve thread, identity, history and audit', async t => {
  const f=await modelWorkflow(t);
  const read=(p,id)=>f.call('message_list',{project:p,thread:id});
  for(const [i,employee] of f.workers.entries()) {
    const thread=f.ids[employee.id], project=employee.projectKey;
    const original=f.registry.require(employee.id);
    const {model,effort}=migrationTargets[i];
    const args={project,thread}, pick={...args,model,effort,modelProviderId:vip};
    let displaced;
    if(i===2) {
      displaced=await f.call('conversation_model_set',{...pick,model:'gpt-6.2-sol',effort:'high'});
      assert.equal(displaced.state,'pending_application');
    }
    const pending=await f.call('conversation_model_set',pick);
    assert.equal(pending.state,'pending_application');
    assert.deepEqual(pending.next,{model,modelProviderId:vip,reasoningEffort:effort});
    assert.equal((await f.call('conversation_model_get',args)).current.modelProviderId,'current');
    if(displaced)assert.ok((await f.providers.modelEvents.events.history(project))
      .some(e=>e.callId===displaced.callId&&e.state==='superseded'));
    const attempt=submissionId=>f.api('/api/session/message',{threadId:thread,conversationId:original.conversationId,text:'续聊 '+employee.name,submissionId});
    if(i===1) {
      f.controls.failCompact=vip;
      assert.ok((await attempt('handoff-failed')).status>=400);
      const failed=await f.call('conversation_model_get',args);
      assert.equal(failed.current.modelProviderId,'current');
      assert.equal(failed.next.modelProviderId,vip);
      assert.equal(f.registry.require(employee.id).runtimeThreadIds.length,0);
      assert.ok((await read(project,thread)).messages.some(m=>m.text==='原历史 '+employee.name));
      assert.ok((await f.providers.modelEvents.events.history(project)).some(e=>e.state==='apply_failed'));
      f.controls.failCompact=null;
    }
    const sent=await attempt('after-'+i);
    assert.equal(sent.status,202);
    assert.equal(sent.body.threadId,thread);
    const native=f.controls.starts.at(-1);
    assert.equal(native.provider,vip);
    assert.equal(native.model,model);
    assert.equal(native.effort,effort);
    assert.notEqual(native.threadId,thread);
    assert.equal(f.registry.require(employee.id).conversationId,original.conversationId);
    assert.equal(f.registry.require(employee.id).mainThreadId,thread);
    const messages=await read(project,thread);
    assert.ok(messages.messages.some(m=>m.text==='原历史 '+employee.name));
    const during=await f.call('conversation_model_get',args);
    assert.equal(during.lastSuccessfulSettings.model,'fixture-a');
    assert.equal(during.lastSuccessfulSettings.modelProviderId,'current');
    await f.clients.get(vip).finish(native.threadId);
    const rows=await f.providers.modelEvents.events.history(project);
    const selected=rows.find(e=>e.state==='pending_application'&&e.callId===pending.callId);
    const applied=rows.find(e=>e.state==='applied');
    assert.equal(selected.callId,applied.callId);
    assert.equal(applied.actor,'00');
    assert.equal(applied.objectId,thread);
    assert.equal(applied.modelChange.previous.modelProviderId,'current');
    assert.deepEqual(applied.modelChange.next,{model,modelProviderId:vip,reasoningEffort:effort});
    assert.ok(applied.modelChange.credentialId);
  }
  await f.restart();
  for(const [i,employee] of f.workers.entries()) {
    const original=f.registry.require(employee.id);
    const args={project:employee.projectKey,thread:f.ids[employee.id]};
    const selection=await f.call('conversation_model_get',args);
    assert.equal(selection.current.modelProviderId,vip);
    assert.equal(selection.lastSuccessfulSettings.model,migrationTargets[i].model);
    assert.equal(selection.lastSuccessfulSettings.reasoningEffort,migrationTargets[i].effort);
    assert.equal((await f.call('conversation_model_set',{...args,...{model:'fixture-a',modelProviderId:'current',effort:'high'}})).state,'pending_application');
    const rollback=await f.api('/api/session/message',{threadId:args.thread,conversationId:original.conversationId,
      submissionId:'rollback-'+i,text:'隔离反向切回'});
    assert.equal(rollback.status,202,JSON.stringify(rollback.body));
    assert.equal(rollback.body.threadId,args.thread);
    const native=f.controls.starts.at(-1);
    assert.equal(native.provider,'current');
    assert.equal(native.model,'fixture-a');
    assert.equal(native.effort,'high');
    assert.equal(f.registry.require(employee.id).conversationId,original.conversationId);
    assert.ok((await read(args.project,args.thread)).messages.some(m=>m.text==='原历史 '+employee.name));
    await f.clients.get('current').finish(native.threadId);
  }
});

test('ordinary existing conversation through MCP then the normal send route keeps its native ID and last good model', async t=>{
  const f=await modelWorkflow(t), thread=f.ordinaryId, args={project:'ordinary',thread};
  const get=()=>f.call('conversation_model_get',args);
  const before=await get();
  assert.equal(before.current.model,'fixture-a');
  assert.equal(before.lastSuccessfulSettings.model,'fixture-a');
  assert.equal((await f.call('conversation_model_set',{...args,model:'fixture-b',modelProviderId:'ccswitch_b',effort:'high'})).state,'pending_application');
  const submit=(submissionId,text)=>f.api('/api/session/message',{threadId:thread,submissionId,text});
  f.controls.failCompact='ccswitch_b';
  assert.ok((await submit('ordinary-failure','普通接续失败')).status>=400);
  assert.equal((await get()).current.modelProviderId,'current');
  assert.equal((await get()).lastSuccessfulSettings.model,'fixture-a');
  assert.equal(f.controls.starts.length,0);
  const failed=(await f.call('message_list',{...args,submissionId:'ordinary-failure'})).messages[0];
  assert.equal(failed.failure.code,'timeout');
  assert.equal(f.providers.channelAvailability('ccswitch_b').available,true);
  f.controls.failCompact=null;
  const sent=await submit('ordinary-success','继续原对话');
  assert.equal(sent.status,202);
  assert.equal(sent.body.threadId,thread);
  assert.equal(f.controls.starts.at(-1).threadId,thread);
  assert.equal(f.controls.starts.at(-1).provider,'ccswitch_b');
  assert.equal(f.controls.starts.at(-1).model,'fixture-b');
  assert.equal((await get()).lastSuccessfulSettings.model,'fixture-a');
  assert.ok((await f.call('message_list',args)).messages.some(m=>m.text==='普通对话保留此历史'));
  await f.clients.get('ccswitch_b').finish(thread);
  assert.equal((await get()).lastSuccessfulSettings.model,'ccswitch_b::fixture-b');
});
