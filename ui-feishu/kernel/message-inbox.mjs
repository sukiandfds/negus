import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Persist intake before publishing a message. Idempotent publish/enqueue adapters make crash replay safe.
export async function createMessageInbox({ stateFile, publish, dispatch, onError = () => {} }) {
  let entries = [];
  try { entries = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!Array.isArray(entries)) throw Error('消息接收记录格式错误');
  let writes = Promise.resolve(); let closed = false;
  const pending = new Map(); const locks = new Map();
  const mutate = operation => {
    if (closed) return Promise.reject(Error('消息服务已关闭'));
    const work = writes.then(async () => {
      const next = structuredClone(entries); const result = operation(next);
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      const temporary = `${stateFile}.tmp`;
      const handle = await fs.open(temporary, 'w', 0o600);
      try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, stateFile); entries = next;
      return structuredClone(result);
    });
    writes = work.catch(() => {}); return work;
  };
  const ensureMessage = async id => {
    const entry = entries.find(item => item.id === id);
    if (entry.message) return entry.message;
    const message = await publish(entry);
    await mutate(data => { data.find(item => item.id === id).message = message; });
    return message;
  };
  const process = id => {
    if (pending.has(id) || closed) return;
    const work = (async () => {
      try {
        const message = await ensureMessage(id);
        const entry = entries.find(item => item.id === id);
        const execution = await dispatch(entry.input, message, {
          routing: entry.routing,
          saveRouting: routing => mutate(data => { data.find(item => item.id === id).routing = routing; }),
        });
        await mutate(data => Object.assign(data.find(item => item.id === id), { state: 'dispatched', execution, error: '' }));
      } catch (error) {
        if (closed) return;
        await mutate(data => Object.assign(data.find(item => item.id === id), { state: 'failed', error: error.message }));
        await onError(entries.find(item => item.id === id), error);
      }
    })().finally(() => pending.delete(id));
    pending.set(id, work);
    void work.catch(() => {});
  };
  const accept = async (key, input) => {
    if (!key) throw Error('消息缺少重试标识');
    if (locks.has(key)) return locks.get(key);
    const work = (async () => {
      const entry = await mutate(data => {
        const existing = data.find(item => item.key === key);
        if (existing) { if (existing.state === 'failed') existing.state = 'pending'; return existing; }
        const item = { id: randomUUID(), key, input, state: 'pending', createdAt: new Date().toISOString() };
        data.push(item); return item;
      });
      const message = await ensureMessage(entry.id);
      if (entry.state !== 'dispatched') process(entry.id);
      return { message, execution: entry.execution || null };
    })().finally(() => locks.delete(key));
    locks.set(key, work); return work;
  };
  for (const entry of entries) if (entry.state === 'pending') process(entry.id);
  return { accept, list: () => structuredClone(entries), close: async () => { closed = true; await writes; } };
}
