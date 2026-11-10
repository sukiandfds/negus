import { randomUUID } from "node:crypto";
import { cloneJson, readJsonFile, writeJsonFileAtomic } from "./persistence/json-file.mjs";

const clean = (value, max = 300) => String(value || "").trim().slice(0, max);
const now = () => new Date().toISOString();

const readState = async (stateFile) => {
  try {
    const value = await readJsonFile(stateFile, {});
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
};

export const createEmployeeGrowthStore = async ({ stateFile, registry }) => {
  const stored = await readState(stateFile);
  const entries = new Map();
  for (const employee of registry.list()) {
    const value = stored.employees?.[employee.id] || {};
    entries.set(employee.id, {
      facts: Array.isArray(value.facts) ? value.facts : [],
      proposals: Array.isArray(value.proposals) ? value.proposals : [],
      logs: Array.isArray(value.logs) ? value.logs : [],
    });
  }
  let writeQueue = Promise.resolve();
  let ruleStatusQueue = Promise.resolve();
  const persist = () => {
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      await writeJsonFileAtomic(stateFile, { version: 1, employees: Object.fromEntries(entries) });
    });
    return writeQueue;
  };
  const queueRuleStatus = operation => {
    const result = ruleStatusQueue.then(operation, operation);
    ruleStatusQueue = result.then(() => {}, () => {});
    return result;
  };
  const requireEntry = (employeeId) => {
    const id = clean(employeeId, 80);
    const entry = entries.get(id);
    if (!entry) throw Object.assign(new Error("Employee does not exist."), { statusCode: 404 });
    return { id, entry };
  };
  const appendLog = (entry, log) => {
    const value = { id: randomUUID(), createdAt: now(), ...log };
    entry.logs.push(value);
    if (entry.logs.length > 500) entry.logs.splice(0, entry.logs.length - 500);
    return value;
  };
  await persist();
  return {
    list: () => [...entries.entries()].map(([employeeId, value]) => ({ employeeId, ...cloneJson(value) })),
    get: (employeeId) => {
      const { id, entry } = requireEntry(employeeId);
      return { employeeId: id, ...cloneJson(entry) };
    },
    addFact: async (employeeId, fact, { requestId = "" } = {}) => {
      const { id, entry } = requireEntry(employeeId);
      const key = clean(requestId, 120);
      if (key && entry.facts.some((item) => item.requestId === key)) return cloneJson(entry.facts.find((item) => item.requestId === key));
      const value = { id: randomUUID(), requestId: key || null, createdAt: now(), status: "saved", ...fact };
      entry.facts.push(value);
      appendLog(entry, { action: "fact_saved", itemId: value.id, requestId: key || null });
      await persist();
      return cloneJson(value);
    },
    addProposal: async (employeeId, proposal, { requestId = "" } = {}) => {
      const { id, entry } = requireEntry(employeeId);
      const key = clean(requestId, 120);
      const duplicate = key && entry.proposals.find((item) => item.requestId === key);
      if (duplicate) return cloneJson(duplicate);
      const value = {
        id: randomUUID(),
        requestId: key || null,
        createdAt: now(),
        status: "pending",
        ...proposal,
      };
      entry.proposals.push(value);
      appendLog(entry, { action: "proposal_pending", itemId: value.id, requestId: key || null });
      await persist();
      return cloneJson(value);
    },
    decide: async (employeeId, proposalId, decision, { requestId = "" } = {}) => {
      const { id, entry } = requireEntry(employeeId);
      const proposal = entry.proposals.find((item) => item.id === clean(proposalId, 120));
      if (!proposal) throw Object.assign(new Error("Growth proposal does not exist."), { statusCode: 404 });
      if (proposal.status !== "pending") return cloneJson(proposal);
      proposal.status = decision === "approved" ? "approved" : "rejected";
      delete proposal.error;
      proposal.decidedAt = now();
      proposal.decisionRequestId = clean(requestId, 120) || null;
      appendLog(entry, { action: `proposal_${proposal.status}`, itemId: proposal.id, requestId: proposal.decisionRequestId });
      await persist();
      return cloneJson(proposal);
    },
    setRuleStatus: (employeeId, proposalId, status, { requestId = "" } = {}) => queueRuleStatus(async () => {
      const { entry } = requireEntry(employeeId);
      const proposal = entry.proposals.find((item) => item.id === proposalId && item.kind === "rule");
      if (!proposal) throw Object.assign(new Error("Rule does not exist."), { statusCode: 404 });
      if (proposal.status === status) return { ...cloneJson(proposal), changed: false };
      if (status === "disabled" && proposal.status !== "approved") throw Object.assign(new Error("Rule is not active."), { statusCode: 409 });
      const previous = cloneJson(proposal);
      const previousLogs = cloneJson(entry.logs);
      proposal.status = status;
      proposal.statusChangedAt = now();
      proposal.statusRequestId = clean(requestId, 120) || null;
      const transitionLog = appendLog(entry, { action: `rule_${status}`, itemId: proposal.id, requestId: proposal.statusRequestId });
      try {
        await persist();
      } catch (error) {
        for (const key of Object.keys(proposal)) delete proposal[key];
        Object.assign(proposal, previous);
        const currentLogs = entry.logs.filter(item => item.id !== transitionLog.id);
        const currentIds = new Set(currentLogs.map(item => item.id));
        entry.logs = [...previousLogs.filter(item => !currentIds.has(item.id)), ...currentLogs].slice(-500);
        throw error;
      }
      return { ...cloneJson(proposal), changed: true };
    }),
    requeue: async (employeeId, proposalId, { error = "", requestId = "" } = {}) => {
      const { entry } = requireEntry(employeeId);
      const proposal = entry.proposals.find((item) => item.id === clean(proposalId, 120));
      if (!proposal) throw Object.assign(new Error("Growth proposal does not exist."), { statusCode: 404 });
      proposal.status = "pending";
      proposal.error = clean(error, 500) || null;
      appendLog(entry, { action: "proposal_requeued", itemId: proposal.id, requestId: clean(requestId, 120) || null });
      await persist();
      return cloneJson(proposal);
    },
    appendLog: async (employeeId, log) => {
      const { entry } = requireEntry(employeeId);
      appendLog(entry, log);
      await persist();
    },
    close: async () => {
      await ruleStatusQueue;
      return writeQueue;
    },
  };
};
