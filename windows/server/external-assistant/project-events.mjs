import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

// Project-owned audit records hold references, never bearer links or raw tool arguments.
export function projectEvents(projectRoot) {
  const dir = path.join(projectRoot, 'runtime', 'project-activity');
  const file = project => path.join(dir, createHash('sha256').update(project).digest('hex') + '.jsonl');
  let pending = Promise.resolve();
  const snapshots=new Map();
  async function history(project) {
    let bytes;
    let revision;
    try {
      await pending;
      const info=await stat(file(project));
      revision=info.mtimeMs+':'+info.size;
      const cached=snapshots.get(project);
      if(cached?.revision===revision)return cached.rows;
      bytes=await readFile(file(project),'utf8');
    }
    catch(e){ if(e.code==='ENOENT')return [];throw e; }
    const rows=bytes.trimEnd().split('\n').filter(Boolean).map(s=>JSON.parse(s));
    if(snapshots.size>=32)snapshots.delete(snapshots.keys().next().value);
    snapshots.set(project,{revision,rows});
    return rows;
  }
  return {
    history,
    append(project, { callId = randomUUID(), tool, state, objectId, approval, modelChange, actor = '00' }) {
      const row = { id: randomUUID(), project, actor, callId, tool, state, at: new Date().toISOString(), ...(objectId ? {objectId} : {}),...(approval ? {approval} : {}), ...(modelChange ? {modelChange} : {}) };
      const op = pending.then(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await appendFile(file(project), JSON.stringify(row)+'\n', { mode: 0o600 });
        return row;
      });
      pending = op.catch(() => {});
      return op;
    },
    async list(project, after, limit = 100) {
      const rows=await history(project);
      const index = after ? rows.findIndex(r => r.id === after) : -1;
      if (after && index < 0) throw Error('活动游标无效');
      const events = rows.slice(index + 1, index + 1 + limit);
      return { events, next: events.at(-1)?.id || after || null };
    },
  };
}
