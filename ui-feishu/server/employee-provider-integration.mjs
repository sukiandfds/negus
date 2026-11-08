import path from 'node:path';
import fs from 'node:fs/promises';

export async function setTransferredProvider(file, sourceFile, threadId, modelProvider) {
  if (path.resolve(file) === path.resolve(sourceFile)) return;
  const content = await fs.readFile(file, 'utf8');
  const newline = content.indexOf('\n');
  const header = JSON.parse(newline < 0 ? content : content.slice(0, newline));
  if (header.type !== 'session_meta' || header.payload?.id !== threadId) throw Error('员工原对话记录校验失败，未切换配置');
  header.payload.model_provider = modelProvider;
  const tail = (newline < 0 ? '' : content.slice(newline)).split('\n').map(line => {
    if (!line) return line;
    const entry = JSON.parse(line);
    const settings = entry.type === 'event_msg' && entry.payload?.type === 'thread_settings_applied'
      ? entry.payload.thread_settings : null;
    if (!settings || settings.model_provider_id === modelProvider) return line;
    settings.model_provider_id = modelProvider;
    return JSON.stringify(entry);
  }).join('\n');
  const temporary = `${file}.provider-${process.pid}`;
  await fs.writeFile(temporary, JSON.stringify(header) + tail, { mode: 0o600 });
  await fs.rename(temporary, file);
  // Native resume also trusts its persisted index over the rollout metadata.
  let directory = path.dirname(file);
  while (path.dirname(directory) !== directory && !['sessions', 'archived_sessions'].includes(path.basename(directory))) directory = path.dirname(directory);
  if (!['sessions', 'archived_sessions'].includes(path.basename(directory))) return;
  const home = path.dirname(directory);
  const databases = (await fs.readdir(home)).filter(name => /^state_\d+\.sqlite$/.test(name));
  if (!databases.length) return;
  const { DatabaseSync } = await import('node:sqlite');
  for (const name of databases) {
    const db = new DatabaseSync(path.join(home, name));
    try {
      db.exec('PRAGMA busy_timeout=5000');
      db.prepare('UPDATE threads SET model_provider=? WHERE id=? AND rollout_path=?').run(modelProvider, threadId, file);
    } finally { db.close(); }
  }
}

// Move the native rollout, preserving the thread ID and complete history.
export async function transferEmployeeThread({ source, target, providers, threadId, route, config, instructions, policy }) {
  let thread;
  try { ({ thread } = await source.request('thread/read', { threadId, includeTurns: false })); }
  catch (error) {
    if (!/thread not loaded/i.test(String(error.message))) throw error;
    ({ thread } = await source.request('thread/resume', { threadId, persistExtendedHistory: true, ...policy }));
  }
  if (thread?.status?.type === 'active') throw Object.assign(new Error('员工正在处理消息，不能修改配置'), { statusCode: 409 });
  if (!thread?.path || !path.isAbsolute(thread.path) || !thread.cwd) throw Error('无法找到员工原对话记录，未切换配置');
  const native = (await target.request('config/read', { cwd: thread.cwd })).config;
  const modelProvider = route.modelProviderId === 'current' ? native.model_provider || 'openai' : route.modelProviderId;
  await source.request('thread/unsubscribe', { threadId });
  let resumed = false;
  try {
    const info = await providers.prepareResumeFile(route.modelProviderId, thread);
    // A prior visit to this provider may still have this thread cached.
    await target.request('thread/unsubscribe', { threadId });
    await setTransferredProvider(info.path, thread.path, threadId, modelProvider);
    const result = await target.request('thread/resume', {
      threadId, path: info.path, cwd: thread.cwd, model: route.model, modelProvider,
      config, developerInstructions: instructions, persistExtendedHistory: true, ...policy,
    });
    resumed = true;
    if (result.thread?.id !== threadId || path.resolve(result.thread.cwd) !== path.resolve(thread.cwd)) {
      throw Error('员工原对话恢复校验失败，未切换配置');
    }
    return result;
  } catch (error) {
    if (resumed) await target.request('thread/unsubscribe', { threadId }).catch(() => {});
    throw error;
  }
}

export function adaptEmployeeProviderSource(source) {
  const replace = (before, after) => {
    if (!source.includes(before)) throw Error(`Employee provider integration changed: ${before}`);
    source = source.replace(before, after);
  };
  replace('  const sendLocks = new Map();', '  const sendLocks = new Map();\n  const modelChanges = new Map();');
  replace('runtimeClient.subscribe(handleProtocolMessage)', `runtimeClient.subscribe(message => {
      const owner = threadClients.get(message?.params?.threadId);
      if (!owner || owner === runtimeClient) handleProtocolMessage(message);
    })`);
  replace('  const ensureOpen = async (employeeId) => {', '  const ensureOpen = async (employeeId) => {\n    await modelChanges.get(employeeId);');
  replace('  const startThread = async (employee) => {', `  const reconcileEmployeeIdle = async (employeeId) => {
    const status = statusFor(employeeId);
    const employee = registry.require(employeeId);
    if (!status.active || !employee.mainThreadId || sendLocks.has(employeeId)) return;
    const native = await readAuthoritativeStatus(employee.mainThreadId, employee);
    if (native.known && !native.active && statusFor(employeeId) === status) {
      publishStatus(employeeId, { phase: "idle", label: "等待任务", active: false, turnId: "", detail: "" });
    }
  };
  const startThread = async (employee) => {`);
  replace('      if (hadExistingThread) {\n        const authoritative', '      if (hadExistingThread) {\n        const beforeRead = statusFor(employee.id);\n        const authoritative');
  replace('if (authoritative.known && authoritative.active) {', 'if (authoritative.known && authoritative.active && statusFor(employee.id) === beforeRead) {');
  replace('  const sendMessage = async ({ employeeId, text, attachments = [], requestId = "" }) => {', '  const sendMessage = async ({ employeeId, text, attachments = [], requestId = "" }) => {\n    await modelChanges.get(employeeId);\n    await reconcileEmployeeIdle(employeeId);\n    const pending = registry.require(employeeId).pendingModelSettings;\n    if (pending) await applyModelSettings(employeeId, pending);');
  replace('  const updateModelSettings = async (employeeId, settings = {}) => {', `  const updateModelSettings = (employeeId, settings = {}) => {
    const previous = modelChanges.get(employeeId);
    const task = (async () => {
      await previous?.catch(() => {});
      await openPromises.get(employeeId);
      if (sendLocks.has(employeeId)) throw statusError("员工正在处理消息，不能修改配置", 409);
      await reconcileEmployeeIdle(employeeId);
      if (statusFor(employeeId).active) throw statusError("员工正在处理消息，不能修改模型", 409);
      const employee = registry.require(employeeId);
      const selected = { ...employee, ...employee.pendingModelSettings, ...settings };
      const route = modelProviders.resolveRoute({ model: selected.model, modelProviderId: Object.hasOwn(settings, "model") ? settings.modelProviderId || "" : selected.modelProviderId });
      const pending = { modelProviderId: route.modelProviderId, model: route.model, reasoningEffort: selected.reasoningEffort };
      if (!employee.mainThreadId) return applyModelSettings(employeeId, pending);
      await registry.setPendingModelSettings(employeeId, pending);
      return { employee: { ...employee, ...pending }, status: statusFor(employeeId) };
    })();
    modelChanges.set(employeeId, task);
    return task.finally(() => { if (modelChanges.get(employeeId) === task) modelChanges.delete(employeeId); });
  };
  const applyModelSettings = async (employeeId, settings = {}) => {`);
  replace('const requestedProviderId = requestedModel && modelProviders && !explicitProviderId', 'const requestedProviderId = Object.hasOwn(settings, "model") && requestedModel && modelProviders && !explicitProviderId');
  replace(`    if (employee.mainThreadId && currentRoute.modelProviderId !== requestedRoute.modelProviderId) {
      throw statusError("现有员工 Thread 暂不支持跨供应商切换；请为新 Thread 选择该模型", 409);
    }`, '    const switchingProvider = currentRoute.modelProviderId !== requestedRoute.modelProviderId;');
  const start = source.indexOf('    if (employee.mainThreadId) {', source.indexOf('  const applyModelSettings'));
  const end = source.indexOf('    return { employee: updated, status: statusFor(employee.id) };', start);
  if (start < 0 || end < 0) throw Error('Employee model settings integration changed');
  source = source.slice(0, start) + `    const nextSettings = { modelProviderId: requestedRoute.modelProviderId, model: requestedRoute.model, reasoningEffort };
    const threadId = employee.mainThreadId;
    let originalClient;
    try {
      if (threadId) {
        originalClient = await clientForThread(threadId, employee);
        if (switchingProvider) {
          await transferEmployeeThread({ source: originalClient, target: runtimeClient, providers: modelProviders,
            threadId, route: requestedRoute,
            config: { ...taskService?.leaderConfig(employee.id), ...(reasoningEffort ? { model_reasoning_effort: reasoningEffort } : {}) },
            instructions: employeeTurnInstructions(employee.instructions, taskService?.leaderInstructions(employee.id)),
            policy: policyFor(employee),
          });
          threadClients.set(threadId, runtimeClient);
          freshThreads.delete(threadId);
          taskConfiguredClients.set(threadId, runtimeClient);
        } else {
          await resumeThread(threadId, employee);
          if (requestedRoute.model && requestedRoute.model !== currentRoute.model) {
            await runtimeClient.request("thread/settings/update", { threadId, model: requestedRoute.model });
          }
          if (reasoningEffort && reasoningEffort !== clean(employee.reasoningEffort, 40)) {
            await runtimeClient.request("thread/settings/update", { threadId, effort: reasoningEffort });
          }
          freshThreads.delete(threadId);
        }
      }
      const updated = await registry.setModelSettings(employee.id, nextSettings);
      return { employee: updated, status: statusFor(employee.id) };
    } catch (error) {
      if (switchingProvider && threadId && originalClient) {
        await runtimeClient.request("thread/unsubscribe", { threadId }).catch(() => {});
        threadClients.set(threadId, originalClient);
        freshThreads.delete(threadId);
        taskConfiguredClients.delete(threadId);
        await resumeThread(threadId, employee).catch(() => {});
      }
      throw error;
    }
` + source.slice(end + '    return { employee: updated, status: statusFor(employee.id) };'.length);
  // Reading settings uses the saved selection, without resuming the employee thread.
  replace('    const employee = registry.require(employeeId);\n    return {\n      model: employee.model || "",',
    '    const saved = registry.require(employeeId);\n    const employee = saved.pendingModelSettings || saved;\n    return {\n      model: employee.modelProviderId?.startsWith("ccswitch_") ? employee.modelProviderId + "::" + employee.model : employee.model || "",');
  return `import { transferEmployeeThread } from ${JSON.stringify(import.meta.url)};\n` + source;
}
