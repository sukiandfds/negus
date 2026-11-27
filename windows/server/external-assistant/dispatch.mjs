import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const publicRow = r => ({id:r.id, projectId:r.project, threadId:r.thread, callId:r.callId, actor:r.actor,
  agentId:r.agent, employeeName:r.employeeName, tool:r.tool, state:r.state, text:r.input, acceptance:r.acceptance,
  result:r.answer, error:r.error, createdAt:r.created, updatedAt:r.updated});

// Historical work remains readable after retiring the offline executor.
export function scopedDispatch({projectRoot,directory}) {
  const file=path.join(projectRoot,'runtime','external-work','ledger.sqlite');
  let db;
  const ledger=()=>db || (existsSync(file) ? db=new DatabaseSync(file,{readOnly:true}) : null);
  const rows=(sql,...args)=>(ledger()?.prepare(sql).all(...args)||[]).map(publicRow);
  return {hasPendingWork:()=>false,
    tasks:project=>rows("SELECT * FROM work WHERE project=? AND tool='task_create' ORDER BY created DESC",project),
    forThread:(project,thread)=>rows('SELECT * FROM work WHERE project=? AND thread=? ORDER BY created DESC LIMIT 100',project,thread),
    // Called only on the authenticated local conversation view, not by any executor.
    forView:async thread=>{
      const history=rows('SELECT * FROM work WHERE thread=? ORDER BY created DESC LIMIT 100',thread);
      if(!history.length)return [];
      const {projects}=await directory.list();
      return history.filter(r=>projects.find(p=>p.projectId===r.projectId)?.conversations.some(t=>t.threadId===thread &&
        (!t.projectId || t.projectId===r.projectId) && (!t.targetProjectId || t.targetProjectId===r.projectId)));
    },
    forCall:(project,call)=>{const r=ledger()?.prepare('SELECT * FROM work WHERE project=? AND callId=?').get(project,call);return r && publicRow(r);},
    revision:thread=>ledger()?.prepare('SELECT max(updated) AS t FROM work WHERE thread=?').get(thread)?.t || '',
  };
}
