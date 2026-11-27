// Shared by the owner's review panel and the external read-only projections.
// Artifacts historically share an installation-level project label. Follow their
// task or original room message, never that label, to establish ownership.
export function projectData({ tasks, artifacts, roomDirectory, multiAgentDirectory }) {
  const rooms = p => (roomDirectory?.list()||[]).filter(r=>r.projectId===p.projectId);
  const ownedTasks = p => {
    const own=(tasks?.tasks()||[]).filter(t=>t.workProjectId ? t.workProjectId===p.projectId :
      t.source?.projectId ? t.source.projectId===p.projectId : t.source?.kind==='conversation' && p.conversations.some(c=>c.threadId===t.source.threadId));
    return [...own,...rooms(p).flatMap(r=>multiAgentDirectory?.get(r.id)?.tasks?.()||[])];
  };
  const records=p=>{
    const ids=new Set(ownedTasks(p).map(t=>t.id));
    return (artifacts?.list({})||[]).filter(a=>a.taskId ? ids.has(a.taskId) :
      a.messageId && rooms(p).some(r=>roomDirectory.require(r.id).getMessage(a.messageId)?.artifactIds?.includes(a.id))).map(a=>({...a,versions:a.versions.filter(v=>v.version===a.currentVersion || v.workProjectId===p.projectId)}));
  };
  const reviews=p=>records(p).flatMap(a=>a.versions.filter(v=>v.version===a.currentVersion).map(v=>({
    id:a.id,version:v.version,title:v.name,state:v.reviewDecision||'pending',kind:'artifact',task:a.taskId
  })));
  return {rooms,ownedTasks,records,reviews};
}
