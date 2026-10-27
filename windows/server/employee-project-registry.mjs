import fs from "node:fs/promises";
import path from "node:path";
import { builtInEmployeesRoot, loadEmployeeDefinitions } from "./employee-definitions.mjs";
import { CURRENT_MODEL_PROVIDER_ID } from "./model-provider-service.mjs";
import { cloneJson, readJsonFile, writeJsonFileAtomic } from "./persistence/json-file.mjs";

const clean = (value, maxLength = 200) => String(value || "").trim().slice(0, maxLength);

const readStored = async (stateFile) => {
  try {
    const stored = await readJsonFile(stateFile, {});
    return Array.isArray(stored?.employees) ? stored.employees : [];
  } catch { return []; }
};

const normalize = (definition, saved = {}, workspaceRoot) => ({
  ...definition,
  // User-visible employees operate on the same project workspace as the main
  // agent. Their private context remains isolated below, but cwd must not hide
  // the repository behind employees/<id>.
  projectRoot: clean(workspaceRoot, 400),
  contextRoot: clean(saved.contextRoot, 400) || path.join(workspaceRoot, "runtime", "employee-contexts", definition.id),
  modelProviderId: clean(saved.modelProviderId, 80) || clean(definition.modelProviderId, 80) || CURRENT_MODEL_PROVIDER_ID,
  model: clean(saved.model, 120) || clean(definition.model, 120) || "",
  reasoningEffort: clean(saved.reasoningEffort, 40) || clean(definition.reasoningEffort, 40) || "",
  pendingModelSettings: saved.pendingModelSettings || null,
  mainThreadId: clean(saved.mainThreadId, 120) || null,
  conversationId: clean(saved.conversationId, 120) || null,
  conversationTitle: clean(saved.conversationTitle, 240) || null,
  conversationArchived: saved.conversationArchived === true,
  // User-visible employees inherit the main Agent's host-level authorization;
  // the legacy confirmation flag is retained for API compatibility only.
  modificationConfirmed: true,
  updatedAt: saved.updatedAt || null,
});

export const createEmployeeProjectRegistry = async ({ stateFile, workspaceRoot, definitions = null }) => {
  const employeeDefinitions = definitions || await loadEmployeeDefinitions(
    builtInEmployeesRoot,
    path.join(workspaceRoot, "employees"),
  );
  const saved = new Map((await readStored(stateFile)).map((entry) => [entry?.id, entry]));
  const employees = new Map(employeeDefinitions.map((definition) => [
    definition.id,
    normalize(definition, saved.get(definition.id), workspaceRoot),
  ]));
  let writeQueue = Promise.resolve();
  const persist = () => {
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await writeJsonFileAtomic(stateFile, { version: 1, employees: [...employees.values()] });
    });
    return writeQueue;
  };
  const publicEmployee = (employee) => {
    if (!employee) return null;
    const { instructions, ...publicValue } = employee;
    return cloneJson(publicValue);
  };
  const requireEmployee = (employeeId) => {
    const employee = employees.get(clean(employeeId, 80));
    if (!employee) throw Object.assign(new Error("Employee does not exist."), { statusCode: 404 });
    return employee;
  };
  const update = async (employeeId, patch) => {
    const current = requireEmployee(employeeId);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    employees.set(current.id, next);
    await persist();
    return publicEmployee(next);
  };
  await persist();
  await Promise.all([...employees.values()].flatMap((employee) => [
    fs.mkdir(employee.projectRoot, { recursive: true }),
    fs.mkdir(employee.contextRoot, { recursive: true }),
  ]));
  return {
    list: () => [...employees.values()].map(publicEmployee),
    get: (employeeId) => publicEmployee(employees.get(clean(employeeId, 80))),
    require: requireEmployee,
    listRuntimeProfiles: () => [...employees.values()].map(cloneJson),
    bindMainThread: (employeeId, mainThreadId) => update(employeeId, { mainThreadId: clean(mainThreadId, 120) || null }),
    bindConversation: (employeeId, conversationId) => update(employeeId, { conversationId: clean(conversationId, 120) || null }),
    setConversationTitle: (employeeId, conversationTitle) => update(employeeId, { conversationTitle: clean(conversationTitle, 240) || null }),
    setConversationArchived: (employeeId, conversationArchived) => update(employeeId, { conversationArchived: conversationArchived === true }),
    setPendingModelSettings: (employeeId, settings) => update(employeeId, { pendingModelSettings: settings }),
    setModelSettings: (employeeId, settings) => update(employeeId, {
      pendingModelSettings: null,
      modelProviderId: clean(settings?.modelProviderId, 80) || CURRENT_MODEL_PROVIDER_ID,
      model: clean(settings?.model, 120),
      reasoningEffort: clean(settings?.reasoningEffort, 40),
    }),
    // Retain the legacy setter for callers that still acknowledge the old UI;
    // employees are always authorized and cannot be downgraded by that flag.
    setModificationConfirmed: (employeeId) => update(employeeId, { modificationConfirmed: true }),
    close: () => writeQueue,
  };
};
