import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extendEmployeeTasks } from '../server/employee-task-extension.mjs';

const until = async fn => { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

async function setup(t, saved = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-source-route-'));
  if (saved) await fs.writeFile(path.join(root,'tasks.json'), JSON.stringify({version:1,tasks:[
    {id:'parent',kind:'external',agentId:'a',conversationId:'direct',state:'interrupted',cancelRequested:false,interruptionReason:'serviceRestart',error:'重启后原执行会话未加载，任务未自动重复启动',runtime:{threadId:'logical',turnId:'source-turn'}},
    {id:'saved-child',kind:'delegation',agentId:'b',conversationId:'saved',title:'原任务',state:'completed',result:'原结果',parentTaskId:'parent',runtime:{threadId:'saved-thread',turnId:'saved-turn'},source:{threadId:'logical',agentId:'a',conversationId:'direct'}}],deliveries:[{id:'result:saved-child',taskId:'saved-child',state:'failed',attempts:1,error:'来源对话已停止或暂停，结果尚未送达；可点击重新发送结果'}]}));
  const employees = [{ id:'a', name:'产品', mainThreadId:'logical', runtimeThreadIds:['physical'], conversationId:'direct', modelProviderId:'new', projectRoot:root }, { id:'b', name:'质量', projectRoot:root }];
  const registry = { list:()=>employees, require:id=>employees.find(e=>e.id===id) };
  const listeners = new Set(), reads = [], starts = [], sent = [], bindings = [];
  const threads = new Map([['physical', { id:'physical', status:{type:'active'}, turns:[{ id:'source-turn', status:'inProgress', items:[] }] }]]);
  const newClient = { subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}, request:async(method,p)=>{
    if(method==='thread/read') { reads.push(p.threadId); return {thread:threads.get(p.threadId) || {status:{type:'notLoaded'},turns:[]}}; }
    if(method==='thread/start') { const thread={id:'child',turns:[]}; threads.set('child',thread); return {thread}; }
    if(method==='turn/start') { const turn={id:'child-turn',status:'inProgress',items:[]}; threads.get(p.threadId).turns.push(turn); starts.push(p); queueMicrotask(()=>listeners.forEach(fn=>fn({method:'turn/started',params:{threadId:p.threadId,turn}}))); return {turn}; }
    return {};
  }};
  const oldClient = {subscribe:()=>()=>{},request:async()=>({thread:{status:{type:'notLoaded'},turns:[]}})};
  let active=!saved;
  const extension=await extendEmployeeTasks({leaderConfig:()=>({}),ownsThread:()=>false,list:()=>[],directoryEntries:()=>[],runtimeOptions:()=>null,hasPendingWork:()=>false,close:async()=>{}}, {
    stateRoot:root, registry, bindings:{bindRuntime:async b=>bindings.push(b),findByRuntimeSession:()=>null},
    modelProviders:{providers:()=>[{id:'new',models:[{model:'test'}]}],resolveRoute:x=>x,getClient:async route=>route.modelProviderId==='old'?oldClient:newClient,isProviderConfigured:async()=>true},
    providerForThread:async id=>id==='logical'?'old':null,
    execution:{getStatus:id=>({active:id==='logical'&&active,turnId:'source-turn',phase:active?'working':'completed'})},
    registerSession:async()=>{}, queue:{list:()=>[],enqueue:async x=>{sent.push(x);threads.get('physical').turns[0].items.push({type:'userMessage',content:[{type:'inputText',text:x.text}]});return {id:x.submissionId,state:'pending'};}}
  });
  t.after(async()=>{await extension.close();await fs.rm(root,{recursive:true,force:true});});
  const cfg=extension.leaderConfig('a')['mcp_servers.negus_handoffs'];
  const invoke=async body=>{const r=await fetch(cfg.env.NEGUS_HANDOFF_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${cfg.env.NEGUS_HANDOFF_TOKEN}`},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  return {extension,invoke,starts,sent,reads,threads,listeners,stop:()=>{active=false;}};
}

test('双渠道来源：名单后同一请求只启动一次，结果回到原处一次',async t=>{
  const f=await setup(t);
  assert.equal((await f.invoke({action:'list'})).status,200);
  await until(()=>f.reads.includes('physical'));
  const input={action:'delegate',requestId:'one',agentId:'b',title:'检查',instructions:'本人完成，不要再次派工'};
  const first=await f.invoke(input);
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.startup.confirmed,true);
  const retry=await f.invoke(input);
  assert.equal(retry.body.id,first.body.id);
  assert.equal(f.starts.length,1);
  assert.ok(f.starts[0].developerInstructions.includes(`任务 ${first.body.id} 的受派执行人`));
  assert.match(f.starts[0].developerInstructions,/不另建任务、不转给同事/);
  const child=f.extension.tasks().find(x=>x.id===first.body.id);
  assert.deepEqual(child.source.actor,{id:'a',name:'产品'});
  const turn=f.threads.get('child').turns[0];turn.status='completed';turn.items=[{type:'agentMessage',text:'检查完成'}];
  f.listeners.forEach(fn=>fn({method:'turn/completed',params:{threadId:'child',turn}}));
  await until(()=>f.extension.deliveries().some(x=>x.taskId===first.body.id && x.state==='delivered'));
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].threadId,'logical');assert.match(f.sent[0].text,/检查完成/);
  await f.extension.retryDelivery(`result:${first.body.id}`);assert.equal(f.sent.length,1);
});

test('主动停止来源后不启动员工',async t=>{
  const f=await setup(t);
  assert.equal((await f.invoke({action:'list'})).status,200);
  await until(()=>f.reads.includes('physical'));
  f.stop();await f.extension.cancelRelatedTasks('logical','source-turn');
  const result=await f.invoke({action:'delegate',requestId:'stopped',agentId:'b',title:'检查',instructions:'检查'});
  assert.equal(result.status,409);assert.equal(f.starts.length,0);
});

test('原任务 failed 回执在来源恢复后只补送一次',async t=>{
  const f=await setup(t,true);
  await until(()=>f.extension.deliveries().some(x=>x.taskId==='saved-child'&&x.state==='delivered'));
  assert.equal(f.starts.length,0);assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].threadId,'logical');assert.match(f.sent[0].text,/原结果/);
  await f.extension.retryDelivery('result:saved-child');assert.equal(f.sent.length,1);
});

test('实际轮次结束后仍拒绝新派工',async t=>{
  const f=await setup(t);
  assert.equal((await f.invoke({action:'list'})).status,200);
  await until(()=>f.reads.includes('physical'));
  const turn=f.threads.get('physical').turns[0];turn.status='completed';
  f.listeners.forEach(fn=>fn({method:'turn/completed',params:{threadId:'physical',turn}}));
  await until(()=>f.extension.deliveries().some(x=>x.state==='delivered'));
  const result=await f.invoke({action:'delegate',requestId:'late',agentId:'b',title:'检查',instructions:'检查'});
  assert.equal(result.status,409);assert.equal(f.starts.length,0);
});
