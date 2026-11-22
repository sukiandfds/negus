import { interruptTurn } from "./execution/protocol.mjs";
import path from 'node:path';
import fs from 'node:fs/promises';
import { removeTransferredThread, setTransferredProvider } from './provider-transfer.mjs';
import { latestRolloutFile } from './rollout-file.mjs';

const canonicalPath = async file => file && fs.realpath(file).catch(() => path.resolve(file));

// Reuse the native rollout for provider changes. Employee main chats supply
// a fresh runtime ID and keep their public thread ID separately.
export async function transferConversationThread({ source, target, providers, threadId, nextThreadId = threadId, route, reasoningEffort = "", config, instructions, policy, sourceInfo, resume }) {
  let thread = sourceInfo;
  if (!thread) try { ({ thread } = await source.request('thread/read', { threadId, includeTurns: false })); }
  catch (error) {
    if (!/thread not loaded/i.test(String(error.message))) throw error;
    ({ thread } = await source.request('thread/resume', { threadId, persistExtendedHistory: true, ...policy }));
  }
  if (thread?.status?.type === 'active') throw Object.assign(new Error('对话正在处理消息，不能修改配置'), { statusCode: 409 });
  if (!thread?.path || !path.isAbsolute(thread.path) || !thread.cwd) throw Error('无法找到原对话记录，未切换配置');
  const native = !resume && route.modelProviderId === 'current' ? (await target.request('config/read', { cwd: thread.cwd })).config : {};
  const modelProvider = !resume && route.modelProviderId === 'current' ? native.model_provider || 'openai' : route.modelProviderId;
  const fresh = nextThreadId !== threadId;
  if (!fresh && source) await source.request('thread/unsubscribe', { threadId });
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
    info = providers.prepareResumeFile ? await providers.prepareResumeFile(route.modelProviderId,
      fresh ? { ...thread, path: await latestRolloutFile(thread.path) } : thread,
      new Set(), fresh ? { threadId: nextThreadId } : undefined) : thread;
    // A prior visit to this provider may still have this thread cached.
    if (!fresh && !resume) await target.request('thread/unsubscribe', { threadId });
    await setTransferredProvider(info.path, thread.path, threadId, modelProvider, nextThreadId, {
      model: route.model, reasoningEffort, bindCopiedPath: Boolean(resume),
    });
    if (resume) {
      await resume(nextThreadId, { ...info, model: route.model, modelProvider: route.modelProviderId === 'current' ? undefined : route.modelProviderId, reasoningEffort, strictPath: true });
      if (target) {
        resumed = true;
        await compactHandoff(target, nextThreadId);
      }
      return info;
    }
    const result = await target.request('thread/resume', {
      threadId: nextThreadId, path: info.path, cwd: thread.cwd, model: route.model, modelProvider,
      config, developerInstructions: instructions, excludeTurns: fresh, persistExtendedHistory: true, ...policy,
    });
    resumed = true;
    if (result.thread?.id !== nextThreadId || await canonicalPath(result.thread.cwd) !== await canonicalPath(thread.cwd)
      || (fresh && await canonicalPath(result.thread.path) !== await canonicalPath(info.path))) {
      throw Error('原对话恢复校验失败，未切换配置');
    }
    if (!fresh) return result;
    await compactHandoff(target, nextThreadId);
    return { ...result, discard };
  } catch (error) {
    await discard();
    throw error;
  }
}

// A compact request acknowledges scheduling. Wait for the native turn before sending.
async function compactHandoff(client, threadId) {
  const { promise, resolve, reject } = Promise.withResolvers();
  void promise.catch(() => {});
  let turnId;
  const unsubscribe = client.subscribe(({ method, params }) => {
    if (params?.threadId !== threadId) return;
    if (method === 'turn/started') turnId ||= params.turn?.id;
    if (method !== 'turn/completed' || (turnId && params.turn?.id !== turnId)) return;
    if (params.turn?.status === 'completed') resolve();
    else reject(new Error(params.turn?.error?.message || '对话接续失败，请重试'));
  });
  const timer = setTimeout(() => {
    if (turnId) void interruptTurn(client, threadId, turnId).catch(() => {});
    reject(new Error('对话接续超时，请重试'));
  }, 120000);
  try {
    await client.request('thread/compact/start', { threadId });
    await promise;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}
