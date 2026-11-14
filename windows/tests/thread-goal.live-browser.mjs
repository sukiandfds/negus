import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { createAppServerClient } from "../server/app-server-client.mjs";
import { createAppServerConversationStore } from "../server/app-server-conversation-store.mjs";
import { createConversationRoutes } from "../server/routes/conversation-routes.mjs";
const { chromium } = await import(pathToFileURL(process.env.NEGUS_PLAYWRIGHT_MODULE).href);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-goal-live-browser-"));
const native = createAppServerClient({ codexHome: path.resolve("runtime/model-providers/ccswitch_default/codex-home"), workingDirectory: root, label: "goal-live-browser", requestTimeoutMs: 20000 });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
let ready = false;
const notifications = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
const store = createAppServerConversationStore({ projectRoot: root, client: native, autoTitleEnabled: false, registerMedia: () => null,
 onProtocolMessage: message => {
   if (!message.method.startsWith("thread/goal/")) return;
   notifications.push({ method: message.method, status: message.params.goal?.status });
   if (ready) void page.evaluate(event => window.__emit(event), { type: "goal_status", threadId: message.params.threadId, goal: message.params.goal || null }).catch(() => {});
 }
});
const routes = createConversationRoutes({ conversations: store, media: { resolveMany: () => [] } });
let threadId;
await context.addInitScript(() => {
 window.__sources = []; window.__id = 1;
 window.EventSource = class { static CLOSED=2; readyState=1; constructor() { window.__sources.push(this); setTimeout(() => { this.onopen?.({}); this.onmessage?.({data:JSON.stringify({type:"connected",eventId:1}),lastEventId:""}); },10); } close() { window.__sources=window.__sources.filter(s=>s!==this); } };
 window.__emit = event => { const id=String(++window.__id); for(const source of window.__sources) source.onmessage?.({data:JSON.stringify(event),lastEventId:id}); };
});
try {
 const created = await store.createSession();
 threadId = created.threadId;
 const runtime = await store.getRuntimeContext(threadId);
 const session = { ...created, messages: [], messageCount: 0, model: runtime.model };
 const project = { id:"goal-live", name:"Goal live test", kind:"personal", root, conversations:[{...session,id:threadId}] };
 await page.route("**/api/**", async route => {
  const url=new URL(route.request().url()), method=route.request().method();
  if(url.pathname === "/api/session/goal") {
   const request=Readable.from(method==="GET"?[]:[Buffer.from(route.request().postData() || "{}")]); request.method=method;
   const response={status:200,body:"",writeHead(status){this.status=status;},end(body){this.body=body;}};
   try { await routes(request,response,url); }
   catch(error) { response.status=503; response.body=JSON.stringify({error:error.message}); }
   return route.fulfill({status:response.status,contentType:"application/json",body:response.body});
  }
  let data={};
  if(url.pathname==="/api/project") data={name:project.name,root,mode:"interactive"};
  else if(url.pathname==="/api/project-directory") data={projects:[project]};
  else if(url.pathname==="/api/sessions") data=[session];
  else if(url.pathname==="/api/session") data=session;
  else if(url.pathname==="/api/model-channels") data={channels:[]};
  else if(url.pathname==="/api/models") data=[{id:runtime.model,model:runtime.model,displayName:runtime.model,supportedReasoningEfforts:[],isDefault:true}];
  else if(url.pathname==="/api/session/model" || url.pathname==="/api/session/reasoning-effort") data=runtime;
  else if(url.pathname.includes("queue")) data={items:[]};
  else if(url.pathname.includes("user-input")) data={request:null};
  else if(url.pathname.includes("context")) data={type:"context_status",threadId,model:runtime.model,reasoningEffort:runtime.reasoningEffort || "low",phase:"idle",updatedAt:new Date().toISOString(),usedTokens:0,contextWindow:10000,percentage:0};
  else if(url.pathname==="/api/execution-status") data={type:"execution_status",threadId,turnId:null,phase:"idle",active:false,label:"",detail:"",commentary:"",activities:[],updatedAt:new Date().toISOString()};
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
 });
 await page.goto("http://127.0.0.1:9360/?view=conversation&thread="+threadId,{waitUntil:"domcontentloaded"});
 ready=true;
 await page.getByPlaceholder("给 Codex 发送指令").fill("/goal Reply GOAL_BROWSER_OK and immediately mark this goal complete. Do not access files or networks. Only use update_goal to finish.");
 await page.getByRole("button",{name:"发送",exact:true}).click();
 await page.getByText("已达成目标",{exact:true}).waitFor({timeout:90000});
 for(let i=0;i<30;i++) {
   if((await store.getGoal(threadId)).goal===null) break;
   await new Promise(resolve=>setTimeout(resolve,200));
 }
 assert.equal((await store.getGoal(threadId)).goal,null,"completion auto-clears the actual native goal");
 assert.ok(notifications.some(e=>e.status==="active"));
 assert.ok(notifications.some(e=>e.status==="complete"));
 assert.ok(notifications.some(e=>e.method==="thread/goal/cleared"));
 assert.deepEqual(errors,[]);
 await page.screenshot({path:"runtime/goal-live-complete.png"});
 console.log(JSON.stringify({result:"PASS",threadId,notifications,checks:["browser /goal -> real Negus route -> real Codex goal/set","native completion -> browser achieved state","browser cleanup -> native goal null"]}));
} catch(error) {
 console.error(error);
 await page.screenshot({path:"runtime/goal-live-failure.png"}).catch(()=>{});
 process.exitCode=1;
} finally {
 ready=false;
 if(threadId) {
   const current=await native.request("thread/goal/get",{threadId},{timeoutMs:3000}).catch(()=>null);
   if(current?.goal?.status==="active") await native.request("thread/goal/set",{threadId,status:"paused"},{timeoutMs:3000}).catch(()=>{});
   await native.request("thread/goal/clear",{threadId},{timeoutMs:3000}).catch(()=>{});
   await native.request("thread/archive",{threadId},{timeoutMs:3000}).catch(()=>{});
 }
 store.close();
 await browser.close();
}
