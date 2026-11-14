import { readJsonFile, writeJsonFileAtomic } from './persistence/json-file.mjs';

const EMPTY_DEFAULTS = { providerId: '', model: '', effort: '', archivedProviderIds: [] };

export const createModelDefaultsStore = (file, { fallback = null } = {}) => {
  let writes = Promise.resolve();
  const normalize = async (input = {}) => {
    let providerId = String(input.providerId || '').trim();
    let model = String(input.model || '').trim();
    let effort = String(input.effort || '').trim();
    let archivedProviderIds = Array.isArray(input.archivedProviderIds) ? input.archivedProviderIds : [];
    if (!providerId && !model) {
      const value = fallback ? await fallback() : EMPTY_DEFAULTS;
      providerId = String(value?.providerId || '').trim();
      model = String(value?.model || '').trim();
      effort = String(value?.effort || '').trim();
      archivedProviderIds = Array.isArray(value?.archivedProviderIds) ? value.archivedProviderIds : [];
    }
    if (providerId.length > 100 || model.length > 240 || !['','none','minimal','low','medium','high','xhigh','max','ultra'].includes(effort)
      || (providerId && !model)) throw Object.assign(new Error('设为默认前请选择默认模型'), { statusCode: 400 });
    return { providerId, model, effort, archivedProviderIds: [...new Set(archivedProviderIds.filter(id => typeof id === 'string'))] };
  };
  const read = async () => {
    await writes;
    return normalize(await readJsonFile(file, EMPTY_DEFAULTS));
  };
  const save = (input) => {
    const task = writes.catch(() => {}).then(async () => {
      const value = await normalize(input);
      await writeJsonFileAtomic(file, value, { space: 0, trailingNewline: false, mode: 0o600 });
      return value;
    });
    writes = task.catch(() => {});
    return task;
  };
  return { read, save };
};
