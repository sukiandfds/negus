import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createConversationSummaryService, createSummaryGenerator } from "../server/conversation-summary-service.mjs";
import { createConversationForwardService } from "../server/conversation-forward-service.mjs";
import { createFollowUpQueueService } from "../server/follow-up-queue-service.mjs";

const temporary = async t => { const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-forward-")); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; };
const message = (id, role, text, createdAt = "2026-09-30T00:00:00Z") => ({ id, role, text, createdAt });
test("summary excludes hidden activity, preserves full quotations, and caches concurrent/restarted requests", async t => {
  const root = await temporary(t); let calls = 0;
  const options = { cacheRoot: root, generate: async text => { calls++; assert.ok(!text.includes("secret thought")); return "目标与决定 [u1]"; } };
  const service = createConversationSummaryService(options);
  const messages = [message("u1","user","old request","2026-09-20T00:00:00Z"),
    message("a1","assistant","old answer","2026-09-20T01:00:00Z"),
    { ...message("hidden","assistant","secret thought"), phase:"analysis" },
    message("u2","user","latest verbatim"),message("a2","assistant","latest answer"),
    message("tool","tool","secret thought")];
  const [a,b] = await Promise.all([service.summarize({messages}),service.summarize({messages})]);
  assert.equal(calls,1); assert.equal(a.sourceHash,b.sourceHash);
  assert.match(a.transcript,/old request/); assert.doesNotMatch(a.recent,/old request/);
  assert.match(a.recent,/latest verbatim/); assert.doesNotMatch(a.transcript,/secret thought/);
  await createConversationSummaryService(options).summarize({messages});
  assert.equal(calls,1);
  const bounded=await service.summarize({messages,recentChars:10});
  assert.equal(bounded.recentMessageCount,0);
  assert.match(bounded.transcript,/latest verbatim/);
});
test("failed summary is never cached as a valid handoff",async t=>{
  const root=await temporary(t);let calls=0;
  const service=createConversationSummaryService({cacheRoot:root,generate:async()=>{calls++;if(calls===1)throw Error("offline");return "verified";}});
  const input={messages:[message("u","user","request")]};
  await assert.rejects(service.summarize(input),/offline/);
  assert.equal((await service.summarize(input)).summary,"verified");assert.equal(calls,2);
});
test("API generator rejects truncated output and does not expose credentials/errors",async()=>{
  const generate=createSummaryGenerator({configuration:async()=>({model:"test",baseUrl:"https://example.test/v1",key:"secret"}),
    fetchResponse:async()=>({ok:true,json:async()=>({status:"incomplete",output:[{type:"message",content:[{type:"output_text",text:"partial"}]}]})})});
  await assert.rejects(generate("example"),/未转发/);
});
const fixture = async t => {
  const root=await temporary(t); let sends=0;
  const projects=[{name:"Research",conversations:[{threadId:"source",title:"Research"}]},
    {name:"Development",conversations:[{threadId:"target",title:"Build"},{threadId:"archived",title:"Archived",archived:true}]},
    {name:"Engineer",employeeId:"engineer",mainThreadId:"employee",conversations:[{threadId:"employee",title:"Main",conversationId:"direct"},{threadId:"group-thread",title:"Group"}]}];
  const pages={source:{threadId:"source",messages:[message("u2","user","new"),message("a2","assistant","new answer")],hasMore:true,nextCursor:"older"},
    older:{threadId:"source",messages:[message("u1","user","old","2026-09-01"),message("a1","assistant","old answer","2026-09-01")],hasMore:false}};
  const queue={enqueue:async item=>{sends++;return {id:"queued",...item};}};
  const options={directory:{list:async()=>({projects})},
    conversations:{listSessions:async()=>[],findSession:async(id,source,p)=>pages[p.cursor||id]},
    employeeRuntime:{readSession:async()=>({threadId:"employee",messages:[message("eu","user","employee request")],hasMore:false})},
    summaryService:createConversationSummaryService({cacheRoot:path.join(root,"cache"),generate:async()=> "Summary [u1]"}),
    media:{register:file=>({id:path.basename(file),name:path.basename(file),url:"/api/media/test"})},
    uploadRoot:path.join(root,"uploads"),stateRoot:path.join(root,"receipts"),queue};
  return {root,options,service:createConversationForwardService(options),pages,projects,sends:()=>sends};
};
test("forward reads all pages and sends only a document link; duplicate submission survives restart",async t=>{
  const f=await fixture(t);let delivered;
  f.options.queue.enqueue=async item=>{delivered=item;return{id:"queued"};};
  const service=createConversationForwardService(f.options);
  const input={sourceThreadId:"source",targetThreadId:"target",requestId:"request-123"};
  const a=await service.forward(input);
  assert.equal(a.state,"queued"); assert.ok(delivered.text.length<1000); assert.doesNotMatch(delivered.text,/old answer/); assert.match(delivered.text,/等待用户下一步指令/); assert.doesNotMatch(delivered.text,/结合本对话目标处理/);
  const files=await fs.readdir(f.options.uploadRoot);
  const transcript=await fs.readFile(path.join(f.options.uploadRoot,files.find(f=>f.includes("原对话"))),"utf8");
  assert.ok(transcript.indexOf("old answer")<transcript.indexOf("new answer"));
  f.options.queue.enqueue=async()=>assert.fail("duplicate delivery");
  assert.deepEqual(await createConversationForwardService(f.options).forward(input),a);
  await assert.rejects(service.forward({...input,targetThreadId:"employee"}),/请求编号/);
});
test("cross-Agent supports direct conversations and never routes a group thread as a direct chat",async t=>{
  const f=await fixture(t);
  const targets=await f.service.listTargets();
  assert.ok(targets.some(t=>t.threadId==="employee"));assert.ok(!targets.some(t=>t.threadId==="group-thread"));
  await f.service.forward({sourceThreadId:"employee",targetThreadId:"target",requestId:"employee-123"});
  assert.equal(f.sends(),1);
  await assert.rejects(f.service.forward({sourceThreadId:"source",targetThreadId:"archived",requestId:"archived-123"}),/目标/);
  await assert.rejects(f.service.forward({sourceThreadId:"source",targetThreadId:"group-thread",requestId:"group-123"}),/目标/);
});
test("missing pagination blocks delivery, while summary unavailability does not block raw forwarding",async t=>{
  const f=await fixture(t); delete f.pages.source.nextCursor;
  await assert.rejects(f.service.forward({sourceThreadId:"source",targetThreadId:"target",requestId:"broken-123"}),/分页/);
  assert.equal(f.sends(),0);
  f.pages.source.nextCursor="older";
  f.options.summaryService={hasPendingWork:()=>false,summarize:async()=>{throw Error("summary unavailable");}};
  await createConversationForwardService(f.options).forward({sourceThreadId:"source",targetThreadId:"target",requestId:"broken-456"});
  assert.equal(f.sends(),1);
});
test("busy delivery waits and its dispatch claim is on disk before model execution",async t=>{
  const root=await temporary(t),stateFile=path.join(root,"queue.json");
  let active=true,sent=false;
  const queue=createFollowUpQueueService({stateFile,execution:{getStatus:()=>({active,phase:active?"working":"completed"})},
    media:{resolveMany:()=>[]},publishThreadEvent(){},
    conversations:{sendMessage:async()=>{const state=JSON.parse(await fs.readFile(stateFile,"utf8"));assert.equal(state.queues[0].items[0].state,"dispatching");sent=true;}}});
  t.after(()=>queue.close());
  await queue.enqueue({threadId:"t",text:"Read document",submissionId:"forward-123"});
  assert.equal(sent,false);
  active=false;queue.handleTurnTerminal({threadId:"t",status:"completed"});
  for(let i=0;i<100&&!sent;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(sent,true);
});

test("a later source edit creates a new document without changing the forwarded snapshot",async t=>{
 const f=await fixture(t);
 const first=await f.service.prepare("source"), before=await fs.readFile(first.file,"utf8");
 f.pages.source.messages[0].text="corrected decision";
 const second=await f.service.prepare("source");
 assert.notEqual(first.file,second.file);assert.equal(await fs.readFile(first.file,"utf8"),before);
});
test("a full queue rejects a new forward instead of silently dropping older requests",async t=>{
 const q=createFollowUpQueueService({execution:{getStatus:()=>({active:true})},media:{resolveMany:()=>[]},publishThreadEvent(){},conversations:{}});
 t.after(()=>q.close());
 for(let i=0;i<50;i++)await q.enqueue({threadId:"t",text:"request "+i,submissionId:"request"+i});
 await assert.rejects(q.enqueue({threadId:"t",text:"overflow",submissionId:"overflow"}),/已满/);
 assert.equal(q.list("t").length,50);assert.equal(q.list("t")[0].text,"request 0");
});
