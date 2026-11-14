export type StorageArea = "local" | "session";

const getStorage = (area: StorageArea): Storage | null => {
  try {
    if (typeof window === "undefined") return null;
    return area === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

/** Read JSON from browser storage without making storage failures fatal. */
export const readStorage = <T>(key: string, area: StorageArea = "local"): T | null => {
  const storage = getStorage(area);
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** Read and validate JSON from browser storage. Invalid values are treated as misses. */
export const readValidStorage = <T>(
  key: string,
  valid: (value: unknown) => value is T,
  area: StorageArea = "local",
): T | null => {
  const value = readStorage<unknown>(key, area);
  return value !== null && valid(value) ? value : null;
};

export const writeStorage = <T>(key: string, value: T, area: StorageArea = "local"): boolean => {
  const storage = getStorage(area);
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const removeStorage = (key: string, area: StorageArea = "local"): boolean => {
  const storage = getStorage(area);
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};
