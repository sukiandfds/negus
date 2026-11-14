// Isolated real Codex thread. Uses the selected local provider without copying credentials.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createAppServerClient } from "../server/app-server-client.mjs";
const root = await fs.mkdtemp(path.join(os.tmpdir(),"negus-goal-native-"));
const client = createAppServerClient({ codexHome: path.resolve("runtime/model-providers/ccswitch_default/codex-home"), workingDirectory: root, label: "goal-native-test", requestTimeoutMs: 30000 });
let threadId, activeTurn;
const events=[];
client.subscribe(message => {
 if(message.params?.threadId !== threadId) return;
 if(message.method === "turn/started") activeTurn=message.params.turn?.id;
 if(message.method === "thread/goal/updated") events.push(message.params.goal.status);
});
try {
 const { thread } = await client.request("thread/start", { cwd:root, approvalPolicy:"never", sandbox:"read-only", persistExtendedHistory:true });
 threadId=thread.id;
 const objective="Reply GOAL_PARITY_OK, then mark this goal complete. Do not call any tools except update_goal. Do not access files or networks.";
 const paused=await client.request("thread/goal/set",{threadId,objective,status:"paused",tokenBudget:5000});
 assert.equal(paused.goal.status,"paused");
 assert.equal((await client.request("thread/goal/get",{threadId})).goal.objective,objective);
 console.log("PASS real native create/read paused goal");
 const active=await client.request("thread/goal/set",{threadId,status:"active"});
 assert.equal(active.goal.status,"active");
 console.log("PASS real native resume starts goal; awaiting native completion");
 const started=Date.now(); let last;
 while(Date.now()-started<90000) {
  last=(await client.request("thread/goal/get",{threadId})).goal;
  if(last && last.status !== "active") break;
  await new Promise(r=>setTimeout(r,1000));
 }
 console.log(JSON.stringify({threadId,status:last?.status,events,tokensUsed:last?.tokensUsed}));
 assert.equal(last?.status,"complete","native short goal completes through the real provider");
 await client.request("thread/goal/clear",{threadId});
 assert.equal((await client.request("thread/goal/get",{threadId})).goal,null);
 console.log("PASS real completion notification and clear/read");
} finally {
 if(threadId) {
  const remaining = await client.request("thread/goal/get",{threadId},{timeoutMs:3000}).catch(()=>null);
  if (remaining?.goal?.status === "active") await client.request("thread/goal/set",{threadId,status:"paused"},{timeoutMs:3000}).catch(()=>{});
  if(activeTurn) await client.request("turn/interrupt",{threadId,turnId:activeTurn},{timeoutMs:3000}).catch(()=>{});
  await client.request("thread/goal/clear",{threadId},{timeoutMs:3000}).catch(()=>{});
  await client.request("thread/archive",{threadId},{timeoutMs:3000}).catch(()=>{});
 }
 client.close();
}
