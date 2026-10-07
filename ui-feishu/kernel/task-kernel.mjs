import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const terminalStates = new Set(['completed', 'failed', 'interrupted']);
const copy = value => structuredClone(value);
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });

/** Durable, channel-independent task queue. Runtime and message delivery are injected.
 * execute/observe return only when a native turn is terminal; checkpoint persists native IDs.
 * deliver MUST deduplicate by delivery.id. Startup never replays an ambiguous native start.
 */
export async function createTaskKernel({ stateFile, runtime, deliver, validate = () => {},
  broadcast = () => {}, log = () => {}, now = () => new Date().toISOString() }) {
  let state = { version: 1, tasks: [], deliveries: [] };
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state.version !== 1 || !Array.isArray(state.tasks) || !Array.isArray(state.deliveries)) throw new Error('任务记录格式错误');
  let writes = Promise.resolve();
  let closed = false;
  let scheduled = false;
  const running = new Map();
  const delivering = new Set();
  const notifications = new Set();
  const emit = event => {
    try { log(event); } catch {}
    try { broadcast({ type: 'tasks_changed', ...event }); } catch {}
  };
  // Commit a cloned state: failed writes cannot leak accepted tasks into memory.
  const mutate = operation => {
    if (closed) return Promise.reject(fail('任务服务已关闭'));
    const work = writes.then(async () => {
      const next = copy(state);
      const result = await operation(next);
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      const temporary = `${stateFile}.${randomUUID()}.tmp`;
      try {
        const file = await fs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(next)); await file.sync(); }
        finally { await file.close(); }
        await fs.rename(temporary, stateFile);
      } catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
      state = next;
      return copy(result);
    });
    writes = work.catch(() => {});
    return work;
  };
  const find = id => state.tasks.find(task => task.id === id);
  const requireTask = (data, id) => {
    const task = data.tasks.find(item => item.id === id);
    if (!task) throw fail('任务不存在', 404);
    return task;
  };
  const newTask = (input, requestKey) => ({ ...copy(input), id: randomUUID(), requestKey,
    state: ['external', 'followup'].includes(input.kind) ? 'recovering' : 'queued',
    runtime: ['external', 'followup'].includes(input.kind) ? copy(input.runtime || {}) : {},
    cancelRequested: false, createdAt: now(), updatedAt: now() });
  const complete = async (id, result) => {
    if (!terminalStates.has(result?.status)) throw new Error('运行适配器没有提供终态');
    const task = await mutate(data => {
      const current = requireTask(data, id);
      if (terminalStates.has(current.state)) return current;
      Object.assign(current, { state: result.status, result: String(result.text || ''), error: String(result.error || ''), updatedAt: now() });
      data.deliveries.push({ id: `result:${id}`, taskId: id, state: 'pending', attempts: 0 });
      return current;
    });
    emit({ event: 'task_terminal', taskId: id, state: task.state, conversationId: task.conversationId });
  };
  const checkpoint = (id, patch) => mutate(data => {
    const task = requireTask(data, id);
    if (terminalStates.has(task.state)) throw fail('任务已经结束');
    task.runtime = { ...task.runtime, ...copy(patch) };
    task.updatedAt = now();
    return task;
  });
  const execute = async (id, recovering) => {
    const controller = new AbortController();
    const entry = { controller, promise: null };
    running.set(id, entry);
    entry.promise = (async () => {
      try {
        const task = await mutate(data => {
          const current = requireTask(data, id);
          if (!terminalStates.has(current.state)) current.state = recovering ? 'recovering' : 'starting';
          current.updatedAt = now();
          return current;
        });
        if (terminalStates.has(task.state)) return;
        if (task.cancelRequested) controller.abort();
        const controls = {
          signal: controller.signal,
          checkpoint: patch => checkpoint(id, patch),
          started: async patch => {
            await mutate(data => {
              const current = requireTask(data, id);
              if (terminalStates.has(current.state)) return;
              Object.assign(current.runtime, copy(patch));
              current.state = current.cancelRequested ? 'stopping' : 'running';
              current.updatedAt = now();
            });
            emit({ event: 'task_started', taskId: id, conversationId: task.conversationId });
          },
          delegate: input => delegate(id, input),
        };
        const result = recovering ? await runtime.observe(task, controls) : await runtime.execute(task, controls);
        if (result?.status === 'unknown') {
          await mutate(data => { const current = requireTask(data, id); current.state = 'needs-reconciliation'; current.error = result.error || '执行状态待核对'; return current; });
          emit({ event: 'task_reconciliation_required', taskId: id });
        } else if (!closed) await complete(id, result);
      } catch (error) {
        if (closed) return;
        // Adapter must identify ambiguous side effects; unknown starts cannot be called failed or replayed.
        if (error.ambiguous || recovering) {
          await mutate(data => { const task = requireTask(data, id); task.state = 'needs-reconciliation'; task.error = error.message; });
          emit({ event: 'task_reconciliation_required', taskId: id });
        } else await complete(id, { status: 'failed', error: error.message });
      }
    })().catch(error => emit({ event: 'task_storage_failed', taskId: id, code: error.code || 'unknown' }))
      .finally(() => { running.delete(id); schedule(); });
    return entry.promise;
  };
  const dispatch = async deliveryId => {
    delivering.add(deliveryId);
    try {
      const delivery = await mutate(data => {
        const item = data.deliveries.find(item => item.id === deliveryId);
        item.state = 'delivering'; item.attempts += 1;
        const attempt = copy(item);
        delete item.retryRequested;
        return attempt;
      });
      const task = copy(find(delivery.taskId));
      const receipt = await deliver({ ...delivery, task });
      await mutate(data => {
        const item = data.deliveries.find(item => item.id === deliveryId);
        item.state = 'delivered'; item.receipt = receipt ?? null; item.error = '';
        // Result continuation is committed with delivery acknowledgment, with no parent/child lock held.
        const sourceStopped = data.tasks.find(candidate => candidate.id === task.parentTaskId)?.cancelRequested;
        if (task.replyTo && !task.suppressContinuation && !sourceStopped) {
          const key = `continuation:${task.id}`;
          if (!data.tasks.some(candidate => candidate.requestKey === key)) {
            data.tasks.push(newTask({ ...task.replyTo, parentTaskId: task.parentTaskId, resultOf: task.id,
              title: task.title, instructions: `外派任务结果（这是已有任务的反馈）：\n${task.title}\n状态：${task.state}\n${task.error || task.result}`,
              attachments: [], kind: 'continuation' }, key));
          }
        }
      });
      emit({ event: 'task_result_delivered', taskId: task.id, deliveryId });
    } catch (error) {
      await mutate(data => { const item = data.deliveries.find(item => item.id === deliveryId); item.state = 'failed'; item.error = error.message; });
      emit({ event: 'task_delivery_failed', deliveryId });
    } finally { delivering.delete(deliveryId); schedule(); }
  };
  function schedule() {
    if (closed || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (closed) return;
      const busy = new Set([...running.keys()].map(id => find(id)?.lane));
      // Unknown native activity keeps its own lane occupied until reconciliation confirms termination.
      for (const task of state.tasks) if (task.state === 'needs-reconciliation') busy.add(task.lane);
      for (const task of state.tasks) {
        if (!['queued', 'recovering'].includes(task.state) || busy.has(task.lane)) continue;
        busy.add(task.lane);
        void execute(task.id, task.state === 'recovering');
      }
      for (const delivery of state.deliveries) {
        if (delivery.state !== 'pending' || delivering.has(delivery.id)) continue;
        const promise = dispatch(delivery.id).catch(error => emit({ event: 'task_storage_failed', code: error.code || 'unknown' }));
        notifications.add(promise); void promise.finally(() => notifications.delete(promise));
      }
    });
  }
  const enqueue = async input => {
    if (closed) throw fail('任务服务已关闭');
    if (!input.requestKey || !input.lane || !input.conversationId || !input.agentId) throw fail('任务来源或执行员工不完整', 400);
    await validate(copy(input));
    const task = await mutate(data => {
      const existing = data.tasks.find(task => task.requestKey === input.requestKey);
      if (existing) return existing;
      if (input.kind === 'delegation') {
        const parent = requireTask(data, input.parentTaskId);
        if (terminalStates.has(parent.state) || parent.cancelRequested) throw fail('来源任务已结束或正在停止');
        const ancestors = [parent.id]; const seen = new Set();
        while (ancestors.length) {
          const id = ancestors.pop(); if (!id || seen.has(id)) continue; seen.add(id);
          const ancestor = data.tasks.find(task => task.id === id); if (!ancestor) continue;
          if (ancestor.kind === 'delegation' && ancestor.agentId === input.agentId
            && ancestor.instructions.trim() === input.instructions.trim()) throw fail('这项工作已在当前交接链中派发，请读取已有结果或补充新的要求');
          ancestors.push(ancestor.parentTaskId, ancestor.resultOf);
        }
      }
      const task = newTask(input, input.requestKey);
      data.tasks.push(task);
      return task;
    });
    emit({ event: 'task_accepted', taskId: task.id, conversationId: task.conversationId, agentId: task.agentId });
    schedule();
    return task;
  };
  async function delegate(parentId, input) {
    const parent = find(parentId);
    if (!parent || terminalStates.has(parent.state) || parent.cancelRequested) throw fail('来源任务已结束或正在停止');
    if (!input.requestId || !input.instructions?.trim() || !input.title?.trim()) throw fail('交接标识、任务标题和要求不能为空', 400);
    const target = { ...input, conversationId: input.conversationId || parent.conversationId,
      lane: input.lane || `${input.conversationId || parent.conversationId}:${input.agentId}`,
      requestKey: `handoff:${parentId}:${input.requestId}`, parentTaskId: parentId, kind: 'delegation',
      replyTo: { conversationId: parent.conversationId, agentId: parent.agentId, lane: parent.lane, source: parent.source,
        resumeThreadId: parent.runtime.threadId },
      source: input.source || parent.source };
    delete target.requestId;
    return enqueue(target);
  }
  const cancel = async (id, { suppressContinuation = false } = {}) => {
    const task = await mutate(data => {
      const task = requireTask(data, id);
      if (terminalStates.has(task.state)) return task;
      if (suppressContinuation) task.suppressContinuation = true;
      task.cancelRequested = true; task.updatedAt = now();
      if (task.state === 'queued') {
        task.state = 'interrupted'; task.result = ''; task.error = '';
        data.deliveries.push({ id: `result:${id}`, taskId: id, state: 'pending', attempts: 0 });
      } else if (task.state !== 'needs-reconciliation') task.state = 'stopping';
      return task;
    });
    running.get(id)?.controller.abort();
    if (!terminalStates.has(task.state)) await runtime.cancel?.(task);
    emit({ event: 'task_stop_requested', taskId: id });
    schedule();
    return copy(find(id));
  };
  // Persist the recovery decision before accepting new messages.
  await mutate(data => {
    for (const task of data.tasks) if (['starting', 'running', 'stopping', 'recovering'].includes(task.state)) task.state = 'recovering';
    for (const delivery of data.deliveries) if (delivery.state === 'delivering') delivery.state = 'pending';
  });
  const recoveryTimer = setInterval(() => {
    if (closed || !state.tasks.some(task => task.state === 'needs-reconciliation')) return;
    void mutate(data => {
      for (const task of data.tasks) if (task.state === 'needs-reconciliation') task.state = 'recovering';
    }).then(schedule).catch(error => emit({ event: 'task_recovery_failed', code: error.code || 'unknown' }));
  }, 15000);
  recoveryTimer.unref?.();
  schedule();
  return {
    enqueue, delegate, cancel,
    list: () => copy(state.tasks), deliveries: () => copy(state.deliveries), get: id => copy(find(id)),
    hasPendingWork: () => state.tasks.some(task => !terminalStates.has(task.state)),
    retryDelivery: async id => { await mutate(data => {
      const delivery = data.deliveries.find(item => item.id === id);
      if (!delivery) throw fail('结果通知不存在', 404);
      if (delivery.state === 'failed') { delivery.state = 'pending'; delivery.retryRequested = true; }
    }); schedule(); },
    reconcile: async id => { await mutate(data => {
      const task = requireTask(data, id);
      if (task.state === 'needs-reconciliation') task.state = 'recovering';
    }); schedule(); },
    // Detach without cancelling native work: the next instance must observe its authoritative state.
    close: async () => { closed = true; clearInterval(recoveryTimer); runtime.detach?.(); await writes; await Promise.allSettled([...notifications]); await writes; },
  };
}
