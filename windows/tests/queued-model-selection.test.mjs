import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFollowUpQueueService } from "../server/follow-up-queue-service.mjs";
const sleep = ms => new Promise(r => setTimeout(r, ms));
test("queued model selection persists and applies only when the next turn starts", async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-queue-model-"));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const stateFile = path.join(root, "queue.json"), calls = [];
 let status = { active: true, turnId: "old", phase: "running" };
 const options = { stateFile, execution: { getStatus: () => status }, media: { resolveMany: () => [] }, publishThreadEvent() {},
 conversations: {
   updateModel: async (id, model, settings) => { calls.push(["model", model, settings.reasoningEffort]); return { threadId: id }; },
   updateReasoningEffort: async (_, effort) => calls.push(["effort", effort]),
   sendMessage: async (_, text) => calls.push(["send", text]),
   steerMessage: async () => calls.push(["steer"]),
 }};
 let queue = createFollowUpQueueService(options);
 await queue.enqueue({ threadId: "t", text: "next", modelSettings: { model: "gpt-6.1-sol", reasoningEffort: "high" } });
 assert.deepEqual(calls, []);
 await queue.close();
 queue = createFollowUpQueueService(options);
 t.after(() => queue.close());
 assert.equal(queue.list("t")[0].modelSettings.model, "gpt-6.1-sol");
 status = { active: false, phase: "completed" };
 queue.handleTurnTerminal({ threadId: "t", status: "completed" });
 for(let i=0;i<50&&!calls.some(x=>x[0]==="send");i++)await sleep(10);
 assert.deepEqual(calls,[["model","gpt-6.1-sol","high"],["effort","high"],["send","next"]]);
 status = { active: true, turnId: "current", phase: "running" };
 const item = await queue.enqueue({ threadId: "t", text: "steer", modelSettings: { model: "different", reasoningEffort: "low" } });
 await queue.sendNow("t", item.id);
 assert.deepEqual(calls.at(-1), ["steer"]);
 assert.equal(calls.filter(x=>x[0]==="model").length, 1);
});
test("failed queued model application fails the item without sending a message", async t => {
 const queue = createFollowUpQueueService({ execution: { getStatus: () => ({ active: true, turnId:"old" }) },
 media:{resolveMany:()=>[]},publishThreadEvent(){},conversations:{updateModel:async()=>{throw Error("model unavailable")},sendMessage:async()=>assert.fail("must not send") }});
 t.after(()=>queue.close());
 const item=await queue.enqueue({threadId:"t",text:"next",modelSettings:{model:"missing",reasoningEffort:""}});
 // A fresh service with idle status is tested via explicit dispatch.
 const idle = createFollowUpQueueService({execution:{getStatus:()=>({active:false,phase:"idle"})},media:{resolveMany:()=>[]},publishThreadEvent(){},
 conversations:{updateModel:async()=>{throw Error("model unavailable")},sendMessage:async()=>assert.fail("must not send")}});
 t.after(()=>idle.close());
 await idle.enqueue({threadId:"t",text:item.text,modelSettings:item.modelSettings});
 for(let i=0;i<50&&idle.list("t")[0]?.state!=="failed";i++)await sleep(10);
 assert.equal(idle.list("t")[0].state,"failed");
});

test('queue ingress and actual ordinary provider store agree on max and ultra', async t => {
 const { createFollowUpQueueRoutes } = await import('../server/routes/follow-up-queue-routes.mjs');
 const { createProviderConversationStore } = await import('../server/provider-conversation-store.mjs');
 const { Readable } = await import('node:stream');
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-effort-'));
 t.after(() => fs.rm(root, {recursive:true,force:true}));
 const sent = [], efforts = [];
 const conversations = createProviderConversationStore({
  stateFile:path.join(root,'routes.json'),
  current:{getSessionResumeInfo:async()=>({}),getRuntimeContext:async()=>({model:'test'}),updateModel:async()=>({threadId:'t'}),updateReasoningEffort:async(id,effort)=>efforts.push(effort),sendMessage:async(id,text)=>sent.push(text),close(){}},
  providers:{resolveRoute:({model})=>({modelProviderId:'current',model}),listModels:async()=>[]},createStore:()=>{throw Error('unexpected provider')}
 });
 t.after(()=>conversations.close());
 const queue=createFollowUpQueueService({stateFile:path.join(root,'queue.json'),execution:{getStatus:()=>({active:false,phase:'idle'})},conversations,media:{resolveMany:()=>[]},publishThreadEvent(){}});
 t.after(()=>queue.close());
 const route=createFollowUpQueueRoutes({queue,media:{resolveMany:()=>[]}});
 for(const effort of ['max','ultra','invalid']){
  const req=Readable.from([Buffer.from(JSON.stringify({threadId:'t',text:effort,modelSettings:{model:'test',reasoningEffort:effort}}))]);req.method='POST';
  let code;await route(req,{writeHead(status){code=status},end(){}},new URL('http://localhost/api/session/queue'));
  assert.equal(code,effort==='invalid'?400:202);
  if(effort==='invalid')continue;
  for(let i=0;i<50&&!sent.includes(effort);i++)await sleep(10);
  assert.ok(sent.includes(effort));assert.ok(efforts.includes(effort));
 }
 await assert.rejects(conversations.updateModel('t','test',{reasoningEffort:'invalid'}),/无效/);
});
