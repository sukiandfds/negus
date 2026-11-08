const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require('/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=path.resolve('ui-feishu/dist'),id='mobile-trace',start=Date.now();
 const summary={threadId:id,title:'手机链路对照',source:'codex',updatedAt:'2026-11-06T00:00:00Z',messageCount:1,cwd:'/fixture/project',createdBy:'assistant',model:'fixture-model'};
 const context={type:'context_status',threadId:id,model:'fixture-model',reasoningEffort:'medium',usedTokens:12000,contextWindow:100000,percentage:12,autoCompactThreshold:80,phase:'idle',updatedAt:'2026-11-06T00:00:00Z'};
 let sessionReads=0;const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');let data={},delay=0;
  if(u.pathname.startsWith('/api/')){
   if(u.pathname==='/api/sessions'){data=[summary];delay=1000;}
   else if(u.pathname==='/api/project'){data={root:'/fixture/project',name:'project',mode:'interactive'};delay=500;}
   else if(u.pathname==='/api/project-directory'){data={projects:[{id:'project-fixture',name:'project',conversations:[{id:'fixture-entry',threadId:id,title:summary.title}]}]};}
   else if(u.pathname==='/api/session'){sessionReads++;if(sessionReads===1){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Fixture transient first-read failure'}));}data={session:{...summary,historyFormatVersion:3,messages:[{id:'body',role:'assistant',text:'链路正文内容',createdAt:summary.updatedAt}]},context,status:{threadId:id,phase:'idle',active:false,activities:[]},goal:null,queue:[],input:null};delay=1600;}
   else if(u.pathname==='/api/models')data=[];
   else if(u.pathname==='/api/model-channels')data={channels:[]};
   else if(u.pathname==='/api/group/rooms')data={rooms:[]};
   else if(u.pathname==='/api/version')data=JSON.parse(fs.readFileSync(path.join(root,'version.json')));
   return setTimeout(()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));},delay);
  }
  const f=path.join(root,u.pathname==='/'?'index.html':u.pathname);if(!fs.existsSync(f)){res.writeHead(404);return res.end();}
  const type={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}[path.extname(f)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type});res.end(fs.readFileSync(f));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await ctx.newPage();page.on('pageerror',e=>console.log('PAGEERROR',e.message));page.on('console',m=>{if(m.type()==='error')console.log('ERROR',m.text());});
 await page.addInitScript(({id,context})=>{
  if(!localStorage.getItem('fixture-seeded')){localStorage.setItem('fixture-seeded','1');localStorage.setItem('negus-project-directory-v1',JSON.stringify({version:1,value:[{id:'project-fixture',name:'project',conversations:[{id:'fixture-entry',threadId:id,title:'手机链路对照'}]}]}));}
  window.EventSource=class{constructor(){}close(){}};
  window.trace=[];let previous='';const capture=()=>{const h=document.querySelector('.chat-header');const c=document.querySelector('.chat-composer');const value={title:h?.textContent||'',composer:c?.textContent||'',messages:document.querySelectorAll('[data-message-id]').length};const key=JSON.stringify(value);if(key!==previous){previous=key;window.trace.push({ms:Math.round(performance.now()),...value});}};
  document.addEventListener('DOMContentLoaded',()=>new MutationObserver(capture).observe(document.documentElement,{childList:true,subtree:true,characterData:true}));
 },{id,context});
 const origin='http://127.0.0.1:'+server.address().port;
 await page.goto(origin+'/?thread='+id);await page.waitForTimeout(4500);
 const beforeRefresh={sessionReads,visibleMessages:await page.locator('[data-message-id]').count(),hasSyncFailure:(await page.locator('body').innerText()).includes('Fixture transient first-read failure')};
 await page.reload();await page.getByText('链路正文内容',{exact:true}).last().waitFor({timeout:10000});
 const afterRefresh={sessionReads,visibleMessages:await page.locator('[data-message-id]').count()};
 const results={build:JSON.parse(fs.readFileSync(path.join(root,'version.json'))),scope:'Isolated mobile Chrome; first session read 503 once, later requests succeed',beforeRefresh,afterRefresh};
 fs.writeFileSync('work/mobile-cache-diagnosis-2026-11-06/cold-error-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
