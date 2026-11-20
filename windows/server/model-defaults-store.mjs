import { readJsonFile, writeJsonFileAtomic } from './persistence/json-file.mjs';

const EMPTY_DEFAULTS = { providerId: '', model: '', effort: '', archivedProviderIds: [] };

export const createModelDefaultsStore = (file) => {
  let writes = Promise.resolve();
  const normalize = async (input = {}) => {
    let providerId = String(input.providerId || '').trim();
    let model = String(input.model || '').trim();
    let effort = String(input.effort || '').trim();
    let archivedProviderIds = Array.isArray(input.archivedProviderIds) ? input.archivedProviderIds : [];
    if (providerId.length > 100 || model.length > 240 || !['','none','minimal','low','medium','high','xhigh','max','ultra'].includes(effort)
      || (providerId && !model)) throw Object.assign(new Error('设为默认前请选择默认模型'), { statusCode: 400 });
    return { providerId, model, effort, archivedProviderIds: [...new Set(archivedProviderIds.filter(id => typeof id === 'string'))] };
  };
  const read = async () => {
    await writes;
    return normalize(await readJsonFile(file, EMPTY_DEFAULTS));
  };
  const save = (input, { selectionOnly = false, ifProvider } = {}) => {
    const task = writes.catch(() => {}).then(async () => {
      const previous = selectionOnly || ifProvider ? await readJsonFile(file, EMPTY_DEFAULTS) : EMPTY_DEFAULTS;
      if (ifProvider && previous.providerId !== ifProvider) return normalize(previous);
      const value = await normalize(selectionOnly ? { ...input, archivedProviderIds: previous.archivedProviderIds || [] } : input);
      await writeJsonFileAtomic(file, value, { space: 0, trailingNewline: false, mode: 0o600 });
      return value;
    });
    writes = task.catch(() => {});
    return task;
  };
  return { read, save };
};
