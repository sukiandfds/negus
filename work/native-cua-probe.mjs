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
 await c.request('turn/start',{threadId:id,input:[{type:'text',text:'只读调查Codex现有电脑操控：如果可用，请调用cua_repl的js工具，严格使用首次调用 await cua.getState(); 。报告工具返回的可用表面和是否需要授权。不要实际点击、输入、导航、修改设置或文件，也不要读取用户网页正文。如果工具不存在或失败，报告原始错误。',text_elements:[]}]},{timeoutMs:30000});
 const timer=setTimeout(()=>done(),120000);await finished;clearTimeout(timer);
 await fs.writeFile('work/native-cua-probe-result.json',JSON.stringify(records,null,2));
}finally{c.close();}
