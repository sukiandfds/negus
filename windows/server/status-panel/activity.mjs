import { openRollout } from '../rollout-file.mjs';
import { capabilities, panelCommand } from './capabilities.mjs';
export async function panelHistory(files) {
  const turns = new Map(); let current = '';
  for (const file of files) {
    const handle = await openRollout(file);
    try {
      const decode = new TextDecoder(), buf = Buffer.alloc(128*1024); let offset=0, carry='';
      const consume = line => {
        if (!line) return;
        const r=JSON.parse(line), p=r.payload || {}, t=p.type;
        if (r.type==='session_meta') return;
        if (r.type==='turn_context' || t==='task_started') current=p.turn_id || current;
        const id=p.turn_id || p.internal_chat_message_metadata_passthrough?.turn_id || current;
        if(!id) return;
        const turn=turns.get(id) || {id,at:r.timestamp,state:'',steps:[]}; turns.set(id,turn);
        turn.at ||= r.timestamp;
        if(r.type==='event_msg'){
          if(t==='task_complete'||t==='turn_completed') {turn.state=p.status==='failed'?'失败':'已完成';}
          if(t==='turn_aborted') turn.state='已中断';
        }
        let name='',args={};
        if(r.type==='response_item' && ['function_call','custom_tool_call'].includes(t)){
          name=p.name || ''; if(typeof p.arguments==='string'){try{args=JSON.parse(p.arguments);}catch{/* streamed arguments */}}
        }
        let kind=r.type==='compacted'?r.type:t, key=p.call_id||p.id||r.timestamp+':'+t;
        let done=true;
        if(r.type==='event_msg' && t==='item_completed' && p.item){
          const item=p.item;
          kind=item.type?.replace(/^./, c=>c.toLowerCase());
          key=item.id||key;
          if(kind==='commandExecution'){
            name='exec_command';
            args={cmd:panelCommand(item.command)};
          } else if(kind==='mcpToolCall'||kind==='dynamicToolCall')name=[item.server,item.tool].filter(Boolean).join('__');
        } else if(r.type==='response_item' && ['function_call','custom_tool_call'].includes(t)){
          // The exec wrapper can invoke several real tools. Its child item events carry their identities.
          if(name==='exec')return;
          done=false;
        }
        const tags=capabilities(kind,name,args);
        if(tags.length){
          const command=panelCommand(args?.cmd || args?.command);
          const step={id:key,at:r.timestamp,tags,done,...(tags.some(t=>t.kind==='command') && command ? {command} : {})};
          const old=turn.steps.findIndex(s=>s.id===key);
          if(old<0)turn.steps.push(step);else if(done)turn.steps[old]={...turn.steps[old],...step};
        }
      };
      while(true){const {bytesRead}=await handle.read(buf,0,buf.length,offset);if(!bytesRead)break;offset+=bytesRead;
        const lines=(carry+decode.decode(buf.subarray(0,bytesRead),{stream:true})).split('\n'); carry=lines.pop(); for(const line of lines)consume(line);}
      // An actively appended rollout may end mid-record.
      carry+=decode.decode();if(carry.trimEnd().endsWith('}'))consume(carry);
    } finally {await handle.close();}
  }
  return [...turns.values()].filter(t=>t.steps.length).reverse();
}
