import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

export const readJsonFile = async (file, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
};

export const writeTextFileAtomic = async (file, payload, { mode } = {}) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, payload, mode === undefined ? "utf8" : { encoding: "utf8", mode });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
};

export const writeJsonFileAtomic = async (file, value, {
  space = 2,
  trailingNewline = true,
  mode,
} = {}) => {
  const payload = JSON.stringify(value, null, space) + (trailingNewline ? "\n" : "");
  await writeTextFileAtomic(file, payload, { mode });
};
