import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium }=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 for (const width of [1280,390]) {
  const page=await browser.newPage({viewport:{width,height:844}}); page.setDefaultTimeout(7000);
  const errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  const agents=['manager','developer'].map(id=>({id,name:id,shortName:id,responsibility:'fixture',phase:'working',active:true,threadId:id}));
  const stamp='2026-11-17T00:00:00Z';
  const works=agents.map(a=>({workId:`work-${a.id}`,agentId:a.id,agentName:a.name,startedAt:stamp,phase:'working'}));
  let snapshot={project:'fixture',projectId:'p',room:{id:'room-a',name:'room-a',projectId:'p'},agents,members:[],messages:[],activeWorks:works};
  const message=(id,agentId,text,sequence,phase='commentary')=>({id,itemId:phase? id:undefined,phase:phase||undefined,workId:`work-${agentId}`,type:'agent',agentId,authorId:agentId,authorName:agentId,text,sequence,createdAt:`2026-11-17T00:00:0${sequence}Z`,attachments:[]});
  await page.route('**/api/**',route=>{
   const url=new URL(route.request().url());
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/group/snapshot')return route.fulfill({json:snapshot});
   return route.fulfill({json:url.pathname==='/api/group/rooms'?{rooms:[]}: {}});
  });
  await page.goto(`${process.env.GROUP_FIXTURE_URL || 'http://127.0.0.1:5197'}/validation/group-workspace.html`);
  await page.getByRole('region',{name:'群聊工作区'}).waitFor();
  await page.evaluate(async()=>{ const {publishProjectStream}=await import('/src/projectEvents.ts');
   window.emit=event=>publishProjectStream('message',new MessageEvent('message',{data:JSON.stringify(event)}));
   window.reopen=()=>publishProjectStream('open',new Event('open')); window.reopen(); });
  for (const work of works) await page.evaluate(work=>window.emit({type:'group_agent_started',roomId:'room-a',...work}),work);
  const a=message('a','manager','运营中间回复',1), b=message('b','developer','研发中间回复',2);
  for (const m of [a,b,a]) await page.evaluate(message=>window.emit({type:'group_message_created',roomId:'room-a',message}),m);
  await page.getByText(a.text,{exact:true}).waitFor(); await page.getByText(b.text,{exact:true}).waitFor();
  assert.equal(await page.getByText(a.text,{exact:true}).count(),1);
  assert.equal(await page.getByText(b.text,{exact:true}).count(),1);
  snapshot={...snapshot,messages:[a,b]};
  // A reconnect refresh keeps commentary plus live work; a missed commentary arrives from snapshot.
  const c=message('c','manager','重连补回中间回复',3); snapshot={...snapshot,messages:[a,b,c]};
  await page.evaluate(()=>window.reopen());
  await page.getByText(c.text,{exact:true}).waitFor();
  await page.reload(); await page.getByText(c.text,{exact:true}).waitFor();
  await page.evaluate(async()=>{const {publishProjectStream}=await import('/src/projectEvents.ts');window.emit=event=>publishProjectStream('message',new MessageEvent('message',{data:JSON.stringify(event)}));});
  for(const m of [a,b,c]) assert.equal(await page.getByText(m.text,{exact:true}).count(),1);
  const final=message('final','manager','最终回复',4,'');
  const stopped={...message('stop','developer','任务已停止',5,''),type:'system',authorId:'system'};
  snapshot={...snapshot,messages:[a,b,c,final,stopped],activeWorks:[],agents:agents.map(a=>({...a,active:false,phase:'completed'}))};
  for(const m of [final,stopped]) await page.evaluate(message=>window.emit({type:'group_message_created',roomId:'room-a',message}),m);
  for(const agent of snapshot.agents) await page.evaluate(agent=>window.emit({type:'group_agent_updated',roomId:'room-a',agent}),agent);
  await page.getByText(final.text,{exact:true}).waitFor();
  await page.evaluate(message=>window.emit({type:'group_message_created',roomId:'foreign',message}),message('foreign','manager','跨群泄漏',6));
  assert.equal(await page.getByText('跨群泄漏',{exact:true}).count(),0);
  await page.reload();
  for(const m of snapshot.messages){await page.getByText(m.text,{exact:true}).waitFor();assert.equal(await page.getByText(m.text,{exact:true}).count(),1);}
  const order=await page.locator('[data-message-id]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-message-id')));
  assert.deepEqual(order,['a','b','c','final','stop']); assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,completedCommentary:3,duplicateCount:0,reconnect:true,refresh:true,stopPreserved:true,roomIsolation:true,order}));
  await page.close();
 }
}finally{await browser.close();}
