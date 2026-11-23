import {topicWriter} from '../../windows/server/status-panel/topics.mjs';
import {digest,taskRows} from '../../windows/server/status-panel/resources.mjs';
import {realtimeIntegration} from '../realtime-integration.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { createHistoryFixture } from '../../windows/tests/history-readonly.fixture.mjs';
import { statusPanelRoute } from '../../windows/server/status-panel/route.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const f=await createHistoryFixture(), vite=await createServer({root:path.resolve('ui-feishu'),configFile:false,plugins:[realtimeIntegration(path.resolve('ui-feishu/src/projectEvents.ts'))],optimizeDeps:{include:['react/jsx-runtime','react/jsx-dev-runtime','react','react-dom/client']},
 esbuild:{jsx:'automatic'},define:{__APP_BUILD_ID__:JSON.stringify('panel-test')},server:{host:'127.0.0.1',port:0,fs:{allow:[process.cwd()]}}});
await vite.listen();const browser=await chromium.launch({executablePath:process.env.CHROME_PATH});
try{
await fs.appendFile(f.file,JSON.stringify({type:'response_item',timestamp:new Date().toISOString(),payload:{type:'message',role:'assistant',phase:'final_answer',id:'panel-output',internal_chat_message_metadata_passthrough:{turn_id:'turn-47'},content:[{type:'image',image_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLZkAAAAASUVORK5CYII='}]}})+'\n');
const commands=['pwd','cat /tmp/github/SKILL.md','echo first\necho second'];
await fs.appendFile(f.file,commands.map((cmd,i)=>JSON.stringify({type:'response_item',timestamp:new Date().toISOString(),payload:{turn_id:'turn-47',type:'function_call',call_id:'panel-cmd-'+i,name:'exec_command',arguments:JSON.stringify({cmd})}})).join('\n')+'\n');
let panelTasks=[],scheduleName='本对话的日程';const nextRunAt=Date.now()+10000,createdAt=Date.now();
const writer=topicWriter(f.root);const {draft}=await writer.prepare(f.id);
await fs.mkdir(path.dirname(draft),{recursive:true});await fs.writeFile(draft,JSON.stringify({title:'跨设备置顶',mainline:'统一对话体验',summary:'两台设备显示相同顺序'}));
writer.bind(f.id,'turn-47',draft);await writer.finish(f.id,'turn-47','completed');
const dataRoute=statusPanelRoute({projectRoot:f.root,authorizeAgentThread:async()=>null,conversations:f.conversations,readAutomations:async()=>({items:[{threadId:f.id,id:'s',name:scheduleName,status:'ACTIVE',schedule:'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',nextRunAt,runs:[{createdAt,status:'COMPLETED'}]},{threadId:'other',name:'其他对话的日程'}],warnings:[]}),agentTasks:{tasks:()=>panelTasks }});
for(const width of [1440,412]){
 panelTasks=[];scheduleName='本对话的日程';const reads=[];
 const p=await browser.newPage({viewport:{width,height:900}});p.setDefaultTimeout(8000);p.on('pageerror',e=>console.error(e.message));
 await p.addInitScript(()=>{window.EventSource=class{constructor(){window.panelStream=this;setTimeout(()=>this.onopen?.(),0)}close(){}}});
 await p.route('**/api/**',async r=>{const u=new URL(r.request().url());if(!u.pathname.startsWith('/api/'))return r.continue();
   if(u.pathname==='/api/session/status-panel'){reads.push(u.searchParams.get('section'));let data;await dataRoute({method:'GET'},{writeHead(){},end(t){data=JSON.parse(t)}},u);return r.fulfill({json:data});}
   if(u.pathname==='/api/session'||u.pathname.startsWith('/api/session/')||u.pathname==='/api/model-defaults'){const v=await f.request(u.pathname+u.search,r.request().method()==='POST'?r.request().postDataJSON():undefined);return r.fulfill({status:v.status,json:v.value});}
   const row={threadId:f.id,source:'codex',title:'隔离历史对话',cwd:f.root,messageCount:96,updatedAt:new Date().toISOString(),latestUser:'',latestAssistant:'assistant history 47'};
   await r.fulfill({json:({'/api/sessions':[row],'/api/project':{name:'隔离',root:f.root,mode:'interactive'},'/api/project-directory':{projects:[]},'/api/group/rooms':{rooms:[]}})[u.pathname]||{}});
 });
 await p.goto(vite.resolvedUrls.local[0]+'?thread='+f.id);await p.locator('.chat-messages').getByText('assistant history 47',{exact:true}).waitFor().catch(async e=>{console.log((await p.locator('body').innerText()).slice(0,900));throw e});
 const geometry=()=>p.locator('.chat-primary').evaluate(el=>({w:el.clientWidth,h:el.clientHeight,scroll:[...el.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight&&e.scrollTop>0).map(e=>e.scrollTop)}));
 const before=await geometry();await p.getByRole('button',{name:'对话详情',exact:true}).click();const panel=p.getByRole('complementary',{name:'对话详情'});
 assert.equal(await panel.getByText('user history 47',{exact:true}).count(),0);await panel.getByText('两台设备显示相同顺序').waitFor();assert.equal(await panel.getByText('统一对话体验').count(),0);
 if(process.env.MUSE_RELOAD_CHECK){
   if(width===1440) for(const name of ['员工','项目','后台','全部']){
     await p.locator('.list-filters').getByRole('button',{name,exact:true}).click();
     assert.ok(await panel.isVisible());
   }
   await p.getByRole('button',{name:'关闭对话详情'}).click();
   await p.waitForFunction(()=>document.querySelector('.list-footer span')?.textContent==='1');
   await p.evaluate(async()=>{const {flushConversationSnapshot}=await import('/shared/features/conversations/data/conversationSnapshot.ts');await flushConversationSnapshot();});
   let resume;const network=new Promise(resolve=>{resume=resolve;});
   await p.route(url=>url.pathname.startsWith('/api/'),async route=>{await network;await route.fallback();});
   try {await p.reload({waitUntil:'domcontentloaded'});await p.locator('.chat-messages').getByText('assistant history 47',{exact:true}).waitFor();assert.match(await p.locator('.list-footer').innerText(),/同步中/);}
   finally {resume();}
   console.log(width,'px: cached body before network; partial count hidden; panel filters passed');await p.close();continue;
 }
 await panel.getByText('跨设备置顶',{exact:true}).click();await panel.locator('section[aria-label="本次产物"] img').first().waitFor({state:'attached'});assert.deepEqual(await geometry(),before);
 const block=panel.locator('.sp-commands').filter({hasText:'执行命令 · 3 次'});assert.equal(await block.count(),1);
 const box=block.locator('pre');assert.equal(await box.isVisible(),false);await block.locator('summary').click();
 const details=await box.innerText();assert.ok(commands.every(cmd=>details.includes(cmd)));assert.ok(details.indexOf('pwd')<details.indexOf('cat /tmp/'));
 if(process.env.PANEL_PREVIEW && width===1440){await block.locator('summary').click();await panel.getByText('跨设备置顶',{exact:true}).click();await panel.screenshot({path:process.env.PANEL_PREVIEW});}
 await panel.getByRole('button',{name:'日程',exact:true}).click();await panel.getByText('本对话的日程').click();await panel.getByText('运行历史',{exact:true}).waitFor();assert.equal(await panel.getByText('其他对话的日程').count(),0);
 await panel.getByRole('button',{name:'关闭对话详情'}).click();assert.deepEqual(await geometry(),before);assert.equal(f.calls.client,0);assert.equal(f.calls.credentials,0);
 const warm=reads.length;
 await p.getByRole('button',{name:'查看助手状态',exact:true}).click();
 await panel.getByText('跨设备置顶',{exact:true}).click();await panel.locator('section[aria-label="本次产物"] img').first().waitFor();
 assert.equal(reads.length,warm,'重开活动、产物、任务、日程均零请求');
 const signal=(section,versions)=>p.evaluate(payload=>window.panelStream.onmessage({data:JSON.stringify(payload)}),{type:'panel_versions',section,versions,warnings:''});
 await signal('tasks',{other:'other-version'});assert.equal(reads.length,warm);
 panelTasks=[{id:'task-1',background:true,source:{kind:'conversation',threadId:f.id},title:'独立变化任务',state:'running'}];
 await signal('tasks',{[f.id]:digest(taskRows(panelTasks))});await panel.getByText('独立变化任务').waitFor();
 assert.deepEqual(reads.slice(warm),['tasks']);
 scheduleName='独立变化日程';await signal('schedules',{[f.id]:'changed'});await panel.getByText('独立变化日程').waitFor();
 assert.deepEqual(reads.slice(warm),['tasks','schedules']);
 await panel.getByRole('button',{name:'关闭对话详情'}).click();
 // Simulate a fresh page: disk cache should paint before any panel network response.
 const reloadStart=reads.length;await p.reload();await keep.click();
 await p.getByRole('button',{name:'查看助手状态',exact:true}).click();
 await panel.getByText('独立变化日程').waitFor();await panel.getByText('独立变化任务',{exact:true}).waitFor();
 await panel.getByText('跨设备置顶',{exact:true}).click();await panel.locator('section[aria-label="本次产物"] img').first().waitFor();
 assert.deepEqual(reads.slice(reloadStart),[],'硬刷新后可直接恢复当前对话缓存');
 await panel.getByRole('button',{name:'关闭对话详情'}).click();
 if(width===412){
   await p.getByRole('button',{name:'查看助手状态',exact:true}).click();
   const turnId='panel-live-check';
   f.execution.handleProtocolMessage({method:'turn/started',params:{threadId:f.id,turn:{id:turnId}}});
   for(const item of [{type:'webSearch',id:'s',query:'商品报价'},{type:'mcpToolCall',id:'d',server:'negus_handoffs',tool:'create_background_task'}]){
     f.execution.handleProtocolMessage({method:'item/started',params:{threadId:f.id,turnId,item}});
     await p.evaluate(status=>window.panelStream.onmessage({data:JSON.stringify(status)}),f.execution.getStatus(f.id));
     await panel.getByText(item.type==='webSearch'?'联网搜索':'派发后台任务',{exact:true}).waitFor();
   }
   for(const [i,command] of ['pwd','echo a\necho b'].entries()){
     f.execution.handleProtocolMessage({method:'item/started',params:{threadId:f.id,turnId,item:{id:'live-cmd-'+i,type:'commandExecution',command}}});
     await p.evaluate(status=>window.panelStream.onmessage({data:JSON.stringify(status)}),f.execution.getStatus(f.id));
   }
   const liveBlock=panel.locator('.sp-commands').filter({hasText:'执行命令 · 2 次'});await liveBlock.locator('summary').click();
   assert.match(await liveBlock.locator('pre').innerText(),/pwd[\s\S]+echo a\necho b/);
   await panel.getByRole('button',{name:'停止本轮'}).waitFor();
 }
 console.log(width,'px: overlay, activity detail, schedule history, scope and unchanged chat geometry passed');await p.close();
}
} finally {await browser.close();await vite.close();await f.close();}
