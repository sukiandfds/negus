import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { helperPath, installRoot } from './runtime.mjs';
const execute = promisify(execFile);
const text = value => ({content:[{type:'text',text:JSON.stringify(value)}]});
let nativeQueue = Promise.resolve();
export const isScreenLocked = output => /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(output);
export const nativeCommand = async args => {
  if (process.platform !== 'darwin') throw new Error('Negus computer control is currently available on macOS only.');
  const action = nativeQueue.then(async () => {
    const {stdout: sessionState} = await execute('/usr/sbin/ioreg',['-n','Root','-d1'],{timeout:5000,maxBuffer:1024*1024});
    if(isScreenLocked(sessionState) && !['permissions','authorize'].includes(args[0])) {
      throw new Error('Mac is locked. Ask the user to unlock the computer before taking screenshots or controlling the desktop. Do not retry until unlocked.');
    }
    try {await fs.access(helperPath);}catch {throw new Error('Negus Computer is not installed. Run scripts/negus-computer-setup.mjs.');}
    const dir=path.join(installRoot,'runtime/computer-control');await fs.mkdir(dir,{recursive:true,mode:0o700});
    const resultFile=path.join(dir,randomUUID()+'.json');
    const errorFile=resultFile+'.err';
    try {
      // LaunchServices gives the helper its own stable macOS consent identity.
      // Executing its binary as a Node child incorrectly inherits host consent.
      await execute('/usr/bin/open',['-g','-n','--stdout',resultFile,'--stderr',errorFile,path.resolve(helperPath,'../../..'),'--args',...args],{timeout:10000});
      const deadline=Date.now()+30000;
      while(Date.now()<deadline){
        const output=await fs.readFile(resultFile,'utf8').catch(()=>'');
        if(output.trim()) {let result;try{result=JSON.parse(output);}catch{await new Promise(r=>setTimeout(r,50));continue;}if(result.error)throw new Error(result.error);return result;}
        await new Promise(r=>setTimeout(r,100));
      }
      throw new Error('Negus Computer did not return a result within 30 seconds; inspect the desktop before repeating the action.');
    } finally {await fs.rm(resultFile,{force:true});await fs.rm(errorFile,{force:true});}
  });
  nativeQueue=action.catch(()=>{});
  return action;
};
export const createComputerMcpServer = ({run=nativeCommand}={}) => {
 const server=new McpServer({name:'negus-computer',version:'0.1.0'},{capabilities:{tools:{}}});
 const register=(name,description,schema,fn,readOnly=false)=>server.registerTool(name,{description,inputSchema:z.object(schema),annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,openWorldHint:true}},async args=>{try{return await fn(args);}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}});
 register('permissions','Check macOS accessibility and screen recording permissions without prompting.',{},async()=>text(await run(['permissions'])),true);
 register('screenshot','Capture the main display. Use returned coordinate dimensions for mouse actions.',{},async()=>{
   const directory=path.join(installRoot,'runtime/computer-control');await fs.mkdir(directory,{recursive:true,mode:0o700});
   const file=path.join(directory,randomUUID()+'.png');
   try {const result=await run(['screenshot',file]);const data=await fs.readFile(file);return {content:[{type:'text',text:JSON.stringify(result)},{type:'image',mimeType:'image/png',data:data.toString('base64')}]};}
   finally{await fs.rm(file,{force:true});}
 },true);
 register('open_url','Open an HTTP(S) URL in the host default browser.',{url:z.string().url()},async({url})=>{if(!['http:','https:'].includes(new URL(url).protocol))throw new Error('HTTP(S) only');return text(await run(['open-url',url]));});
 register('click','Left click a position observed in the latest screenshot. Coordinates are main-display points.',{x:z.number().min(0),y:z.number().min(0)},async({x,y})=>text(await run(['click',String(x),String(y)])));
 register('type_text','Type user-authorized text into the focused field. Do not enter passwords or verification codes.',{text:z.string().min(1).max(12000)},async({text:value})=>text(await run(['type',value])));
 register('press_key','Press a macOS virtual key. Common codes: Return 36, Tab 48, Escape 53, A 0, L 37, W 13, arrows left 123/right 124/down 125/up 126.',{key_code:z.number().int().min(0).max(127),modifiers:z.array(z.enum(['command','shift','option','control'])).default([])},async({key_code,modifiers})=>text(await run(['key',String(key_code),...modifiers])));
 register('scroll','Scroll the focused area by lines (positive up, negative down).',{lines:z.number().int().min(-100).max(100)},async({lines})=>text(await run(['scroll',String(lines)])));
 register('read_url','Fetch a public HTTP(S) page from the Negus host. Does not use browser login. HTTP errors are not proof of no network.',{url:z.string().url()},async({url})=>{
   const target=new URL(url);if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw new Error('Public HTTP(S) URL without embedded credentials required');
   const response=await fetch(target,{signal:AbortSignal.timeout(20000)});
   let size=0;const chunks=[];
   try {for await(const chunk of response.body||[]){const bytes=chunk.subarray(0,Math.max(0,200000-size));chunks.push(bytes);size+=bytes.length;if(size>=200000)break;}}
   finally {await response.body?.cancel().catch(()=>{});}
   return text({url:response.url,status:response.status,contentType:response.headers.get('content-type'),body:Buffer.concat(chunks).toString('utf8'),truncated:size>=200000});
 },true);
 return server;
};
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)serveStdio(()=>createComputerMcpServer(),{legacy:'serve'});
