import fs from 'node:fs/promises';
import {createAppServerClient} from '../windows/server/app-server-client.mjs';
import {computerInstructions} from '../windows/server/computer-control/runtime.mjs';
const c=createAppServerClient({label:'native-channel-probe',codexHome:process.cwd()+'/runtime/model-providers/ccswitch_折扣-1790603771586/codex-home',sanitizeEnvironment:true});
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
 await c.request('turn/start',{threadId:id,input:[{type:'text',text:'这是用户授权的Negus原生电脑操控验收。请发现 node_repl 的 js 工具，通过 await import("@oai/sky") 获取 sky；只操作 Chrome 当前的 http://127.0.0.1:18763 独立测试页面。先 get_app_state，按实际 element_index 将验收文字输入框清空，再输入 NEGUS-NATIVE-65932，点击验证输入，get_app_state 检查收到：NEGUS-NATIVE-65932。使用原生电脑工具，不用negus_computer，不用HTTP POST或DOM脚本，不修改文件或其他网页。报告实际结果。',text_elements:[]}]},{timeoutMs:30000});
 await finished;
 await fs.writeFile('work/native-channel-interaction-result.json',JSON.stringify(records,null,2));
}finally{c.close();}
