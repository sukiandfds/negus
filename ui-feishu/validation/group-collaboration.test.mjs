import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createGroupTaskService } from '../server/group-task-service.mjs';
import { createGroupRoomStore } from '../../windows/server/group-room-store.mjs';
const until = async check => { for (let i = 0; i < 800; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('condition timed out'); };
async function fixture(t, roomId = 'room', options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-collaboration-'));
  const events = [], registered = [], calls = [], turnStarts = [], threadStarts = [], resumeStarts = [], providerRequests = [],
    listeners = new Set(), health = new Set(), threads = new Map(), bridges = [];
  const agentDefinitions = options.agentDefinitions || [
    { id: 'manager', name: '运营管理', responsibility: '澄清目标、拆解任务、协调执行并汇总结论' },
    { id: 'researcher', name: '产品分析', responsibility: '需求澄清、用户流程分析、产品方案、优先级与验收' },
    { id: 'developer', name: '技术研发', responsibility: '实现已确认的代码任务、进行必要验证并报告结果' },
    { id: 'reviewer', name: '风控质量', responsibility: '检查缺陷、回归风险、安全问题和遗漏' },
    { id: 'grok', name: 'Grok 助手', responsibility: '分析、讨论和任务执行' },
  ];
  if (options.roomState) await fs.writeFile(path.join(root, 'room.json'), JSON.stringify(options.roomState));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId, project: 'fixture', agentDefinitions, broadcast: event => events.push(event) });
  for (const [id, thread] of Object.entries(options.initialThreads || {})) threads.set(id, thread);
  const emit = (method, params) => listeners.forEach(listener => listener({method, params}));
  const client = { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeHealth: listener => { health.add(listener); return () => health.delete(listener); },
    request: async (method, params) => {
      calls.push(method);
      if (method === 'thread/start') { threadStarts.push(params); const thread = { id: `thread-${threads.size}`, turns: [], config: params.config, loaded: true }; threads.set(thread.id, thread); return {thread}; }
      const thread = threads.get(params.threadId);
      if (method === 'thread/read') return {thread};
      // Match the native behavior: loaded resume does not replace MCP config.
      if (method === 'thread/resume') { resumeStarts.push(params); if (!thread.loaded) thread.config = params.config; thread.loaded = true; return {thread}; }
      if (method === 'thread/unsubscribe') { thread.loaded = false; return {}; }
      if (method === 'turn/start') { turnStarts.push(params); const turn = {id:`${thread.id}-turn-${thread.turns.length}`, status:'inProgress', items:[]}; thread.turns.push(turn); queueMicrotask(() => emit('turn/started', {threadId:thread.id,turn})); return {turn:{...turn}}; }
      if (method === 'turn/interrupt') { const turn = thread.turns.at(-1); turn.status = 'interrupted'; emit('turn/completed',{threadId:thread.id,turn}); }
      return {};
    } };
  const modelProviders = options.modelProviders
    ? { ...options.modelProviders, getClient: async route => { providerRequests.push(route); return client; } }
    : { providers:()=>[{id:'deepseek',displayName:'DeepSeek',models:[{model:'deepseek-flash'}]}],isProviderConfigured:async()=>true,
      resolveRoute: settings=>settings,getClient:async route=>{ providerRequests.push(route); return client; } };
  const selectGroupAgent = options.selectGroupAgent ?? (async ({ members }) => {
    const selected = members.find(member => member.id === 'manager') || members[0];
    return { agentIds: selected ? [selected.id] : [], selection: {
      model: 'deepseek-flash', modelProviderId: 'deepseek', reasoningEffort: 'low', durationMs: 1,
    } };
  });
  const service = await createGroupTaskService({stateRoot:root,room,projectRoot:root,appServerClient:client,broadcast:event=>events.push(event),
    modelProviders, selectGroupAgent,
    transferThread: options.transferThread,
    registerSession:async (...args)=>registered.push(args), bindings:{bindRuntime:async()=>{}},queue:{list:()=>[]},execution:{} });
  t.after(async()=>{ for (const bridge of bridges) await bridge.close(); await service.close(); await room.close(); await fs.rm(root,{recursive:true,force:true}); });
  const send = async (id, agentIds=[], text=id) => { const result = await service.receive({requestId:id,agentIds,message:{type:'human',authorId:'fixture',authorName:'fixture',text,attachments:[]}}); await until(()=>service.tasks().some(task=>task.state==='running')); return result.message; };
  const running = agentId => service.tasks().findLast(task=>task.agentId===agentId && task.state==='running');
  const complete = async (task,status='completed',{duplicate=false}={}) => { const turn=threads.get(task.runtime.threadId).turns.at(-1); turn.status=status; turn.items.push({id:`final-${turn.id}`,type:'agentMessage',text:`result ${task.agentId}`}); emit('turn/completed',{threadId:task.runtime.threadId,turn}); if (duplicate) emit('turn/completed',{threadId:task.runtime.threadId,turn}); await until(()=>service.deliveries().some(d=>d.taskId===task.id && d.state==='delivered')); };
  const ownerStatus = taskOrId => { const id=typeof taskOrId==='string'?taskOrId:taskOrId.id; return room.snapshot().messages.find(message=>message.workId===id&&message.itemId==='public-status'); };
  const ownerFinal = taskOrId => { const id=typeof taskOrId==='string'?taskOrId:taskOrId.id; return service.tasks().find(task=>task.publication?.role==='owner-final'&&task.publication.ownerTaskId===id); };
  const bridge = async task => { const config=threads.get(task.runtime.threadId).config['mcp_servers.negus_handoffs']; const mcp=new Client({name:'isolated-group-test',version:'1'}); await mcp.connect(new StdioClientTransport({command:config.command,args:config.args,env:{...process.env,...config.env}})); bridges.push(mcp); return mcp; };
  const call = async (mcp,name,args={}) => mcp.callTool({name,arguments:args});
  return {root,room,service,events,registered,calls,turnStarts,threadStarts,resumeStarts,providerRequests,threads,emit,health,send,running,complete,ownerStatus,ownerFinal,bridge,call};
}

test('group completed commentary is durable, ordered, deduplicated and survives failure/reconnect', async t=>{
  const f=await fixture(t);
  await f.send('initial',['manager','developer']);
  await until(()=>f.running('manager') && f.running('developer'));
  for (const agent of ['manager','developer']) {
    const task=f.running(agent); const item={id:`commentary-${agent}`,type:'agentMessage',phase:'commentary',text:`progress ${agent}`};
    const params={threadId:task.runtime.threadId,turnId:task.runtime.turnId,item};
    f.emit('item/agentMessage/delta',{...params,itemId:item.id,delta:item.text});
    f.emit('item/completed',params); f.emit('item/completed',params);
    f.threads.get(task.runtime.threadId).turns.at(-1).items.push(item);
    await until(()=>f.room.snapshot().messages.some(m=>m.itemId===item.id));
  }
  assert.equal(f.room.snapshot().messages.filter(m=>m.phase==='commentary').length,2);
  assert.equal(f.events.filter(e=>e.type==='group_agent_delta').length,0);
  const manager=f.running('manager');
  const supplement=await f.send('supplement',['manager']);
  await until(()=>f.service.tasks().find(x=>x.id===manager.id).inputs?.some(x=>x.accepted));
  // The history-only commentary simulates a missed item event followed by reconnect.
  f.threads.get(manager.runtime.threadId).turns.at(-1).items.push({id:'missed',type:'agentMessage',phase:'commentary',text:'recovered progress'});
  f.health.forEach(listener=>listener({phase:'recovered'}));
  await until(()=>f.room.snapshot().messages.some(m=>m.itemId==='missed'));
  await f.complete(manager);
  await f.service.cancelTask(f.running('developer').id);
  await until(()=>f.room.snapshot().messages.some(m=>m.type==='system'));
  const final=f.room.snapshot().messages.find(m=>m.workId===manager.id && !m.itemId);
  assert.equal(final.replyTo.id,supplement.id);
  assert.equal(f.room.snapshot().messages.filter(m=>m.phase==='commentary').length,3);
  const persisted=JSON.parse(await fs.readFile(path.join(f.root,'room.json'),'utf8'));
  assert.equal(persisted.messages.filter(m=>m.phase==='commentary').length,3);
  assert.deepEqual(persisted.messages.map(m=>m.sequence),[...persisted.messages.map(m=>m.sequence)].sort((a,b)=>a-b));
  const reloaded=await createGroupRoomStore({stateFile:path.join(f.root,'room.json'),roomId:'room',project:'fixture',agentDefinitions:[]});
  assert.equal(reloaded.snapshot().messages.filter(m=>m.phase==='commentary').length,3); await reloaded.close();
});

test('discussion and explicit mentions answer once in the responsible employee bubble', async t=>{
  const f=await fixture(t,'direct-and-mention');
  await f.send('discussion',[],'讨论一下这个方案');
  await until(()=>f.running('manager'));
  const manager=f.running('manager');
  f.emit('item/completed',{threadId:manager.runtime.threadId,turnId:manager.runtime.turnId,
    item:{id:'manager-opinion',type:'agentMessage',phase:'commentary',text:'独立意见：先核对范围'}});
  await f.complete(manager);
  assert.equal(f.room.snapshot().messages.filter(message=>message.agentId==='manager'&&message.type==='agent').length,2);
  assert.equal(f.room.snapshot().messages.some(message=>message.itemId==='public-status'),false);

  await f.send('mention',[],'@技术研发 直接回答');
  await until(()=>f.running('developer'));
  await f.complete(f.running('developer'));
  assert.equal(f.room.snapshot().messages.filter(message=>message.agentId==='developer'&&message.type==='agent').length,1);
  assert.equal(f.room.snapshot().messages.filter(message=>message.agentId==='manager'&&message.type==='agent').length,2);
});

test('delegated execution exposes blockers immediately without posting worker conclusions', async t=>{
  const f=await fixture(t,'delegated-blocker');
  await f.send('blocker-source',[],'@运营管理 安排技术核查');
  await until(()=>f.running('manager'));
  const manager=f.running('manager');
  const mcp=await f.bridge(manager);
  assert.notEqual((await f.call(mcp,'delegate_task',{requestId:'blocker-child',agentId:'developer',
    title:'检查实现',instructions:'检查并返回证据'})).isError,true);
  await until(()=>f.running('developer'));
  await f.complete(manager);
  await f.complete(f.running('developer'),'failed');
  await until(()=>f.ownerStatus(manager)?.failure===true);
  assert.match(f.ownerStatus(manager).text,/技术研发执行失败/);
  assert.equal(f.room.snapshot().messages.some(message=>message.agentId==='developer'),false);
  assert.equal(f.ownerFinal(manager),undefined);
  assert.equal(f.room.snapshot().messages.filter(message=>message.itemId==='public-status'&&message.workId===manager.id).length,1);
});

test('delegated risks and decisions update the same bubble and survive routine progress', async t => {
  const f=await fixture(t,'delegated-notice');
  await f.send('notice-source',[],'@运营管理 安排技术核查');
  const manager=f.running('manager');
  const mcp=await f.bridge(manager);
  const notice={requestId:'data-risk',kind:'decision',text:'继续会删除现有数据，需要您确认。'};
  assert.equal((await f.call(mcp,'publish_group_notice',notice)).isError,true);
  assert.notEqual((await f.call(mcp,'delegate_task',{requestId:'notice-child',agentId:'developer',
    title:'检查影响',instructions:'检查并返回证据'})).isError,true);
  const statusId=f.ownerStatus(manager).id;
  const child=f.running('developer');
  assert.notEqual((await f.call(mcp,'publish_group_notice',notice)).isError,true);
  assert.notEqual((await f.call(mcp,'publish_group_notice',notice)).isError,true);
  assert.equal(f.ownerStatus(manager).text,notice.text);
  f.emit('item/completed',{threadId:child.runtime.threadId,turnId:child.runtime.turnId,
    item:{id:'internal-check',type:'agentMessage',phase:'commentary',text:'后台逐项核对'}});
  await until(()=>f.service.tasks().find(task=>task.id===child.id)?.progress?.length===1);
  await f.complete(manager);
  assert.equal(f.ownerStatus(manager).id,statusId);
  assert.equal(f.ownerStatus(manager).text,notice.text);
  assert.equal(f.service.tasks().find(task=>task.id===manager.id).progress.filter(item=>item.phase==='group-notice').length,1);
  await f.complete(child);
  await until(()=>f.ownerFinal(manager)?.state==='running');
  await f.complete(f.ownerFinal(manager));
  assert.equal(f.ownerStatus(manager).id,statusId);
  assert.match(f.ownerStatus(manager).text,/需要您确认.*result manager/s);
});

test('model-selected multiple employees reply in their own identities and persist public authorship', async t=>{
  const selections=[];
  const f=await fixture(t,'model-multi-selection',{
    selectGroupAgent:async ({text,members})=>{
      selections.push({text,members:members.map(member=>member.id)});
      return {agentIds:['researcher','developer'],selection:{model:'deepseek-flash',modelProviderId:'deepseek',
        reasoningEffort:'low',durationMs:1}};
    },
  });
  await f.send('model-multi',[],'请产品分析和技术研发共同处理这个任务');
  await until(()=>f.running('researcher')&&f.running('developer'));
  assert.equal(selections.length,1);
  assert.equal(selections[0].text,'请产品分析和技术研发共同处理这个任务');
  const source=f.room.snapshot().messages.find(message=>message.text===selections[0].text);
  const tasks=f.service.tasks().filter(task=>task.source?.messageId===source.id);
  assert.deepEqual(tasks.map(task=>task.agentId).sort(),['developer','researcher']);
  assert.ok(tasks.every(task=>task.source.routing.reason==='selected'));
  assert.equal(f.service.tasks().some(task=>task.agentId==='manager'),false);
  await f.complete(f.running('researcher'));
  await f.complete(f.running('developer'));
  await until(()=>f.service.deliveries().every(item=>item.state==='delivered'));
  const persisted=JSON.parse(await fs.readFile(path.join(f.root,'room.json'),'utf8'));
  for (const [agentId,authorName] of [['researcher','产品分析'],['developer','技术研发']]) {
    const reply=persisted.messages.find(message=>message.agentId===agentId&&message.type==='agent'&&message.replyTo?.id===source.id);
    assert.ok(reply);
    assert.equal(reply.authorId,agentId);
    assert.equal(reply.authorName,authorName);
  }
});

test('group first message selects a configured fallback channel before task creation', async t=>{
  const modelProviders = {
    providers: () => [
      { id: 'channel-a', displayName: '渠道A', models: [{ model: 'beta' }] },
      { id: 'channel-b', displayName: '渠道B', models: [{ model: 'alpha' }] },
    ],
    isProviderConfigured: async () => true,
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }),
  };
  const f=await fixture(t,'collaboration-route-before-start',{
    agentDefinitions:[{id:'manager',name:'运营管理',responsibility:'协调执行',modelProviderId:'channel-a',model:'alpha',reasoningEffort:'high'}],
    modelProviders,
  });
  const message=await f.send('route-before-start',[],'直接处理这件事');
  const task=f.service.tasks().find(item=>item.conversationId==='collaboration-route-before-start'&&item.source?.messageId===message.id);
  assert.ok(task);
  assert.equal(task.modelProviderId,'channel-b');
  assert.equal(task.model,'alpha');
  assert.equal(task.reasoningEffort,'high');
  assert.equal(task.taskRouting.selectedProviderId,'channel-b');
  assert.equal(task.taskRouting.selectedModel,'alpha');
  assert.equal(task.taskRouting.reason,'同模型改用其他渠道');
  assert.ok(task.taskRouting.attempted.some(item=>item.providerId==='channel-a'&&item.reason.includes('不包含')));
  assert.equal(task.runtime.modelProviderId,'channel-b');
  assert.equal(f.threadStarts[0].model,'alpha');
  assert.ok(f.providerRequests.length>0);
  assert.ok(f.providerRequests.every(route=>route.modelProviderId==='channel-b'));
});

test('group task transfers an existing employee thread to the selected fallback channel', async t=>{
  const modelProviders = {
    providers: () => [
      { id: 'channel-a', displayName: '渠道A', models: [{ model: 'beta' }] },
      { id: 'channel-b', displayName: '渠道B', models: [{ model: 'alpha' }] },
    ],
    isProviderConfigured: async () => true,
    resolveRoute: ({ modelProviderId, model }) => ({ modelProviderId, model }),
  };
  const transfers=[];
  const f=await fixture(t,'collaboration-existing-thread-route',{
    agentDefinitions:[{id:'manager',name:'运营管理',responsibility:'协调执行'}],
    roomState:{agents:[{id:'manager',modelProviderId:'channel-a',model:'alpha',reasoningEffort:'high',threadId:'group-thread'}],
      messages:[],agentContextSequences:{}},
    initialThreads:{'group-thread':{id:'group-thread',status:{type:'idle'},turns:[],config:{},loaded:true}},
    modelProviders,
    transferThread:async ({route,threadId})=>transfers.push({route,threadId}),
  });
  const message=await f.send('existing-thread-route',[],'继续处理这件事');
  const task=f.service.tasks().find(item=>item.conversationId==='collaboration-existing-thread-route'&&item.source?.messageId===message.id);
  assert.ok(task);
  assert.equal(task.modelProviderId,'channel-b');
  assert.equal(task.model,'alpha');
  assert.equal(task.runtime.modelProviderId,'channel-b');
  assert.deepEqual(transfers,[{route:{modelProviderId:'channel-b',model:'alpha'},threadId:'group-thread'}]);
  assert.equal(f.threadStarts.length,0);
  assert.equal(f.resumeStarts.at(-1).model,'alpha');
  assert.equal(f.providerRequests.at(-1).modelProviderId,'channel-b');
  assert.equal(f.room.getAgent('manager').modelProviderId,'channel-b');
  assert.equal(f.room.getAgent('manager').model,'alpha');
});

for (const [id, request] of [
  ['database-avatar-field', '帮我更新一下数据库里的头像字段'],
  ['homepage-data-display', '修复首页数据不显示'],
]) test(`technical data request stays single-role through the real group task chain: ${id}`, async t=>{
  const f=await fixture(t,`collaboration-${id}`);
  await f.send(id,[],request);
  await until(()=>f.running('manager'));
  const manager=f.running('manager');
  assert.equal(manager.source.coordination,undefined);
  assert.equal(f.service.tasks().some(task=>task.parentTaskId===manager.id),false);
  assert.equal(f.service.tasks().some(task=>task.agentId==='researcher'),false);
  assert.equal(f.service.tasks().some(task=>task.agentId!=='manager'),false);
  await f.complete(manager);
  assert.equal(f.service.tasks().some(task=>task.agentId==='researcher'),false);
});

test('explicit mention wins over collaboration planning', async t=>{
  const f=await fixture(t,'collaboration-explicit');
  const message=await f.send('explicit-developer',[],'@技术研发 资料核实、代码实现、发布验收，几个人相互做好职责合作完成。');
  await until(()=>f.running('developer'));
  const developer=f.running('developer');
  assert.equal(developer.source.coordination,undefined);
  assert.equal(f.service.tasks().some(task=>task.agentId==='manager'),false);
  assert.equal(f.room.snapshot().messages.some(item=>item.workId===`coordination:${message.id}`),false);
  await f.complete(developer);
});

test('stopping reception before completion does not create or revive assigned employee tasks', async t=>{
  const f=await fixture(t,'collaboration-stop');
  const message=await f.send('stop-collaboration',[],'资料核实、代码实现、发布验收，几个人相互做好职责合作完成。');
  await until(()=>f.running('manager'));
  const manager=f.running('manager');
  await f.service.cancelTask(manager.id);
  await until(()=>f.service.tasks().find(task=>task.id===manager.id)?.state==='interrupted');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(f.service.tasks().some(task=>task.parentTaskId===manager.id),false);
  assert.equal(f.room.snapshot().messages.some(item=>item.workId===`coordination:${message.id}`),false);
  assert.equal(f.service.tasks().some(task=>task.agentId!=='manager'),false);
});

test('real MCP group tools refresh capability on reused thread, preserve actors and reject forbidden scope', async t=>{
  const f=await fixture(t);
  await f.send('first');
  const first=f.running('manager'), stale=await f.bridge(first);
  assert.equal((await f.call(stale,'list_tasks')).isError,undefined);
  await f.complete(first);
  assert.match((await f.call(stale,'list_tasks')).content[0].text,/Unauthorized/);
  await f.send('second'); await until(()=>f.running('manager'));
  const source=f.running('manager'), manager=await f.bridge(source);
  assert.equal(source.runtime.threadId,first.runtime.threadId);
  assert.ok(f.calls.includes('thread/unsubscribe'));
  assert.equal((await f.call(manager,'list_tasks')).isError,undefined);
  assert.equal((await f.call(manager,'delegate_task',{requestId:'outsider',agentId:'outsider',title:'no',instructions:'no'})).isError,true);
  for (const agentId of ['researcher','developer','reviewer']) {
    const result=await f.call(manager,'delegate_task',{requestId:agentId,agentId,title:agentId,instructions:'authorized isolated fixture',notifySource:false});
    assert.notEqual(result.isError,true);
    await until(()=>f.running(agentId));
    const worker=f.running(agentId), employee=await f.bridge(worker);
    assert.equal(worker.source.actor.id,'manager'); assert.equal(worker.source.roomId,'room');
    assert.notEqual((await f.call(employee,'list_tasks')).isError,true);
    const delegated=await f.call(employee,'delegate_task',{requestId:`delegate-${agentId}`,agentId:'manager',title:'authorized peer request',instructions:'isolated peer request',notifySource:false});
    assert.notEqual(delegated.isError,true);
    assert.ok(f.service.tasks().some(x=>x.agentId==='manager' && x.source.actor?.id===agentId));
    const background=await f.call(employee,'create_background_task',{requestId:`bg-${agentId}`,title:'fixture execution',instructions:'isolated execution'});
    assert.notEqual(background.isError,true);
    await until(()=>f.service.tasks().some(x=>x.background && x.agentId===agentId && x.state==='running'));
    const bg=f.service.tasks().find(x=>x.background && x.agentId===agentId);
    assert.equal(bg.source.actor.id,agentId); assert.equal(bg.source.roomId,'room');
    assert.equal(f.threads.get(bg.runtime.threadId).config['mcp_servers.negus_handoffs'].enabled,false);
    await f.complete(bg);
    // Background result resumes the source only after its current work completes.
    await f.complete(worker);
  }
  assert.ok(f.registered.length>=3);
  assert.ok(f.registered.every(args=>args[3].createdBy==='assistant'));
  const other=await fixture(t,'other-room'); await other.send('other');
  const otherBridge=await other.bridge(other.running('manager'));
  const listed=JSON.parse((await other.call(otherBridge,'list_tasks')).content[0].text).tasks;
  assert.ok(listed.every(task=>task.source.roomId==='other-room'));
  const foreign=f.threads.get(source.runtime.threadId).config['mcp_servers.negus_handoffs'].env;
  const endpoint=other.threads.get(other.running('manager').runtime.threadId).config['mcp_servers.negus_handoffs'].env.NEGUS_HANDOFF_ENDPOINT;
  const rejected=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${foreign.NEGUS_HANDOFF_TOKEN}`},body:'{"action":"list"}'});
  assert.equal(rejected.status,401);
  assert.equal((await other.call(otherBridge,'followup_background_task',{taskId:f.service.tasks().find(x=>x.background).id,requestId:'cross-room',instructions:'no'})).isError,true);
  assert.equal(f.service.tasks().filter(x=>x.kind==='discussion' && x.agentId!=='manager').length,0);
});

test('failed group turn retains completed commentary and rejects stale tools', async t=>{
  const f=await fixture(t); await f.send('failure'); const task=f.running('manager'),mcp=await f.bridge(task);
  f.emit('item/completed',{threadId:task.runtime.threadId,turnId:task.runtime.turnId,item:{id:'before-failure',type:'agentMessage',phase:'commentary',text:'saved before failure'}});
  await until(()=>f.room.snapshot().messages.some(m=>m.itemId==='before-failure'));
  await f.complete(task,'failed');
  assert.equal(f.room.snapshot().messages.filter(m=>m.phase==='commentary').length,1);
  assert.ok(f.room.snapshot().messages.some(m=>m.failure));
  assert.match((await f.call(mcp,'list_tasks')).content[0].text,/Unauthorized/);
});

test('group credential refresh does not unload an independently active employee turn', async t=>{
  const f=await fixture(t); await f.send('first'); const task=f.running('manager'); await f.complete(task);
  f.threads.get(task.runtime.threadId).status={type:'active'};
  await f.service.receive({requestId:'next',agentIds:[],message:{type:'human',authorId:'fixture',authorName:'fixture',text:'next',attachments:[]}});
  await until(()=>f.service.tasks().some(x=>x.id!==task.id && x.state==='needs-reconciliation'));
  assert.equal(f.calls.includes('thread/unsubscribe'),false);
  assert.equal(f.threads.get(task.runtime.threadId).turns.length,1);
});
