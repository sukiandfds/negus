import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage();
page.setDefaultTimeout(6000);
const stamp='2026-10-30T00:00:00Z';
const summaries=Array.from({length:12},(_,i)=>({threadId:`t${i}`,source:'codex',title:`缓存标题${i}`,updatedAt:new Date(Date.parse(stamp)-i*1000).toISOString(),messageCount:1,latestMessage:`缓存预览${i}`,latestUser:'',latestAssistant:''}));
const detail=id=>({...summaries[Number(id.slice(1))],messages:[{id:`m${id}`,role:'assistant',text:`缓存正文${id}`,createdAt:stamp}]});
let releaseFirst,releaseRest;
const first=new Promise(r=>releaseFirst=r),rest=new Promise(r=>releaseRest=r);
const calls=[],errors=[],syncErrors=[];
let archived=false;
let failNinth=process.env.NEGUS_TEST_BATCH_FAILURE==='1';
page.on('console',message=>{if(message.type()==='error'&&message.text().includes('negus:conversation-sync'))syncErrors.push(message.text());});
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(({summaries,details,stamp})=>{
  localStorage.setItem('negus-conversation-snapshot-v1',JSON.stringify({version:1,savedAt:stamp,selectedId:'t0',sessions:summaries,session:details[0],recentSessions:details.slice(1).map(session=>({savedAt:stamp,session}))}));
  const sources=[];window.EventSource=class{constructor(){sources.push(this);setTimeout(()=>this.onopen?.(),0);}close(){}};
  window.emitFixture=e=>sources.forEach(s=>s.onmessage?.({data:JSON.stringify(e)}));
},{summaries,details:summaries.map(s=>detail(s.threadId)),stamp});
await page.route('**/api/**',async route=>{
 const u=new URL(route.request().url()),p=u.pathname,id=u.searchParams.get('threadId')||'t0',n=Number(id.slice(1));calls.push([p,id]);
 if(!p.startsWith('/api/'))return route.continue();
 let data={};
 if(p==='/api/project')data={name:'项目',root:'/fixture',mode:'interactive'};
 else if(p==='/api/project-directory')data={projects:[{id:'fixture-project',name:'验收项目',conversations:[{id:'t5',threadId:'t5',title:'旧目录标题'}]}]};
 else if(p==='/api/sessions')data=summaries.filter(s=>u.searchParams.has('archived')?(archived&&s.threadId==='t5'):(!archived||s.threadId!=='t5')).map(s=>({...s,archived:s.threadId==='t5'&&archived,title:s.title.replace('缓存','最新'),latestMessage:s.latestMessage.replace('缓存','最新')}));
 else if(p==='/api/session/archive'){archived=true;data={threadId:'t5',archived:true};}
 else if(p==='/api/session/unarchive'){archived=false;data={...summaries[5],archived:false};}
 else if(p==='/api/session'){if(id==='t9'){await first;if(failNinth)return route.fulfill({status:503,json:{error:'fixture timeout'}});}if(id==='t11')await rest;data={...detail(id),title:`最新标题${n}`,messages:[{id:`m${id}`,role:'assistant',text:`最新正文${id}`,createdAt:stamp}]};}
 else if(p==='/api/execution-status')data={type:'execution_status',threadId:id,phase:'idle',active:false,activities:[],turnId:'',startedAt:null,updatedAt:stamp,label:'',detail:'',commentary:''};
 else if(p==='/api/session/context')data={type:'context_status',threadId:id,model:id==='t0'?'model-a':'model-b',reasoningEffort:id==='t0'?'high':'low',phase:'idle',usedTokens:10,contextWindow:100,percentage:10,autoCompactThreshold:80,updatedAt:stamp,message:''};
 else if(p==='/api/session/goal')data={goal:null};
 else if(p==='/api/session/queue')data={threadId:id,items:[]};
 else if(p==='/api/session/user-input')data={request:null};
 else if(p==='/api/models')data=[{id:'model-a',model:'model-a',displayName:'测试模型',available:true,isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'high'}]}];
 else if(p==='/api/model-channels')data={channels:[]};
 else if(p==='/api/group/rooms')data={rooms:[]};
 else if(p==='/api/model-defaults')data={providerId:'current',model:'model-a',effort:'high',archivedProviderIds:[]};
 if(p==='/api/execution-status'){
   data.updatedAt=new Date().toISOString();
   await page.evaluate(event=>window.emitFixture(event),data);
 }
 await route.fulfill({json:data});
});
try{
 await page.goto('http://127.0.0.1:5201/?thread=t0');
 await page.getByText('缓存正文t0',{exact:true}).waitFor();
 await page.waitForTimeout(700);
 assert.ok(calls.some(([p,id])=>p==='/api/session'&&id==='t9'));
 assert.equal(calls.some(([p,id])=>p==='/api/session'&&id==='t10'),false,'second batch must wait');
 assert.equal(await page.getByText('最新正文t0',{exact:true}).count(),0,'body cannot publish early');
 assert.equal(await page.getByText('最新标题1',{exact:true}).count(),0,'title cannot publish early');
 await page.evaluate(()=>window.emitFixture({type:'execution_status',threadId:'t0',phase:'working',active:true,turnId:'r1',startedAt:'2026-10-30T00:00:00Z',updatedAt:'2026-10-30T00:00:01Z',label:'运行',activities:[]}));
 await page.waitForTimeout(100);
 assert.equal(await page.getByText('助手正在运行...',{exact:true}).count(),0,'status cannot cross batch');
 await page.getByRole('button',{name:'打开缓存标题5',exact:true}).click();
 await page.getByText('缓存正文t5',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/测试模型/}).count(),0,'uncached model must not borrow previous thread');
 assert.equal(await page.getByText('最新正文t5',{exact:true}).count(),0,'selection cannot bypass batch');
 await page.getByRole('button',{name:'打开缓存标题0',exact:true}).click();
 await page.getByText('缓存正文t0',{exact:true}).waitFor();
 releaseFirst();
 await page.getByText('最新正文t0',{exact:true}).waitFor();
 if(failNinth){await page.getByText('缓存标题9',{exact:true}).waitFor();assert.equal(await page.getByText('最新标题9',{exact:true}).count(),0);await page.getByText(/t9：/).first().waitFor();assert.ok(syncErrors.length);}
 else await page.getByText('最新标题9',{exact:true}).waitFor();
 assert.equal(await page.getByText('最新标题10',{exact:true}).count(),0,'second batch remains frozen');
 releaseRest();await page.getByText('最新标题11',{exact:true}).waitFor();
 if(failNinth){failNinth=false;await page.getByRole('button',{name:'刷新会话',exact:true}).click();await page.getByText('最新标题9',{exact:true}).waitFor();assert.equal(await page.getByText(/t9：/).count(),0,'refresh retries failure and clears error');}
 await page.waitForTimeout(1200);
 const settledReads=calls.filter(([path])=>path==='/api/session').length;
 await page.waitForTimeout(1200);
 assert.equal(calls.filter(([path])=>path==='/api/session').length,settledReads,'read timestamps must not cause another read');
 await page.getByRole('button',{name:'更多操作：最新标题5',exact:true}).click();
 await page.getByRole('menuitem',{name:'归档',exact:true}).click();
 await page.getByRole('button',{name:'打开最新标题5',exact:true}).waitFor({state:'detached'});
 await page.getByRole('button',{name:'查看已归档对话'}).click();
 await page.getByRole('button',{name:'更多操作：最新标题5',exact:true}).click();
 await page.getByRole('menuitem',{name:'恢复',exact:true}).click();
 await page.getByRole('button',{name:'返回活动对话'}).click();
 await page.getByRole('button',{name:'打开最新标题5',exact:true}).waitFor();
 assert.equal(await page.locator('button.contact-main').count(),12,'restore must retain other conversations');
 assert.deepEqual(errors,[]);
 console.log('PASS cached full view; first ten atomic; state withheld; remainder atomic; failed row retained, logged and refreshed='+(syncErrors.length>0)+'; no page exceptions');
 await page.screenshot({path:'/tmp/negus-conversation-batch-browser.png'});
}finally{console.log(JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(0,3000),calls}));releaseFirst();releaseRest();await browser.close();}
