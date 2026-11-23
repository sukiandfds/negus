import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readJsonFile,writeJsonFileAtomic} from '../persistence/json-file.mjs';
import {addProfileCandidate} from '../profile-service.mjs';

const folder=(root,id)=>path.join(root,'runtime','conversation-topics',createHash('sha256').update(id).digest('hex'));
const index=(root,id)=>path.join(folder(root,id),'topics.json');
export const readTopics=(root,id)=>readJsonFile(index(root,id),[]);

// A draft belongs to one submitted turn. Only its successful completion publishes it.
export function topicWriter(root,onChange){
  const turns=new Map(), pending=new Map();
  async function prepare(id){
    await pending.get(id);
    const rows=await readTopics(root,id), draft=path.join(folder(root,id),randomUUID()+'.json');
    await fs.mkdir(path.dirname(draft),{recursive:true,mode:0o700});
    return {draft,context:{kind:'application',value:JSON.stringify({本轮话题草稿路径:draft,记录要求:"有新结论、决定或进展时，在发出最终回复前用工具把你的总结写到本轮草稿路径；这是对话记录的一部分，无需用户另行要求。没有新内容就跳过。每个独立事项分别记录助手总结，即使在同一轮提出。单项用 {id,title,mainline,summary}，多项用这些对象组成的 JSON 数组。同话题沿用已有 id 并更新累计摘要，新话题留空 id；mainline 写整段对话的主线。只写脱敏内容，不写真实账号、密码、密钥等隐私；不在聊天里重复这份记录。系统在本轮成功结束后发布。本轮若发生用户纠正或愤怒事件，在对应话题条目上附加 profileCandidate 字段：{rule, ref, anger}，rule 为蒸馏后的一行祈使句，ref 为吐血表条目编号，anger 为布尔值；没有纠正或愤怒事件就不要附加。"})},
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
      const rows=await readTopics(root,id), updates=[], candidates=[], at=new Date().toISOString();
      for(const item of Array.isArray(data)?data:[data]){
        const previous=item.id && rows.find(row=>row.id===item.id);
        if(item.id && !previous)throw Error('更新的话题不存在');
        const {title,summary,mainline}=item;
        if(![title,summary,mainline].every(s=>typeof s==='string'&&s.trim()))throw Error('话题缺少标题、摘要或主线');
        const key=previous?.id || (!updates.length && !rows.some(row=>row.id===turn)?turn:randomUUID());
        const candidate=item.profileCandidate;
        if(candidate && typeof candidate.rule==='string' && candidate.rule.trim())
          candidates.push({rule:candidate.rule.trim(),ref:typeof candidate.ref==='string'?candidate.ref:'',anger:candidate.anger===true,topicId:key,turnId:turn});
        if(previous && previous.title===title && previous.summary===summary && previous.mainline===mainline)continue;
        if(updates.some(row=>row.id===key))throw Error('同一话题重复更新');
        updates.push({id:key,title,summary,mainline,turnIds:[...new Set([...(previous?.turnIds || (previous?[previous.id]:[])),turn])],at});
      }
      if(updates.length){
        await writeJsonFileAtomic(index(root,id),[...updates,...rows.filter(row=>!updates.some(update=>update.id===row.id))],{mode:0o600});
        onChange?.(id,at);
      }
      // Profile candidates are an increment on top of the published topics:
      // handling one must never fail or roll back the topic publish itself.
      for(const candidate of candidates){
        try{await addProfileCandidate(root,candidate);}
        catch(e){console.warn('[status-panel] 画像候选未处理:',e.message);}
      }
      await fs.rm(draft,{force:true});
    }).catch(e=>console.warn('[status-panel] 话题记录未保存:',e.message));
    pending.set(id,job);void job.finally(()=>{if(pending.get(id)===job)pending.delete(id);});
    return job;
  }
  return {prepare,bind,finish};
}
