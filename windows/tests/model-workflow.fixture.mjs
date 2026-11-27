import { mkdtemp, rm, mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createModelProviderService } from '../server/model-provider-service.mjs';
import { createEmployeeProjectRegistry } from '../server/employee-project-registry.mjs';
import { createEmployeeRuntimeService } from '../server/employee-runtime-service.mjs';
import { createAgentConversationStore } from '../server/agent-conversation-store.mjs';
import { createExecutionTracker } from '../server/execution-tracker.mjs';
import { createFollowUpQueueService } from '../server/follow-up-queue-service.mjs';
import { createConversationRoutes } from '../server/routes/conversation-routes.mjs';
import { createFollowUpQueueRoutes } from '../server/routes/follow-up-queue-routes.mjs';
import { createSystemRoutes } from '../server/routes/system-routes.mjs';
import { createModelDefaultsStore } from '../server/model-defaults-store.mjs';
import { createProviderConversationStore } from '../server/provider-conversation-store.mjs';
import { createJsonlConversationStore } from '../server/jsonl-conversation-store.mjs';
import { externalRoutes } from '../server/external-assistant/routes.mjs';
import { externalAccess } from '../server/external-assistant/access.mjs';
import { externalMessages } from '../server/external-assistant/messages.mjs';
import { sendJson } from '../server/http/request-utils.mjs';

export const vip = 'ccswitch_vip-1790618576587';
export const migrationTargets = [
  { id:'manager', name:'运营管理', model:'gpt-6.1-terra', effort:'medium' },
  { id:'reviewer', name:'风控质量', model:'gpt-6.2-sol', effort:'high' },
  { id:'negus-assistant', name:'negus助手', model:'gpt-6.1-terra', effort:'medium' },
];

export async function modelWorkflow(t, serve = () => false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'negus-model-workflow-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const runtimeRoot = path.join(root, 'runtime', 'model-providers');
  const currentHome = path.join(root, 'fixture-native');
  const workers = migrationTargets.map(({name},i)=>({ id:'fixture-'+i, name, projectKey:'worker-'+i, model:'fixture-a', modelProviderId:'current' }));
  const ids = Object.fromEntries(workers.map(e=>[e.id,randomUUID()]));
  const ordinaryId = randomUUID();
  const shared = ['a','alias','b','c'].map(id=>({id:'ccswitch_'+id,displayName:id,baseUrl:'https://'+(/alias/.test(id)?'a':id)+'.invalid/v1',
    key:id==='alias'?'fake-a':'fake-'+id,defaultModel:id==='a'||id==='alias'?'fixture-a':'fixture-b',
    models:['fixture-a','fixture-b'].map(model=>({id:model,model}))}));
  shared.push({id:vip,displayName:'VIP',baseUrl:'https://vip.invalid/v1',key:'fake-vip',defaultModel:'gpt-6.1-terra',
    models:migrationTargets.slice(0,2).map(({model})=>({id:model,model}))});
  const controls = { failStart:null, failCompact:null, earlyError:null, starts:[], active:new Map(), turns:0 };
  const home = id=>id==='current'?currentHome:path.join(runtimeRoot,id,'codex-home');
  const files = new Map();
  const encode = rows => rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
  const clients = new Map();
  function clientFor(id) {
    if (clients.has(id)) return clients.get(id);
    const subs=new Set(), notify=(method,params)=>[...subs].forEach(fn=>fn({method,params}));
    const emit=(method,threadId,turn)=>notify(method,{threadId,turn});
    const client={subscribe(fn){subs.add(fn);return ()=>subs.delete(fn);},close(){},async request(method,p){
      if(method==='config/read')return {config:{model_provider:'current'}};
      if(method==='thread/resume'){ if(p.path)files.set(p.threadId,p.path); return {thread:{id:p.threadId,cwd:root,path:files.get(p.threadId)}}; }
      if(method==='thread/read')return {thread:{id:p.threadId,cwd:root,path:files.get(p.threadId),turns:[],status:{type:controls.active.has(p.threadId)?'active':'idle'}}};
      if(method==='thread/compact/start') {
        const turn={id:randomUUID(),status:controls.failCompact===id?'failed':'completed',...(controls.failCompact===id?{error:{message:'fixture timeout'}}:{})};
        queueMicrotask(()=>emit('turn/completed',p.threadId,turn)); return {};
      }
      if(method==='turn/start') {
        controls.starts.push({provider:id,...p});
        if(controls.failStart)throw controls.failStart;
        const turn={id:'turn-'+(++controls.turns),status:'inProgress'};
        controls.active.set(p.threadId,turn.id);
        if(controls.earlyError) notify('error',{threadId:p.threadId,turnId:turn.id,willRetry:false,error:controls.earlyError});
        emit('turn/started',p.threadId,turn);
        const text=p.input.map(v=>v.text).join(' ');
        const ts=new Date().toISOString();
        await appendFile(files.get(p.threadId),encode([
          {timestamp:ts,type:'event_msg',payload:{type:'task_started',turn_id:turn.id}},
          {timestamp:ts,type:'turn_context',payload:{model:p.model,turn_id:turn.id}},
          {timestamp:ts,type:'event_msg',payload:{type:'user_message',message:text,client_user_message_id:p.clientUserMessageId,turn_id:turn.id}},
        ]));
        return {turn};
      }
      return {};
    },notice(threadId,turnId,error,willRetry=false) { notify('error',{threadId,turnId,error,willRetry}); },
    async finish(threadId,error) {
      const turnId=controls.active.get(threadId);
      controls.active.delete(threadId);
      if(!error) {
        const ts=new Date().toISOString();
        await appendFile(files.get(threadId),encode([
          {timestamp:ts,type:'event_msg',payload:{type:'agent_message',message:'隔离夹具回复',phase:'final_answer',turn_id:turnId}},
          {timestamp:ts,type:'event_msg',payload:{type:'task_complete',turn_id:turnId}},
        ]));
      }
      emit('turn/completed',threadId,{id:turnId,status:error?'failed':'completed',error});
    }};
    clients.set(id,client);return client;
  }
  const providerOptions={projectRoot:root,runtimeRoot,defaultCodexHome:currentHome,defaultClient:clientFor('current'),
    createClient:({label})=>clientFor(label), providers:[{id:'current',mode:'current',displayName:'a'}],
    currentApiConfiguration:async()=>({baseUrl:shared[0].baseUrl,key:shared[0].key}),
    sharedConfig:{runtimeProviders:async()=>shared,readCredential:async id=>shared.find(p=>p.id===id).key,
      list:async()=>shared.map(p=>({id:p.id.slice(9),name:p.displayName,configured:true,switchable:true})),credentialCommand:()=>['fixture-only']}};
  let providers, bindings, registry, runtime, queue, execution, ordinary;
  let unbindOrdinary=[];
  const stores=new Map();
  const saved = (id,...args) => {
    if(!stores.has(id))stores.set(id,createJsonlConversationStore({sessionRoot:path.join(home(id),'sessions'),projectRoot:root,onChange(){}}));
    return stores.get(id).findSession(...args);
  };
  const defaults = createModelDefaultsStore(path.join(root,'runtime/model-defaults.json'));
  await defaults.save({providerId:'current',model:'fixture-a',effort:'high'});
  const register = async () => {
    registry=await createEmployeeProjectRegistry({workspaceRoot:root,stateFile:path.join(root,'runtime','staff.json'),definitions:workers});
    bindings=await createAgentConversationStore({stateFile:path.join(root,'runtime','bindings.json'),
      groupRoom:{getAgent:id=>registry.get(id)}});
  };
  await register();
  for(const employee of workers) {
    const id=ids[employee.id], file=path.join(currentHome,'sessions','2026','11','25',`rollout-2026-11-25T00-00-00-${id}.jsonl`);
    await mkdir(path.dirname(file),{recursive:true});
    const stamp='2026-11-25T00:00:00.000Z';
    await writeFile(file,encode([
      {timestamp:stamp,type:'session_meta',payload:{id,cwd:root,model_provider:'current'}},
      {timestamp:stamp,type:'event_msg',payload:{type:'task_started',turn_id:'original'}},
      {timestamp:stamp,type:'turn_context',payload:{model:'fixture-a',turn_id:'original'}},
      {timestamp:stamp,type:'event_msg',payload:{type:'user_message',message:'原历史 '+employee.name,turn_id:'original'}},
      {timestamp:stamp,type:'event_msg',payload:{type:'agent_message',message:'原回复 '+employee.name,phase:'final_answer',turn_id:'original'}},
      {timestamp:stamp,type:'event_msg',payload:{type:'task_complete',turn_id:'original'}},
    ]));
    files.set(id,file);
    await registry.bindMainThread(employee.id,id);
    const binding=await bindings.bindRuntime({agentId:employee.id,runtimeKind:'codex',runtimeSessionId:id,conversationKind:'direct'});
    await registry.bindConversation(employee.id,binding.conversationId);
  }
  const ordinaryFile=path.join(currentHome,'sessions','2026','11','25',`rollout-2026-11-25T00-00-00-${ordinaryId}.jsonl`);
  await writeFile(ordinaryFile,encode([
    {type:'session_meta',payload:{id:ordinaryId,cwd:root,model_provider:'current'}},
    {type:'event_msg',payload:{type:'task_started',turn_id:'old-ordinary'}},
    {type:'turn_context',payload:{model:'fixture-a',turn_id:'old-ordinary'}},
    {timestamp:'2026-11-25T00:00:00.000Z',type:'event_msg',payload:{type:'user_message',message:'普通对话保留此历史',turn_id:'old-ordinary'}},
    {timestamp:'2026-11-25T00:00:00.000Z',type:'event_msg',payload:{type:'agent_message',message:'原回答',phase:'final_answer',turn_id:'old-ordinary'}},
    {type:'event_msg',payload:{type:'task_complete',turn_id:'old-ordinary'}},
  ]));
  files.set(ordinaryId,ordinaryFile);
  const projects = () => [...workers.map(employee=>({name:employee.name,projectId:employee.projectKey,kind:'employee',employeeId:employee.id,
    mainThreadId:ids[employee.id],conversations:[{role:'main',title:employee.name+'主对话',threadId:ids[employee.id]}]})),
    {name:'普通项目',projectId:'ordinary',kind:'personal',root,conversations:[{threadId:ordinaryId,role:'standard',title:'普通对话'}]},
    {name:'范围外',projectId:'outside',conversations:[{threadId:'outside-thread'}]}];
  const museMessages=externalMessages(root);
  const media={resolveMany:ids=>ids?.includes('fixture-file') ? [{id:'fixture-file',name:'fixture.txt',
    mimeType:'text/plain',url:'/api/media/fixture-file',path:path.join(root,'private-fixture.txt')}] : []};
  let endpoints;
  const initialize=async()=>{
    providers=createModelProviderService(providerOptions);
    await providers.refreshShared();
    execution=createExecutionTracker({broadcast(){}});
    const metadata=(id,threadId,options)=>saved(id,threadId,'all',{...options,metadataOnly:true});
    const clientStore=(client,id)=>({
      close(){},listModels:async()=>[{model:'fixture-a'}],
      getSessionResumeInfo:threadId=>metadata(id,threadId),
      getRuntimeContext:async()=>({model:id==='current'?'fixture-a':'fixture-b'}),
      releaseSession:threadId=>client.request('thread/unsubscribe',{threadId}),
      resumeProviderSession:(threadId,options)=>client.request('thread/resume',{...options,threadId}),
      sendMessage:(threadId,text,_attachments,submissionId,settings)=>client.request('turn/start',
        {threadId,model:settings.model,effort:settings.reasoningEffort,clientUserMessageId:submissionId,input:[{type:'text',text}]}),
    });
    ordinary=createProviderConversationStore({current:clientStore(clientFor('current'),'current'),providers,
      stateFile:path.join(root,'runtime','ordinary-routes.json'),createStore:clientStore,
      historyFor:id=>({findSession:(...args)=>saved(id,...args),getSessionResumeInfo:(threadId,options)=>metadata(id,threadId,options)})});
    unbindOrdinary=[clientFor('current'),clientFor('ccswitch_b')].map(c=>c.subscribe(event=>{
      if(event.params.threadId!==ordinaryId)return;
      void ordinary.handleProtocolMessage(event);
      execution.handleProtocolMessage(event);
    }));
    const conversations={...ordinary};
    runtime=createEmployeeRuntimeService({registry,conversationStore:bindings,projectRoot:root,client:clientFor('current'),modelProviders:providers,
      execution,readHistory:saved,readSavedHistory:saved,onTurnCompleted:event=>queue.handleTurnTerminal(event)});
    const employeeFor=threadId=>workers.find(e=>ids[e.id]===threadId).id;
    queue=createFollowUpQueueService({stateFile:path.join(root,'runtime','queue.json'),execution,media,publishThreadEvent:execution.publishThreadEvent,
      sourceActorFor:museMessages.actorFor,conversations:{
        assertSendAvailable:(id,options)=>runtime.assertSendAvailable(employeeFor(id),options),
        sendMessage:(id,text,attachments,requestId)=>runtime.sendMessage({employeeId:employeeFor(id),text,attachments,requestId}),
      }});
    const ex=externalRoutes({projectRoot:root,directory:{list:async()=>({projects:projects()})},conversations,media,modelProviders:providers,modelDefaults:defaults,
      employeeRuntime:runtime,events:providers.modelEvents.events,followUpQueue:queue,execution,museMessages,
      ownerOptions:{configured:'fixture-owner',request:async()=>Response.json({user:{id:'fixture-owner',email:'fixture@example.invalid',emailVerified:true}})}});
    endpoints={...ex,routes:[
      ex.admin,createConversationRoutes({projectRoot:root,conversations,execution,followUpQueue:queue,media,museMessages,
        agentConversationStore:bindings,employeeRuntime:runtime,modelProviders:providers}),
      createFollowUpQueueRoutes({queue,media}),
      createSystemRoutes({projectRoot:root,modelProviders:providers,modelDefaults:defaults}),
    ]};
  };
  const stop=async()=>{ await queue.close(); runtime.close(); unbindOrdinary.forEach(fn=>fn()); ordinary.close();
    await registry.close(); await execution.close(); providers.close(); };
  await initialize();
  const host=createServer(async(req,res)=>{
    try {
      const u=new URL(req.url,'http://localhost');
      if(u.pathname==='/mcp/muse') return await endpoints.mcp(req,res,u);
      for(const handler of endpoints.routes)if(await handler(req,res,u))return;
      if(!await serve(req,res,u))sendJson(res,{},404);
    } catch(e){sendJson(res,{error:e.message},e.statusCode||500);}
  });
  await new Promise(r=>host.listen(0,'127.0.0.1',r));
  t.after(async()=>{host.closeAllConnections();await new Promise(r=>host.close(r));await stop();for(const s of stores.values())s.close();});
  const origin='http://127.0.0.1:'+host.address().port;
  const access=externalAccess(root);
  await access.grant(0,[...workers.map(w=>w.projectKey),'ordinary'],new Set(projects().map(p=>p.projectId)),false);
  const {secret}=await access.issue(1);
  const api = async (route, body, cookie) => {
    const response=await fetch(origin+route,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',origin,...(cookie?{cookie}:{})}});
    return {status:response.status,cookie:response.headers.get('set-cookie')?.split(';')[0],body:await response.json()};
  };
  const call=async(name,args)=>{
    const r=await fetch(origin+'/mcp/muse',{method:'POST',headers:{accept:'application/json,text/event-stream','content-type':'application/json',authorization:'Bearer '+secret},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
    const json=await r.json(), content=json.result?.content?.[0]?.text||'{}';
    let data;try{data=JSON.parse(content);}catch{data={error:content};}
    return {isError:json.result?.isError||Boolean(json.error),...data};
  };
  return {root,origin,workers,ids,ordinaryId,controls,call,api,projects,clients,get registry(){return registry;},get providers(){return providers;},get queue(){return queue;},get runtime(){return runtime;},
    replaceChannelList:async(remove,add)=>{
      const idx=shared.findIndex(entry=>entry.id===remove);
      shared.splice(idx,1,{...shared[idx],id:add,displayName:add});
      await providers.refreshShared({force:true});
    },
    restart:async()=>{await stop();await register();await initialize();} };
}
