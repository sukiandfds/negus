import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {config} from '../scripts/negus-service-common.mjs';
const cfg=await config();
const api=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${cfg.port}${p}`,{method:body?'POST':'GET',headers:{Cookie:'codex_demo_token='+encodeURIComponent(cfg.token),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const o=await r.json();if(!r.ok)throw new Error(JSON.stringify({status:r.status,...o}));return o;};
const {threadId:id}=JSON.parse(await fs.readFile('work/production-demo-thread.json','utf8'));console.log('REUSING',id);
console.log('SEND',await api('/api/session/message',{threadId:id,submissionId:randomUUID(),text:'用户已明确授权把当前Negus版本推送到GitHub。请在 /Users/hans/myproject/negus 中实际执行Git推送验收：先核对当前分支 codex/publish-current-panel、HEAD为a7679bd开头；不要创建或修改提交，不要添加work或runtime文件。使用本机Git已经配置的GitHub CLI凭据助手，通过现有代理执行 git -c http.proxy=http://127.0.0.1:7892 push origin HEAD:refs/heads/codex/publish-current-panel。禁止force push；若远端存在新提交或认证失败，报告真实原因并停止。成功后执行同一代理下的git ls-remote核对远端分支SHA与本地HEAD完全一致。不要使用Codex GitHub插件或浏览器上传代替，不读取或输出token、私钥、凭据内容。只报告分支、提交SHA及推送和远端核验结果。'}));
const start=Date.now();let last='';
while(Date.now()-start<300000){await new Promise(r=>setTimeout(r,3000));const s=await api('/api/execution-status?threadId='+id+'&reconcile=1');const sig=JSON.stringify({active:s.active,phase:s.phase,turnId:s.turnId});if(last!==sig){console.log('STATUS',sig);last=sig;}if(!s.active){const r=await api('/api/session?threadId='+id);await fs.writeFile('work/negus-github-push-result.json',JSON.stringify(r,null,2));console.log('RESULT',JSON.stringify(r.messages?.filter(m=>m.role==='assistant').map(m=>m.text)));break;}}
