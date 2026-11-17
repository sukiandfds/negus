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
async function fixture(t, roomId = 'room') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-collaboration-'));
  const events = [], registered = [], calls = [], listeners = new Set(), health = new Set(), threads = new Map(), bridges = [];
  const agentDefinitions = ['manager', 'researcher', 'developer', 'reviewer'].map(id => ({ id, name: id }));
  const room = await createGroupRoomStore({ stateFile: path.join(root, 'room.json'), roomId, project: 'fixture', agentDefinitions, broadcast: event => events.push(event) });
  const emit = (method, params) => listeners.forEach(listener => listener({method, params}));
  const client = { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeHealth: listener => { health.add(listener); return () => health.delete(listener); },
    request: async (method, params) => {
      calls.push(method);
      if (method === 'thread/start') { const thread = { id: `thread-${threads.size}`, turns: [], config: params.config, loaded: true }; threads.set(thread.id, thread); return {thread}; }
      const thread = threads.get(params.threadId);
      if (method === 'thread/read') return {thread};
      // Match the native behavior: loaded resume does not replace MCP config.
      if (method === 'thread/resume') { if (!thread.loaded) thread.config = params.config; thread.loaded = true; return {thread}; }
      if (method === 'thread/unsubscribe') { thread.loaded = false; return {}; }
      if (method === 'turn/start') { const turn = {id:`${thread.id}-turn-${thread.turns.length}`, status:'inProgress', items:[]}; thread.turns.push(turn); queueMicrotask(() => emit('turn/started', {threadId:thread.id,turn})); return {turn}; }
      if (method === 'turn/interrupt') { const turn = thread.turns.at(-1); turn.status = 'interrupted'; emit('turn/completed',{threadId:thread.id,turn}); }
      return {};
    } };
  const service = await createGroupTaskService({stateRoot:root,room,projectRoot:root,appServerClient:client,broadcast:event=>events.push(event),
    modelProviders: {providers:()=>[{id:'deepseek',displayName:'DeepSeek',models:[{model:'deepseek-flash'}]}],isProviderConfigured:async()=>true,
      resolveRoute: settings=>settings,getClient:async()=>client},
    registerSession:async (...args)=>registered.push(args), bindings:{bindRuntime:async()=>{}},queue:{list:()=>[]},execution:{} });
  t.after(async()=>{ for (const bridge of bridges) await bridge.close(); await service.close(); await room.close(); await fs.rm(root,{recursive:true,force:true}); });
  const send = async (id, agentIds=[]) => { const result = await service.receive({requestId:id,agentIds,message:{type:'human',authorId:'fixture',authorName:'fixture',text:id,attachments:[]}}); await until(()=>service.tasks().some(task=>task.state==='running')); return result.message; };
  const running = agentId => service.tasks().findLast(task=>task.agentId===agentId && task.state==='running');
  const complete = async (task,status='completed') => { const turn=threads.get(task.runtime.threadId).turns.at(-1); turn.status=status; turn.items.push({id:`final-${turn.id}`,type:'agentMessage',text:`result ${task.agentId}`}); emit('turn/completed',{threadId:task.runtime.threadId,turn}); await until(()=>service.deliveries().some(d=>d.taskId===task.id && d.state==='delivered')); };
  const bridge = async task => { const config=threads.get(task.runtime.threadId).config['mcp_servers.negus_handoffs']; const mcp=new Client({name:'isolated-group-test',version:'1'}); await mcp.connect(new StdioClientTransport({command:config.command,args:config.args,env:{...process.env,...config.env}})); bridges.push(mcp); return mcp; };
  const call = async (mcp,name,args={}) => mcp.callTool({name,arguments:args});
  return {root,room,service,events,registered,calls,threads,emit,health,send,running,complete,bridge,call};
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
