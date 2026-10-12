import { basePrompt } from "./base-prompt.mjs";
import { imageInstructions } from "./image-generation/image-runtime.mjs";
import { githubInstructions } from "./github-runtime.mjs";
import { maintenanceInstructions } from "./maintenance-instructions.mjs";
import { computerInstructions } from "./computer-control/runtime.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clean = (value, maxLength = 4000) => String(value || "").trim().slice(0, maxLength);
export const builtInEmployeesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "employees");

export const employeeExecutionPace = "";

// Employee instructions are identity and work guidance, not a second
// permission layer. Keep them in the same developer prompt for every turn so
// a resumed employee behaves exactly like a newly opened one.
export const employeeTurnInstructions = (instructions = "", context = "") => [
  basePrompt,
  clean(instructions, 12000),
  clean(context, 12000),
  maintenanceInstructions(),
  imageInstructions(),
  computerInstructions(),
  githubInstructions(),
].filter(Boolean).join("\n\n");

const normalize = (value, workRoot) => {
  const id = clean(value?.id, 80);
  if (!id) return null;
  return {
    id,
    order: Number.isFinite(Number(value.order)) ? Number(value.order) : 999,
    name: clean(value.name, 160) || id,
    shortName: clean(value.shortName, 40) || id.slice(0, 2),
    aliases: [...new Set((Array.isArray(value.aliases) ? value.aliases : [])
      .map((alias) => clean(alias, 80)).filter(Boolean))],
    delegatesTo: [...new Set((Array.isArray(value.delegatesTo) ? value.delegatesTo : [])
      .map((delegate) => clean(delegate, 80)).filter(Boolean))],
    responsibility: clean(value.responsibility, 500),
    projectKey: clean(value.projectKey, 120) || `employee-${id}`,
    runtimeKind: clean(value.runtimeKind, 80) || "codex",
    modelProviderId: clean(value.modelProviderId, 80),
    model: clean(value.model, 120),
    reasoningEffort: clean(value.reasoningEffort, 40),
    instructions: clean(value.instructions, 8000),
    workRoot: path.join(workRoot, id),
  };
};

export const loadEmployeeDefinitions = async (sourceRoot = builtInEmployeesRoot, workRoot = sourceRoot) => {
  const directories = await fs.readdir(sourceRoot, { withFileTypes: true });
  const loaded = await Promise.all(directories
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const value = JSON.parse(await fs.readFile(path.join(sourceRoot, entry.name, "employee.json"), "utf8"));
      const promptPath = path.join(sourceRoot, entry.name, 'system-prompt.md');
      const prompt = await fs.readFile(promptPath, 'utf8').catch(() => '');
      value.instructions = [value.instructions, prompt].filter(Boolean).join('\n\n');
      return normalize(value, workRoot);
    }));
  const definitions = loaded.filter(Boolean).sort((left, right) => left.order - right.order);
  if (!definitions.length) throw new Error("No built-in employees were found.");
  return definitions;
};
