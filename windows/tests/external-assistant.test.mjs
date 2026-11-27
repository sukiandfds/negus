import {externalMessages} from '../server/external-assistant/messages.mjs';
import test from 'node:test';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {externalRoutes} from '../server/external-assistant/routes.mjs';
import {ownerSessions} from '../server/external-assistant/owner.mjs';
import {sendJson} from '../server/http/request-utils.mjs';

test('owner account binding is explicit and survives restart; verification cannot impersonate a different account',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'negus-auth-'));t.after(()=>rm(root,{recursive:true,force:true}));
 let who='one',confirm=0,verified=true;
 const opts={configured:'',request:async()=>Response.json({user:{id:who,email:who+'@example.org',emailVerified:verified}}),confirmBinding:async()=>{confirm++;}};
 const service=ownerSessions(root,opts);const sid=await service.verify('one@example.org','123456');
 assert.ok(service.check('negus_owner='+sid));assert.equal(confirm,1);
 const reopened=ownerSessions(root,opts);assert.equal(reopened.check('negus_owner='+sid),false);
 who='two';await assert.rejects(reopened.verify('two@example.org','123456'),/不是/);
 who='one';verified=false;await assert.rejects(reopened.verify('one@example.org','123456'),/未通过/);assert.equal(confirm,1);
});

test('authenticated UI issues/revokes; real HTTP MCP projects, data, audit, pending approvals and revocation',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'negus-mcp-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projectIds=['A','B'];
 const directory={list:async()=>({projects:projectIds.map(id=>({projectId:id,name:id,root:fileURLToPath(new URL('../../',import.meta.url)),kind:'personal',employeeId:id==='A'?'worker':null,conversations:[{threadId:'thread'+id}]}))})};
 const payload=Buffer.from('verified project attachment'),localFile=path.join(root,'published.pdf');
 await writeFile(localFile,payload);
 const docs=[{id:'art',taskId:'task',currentVersion:1,versions:[{version:1,name:'Plan',sha256:createHash('sha256').update(payload).digest('hex'),size:payload.length,sourceMediaId:'f1',reviewDecision:null}]}];
 let delivered=false, emptyHistory=false, failed=false; const sent=[]; const museMessages=externalMessages(root);
 const route=externalRoutes({projectRoot:root,directory,museMessages,followUpQueue:{list:t=>delivered?[]:sent.filter(i=>i.threadId===t).map(i=>({...i,state:failed?'failed':'pending',error:failed?'目标不可用':undefined})),enqueue:async item=>{sent.push(item);}}, tasks:{dispatchOrigin:id=>({threadId:'threadA',turnId:id==='child'?'owned':'human'}),cancelTask:id=>({id,state:'interrupted'}),tasks:()=>[{id:'task',source:{kind:'conversation',threadId:'threadA'}},{id:'child',parentTaskId:'task',agentId:'worker',workProjectId:'B',progress:[{text:'核查完成'}]},{id:'private',workProjectId:'B'}],deliveries:()=>[{taskId:'child',state:'failed',error:'来源对话已停止'}]},
  artifacts:{list:()=>docs,review:async(id,decision)=>{docs[0].versions[0].reviewDecision=decision;}},
  conversations:{listModels:async()=>[{model:'channel::m',modelProviderId:'channel',available:true}],
    createSession:async(model,cwd,provider,options)=>{assert.equal(model,'channel::m');assert.equal(provider,'channel');assert.equal(cwd,fileURLToPath(new URL('../../',import.meta.url)));assert.equal(options.createdBy,'assistant');return {threadId:'created'};},
    findSession:async threadId=>emptyHistory?null:({threadId,messages:[{id:'m1',role:'assistant',text:'project message'},...(delivered?sent:[]).filter(i=>i.threadId===threadId).flatMap(i=>[{role:'user',turnId:'turn',text:i.text,submissionId:i.submissionId},{role:'assistant',turnId:'turn',id:'answer',text:'ok',phase:'final_answer'}])],hasMore:false})},
 schedules:async()=>({items:[{id:'s1',name:'schedule',threadId:'threadA'},{id:'s2',threadId:'threadB'}]}),
 media:{resolveMany:()=>[{path:localFile,mimeType:'application/pdf'}]},
 readWebVersion:async()=>({buildId:'build',builtAt:'date'}),fushengUsage:{read:async()=>({updatedAt:'date',today:{requests:12}})},
 ownerOptions:{configured:'principal',request:async()=>Response.json({user:{id:'principal',email:'a@example.org',emailVerified:true}})}});
 const http=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/mcp/muse')await route.mcp(req,res,u);else if(!await route.admin(req,res,u))sendJson(res,{},404);
 }catch(e){sendJson(res,{error:e.message},e.statusCode||500);}});
 await new Promise(r=>http.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>http.close(r)));
 const origin='http://127.0.0.1:'+http.address().port;
 const admin=(body,cookie='',extra={})=>fetch(origin+'/api/external-assistant',{method:'POST',headers:{origin,cookie,'content-type':'application/json',...extra},body:JSON.stringify(body)});
 assert.equal((await admin({action:'issue',revision:0})).status,403);
 const login=await admin({action:'login',email:'a@example.org',code:'123456'});
 const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await admin({action:'issue',revision:0},cookie,{origin:'https://example.org'})).status,403);
 assert.equal((await admin({action:'grant',revision:0,projects:['missing']},cookie)).status,403);
 assert.equal((await admin({action:'grant',revision:0,projects:['A']},cookie)).status,200);
 const issued=await (await admin({action:'issue',revision:1},cookie)).json();assert.ok(issued.link);
 const client=new Client({name:'isolated-sdk-client',version:'1'});
 await client.connect(new StreamableHTTPClientTransport(new URL(issued.link)));
 assert.ok((await client.listTools()).tools.some(t=>t.name==='project_get'));
 await client.close();
 const rpc=async(method,params={},url=issued.link)=>{const r=await fetch(url,{method:'POST',headers:{accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:r.status,body:await r.json()};};
 assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}})).body.result.serverInfo.name,'negus-projects');
 const names=(await rpc('tools/list')).body.result.tools.map(t=>t.name);
 assert.ok(names.includes('approval_list'));assert.ok(!names.some(n=>/approve|issue|revoke|credential/.test(n)));
 const call=(name,args)=>rpc('tools/call',{name,arguments:args});
 const data=r=>JSON.parse(r.body.result.content[0].text);
 assert.deepEqual(data(await call('project_list',{})).projects.map(p=>p.name),['A']);
 assert.ok((await call('conversation_list',{project:'B'})).body.result.isError);
 assert.ok((await call('topic_list',{project:'A',thread:'threadB'})).body.result.isError);
 assert.equal(data(await call('approval_list',{project:'A'})).items[0].id,'art');
 assert.equal((await admin({action:'review',project:'A',id:'art',version:2,decision:'approve'},cookie)).status,403);
 assert.equal((await admin({action:'review',project:'A',id:'art',version:1,decision:'approve'},cookie)).status,200);
 assert.equal(data(await call('approval_list',{project:'A'})).items.length,0);
 const timeline=data(await call('external_activity_list',{project:'A'})).events;
 assert.ok(timeline.some(e=>e.actor==='owner'&&e.state==='approved'));assert.ok(timeline.some(e=>e.state==='denied'));
 assert.ok(!(await readFile(path.join(root,'runtime/external-assistant-access.json'),'utf8')).includes(new URL(issued.link).searchParams.get('access')));
 // Exercise each advertised read tool. The requirements reader uses the current
 // repository's actual, read-only FEAT-017 record; nothing is filed as Muse work.
 assert.ok((await call('conversation_create',{project:'B',model:'channel::m',modelProviderId:'channel'})).body.result.isError);
 assert.ok((await call('conversation_create',{project:'A',model:'other',modelProviderId:'channel'})).body.result.isError);
 const message={project:'A',thread:'threadA',text:'Muse input',submissionId:'1'};
 assert.ok((await call('message_submit',{...message,thread:'threadB'})).body.result.isError);
 assert.equal(data(await call('message_submit',message)).state,'accepted');
 assert.equal(data(await call('message_submit',message)).state,'accepted');
 assert.ok((await call('message_submit',{...message,text:'changed'})).body.result.isError);
 assert.equal(sent.length,1);
 assert.equal(externalMessages(root).actorFor('threadA',sent[0].submissionId).authorName,'Muse');
 const read=async()=>data(await call('message_list',{project:'A',thread:'threadA'})).messages;
 const waiting=(await read()).at(-1);assert.equal(waiting.authorName,'Muse');assert.equal(waiting.state,'pending');
 emptyHistory=true;failed=true;
 const rejected=(await read()).at(-1);assert.equal(rejected.submissionId,waiting.submissionId);assert.equal(rejected.state,'failed');assert.equal(rejected.error,'目标不可用');
 emptyHistory=false;failed=false;delivered=true;const done=await read();assert.equal(done.at(-2).submissionId,waiting.submissionId);assert.equal(done.at(-2).state,'replied');assert.equal(done.at(-2).replyId,done.at(-1).id);
 const child=data(await call('task_get',{project:'A',task:'child'})).task;
 assert.equal(child.delivery.error,'来源对话已停止');assert.equal(child.steps[0].text,'核查完成');
 assert.ok((await call('task_get',{project:'A',task:'private'})).body.result.isError);
 museMessages.recordStartedTurn('threadA',waiting.submissionId,{status:'steered',turnId:'human'});
 assert.ok((await call('task_stop',{project:'A',task:'task'})).body.result.isError);
 museMessages.recordStartedTurn('threadA',waiting.submissionId,{status:'inProgress',turnId:'owned'});
 assert.ok((await call('task_stop',{project:'B',task:'child'})).body.result.isError);
 assert.equal(data(await call('task_stop',{project:'A',task:'child'})).task.state,'interrupted');
 const cases={model_list:[{},v=>v.models[0].model==='channel::m'],conversation_create:[{model:'channel::m',modelProviderId:'channel'},v=>v.threadId==='created'],project_get:[{},v=>v.name==='A'],conversation_list:[{},v=>v.threads[0].threadId==='threadA'],
  topic_list:[{thread:'threadA'},v=>Array.isArray(v.topics)],message_list:[{thread:'threadA'},v=>v.messages[0].id==='m1'],
  task_get:[{task:'task'},v=>v.task.id==='task'&&v.children[0].id==='child'],task_list:[{},v=>v.tasks[0].id==='task'],schedule_list:[{},v=>v.schedules.length===1&&v.schedules[0].id==='s1'],
  artifact_list:[{},v=>v.artifacts[0].versions[0].sourceMediaId==='f1'],approval_list:[{pendingOnly:false},v=>v.items[0].state==='approve'],
  project_entries:[{},v=>v.entries.some(e=>e.id==='FEAT-017')],project_status:[{},v=>v.stats.total>0],
  project_entry_get:[{entry:'FEAT-017'},v=>v.id==='FEAT-017'&&!!v.title],external_activity_list:[{},v=>v.events.length>0],
  room_list:[{},v=>Array.isArray(v.rooms)],file_read:[{file:'f1',offset:2,size:4},v=>Buffer.from(v.content,'base64').equals(payload.subarray(2,6))],
  usage_get:[{},v=>v.usage.requests===12],version_get:[{},v=>v.buildId==='build']};
 assert.deepEqual(Object.keys(cases).concat('project_list','message_submit','task_stop').sort(),names.sort());
 for (const [name,[args,check]] of Object.entries(cases)){const r=await call(name,{project:'A',...args});assert.ok(!r.body.result.isError && check(data(r)),name);}
 await writeFile(localFile,Buffer.alloc(payload.length));assert.ok((await call('file_read',{project:'A',file:'f1'})).body.result.isError);
 const action={operation:'deploy',target:'staging',revision:'immutable-revision',summary:'发布指定版本',requestId:'request-1'};
 const pending=await route.requestApproval('A',action);
 assert.equal((await route.requestApproval('A',action)).id,pending.id);
 await assert.rejects(route.requestApproval('A',{...action,revision:'different'}));
 assert.equal(data(await call('approval_list',{project:'A'})).items[0].state,'pending');
 const review={action:'review',kind:'action',project:'A',id:pending.id,fingerprint:pending.fingerprint,decision:'reject'};
 assert.equal((await admin(review)).status,403);
 assert.equal((await admin({...review,fingerprint:'wrong'},cookie)).status,403);
 assert.equal((await admin(review,cookie)).status,200);assert.equal((await admin({...review,decision:'approve'},cookie)).status,403);
 assert.equal(data(await call('approval_list',{project:'A',pendingOnly:false})).items.find(x=>x.id===pending.id).state,'rejected');
 assert.equal((await admin({action:'grant',projects:['A'],allProjects:true,revision:2},cookie)).status,200);
 projectIds.push('C');
 assert.deepEqual(data(await call('project_list',{})).projects.map(p=>p.name),['A','B','C']);
 assert.equal(data(await call('project_get',{project:'C'})).name,'C');
 assert.ok((await call('project_get',{project:'missing'})).body.result.isError);
 assert.equal((await admin({action:'grant',projects:['A'],allProjects:false,revision:3},cookie)).status,200);
 assert.ok((await call('project_get',{project:'C'})).body.result.isError);
 assert.equal((await admin({action:'revoke',revision:4},cookie)).status,200);assert.equal((await rpc('tools/list')).status,403);
});
