import path from 'node:path';
import { setTransferredProvider } from '../../windows/server/provider-transfer.mjs';

export { setTransferredProvider } from '../../windows/server/provider-transfer.mjs';

// Move the native rollout, preserving the thread ID and complete history.
export async function transferEmployeeThread({ source, target, providers, threadId, route, reasoningEffort = "", config, instructions, policy }) {
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
    await setTransferredProvider(info.path, thread.path, threadId, modelProvider, threadId, {
      model: route.model, reasoningEffort,
    });
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
