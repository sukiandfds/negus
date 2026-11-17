import { createHash } from 'node:crypto';

export async function followupTask({ kernel, source, target, input, queue, execution, clientFor, providerForThread, actor, attachments = [] }) {
  if (!target?.runtime.threadId || !input.requestId || !input.instructions?.trim())
    throw Object.assign(Error('不能继续此后台任务'), { statusCode: 403 });
  const threadId = target.runtime.threadId;
  const attachmentIds = attachments.map(file => file.id);
  const submissionId = `handoff:${createHash('sha256').update(`${target.id}:${input.requestId}`).digest('hex').slice(0, 32)}`;
  const prior = target.inputs?.find(item => item.requestId === input.requestId);
  if (prior) {
    if (prior.cancelled) throw Object.assign(Error('该续派已停止'), { statusCode: 409 });
    if (prior.text !== input.instructions) throw Object.assign(Error('交接标识已用于其他内容'), { statusCode: 409 });
    if (JSON.stringify(prior.attachmentIds || []) !== JSON.stringify(attachmentIds)) throw Object.assign(Error('交接标识已用于其他附件'), { statusCode: 409 });
    const pending = queue.list(threadId).find(item => item.submissionId === submissionId);
    if (prior.accepted && !pending) {
      const client = await clientFor({ modelProviderId: target.runtime.modelProviderId || await providerForThread(threadId), model: '' });
      const history = await client.request('thread/read', { threadId, includeTurns: true });
      const confirmed = history.thread?.turns?.some(turn => turn.items?.some(item => item.type === 'userMessage'
        && (item.clientId === submissionId || item.clientUserMessageId === submissionId)));
      return { taskId: target.id, threadId, submissionId, status: confirmed ? 'confirmed' : 'needs-reconciliation' };
    }
    if (pending && !pending.held) return { taskId: target.id, threadId, submissionId, status: pending.state };
  }
  if (!prior) await kernel.recordInput(target.id, { requestId: input.requestId, submissionId, text: input.instructions, sourceTaskId: source.id, actor, attachmentIds });
  const held = await queue.enqueue({ threadId, submissionId, stableDispatchId: submissionId, text: input.instructions, attachmentIds, attachments, held: true });
  await kernel.acceptInput(target.id, input.requestId);
  let receipt = await queue.release(threadId, held.id);
  const status = execution.getStatus(threadId);
  if (status.active && status.turnId && queue.sendNow) receipt = await queue.sendNow(threadId, receipt.id);
  return { taskId: target.id, threadId, submissionId, status: receipt.state };
}
