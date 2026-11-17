import fs from 'node:fs/promises';
import {createAppServerClient} from '../windows/server/app-server-client.mjs';
import {computerInstructions} from '../windows/server/computer-control/runtime.mjs';
const c=createAppServerClient({label:'negus-live-probe'});
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
 await c.request('turn/start',{threadId:id,input:[{type:'text',text:'这是用户授权的电脑操控验证。请调用cua_repl工具首次调用 let app = await cua.getApp("com.google.Chrome"); 读取返回的应用状态和授权结果；不要点击、输入或导航，不要修改文件，不要读取私人网页正文。只报告原生应用控制是否能建立、是否需要授权和原始错误。',text_elements:[]}]},{timeoutMs:30000});
 const timer=setTimeout(()=>done(),120000);await finished;clearTimeout(timer);
 await fs.writeFile('work/native-cua-app-result.json',JSON.stringify(records,null,2));
}finally{c.close();}
