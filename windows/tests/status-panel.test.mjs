import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {panelHistory} from '../server/status-panel/activity.mjs';
import {statusPanelRoute} from '../server/status-panel/route.mjs';
import {backgroundChecks,checkWindow} from '../server/status-panel/task-check.mjs';
test('跨卷只投影本轮的实际工具，单步可关联多个技能，不把命令和凭据送给面板',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'panel'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const files=['a','b'].map(n=>path.join(root,n)),at=new Date().toISOString();
 const data=[['event_msg',{type:'task_started',turn_id:'t'}],['event_msg',{type:'user_message',message:'只是讨论 Goal 和搜索'}],
 ['response_item',{type:'function_call',name:'exec_command',call_id:'cmd',arguments:JSON.stringify({cmd:'cat /tmp/image/SKILL.md /tmp/github/SKILL.md',secret:'hidden-value'})}],
 ['response_item',{type:'web_search_call',id:'search'}],['response_item',{type:'function_call',name:'mcp__negus_handoffs__create_background_task',call_id:'dispatch'}],
 ['event_msg',{type:'entered_review_mode'}],['compacted',{}],['response_item',{type:'function_call',name:'update_goal',call_id:'goal'}],['event_msg',{type:'task_complete',turn_id:'t',last_agent_message:'结果'}]];
 for(const [i,records] of [data.slice(0,3),data.slice(3)].entries())await fs.writeFile(files[i],records.map(([type,payload])=>JSON.stringify({type,payload,timestamp:at})).join('\n')+'\n');
 const [work]=await panelHistory(files);assert.deepEqual(work.steps.map(step=>step.tags.map(t=>t.kind)),[['command','skill','skill'],['search'],['dispatch'],['review'],['compact'],['goal']]);assert.equal(work.state,'已完成');assert.doesNotMatch(JSON.stringify(work),/只是讨论/);assert.ok(!JSON.stringify(work).includes('hidden-value'));
});
test('按当前来源对话过滤后台任务和日程',async()=>{
 const rows=['a','b'].map(threadId=>({threadId,id:threadId,background:true,source:{threadId,kind:'conversation'}}));
 const route=statusPanelRoute({authorizeAgentThread:async()=>null,agentTasks:{tasks:()=>rows},readAutomations:async()=>({items:rows,warnings:[]})});
 for(const section of ['schedules','tasks']){
 let body;await route({method:'GET'},{writeHead(){},end(v){body=JSON.parse(v)}},new URL('http://localhost/api/session/status-panel?threadId=a&section='+section));
 assert.deepEqual((body.items||body).map(x=>x.id),['a']);
 }
});
test('阶段结果立即汇报并顺延；超时查真实状态，失败有别于任务失败，结束清理计时',async()=>{
 let clock=0,record,callback,count=0,timer=0,armed=0;const reports=[];
 const monitor=backgroundChecks({now:()=>clock,read:()=>record,save:async v=>record=v,probe:async()=>{count++;if(count===2)throw Error('连接超时');return 'inProgress';},
 notify:async(id,text)=>reports.push(text),delay:(f,ms)=>{callback=f;armed=ms;return ++timer;},cancel:()=>{callback=null;}});
 await monitor.start();assert.equal(armed,checkWindow);clock=120000;await monitor.progress('1','已有结果');assert.equal(record.next,420000);assert.deepEqual(reports,['已有结果']);
 clock=420000;callback();await new Promise(setImmediate);assert.equal(count,1);assert.equal(record.next,720000);assert.equal(record.last,420000);
 clock=720000;callback();await new Promise(setImmediate);assert.match(record.error,/状态查询失败/);assert.equal(reports.length,1);
 monitor.close();assert.equal(callback,null);
});
test('actual Codex wrapper emits two child actions, not the generic exec script or its output',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'panel-exec'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'rollout.jsonl');
 const rec=(type,payload)=>JSON.stringify({type,payload,timestamp:'2026-11-22T08:00:00Z'});
 await fs.writeFile(file,[rec('event_msg',{type:'task_started',turn_id:'t'}),rec('response_item',{type:'custom_tool_call',call_id:'wrapper',name:'exec',input:'sensitive code'}),
 ...[{type:'McpToolCall',server:'negus_handoffs',tool:'create_background_task',result:{text:'secret'}},{type:'CommandExecution',command:['zsh','-lc','cat "/a b/github/SKILL.md"']}].map((item,i)=>rec('event_msg',{type:'item_completed',turn_id:'t',item:{...item,id:String(i)}}))].join('\n'));
 const [turn]=await panelHistory([file]);assert.deepEqual(turn.steps.map(x=>x.tags.map(t=>t.kind)),[['dispatch'],['command','skill']]);assert.doesNotMatch(JSON.stringify(turn),/secret|sensitive/);
});
test('面板停止只作用于本对话派发的那项工作',async()=>{
 let stopped='';
 const route=statusPanelRoute({authorizeAgentThread:async()=>null,agentTasks:{tasks:()=>[{id:'work',background:true,source:{threadId:'a',kind:'conversation'}}],cancelTask:async id=>{stopped=id;}}});
 const stop=thread=>route({method:'POST'},{writeHead(){},end(){}},new URL('http://localhost/api/session/status-panel?threadId='+thread+'&section=tasks&stop=work'));
 await assert.rejects(()=>stop('b'),{statusCode:404});assert.equal(stopped,'');await stop('a');assert.equal(stopped,'work');
});
test('展开活动时只返回该轮助手产物，沿用原文件地址',async()=>{
 const file={type:'file',source:'/api/media/out',id:'f',name:'报告.pdf'};
 const make=(id,role,turnId)=>({id,role,turnId,text:'对话原文',blocks:[file,{type:'markdown',text:'摘要不应当作附件'}]});
 const route=statusPanelRoute({authorizeAgentThread:async()=>null,conversations:{findSession:async id=>{
   assert.equal(id,'a');return {messages:[make('owner','assistant','t'),make('upload','user','t'),make('other','assistant','z')]};
 }}});
 let result;await route({method:'GET'},{writeHead(){},end(body){result=JSON.parse(body)}},new URL('http://localhost/api/session/status-panel?section=outputs&threadId=a&turnId=t'));
 assert.deepEqual(result,[{id:'owner',role:'assistant',text:'',blocks:[file]}]);
});
test('日程增量只返回更新的记录，删除的编号同步移除；日程读取不查询任务',async()=>{
 let rows=['a','b','c'].map(id=>({threadId:'thread',id,name:id})),taskReads=0;
 const route=statusPanelRoute({authorizeAgentThread:async()=>null,agentTasks:{tasks:()=>{taskReads++;return [];}},readAutomations:async()=>({items:rows,warnings:[]})});
 const read=async base=>{let data;await route({method:'GET'},{writeHead(){},end(text){data=JSON.parse(text)}},
   new URL('http://localhost/api/session/status-panel?threadId=thread&section=schedules&delta=1&base='+base));return data;};
 const initial=await read('');rows=[rows[0],{...rows[2],name:'changed'}];const next=await read(initial.version);
 assert.deepEqual(next.order,['a','c']);assert.deepEqual(next.rows,[rows[1]]);assert.deepEqual((await read(next.version)).rows,[]);assert.equal(taskReads,0);
});

test('普通对话：当前助手写草稿，完成后才发布；续谈、无进展、中断和新话题',async t=>{
 const {createAppServerConversationStore}=await import('../server/app-server-conversation-store.mjs');
 const {readTopics}=await import('../server/status-panel/topics.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'panel-topics'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let emit,turn=0,context;
 const changed=[];
 const client={subscribe:fn=>(emit=fn,()=>{}),close(){},request:async(method,p)=>{
   if(method==='turn/start'){context={...JSON.parse(p.additionalContext['negus.topics'].value),...JSON.parse(p.additionalContext['negus.topicRecall'].value)};
     assert.match(context.记录要求,/同话题沿用已有 id/);return {turn:{id:String(++turn)}};}
   return {thread:{id:'a',cwd:root,turns:[]}};
 }};
 const store=createAppServerConversationStore({projectRoot:root,threadRuntimeOptions:()=>({ordinaryConversation:true,turn:{}}),client,onTopicChanged:id=>changed.push(id),autoTitleEnabled:false});
 t.after(()=>store.close());
 const send=()=>store.sendMessage('a','继续');const end=status=>emit({method:'turn/completed',params:{threadId:'a',turn:{id:String(turn),status}}});
 const note=async(id,title,summary)=>{await fs.mkdir(path.dirname(context.本轮话题草稿路径),{recursive:true});await fs.writeFile(context.本轮话题草稿路径,JSON.stringify({id,title,mainline:'统一对话体验',summary}));};
 await send();await note('','置顶','正在验证');assert.deepEqual(await readTopics(root,'a'),[]);end('completed');
 await send();assert.equal(context.当前主线,'统一对话体验');const id=context.最近话题[0].id;
 await note(id,'置顶','跨设备验证通过');end('completed');await send();assert.equal(context.最近话题.length,1);assert.equal(context.最近话题[0].summary,'跨设备验证通过');
 end('completed');await send();await note('','噪声','中断');end('interrupted');await send();await note('','模型','保留配置');end('completed');
 await send();assert.deepEqual(context.最近话题.map(r=>r.title),['模型','置顶']);assert.deepEqual(changed,['a','a','a']);
 assert.deepEqual(await readTopics(root,'b'),[]);
 let body;await statusPanelRoute({projectRoot:root,authorizeAgentThread:async()=>null})({method:'GET'},{writeHead(){},end(v){body=JSON.parse(v)}},new URL('http://localhost/api/session/status-panel?threadId=a&section=topics&delta=1'));
 assert.deepEqual(body.order,context.最近话题.map(r=>r.id));
 await fs.writeFile(context.本轮话题草稿路径,JSON.stringify(['复制确认','占用提示'].map(title=>({id:'',title,summary:title+'验收',mainline:'对话操作'}))));
 end('completed');await send();const rows=await readTopics(root,'a');
 assert.equal(new Set(rows.map(r=>r.id)).size,4);assert.deepEqual(rows.slice(0,2).map(r=>[r.title,r.turnIds]),[['复制确认',[String(turn-1)]],['占用提示',[String(turn-1)]]]);end('completed');
});
