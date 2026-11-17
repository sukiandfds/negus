const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require('/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const {config,http:readApi}=await import('../../scripts/negus-service-common.mjs');const cfg=await config();const id='01a1aecc-ff74-7240-bb39-df6720d699c5';
 const response=await readApi(cfg,'/api/session?threadId='+id+'&limit=100&view=1',{timeout:20000});if(response.status!==200||!response.body?.session)throw Error('Actual conversation read failed');
 const actual=response.body;actual.status={...actual.status,active:true,phase:'working',turnId:'fixture-active-turn',startedAt:'2026-11-06T00:00:00Z'};const detail=actual.session;const {messages,...summary}=detail;let hold=false;
 const root=path.resolve('ui-feishu/dist');const version=JSON.parse(fs.readFileSync(path.join(root,'version.json')));
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/')){let data={};
 if(u.pathname==='/api/session')data=actual;
 else if(u.pathname==='/api/sessions')data=[summary];
 else if(u.pathname==='/api/project')data={root:detail.cwd,name:'fixture',mode:'interactive'};
 else if(u.pathname==='/api/project-directory')data={projects:[{id:'fixture',name:'fixture',conversations:[{id:'fixture-entry',threadId:id,title:detail.title}]}]};
 else if(u.pathname==='/api/models')data=[];
 else if(u.pathname==='/api/model-channels')data={channels:[]};
 else if(u.pathname==='/api/group/rooms')data={rooms:[]};
 else if(u.pathname==='/api/version')data=version;
 return setTimeout(()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));},hold?2000:0);}
 const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);if(!fs.existsSync(file)){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const results={buildId:version.buildId,actualMessageCount:messages.length,actualJsonBytes:Buffer.byteLength(JSON.stringify(actual)),cases:[]};
 try{for(const failWrites of [false,true]){hold=false;const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});const page=await ctx.newPage();const errors=[];page.on('console',m=>{if(m.type()==='error'&&m.text().includes('conversation-cache'))errors.push(m.text().replace(/\n[\s\S]*/,''));});
 await page.addInitScript(fail=>{window.EventSource=class{close(){}};if(fail){const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.transaction.mode==='readwrite'&&this.transaction.db.name==='negus-conversations')throw new DOMException('Fixture storage quota exhausted','QuotaExceededError');return original.apply(this,args);};}},failWrites);
 await page.goto(origin+'/?thread='+id);await page.locator('[data-message-id]').first().waitFor({timeout:15000});await page.waitForTimeout(300);
 const initialVisible=await page.locator('[data-message-id]').count();
 const persisted=await page.evaluate(id=>new Promise(resolve=>{const r=indexedDB.open('negus-conversations',1);r.onsuccess=()=>{const db=r.result;const tx=db.transaction(['threads','metadata']);const t=tx.objectStore('threads').get(id),m=tx.objectStore('metadata').get('snapshot');tx.oncomplete=()=>{resolve({hasMetadata:!!m.result,bodyMessages:t.result?.entry?.session?.messages?.length||0});db.close();};};}),id);
 hold=true;await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(300);const restoredVisible=await page.locator('[data-message-id]').count();
 results.cases.push({failWrites,initialVisible,persisted,restoredVisibleBeforeNetwork:restoredVisible,cacheErrors:errors.length});await ctx.close();}
 fs.writeFileSync('work/mobile-cache-diagnosis-2026-11-06/active-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
