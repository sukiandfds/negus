import { createHash } from 'node:crypto';
import { denied } from './access.mjs';

// Decisions are project activity records, not a parallel job store. Capability
// modules (never MCP callers) supply the immutable plan and its version. A
// decision records consent only; a future executor must claim that exact plan.
export function approvalInbox(events) {
  let pending=Promise.resolve();
  const serialize=fn=>{const job=pending.then(fn);pending=job.catch(()=>{});return job;};
  async function list(project) {
    const items=new Map();
    for(const row of await events.history(project)){
      if(row.tool==='approval_requested' && row.approval)items.set(row.callId,{...row.approval,id:row.callId,state:'pending',at:row.at,kind:'action'});
      else if(row.tool==='approval_decided'&&items.has(row.callId)) items.get(row.callId).state=row.state;
    }
    return [...items.values()];
  }
  return {
    list,
    request(project,{operation,target,revision,summary,requestId}) {
      if(!['external_send','delete_data','merge_main','deploy','git_push'].includes(operation)||![target,revision,summary,requestId].every(x=>typeof x==='string'&&x.length>0&&x.length<=1024))throw Error('审批缺少具体操作、目标、版本或说明');
      const fingerprint=createHash('sha256').update(JSON.stringify([project,operation,target,revision,summary])).digest('hex');
      const callId=createHash('sha256').update(JSON.stringify(['00',project,requestId])).digest('hex');
      return serialize(async()=>{
        const existing=(await list(project)).find(x=>x.id===callId);
        if(existing){if(existing.fingerprint!==fingerprint)throw Error('同一申请编号不能更改审批内容');return existing;}
        const approval={operation,target,revision,title:summary,fingerprint};
        await events.append(project,{tool:'approval_requested',callId,state:'pending',approval});
        return {id:callId,...approval,state:'pending',kind:'action'};
      });
    },
    decide(project,id,fingerprint,decision) {
      if(!['approve','reject'].includes(decision))throw denied();
      return serialize(async()=>{
        const existing=(await list(project)).find(x=>x.id===id);
        if(!existing||existing.state!=='pending'||existing.fingerprint!==fingerprint)throw denied();
        const state=decision==='approve'?'approved':'rejected';
        await events.append(project,{tool:'approval_decided',callId:id,actor:'owner',state});
        return {...existing,state};
      });
    },
  };
}
