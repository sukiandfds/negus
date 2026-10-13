import { readJsonFile, writeJsonFileAtomic } from './persistence/json-file.mjs';

export const createModelDefaultsStore = (file) => {
  let writes = Promise.resolve();
  const read = async () => {
    await writes;
    return readJsonFile(file, { providerId: '', model: '', effort: '', archivedProviderIds: [] });
  };
  const save = (input) => {
    const providerId = String(input.providerId || ''), model = String(input.model || ''), effort = String(input.effort || '');
    if (providerId.length > 100 || model.length > 240 || !['','none','minimal','low','medium','high','xhigh','max','ultra'].includes(effort)
      || (providerId && !model)) throw Object.assign(new Error('设为默认前请选择默认模型'), { statusCode: 400 });
    const value = { providerId, model, effort, archivedProviderIds: [] };
    const task = writes.catch(() => {}).then(async () => {
      await writeJsonFileAtomic(file, value, { space: 0, trailingNewline: false, mode: 0o600 });
      return value;
    });
    writes = task.catch(() => {});
    return task;
  };
  return { read, save };
};
