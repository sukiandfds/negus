import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const promptFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "AGENTS.md");
export const basePrompt = fs.readFileSync(promptFile, "utf8").trim();
