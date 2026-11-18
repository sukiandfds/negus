import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServerClient } from '../../windows/server/app-server-client.mjs';
import { createTaskTools } from '../../ui-feishu/kernel/task-tools.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'negus-group-auth-probe-'));
const tools = await createTaskTools({invoke: async source => ({source}), background:true});
const client = createAppServerClient({codexHome:root,workingDirectory:root});
try {
 const old = tools.config('first');
 const next = tools.config('second');
 const {thread} = await client.request('thread/start',{cwd:root,config:old});
 const initial = await client.request('mcpServerStatus/list',{threadId:thread.id});
 await client.request('thread/inject_items', {threadId:thread.id,items:[{type:'message',role:'assistant',content:[{type:'output_text',text:'offline history fixture'}]}]});
 tools.release('first');
 await client.request('thread/resume',{threadId:thread.id,config:{'mcp_servers.negus_handoffs':{...next['mcp_servers.negus_handoffs'],enabled:false}}});
 const resumed = await client.request('mcpServerStatus/list',{threadId:thread.id});
 assert.ok(resumed.data.some(x=>x.name==='negus_handoffs' && x.tools?.list_tasks));
 console.log(JSON.stringify({initial:initial.data.map(x=>({name:x.name,tools:Object.keys(x.tools||{})})),loadedResume:resumed.data.map(x=>({name:x.name,tools:Object.keys(x.tools||{})}))}));
 const call = async config => {const e=config['mcp_servers.negus_handoffs'].env;const r=await fetch(e.NEGUS_HANDOFF_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${e.NEGUS_HANDOFF_TOKEN}`},body:'{"action":"list"}'});return {status:r.status,result:await r.json()};};
 console.log(JSON.stringify({releasedCredential:await call(old),newCredential:await call(next)}));
 await client.request('thread/unsubscribe',{threadId:thread.id});
 try {await client.request('thread/read',{threadId:thread.id,includeTurns:true});console.log('unloaded history readable');} catch(e){console.log('unloaded history: '+e.message);}
 await client.request('thread/resume',{threadId:thread.id,config:{'mcp_servers.negus_handoffs':{...next['mcp_servers.negus_handoffs'],enabled:false}}});
 const unloaded=await client.request('mcpServerStatus/list',{threadId:thread.id});
 assert.ok(!unloaded.data.some(x=>x.name==='negus_handoffs' && x.tools?.list_tasks));
 console.log(JSON.stringify({unloadedResume:unloaded.data.map(x=>({name:x.name,tools:Object.keys(x.tools||{})}))}));
} finally {client.close(); await tools.close(); await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
