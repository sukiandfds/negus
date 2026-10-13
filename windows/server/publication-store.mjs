import { readJsonFile, writeJsonFileAtomic } from "./persistence/json-file.mjs";

const clean = (value, maxLength = 160) => String(value || "").trim().slice(0, maxLength);

export const createPublicationStore = async ({ stateFile, maxRecords = 2000 }) => {
  let records = new Map();
  try {
    const stored = await readJsonFile(stateFile, {});
    for (const record of Array.isArray(stored?.publications) ? stored.publications : []) {
      const requestId = clean(record?.requestId, 120);
      if (requestId) records.set(requestId, record);
    }
  } catch {}

  let writeQueue = Promise.resolve();
  const persist = () => {
    const retained = [...records.values()].slice(-maxRecords);
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        await writeJsonFileAtomic(stateFile, { version: 1, publications: retained }, { trailingNewline: false });
      });
    return writeQueue;
  };

  await persist();
  return {
    get: (requestId) => records.get(clean(requestId, 120)) || null,
    set: async (record) => {
      const requestId = clean(record?.requestId, 120);
      if (!requestId) throw new Error("requestId 不能为空");
      records.set(requestId, record);
      if (records.size > maxRecords) records = new Map([...records.entries()].slice(-maxRecords));
      await persist();
      return record;
    },
    close: () => writeQueue,
  };
};
