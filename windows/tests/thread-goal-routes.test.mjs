import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createConversationRoutes } from "../server/routes/conversation-routes.mjs";
const call = async (route, pathname, body, method = "POST") => {
 const request = Readable.from([Buffer.from(JSON.stringify(body))]); request.method = method;
 const response = { status: 0, body: "", writeHead(status) { this.status=status; }, end(body) { this.body=body; } };
 await route(request, response, new URL("http://localhost"+pathname)); return response;
};
test("native goal creation resolves attachments without sending a model message", async () => {
 const calls = [];
 const route = createConversationRoutes({
  conversations: { setGoal: async (...args) => { calls.push(args); return { goal: { status: "active" } }; } },
  media: { resolveMany: ids => ids?.length ? [{ id:"f", name:"notes.txt", path:"D:/uploads/notes.txt" }] : [] },
 });
 const result = await call(route,"/api/session/goal",{ threadId:"t", objective:"Read notes", status:"active", attachmentIds:["f"] });
 assert.equal(result.status,200);
 assert.deepEqual(calls,[["t",{objective:"Read notes\n\nReferenced pasted text files:\n- pasted text file: D:/uploads/notes.txt. Read this file before continuing.",status:"active",tokenBudget:undefined}]]);
});
test("stop pauses the native goal before interrupting its turn", async () => {
 const calls=[];
 const route=createConversationRoutes({conversations:{
  getGoal:async()=>({goal:{status:"active"}}),
  setGoal:async(id,patch)=>calls.push(["pause",id,patch]),
  interrupt:async(...args)=>calls.push(["interrupt",...args]),
 },execution:{getStatus:()=>({active:true,turnId:"turn"})}});
 const result=await call(route,"/api/session/interrupt",{threadId:"t"});
 assert.equal(result.status,202);
 assert.deepEqual(calls,[["pause","t",{status:"paused"}],["interrupt","t","turn"]]);
});
test("a failed goal pause still interrupts the current turn and reports the failure", async () => {
 let interrupted=false;
 const route=createConversationRoutes({conversations:{
  getGoal:async()=>({goal:{status:"active"}}),setGoal:async()=>{throw Error("pause failed");},
  interrupt:async()=>{interrupted=true;},
 },execution:{getStatus:()=>({active:true,turnId:"turn"})}});
 await assert.rejects(call(route,"/api/session/interrupt",{threadId:"t"}),/pause failed/);
 assert.equal(interrupted,true);
});

test("stop also pauses an active goal between turns", async () => {
 let paused=false;
 const route=createConversationRoutes({conversations:{
  getGoal:async()=>({goal:{status:"active"}}),
  setGoal:async()=>{paused=true;},
 },execution:{getStatus:()=>({active:false,turnId:null})}});
 assert.equal((await call(route,"/api/session/interrupt",{threadId:"t"})).status,202);
 assert.equal(paused,true);
});
test("employee goal controls use the employee runtime, never the ordinary provider", async () => {
 const binding={conversationId:"employee:1",runtimeSessionId:"employee-thread",conversationKind:"direct",agentId:"developer"};
 const calls=[];
 const route=createConversationRoutes({
  conversations:{setGoal:async()=>{throw Error("wrong runtime");}},
  agentConversationStore:{findByRuntimeSession:()=>binding,resolve:async()=>binding},
  employeeRuntime:{supportsEmployee:()=>true,ownsConversation:()=>true,setGoal:async(...args)=>{calls.push(args);return {goal:{status:"active"}};}},
  media:{resolveMany:()=>[]},
 });
 const result=await call(route,"/api/session/goal",{threadId:"employee-thread",conversationId:"employee:1",objective:"Employee goal",status:"active"});
 assert.equal(result.status,200);
 assert.equal(calls[0][0],"employee-thread");
});
