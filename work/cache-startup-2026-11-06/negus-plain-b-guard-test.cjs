const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('/Users/hans/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin='http://127.0.0.1:5201';
const stamp='2026-11-06T00:00:00Z';
const room={id:'test-room',name:'缓存群聊',projectId:'test-project'};
const summary=id=>({threadId:id,title:`对话${id}`,source:'codex',sourceRevision:'r1',historyFormatVersion:3,updatedAt:stamp,createdBy:'user'});
const photo={id:'photo',name:'failed.png',mimeType:'image/png',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',size:68};
const detail=id=>({...summary(id),hasMore:true,nextCursor:'older',messages:Array.from({length:95},(_,n)=>({id:`history-${id}-${n}`,role:'assistant',text:`已加载历史${id}-${n}`,createdAt:stamp})).concat(id==='b'?[{id:'optimistic-old-failure',submissionId:'old-failure',role:'user',text:'旧图片失败',deliveryState:'failed',deliveryError:'真实失败原因',createdAt:stamp,blocks:[{id:'text',type:'markdown',text:'旧图片失败'},{id:'image',type:'image',source:photo.url,file:photo}]}]:[])});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const results=[];
 const check=async(name,fn)=>{try{await fn();results.push({name,pass:true});console.log('PASS '+name)}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL '+name+' '+e.message)}};
 let ctx,page;
 const fixture=async({cache=true,legacy=false,delay=false,route='?thread=a',group=false,mode='fail',plain=false}={})=>{
  ctx=await browser.newContext({viewport:{width:1400,height:1000}});page=await ctx.newPage();page.setDefaultTimeout(6000);const errors=[],calls=[];let apiMode=mode;
  await page.route('**/probe',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.route('**/api/**',async r=>{let p=new URL(r.request().url()).pathname;if(!p.startsWith('/api/'))return r.continue();calls.push(p);if(apiMode==='slow')await new Promise(resolve=>setTimeout(resolve,2500));if(apiMode==='groups'&&p==='/api/group/rooms') return r.fulfill({json:{rooms:[room]}});return r.fulfill({status:503,json:{error:'isolated offline fixture'}}).catch(()=>{})});
  await page.goto(origin+'/probe');
  await page.evaluate(async({cache,legacy,group,stamp,records,room})=>{
   if(cache&&legacy)localStorage.setItem('negus-conversation-snapshot-v1',JSON.stringify({version:1,savedAt:stamp,selectedId:'a',sessions:records.map(r=>r.entry.session),session:records[0].entry.session,recentSessions:[records[1].entry]}));
   else if(cache) await new Promise((resolve,reject)=>{const q=indexedDB.open('negus-conversations',1);q.onupgradeneeded=()=>{q.result.createObjectStore('threads',{keyPath:'threadId'});q.result.createObjectStore('metadata')};q.onsuccess=()=>{const db=q.result,tx=db.transaction(['threads','metadata'],'readwrite');for(const record of records)tx.objectStore('threads').put(record);tx.objectStore('metadata').put({version:1,savedAt:stamp,selectedId:'a',sessions:records.map(r=>{const{messages,...s}=r.entry.session;return s})},'snapshot');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}});
   if(group){localStorage.setItem('negus-group-rooms-v1',JSON.stringify({version:1,value:[room]}));localStorage.setItem('negus-group-snapshot-v1:'+room.id,JSON.stringify({project:'测试项目',projectId:room.projectId,room,messages:[{id:'g1',sequence:1,type:'human',authorId:'me',authorName:'我',agentId:null,text:'群聊缓存正文',createdAt:stamp}],agents:[],members:[]}));}
  },{cache,legacy,group,stamp,records:['a','b'].map(id=>({threadId:id,entry:{savedAt:stamp,session:plain?{...detail(id),messages:detail(id).messages.filter(m=>!m.id.startsWith('optimistic-'))}:detail(id)}})),room});
  await page.addInitScript(({delay})=>{
   const sources=[];window.EventSource=class{constructor(){sources.push(this);setTimeout(()=>this.onopen?.(),0)}close(){}};
   window.emit=e=>sources.forEach(s=>s.onmessage?.({data:JSON.stringify(e)}));
   window.probe={reads:[],rootAt:null};new MutationObserver(()=>{if(!window.probe.rootAt&&document.querySelector('[data-message-id]'))window.probe.rootAt=performance.now()}).observe(document,{childList:true,subtree:true});
   const original=IDBDatabase.prototype.transaction;
   IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);let all=false;const objectStore=tx.objectStore.bind(tx);tx.objectStore=function(name){const store=objectStore(name);if(name==='threads'){const get=store.get.bind(store),getAll=store.getAll.bind(store);store.get=id=>{window.probe.reads.push('get:'+id);return get(id)};store.getAll=(...a)=>{all=true;window.probe.reads.push('getAll');return getAll(...a)}}return store};return new Proxy(tx,{get(t,p){const v=Reflect.get(t,p,t);return typeof v==='function'?v.bind(t):v},set(t,p,v){if(p==='oncomplete'&&args[1]==='readonly'){t[p]=(...a)=>{if(all&&delay){window.probe.remainingReady=true;window.releaseCache=()=>v.apply(t,a)}else v.apply(t,a)};return true}return Reflect.set(t,p,v,t)}})};
  },{delay});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/'+route);
  return {page,errors,calls,setMode:v=>{apiMode=v}};
 };
 try{
 await check('普通B晚到回填后磁盘仍保存原95条正文',async()=>{await fixture({delay:true,plain:true});await page.getByText('已加载历史a-94',{exact:true}).waitFor();await page.waitForFunction(()=>window.probe.remainingReady);await page.waitForTimeout(350);await page.getByRole('button',{name:'打开对话b',exact:true}).click();await page.waitForTimeout(300);await page.evaluate(()=>window.releaseCache());await page.getByText('已加载历史b-94',{exact:true}).waitFor();await page.waitForTimeout(350);const count=await page.evaluate(()=>new Promise(resolve=>{const q=indexedDB.open('negus-conversations',1);q.onsuccess=()=>{const read=q.result.transaction('threads').objectStore('threads').get('b');read.onsuccess=()=>resolve(read.result?.entry.session.messages.length)}}));assert.equal(count,95);await ctx.close()});
 await check('普通B回填前再次刷新仍直接恢复磁盘95条正文',async()=>{await fixture({delay:true,plain:true});await page.getByText('已加载历史a-94',{exact:true}).waitFor();await page.waitForFunction(()=>window.probe.remainingReady);await page.waitForTimeout(350);await page.getByRole('button',{name:'打开对话b',exact:true}).click();await page.waitForTimeout(300);await page.reload();await page.getByText('已加载历史b-94',{exact:true}).waitFor();assert.equal(await page.locator('[data-message-id]').count(),95);await ctx.close()});
 }finally{await browser.close();fs.writeFileSync('/tmp/negus-plain-b-guard-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({pass:results.filter(x=>x.pass).length,total:results.length}));}
})().catch(e=>{console.error(e);process.exitCode=1});
