import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readJsonFile,writeJsonFileAtomic} from '../persistence/json-file.mjs';

const folder=(root,id)=>path.join(root,'runtime','conversation-topics',createHash('sha256').update(id).digest('hex'));
const index=(root,id)=>path.join(folder(root,id),'topics.json');
export const readTopics=(root,id)=>readJsonFile(index(root,id),[]);

// A draft belongs to one submitted turn. Only its successful completion publishes it.
export function topicWriter(root,onChange){
  const turns=new Map(), pending=new Map();
  async function prepare(id){
    await pending.get(id);
    const rows=await readTopics(root,id), draft=path.join(folder(root,id),randomUUID()+'.json');
    return {draft,context:{kind:'application',value:JSON.stringify({本轮话题草稿路径:draft})},
      recall:{kind:'application',value:JSON.stringify({已有话题路径:index(root,id),
      当前主线:rows[0]?.mainline||'',最近话题:rows.slice(0,6).map(({id,title,summary})=>({id,title,summary}))})}};
  }
  function bind(id,turn,draft){if(turn)turns.set(JSON.stringify([id,turn]),draft);}
  function finish(id,turn,status){
    const key=JSON.stringify([id,turn]),draft=turns.get(key);
    if(!draft)return;
    turns.delete(key);
    const job=Promise.resolve(pending.get(id)).then(async()=>{
      if(status!=='completed'){await fs.rm(draft,{force:true});return;}
      const data=await readJsonFile(draft,null);
      if(!data)return;
      const rows=await readTopics(root,id), previous=data.id && rows.find(row=>row.id===data.id);
      if(data.id && !previous)throw Error('更新的话题不存在');
      const {title,summary,mainline}=data;
      if(![title,summary,mainline].every(s=>typeof s==='string'&&s.trim()))throw Error('话题缺少标题、摘要或主线');
      if(!previous || previous.title!==title || previous.summary!==summary || previous.mainline!==mainline){
        const row={id:previous?.id||turn,title,summary,mainline,at:new Date().toISOString()};
        await writeJsonFileAtomic(index(root,id),[row,...rows.filter(r=>r.id!==row.id)],{mode:0o600});
        onChange?.(id,row.at);
      }
      await fs.rm(draft,{force:true});
    }).catch(e=>console.warn('[status-panel] 话题记录未保存:',e.message));
    pending.set(id,job);void job.finally(()=>{if(pending.get(id)===job)pending.delete(id);});
    return job;
  }
  return {prepare,bind,finish};
}
