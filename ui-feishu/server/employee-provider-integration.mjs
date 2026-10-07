import path from 'node:path';

// Move the native rollout, preserving the thread ID and complete history.
export async function transferEmployeeThread({ source, target, providers, threadId, route, config, instructions, policy }) {
  const { thread } = await source.request('thread/read', { threadId, includeTurns: false });
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
  replace('  const sendMessage = async ({ employeeId, text, requestId = "" }) => {', '  const sendMessage = async ({ employeeId, text, requestId = "" }) => {\n    await modelChanges.get(employeeId);\n    await reconcileEmployeeIdle(employeeId);');
  replace('  const updateModelSettings = async (employeeId, settings = {}) => {', `  const updateModelSettings = (employeeId, settings = {}) => {
    const previous = modelChanges.get(employeeId);
    const task = (async () => {
      await previous?.catch(() => {});
      await openPromises.get(employeeId);
      if (sendLocks.has(employeeId)) throw statusError("员工正在处理消息，不能修改配置", 409);
      await reconcileEmployeeIdle(employeeId);
      return applyModelSettings(employeeId, settings);
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
        await resumeThread(threadId, employee);
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
  // Return a provider-qualified model to the shared model picker after reload.
  replace('model: result?.model || employee.model || "",', 'model: employee.modelProviderId?.startsWith("ccswitch_") ? employee.modelProviderId + "::" + (result?.model || employee.model) : result?.model || employee.model || "",');
  replace('modelProvider: result?.modelProvider || employee.modelProviderId || CURRENT_MODEL_PROVIDER_ID,', 'modelProvider: employee.modelProviderId || CURRENT_MODEL_PROVIDER_ID,');
  return `import { transferEmployeeThread } from ${JSON.stringify(import.meta.url)};\n` + source;
}
