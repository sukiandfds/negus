import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequestHandler } from '../server/request-handler.mjs';
import { createFastImageClient } from '../server/image-generation/fast-image-client.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('workbench pages, uploads, results and generation are protected by existing Negus login',async t=>{
 const handler=createRequestHandler({token:'test-only',projectRoot:'/tmp/lynn-routing',execution:{},media:{},realtime:{},conversations:{},groupRoom:{},fushengUsage:{},serveStatic:async(_,s)=>s.end('static')});
 const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 for(const pathname of ['/api/apps/lynn/','/api/apps/lynn/assets/main.js','/api/apps/lynn/api/jobs','/api/apps/lynn/api/uploads','/api/apps/lynn/api/assets/example.png']) {
  const response=await fetch(`http://127.0.0.1:${server.address().port}`+pathname);assert.equal(response.status,401,pathname);
 }
});
test('shared fast client requests URL output and preserves image order without downloading in edit()',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lynn-fast-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const inputs=[path.join(dir,'persona.png'),path.join(dir,'reference.png')];await fs.writeFile(inputs[0],'persona');await fs.writeFile(inputs[1],'target');
 let calls=0;
 const client=createFastImageClient({apiKey:'test-only',fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,'https://api.happyevering.xyz/v1/images/edits');assert.equal(init.body.get('response_format'),'url');assert.equal(init.body.get('size'),'4K:2.35:1');
  assert.equal(init.body.get('model'),'gpt-image-2.5-flare');assert.equal(init.body.get('quality'),null);
  const images=init.body.getAll('image');assert.equal(await images[0].text(),'persona');assert.equal(await images[1].text(),'target');
  return new Response(JSON.stringify({data:[{url:'https://example.com/result.png'}]}),{headers:{'content-type':'application/json'}});
 }});
 const result=await client.edit({prompt:'test',imagePaths:inputs,size:'4K:2.35:1'});
 assert.equal(calls,1);assert.equal(result.outputs[0].url,'https://example.com/result.png');
});
