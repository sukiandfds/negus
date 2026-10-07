import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
process.env.NEGUS_INSTALL_ROOT=process.cwd();
const prepared=JSON.parse(await fs.readFile('runtime/negus-release-prepared.json','utf8'));
const {createAppServerClient}=await import(pathToFileURL(prepared.candidate.directory+'/windows/server/app-server-client.mjs'));
console.log('CANDIDATE',prepared.candidate.id);
import {computerInstructions} from '../windows/server/computer-control/runtime.mjs';
const c=createAppServerClient({label:'snapshot-installation-root-probe',codexHome:process.cwd()+'/runtime/model-providers/ccswitch_折扣-1790603771586/codex-home',sanitizeEnvironment:true});
let id;let done;const finished=new Promise(r=>done=r);const records=[];
c.subscribe(m=>{
 if(m.params?.threadId!==id)return;
 if(m.method==='item/completed'){
  const i=m.params.item;const record={type:i.type,server:i.server,tool:i.tool,status:i.status,text:i.type==='agentMessage'?i.text:undefined,result:i.type==='mcpToolCall'?i.result?.content?.filter(x=>x.type==='text'):undefined};records.push(record);console.log(JSON.stringify(record));
 }
 if(m.method==='turn/completed'){console.log('TURN',m.params.turn.status,JSON.stringify(m.params.turn.error));done();}
});
try{
 const s=await c.request('thread/start',{cwd:process.cwd(),ephemeral:true,sandbox:'danger-full-access',approvalPolicy:'never',developerInstructions:computerInstructions()},{timeoutMs:30000});id=s.thread.id;console.log('THREAD',id,'MODEL',s.model);
 await c.request('turn/start',{threadId:id,input:[{type:'text',text:'这是用户授权的Negus电脑工具验收，只读验证。请发现并实际调用negus_computer的permissions和read_url：读取 https://api.github.com/repos/sukiandfds/negus ，并用screenshot截图以验证权限，报告检查结果，不要复述截图中的私人内容。不要修改代码或配置，不要执行其他任务。',text_elements:[]}]},{timeoutMs:30000});
 const timer=setTimeout(()=>done(),120000);await finished;clearTimeout(timer);
 await fs.writeFile('work/snapshot-computer-probe-result.json',JSON.stringify(records,null,2));
}finally{c.close();}
