import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const createModelDefaultsStore = (file) => {
  let writes = Promise.resolve();
  const read = async () => {
    await writes;
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { providerId: '', model: '', effort: '', archivedProviderIds: [] }; throw error; }
  };
  const save = (input) => {
    const providerId = String(input.providerId || ''), model = String(input.model || ''), effort = String(input.effort || '');
    if (providerId.length > 100 || model.length > 240 || !['','none','minimal','low','medium','high','xhigh','max','ultra'].includes(effort)
      || (providerId && !model)) throw Object.assign(new Error('设为默认前请选择默认模型'), { statusCode: 400 });
    const value = { providerId, model, effort, archivedProviderIds: [] };
    const task = writes.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.' + randomUUID() + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
      await fs.rename(tmp, file);
      return value;
    });
    writes = task.catch(() => {});
    return task;
  };
  return { read, save };
};
