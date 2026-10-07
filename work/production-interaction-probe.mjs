import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {config} from '../scripts/negus-service-common.mjs';
const cfg=await config();
const api=async(p,body)=>{const r=await fetch(`http://127.0.0.1:${cfg.port}${p}`,{method:body?'POST':'GET',headers:{Cookie:'codex_demo_token='+encodeURIComponent(cfg.token),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const o=await r.json();if(!r.ok)throw new Error(JSON.stringify({status:r.status,...o}));return o;};
const {threadId:id}=JSON.parse(await fs.readFile('work/production-demo-thread.json','utf8'));console.log('REUSING',id);
console.log('SEND',await api('/api/session/message',{threadId:id,submissionId:randomUUID(),text:'这是用户授权的实际电脑操控验收。请通过电脑工具打开 http://127.0.0.1:18763 独立测试页，先观察截图，再点击输入框，输入 NEGUS-DEMO-82461，点击验证输入按钮，再观察页面是否显示收到：NEGUS-DEMO-82461。必须真实使用电脑工具完成点击和输入，不得用脚本、HTTP POST、DOM赋值代替，不修改任何文件。不操作其他窗口内容。若屏幕锁定或失败如实报告。'}));
const start=Date.now();let last='';
while(Date.now()-start<180000){await new Promise(r=>setTimeout(r,3000));const s=await api('/api/execution-status?threadId='+id+'&reconcile=1');const sig=JSON.stringify({active:s.active,phase:s.phase,turnId:s.turnId});if(last!==sig){console.log('STATUS',sig);last=sig;}if(!s.active){const r=await api('/api/session?threadId='+id);await fs.writeFile('work/production-interaction-result.json',JSON.stringify(r,null,2));console.log('RESULT',JSON.stringify(r.messages?.filter(m=>m.role==='assistant').map(m=>m.text)));break;}}
