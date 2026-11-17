import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {computerMcpArguments,nativeComputerMcpArguments} from '../server/computer-control/runtime.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';

test('native computer runtime survives provider isolation without inheriting provider credentials',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'negus-native-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const configFile=path.join(dir,'config.toml');
 const settings={command:process.execPath,args:[],env:{SKY_CUA_SERVICE_PATH:dir}};
 await fs.writeFile(configFile,TOML.stringify({model_provider:'private',model_providers:{private:{experimental_bearer_token:'must-not-copy'}},mcp_servers:{node_repl:settings}}));
 const args=nativeComputerMcpArguments({configFile});
 assert.deepEqual(TOML.parse(args[1]).mcp_servers.node_repl,settings);
 assert.ok(!args.join('').includes('must-not-copy'));
 await fs.writeFile(configFile,TOML.stringify({mcp_servers:{node_repl:{...settings,enabled:false}}}));
 assert.deepEqual(nativeComputerMcpArguments({configFile}),[]);
 assert.deepEqual(nativeComputerMcpArguments({configFile:path.join(dir,'missing')}),[]);
});

test('computer MCP exposes shared tools, refuses file URLs, and reads actual HTTP status/body',async t=>{
 const child=spawn(process.execPath,['windows/server/computer-control/mcp-server.mjs'],{stdio:['pipe','pipe','pipe']});
 const pending=new Map();let id=0,buffer='',errors='';
 child.stderr.on('data',d=>errors+=d);
 child.stdout.on('data',d=>{buffer+=d;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const o=JSON.parse(line);if(o.id!==undefined){pending.get(o.id)?.(o);pending.delete(o.id);}}catch{}}});
 t.after(()=>child.kill());
 const request=(method,params)=>new Promise((resolve,reject)=>{const next=++id;const timer=setTimeout(()=>reject(new Error('MCP timeout '+errors)),5000);pending.set(next,o=>{clearTimeout(timer);resolve(o);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});
 const init=await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'negus-test',version:'1'}});assert.ok(init.result);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const list=await request('tools/list',{});assert.deepEqual(list.result.tools.map(x=>x.name).sort(),['click','open_url','permissions','press_key','read_url','screenshot','scroll','type_text'].sort());
 for(const tool of ['read_url','open_url']){const r=await request('tools/call',{name:tool,arguments:{url:'file:///etc/passwd'}});assert.equal(r.result.isError,true);}
 const server=http.createServer((req,res)=>{res.writeHead(403,{'Content-Type':'text/plain'});res.end('test access denied');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const r=await request('tools/call',{name:'read_url',arguments:{url:`http://127.0.0.1:${server.address().port}`}});
 const result=JSON.parse(r.result.content[0].text);assert.equal(result.status,403);assert.equal(result.body,'test access denied');
});

test('MCP launch configuration is absolute and does not depend on provider home',()=>{
 const args=computerMcpArguments();const command=args.find(x=>x.startsWith('mcp_servers.negus_computer.command='));assert.ok(command.includes(process.execPath));
 assert.ok(args.some(x=>x.startsWith('mcp_servers.negus_computer.args=["/')));
 assert.equal(args.some(x=>/CODEX_HOME|auth\.json|api_key/.test(x)),false);
});

test('MCP explicitly passes installation root through Codex filtered child environment',async()=>{
 const {installRoot}=await import('../server/computer-control/runtime.mjs');
 const TOML=(await import('@iarna/toml')).default;
 const values=computerMcpArguments().filter((_,i)=>i%2===1).join('\n');
 const parsed=TOML.parse(values);
 assert.equal(parsed.mcp_servers.negus_computer.env.NEGUS_INSTALL_ROOT,installRoot);
});

test('locked desktop is distinguished from missing system permissions',async()=>{
 const {isScreenLocked}=await import('../server/computer-control/mcp-server.mjs');
 assert.equal(isScreenLocked('"CGSSessionScreenIsLocked"=Yes'),true);
 assert.equal(isScreenLocked('"CGSSessionScreenIsLocked"=No'),false);
 assert.equal(isScreenLocked('"kCGSSessionOnConsoleKey"=Yes'),false);
});
