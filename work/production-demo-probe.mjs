import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {config} from '../scripts/negus-service-common.mjs';
const cfg=await config();
const api=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${cfg.port}${p}`,{method:body?'POST':'GET',headers:{Cookie:'codex_demo_token='+encodeURIComponent(cfg.token),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const o=await r.json();if(!r.ok)throw new Error(JSON.stringify({status:r.status,...o}));return o;};
const session=await api('/api/session',{projectRoot:process.cwd(),modelProviderId:'ccswitch_折扣-1790603771586',model:'gpt-6-sol'});
const id=session.threadId;await fs.writeFile('work/production-demo-thread.json',JSON.stringify({threadId:id},null,2));
await api('/api/session/name',{threadId:id,name:'演示前验收：联网与电脑工具'});console.log('CREATED',id);
console.log('SEND',await api('/api/session/message',{threadId:id,submissionId:randomUUID(),text:'这是用户授权的Negus正式服务验收。请实际使用negus_computer工具检查permissions，读取https://api.github.com/repos/sukiandfds/negus，并截取当前屏幕确认截图可用。只做这些检查，不点击、输入、不切换窗口、不修改文件配置。报告实际结果，截图可能包含私人内容，不要把截图全文或私人内容复述出来。'}));
const start=Date.now();let last='';
while(Date.now()-start<180000){await new Promise(r=>setTimeout(r,3000));const s=await api('/api/execution-status?threadId='+id+'&reconcile=1');const sig=JSON.stringify({active:s.active,phase:s.phase,turnId:s.turnId});if(last!==sig){console.log('STATUS',sig);last=sig;}if(!s.active){const r=await api('/api/session?threadId='+id);await fs.writeFile('work/production-demo-result.json',JSON.stringify(r,null,2));console.log('RESULT',JSON.stringify(r.messages?.filter(m=>m.role==='assistant').map(m=>m.text)));break;}}
