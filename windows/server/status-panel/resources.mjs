import {createHash} from 'node:crypto';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('base64url').slice(0,22);
export function taskRows(tasks){
  return (tasks||[]).filter(t=>t.background && t.source?.kind==='conversation').map(t=>({threadId:t.source.threadId,
    id:t.id,title:t.title,state:t.state,result:t.error||t.result||'',at:t.createdAt,check:t.runtime?.panelCheck}));
}
function versions(rows){
  const groups=new Map();
  for(const row of rows)if(row.threadId){const list=groups.get(row.threadId)||[];list.push(row);groups.set(row.threadId,list);}
  return Object.fromEntries([...groups].map(([id,items])=>[id,digest(items)]));
}
// Each source publishes its own small revision index over the existing project connection.
export function panelSignals({readAutomations,agentTasks}){
  const clients=new Set(),previous=new Map(),pending=new Map();
  let timer,unsubscribe;
  const send=(res,event)=>{if(!res.destroyed&&!res.writableEnded && !(res.writableLength>4*1024*1024))res.write('data: '+JSON.stringify(event)+'\n\n');};
  const refresh=(section)=>{
    if(pending.has(section))return pending.get(section);
    const job=Promise.resolve().then(async()=>{
      const value=section==='tasks'?{items:taskRows(agentTasks?.tasks?.())}:await readAutomations();
      const event={type:'panel_versions',section,versions:versions(value.items),warnings:value.warnings?.length?digest(value.warnings):''};
      if(JSON.stringify(previous.get(section))!==JSON.stringify(event)){
        previous.set(section,event);for(const res of clients)send(res,event);
      }
    }).catch(()=>{}).finally(()=>pending.delete(section));pending.set(section,job);return job;
  };
  return (req,res)=>{
    clients.add(res);
    for(const event of previous.values())send(res,event);
    if(clients.size===1){
      void refresh('tasks');void refresh('schedules');
      unsubscribe=agentTasks?.onTaskCommit?.(()=>void refresh('tasks'));
      timer=setInterval(()=>void refresh('schedules'),30000);timer.unref?.();
    }
    res.once('close',()=>{clients.delete(res);if(!clients.size){clearInterval(timer);unsubscribe?.();previous.clear();}});
  };
}
