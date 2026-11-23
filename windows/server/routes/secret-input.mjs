import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import {pending,slot} from '../connections/secret-requests.mjs';
import { readJson, sendJson } from '../http/request-utils.mjs';
const endpoint='/api/connections/secret-input';
export const secureInputRoute=async(req,res,url)=>{
  if(url.pathname!==endpoint)return false;
  res.setHeader('Cache-Control','no-store');
  const thread=url.searchParams.get('thread') || '';

  if(req.method==='GET'){sendJson(res,{request:await pending(thread)});return true}
  if(req.method!=='POST'||req.headers.origin!=='https://'+req.headers.host||req.headers['content-type']!=='application/json'){sendJson(res,{error:'请从已登录的 HTTPS 安全输入页面操作'},403);return true}
  const body=await readJson(req,16384);
  const request=await pending(thread);
  if(!request||request.id!==body.id){sendJson(res,{error:'输入请求已过期，请重新调用'},409);return true}
  if(body.dismiss===true){await fs.unlink(slot(thread));sendJson(res,{dismissed:true});return true}
  let value=body.value;
  if(typeof value!=='string'||!value.trim()){sendJson(res,{error:'请输入凭据'},400);return true}
  if(request.kind==='google'){
  let w;try{w=JSON.parse(value)?.web}catch{}
  if(w?.project_id!=='negus-515610'||typeof w.client_id!=='string'||!w.client_id.endsWith('.apps.googleusercontent.com')||typeof w.client_secret!=='string'||!w.client_secret.trim()||!Array.isArray(w.redirect_uris)||!w.redirect_uris.includes('https://auth.negus.us.ci/api/auth/callback/google')){sendJson(res,{error:'请检查 Negus 项目、网页客户端和回调地址'},400);return true}
  value=JSON.stringify({clientId:w.client_id,clientSecret:w.client_secret});
  }
  const code=await new Promise(resolve=>{const p=spawn('/usr/bin/swift',[fileURLToPath(new URL('../connections/save-google.swift',import.meta.url)),request.kind],{stdio:['pipe','ignore','ignore'],timeout:30000});p.once('error',()=>resolve(1));p.once('close',resolve);p.stdin.on('error',()=>{});p.stdin.end(value);});
  if(code===0)await fs.unlink(slot(thread)).catch(()=>{});
  sendJson(res,code===0?{saved:true}:{error:code===2?'此客户端已录入，已有凭据未被覆盖':'钥匙串保存失败，请检查主机钥匙串是否解锁'},code===0?200:code===2?409:503);return true;
};
