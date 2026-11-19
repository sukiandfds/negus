import path from 'node:path';
import fs from 'node:fs/promises';
import { removeTransferredThread, setTransferredProvider } from '../../windows/server/provider-transfer.mjs';
import { latestRolloutFile } from '../../windows/server/rollout-file.mjs';

export { setTransferredProvider } from '../../windows/server/provider-transfer.mjs';

const canonicalPath = async file => file && fs.realpath(file).catch(() => path.resolve(file));

// Reuse the native rollout for provider changes. Employee main chats supply
// a fresh runtime ID and keep their public thread ID separately.
export async function transferEmployeeThread({ source, target, providers, threadId, nextThreadId = threadId, route, reasoningEffort = "", config, instructions, policy }) {
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
  const fresh = nextThreadId !== threadId;
  if (!fresh) await source.request('thread/unsubscribe', { threadId });
  let resumed = false;
  let info;
  const discard = async () => {
    if (resumed || fresh) await target.request('thread/unsubscribe', { threadId: nextThreadId }).catch(() => {});
    if (!fresh || !info?.path || path.resolve(info.path) === path.resolve(thread.path)) return;
    const files = new Set([info.path, await latestRolloutFile(info.path)]);
    for (const file of files) {
      await removeTransferredThread(file, nextThreadId).catch(() => {});
      await fs.rm(file, { force: true }).catch(() => {});
    }
  };
  try {
    info = await providers.prepareResumeFile(route.modelProviderId,
      fresh ? { ...thread, path: await latestRolloutFile(thread.path) } : thread,
      new Set(), fresh ? { threadId: nextThreadId } : undefined);
    // A prior visit to this provider may still have this thread cached.
    if (!fresh) await target.request('thread/unsubscribe', { threadId });
    await setTransferredProvider(info.path, thread.path, threadId, modelProvider, nextThreadId, {
      model: route.model, reasoningEffort,
    });
    const result = await target.request('thread/resume', {
      threadId: nextThreadId, path: info.path, cwd: thread.cwd, model: route.model, modelProvider,
      config, developerInstructions: instructions, excludeTurns: fresh, persistExtendedHistory: true, ...policy,
    });
    resumed = true;
    if (result.thread?.id !== nextThreadId || await canonicalPath(result.thread.cwd) !== await canonicalPath(thread.cwd)
      || (fresh && await canonicalPath(result.thread.path) !== await canonicalPath(info.path))) {
      throw Error('员工原对话恢复校验失败，未切换配置');
    }
    if (!fresh) return result;
    await compactEmployeeHandoff(target, nextThreadId);
    return { ...result, discard };
  } catch (error) {
    await discard();
    throw error;
  }
}

// A compact request acknowledges scheduling. Wait for the native turn before sending.
async function compactEmployeeHandoff(client, threadId) {
  const { promise, resolve, reject } = Promise.withResolvers();
  void promise.catch(() => {});
  let turnId;
  const unsubscribe = client.subscribe(({ method, params }) => {
    if (params?.threadId !== threadId) return;
    if (method === 'turn/started') turnId ||= params.turn?.id;
    if (method !== 'turn/completed' || (turnId && params.turn?.id !== turnId)) return;
    if (params.turn?.status === 'completed') resolve();
    else reject(new Error(params.turn?.error?.message || '员工对话接续失败，请重试'));
  });
  const timer = setTimeout(() => {
    if (turnId) void client.request('turn/interrupt', { threadId, turnId }).catch(() => {});
    reject(new Error('员工对话接续超时，请重试'));
  }, 120000);
  try {
    await client.request('thread/compact/start', { threadId });
    await promise;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}
