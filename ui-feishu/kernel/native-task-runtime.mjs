const terminal = new Set(['completed', 'failed', 'interrupted']);
const resultFrom = turn => ({ status: turn.status,
  text: (turn.items || []).filter(item => item.type === 'agentMessage' && item.phase !== 'commentary').map(item => item.text || '').join('\n'),
  error: turn.error?.message || '' });

// Shared protocol adapter. resolve supplies the existing provider/client and channel context.
export function createNativeTaskRuntime({ resolve, onEvent = () => {}, log = () => {}, healthIntervalMs = 10000 }) {
  const active = new Map();
  const trace = event => { try { log(event); } catch {} };
  const run = async (task, controls, recovering) => {
    if (recovering && !task.runtime.turnId) {
      if (!task.runtime.starting) return { status: 'interrupted', text: '', error: '服务在任务启动前退出' };
      if (!Array.isArray(task.runtime.previousTurnIds)) return { status: 'unknown', error: '缺少本次执行前的历史记录，无法确认执行结果' };
    }
    const prepared = await resolve(task, controls, { recovering });
    const { client, threadId, input, turnOptions = {}, previousTurnIds = [] } = prepared;
    if (!threadId) return recovering && !task.runtime.starting
      ? { status: 'interrupted', text: '', error: '服务在任务启动前退出' }
      : recovering ? { status: 'unknown', error: '尚未确认原任务的会话编号' } : { status: 'failed', error: '无法建立执行会话' };
    let turnId = recovering ? task.runtime.turnId || '' : '';
    let startRequested = false;
    let text = '';
    let ended = false;
    let announcePromise;
    let interrupting = false;
    let serial = Promise.resolve();
    let resolveResult;
    const completion = new Promise(resolve => { resolveResult = resolve; });
    const started = () => announcePromise ||= (async () => {
      await controls.started({ threadId, turnId });
      await prepared.onStarted?.();
    })();
    const ignored = new Set(recovering ? task.runtime.previousTurnIds || [] : previousTurnIds);
    const finish = result => { if (!ended) { ended = true; resolveResult(result); } };
    const interrupt = async () => {
      if (ended || !turnId || interrupting) return;
      interrupting = true;
      try { await client.request('turn/interrupt', { threadId, turnId }); }
      catch (error) { interrupting = false; trace({ event: 'native_interrupt_failed', taskId: task.id }); throw error; }
    };
    const queue = operation => {
      serial = serial.then(operation).catch(error => finish({ status: 'unknown', error: error.message }));
    };
    const unsubscribe = client.subscribe(event => {
      const { method, params = {} } = event || {};
      if (ended || params.threadId !== threadId) return;
      const eventTurnId = params.turn?.id || params.turnId;
      if (eventTurnId && (ignored.has(eventTurnId) || (turnId && eventTurnId !== turnId))) return;
      // Do not attach unscoped item events to a new run.
      if (!eventTurnId) return;
      queue(async () => {
        if (ended || (turnId && eventTurnId !== turnId)) return;
        if (!turnId) {
          // Recovery identifies a unique candidate from history, never from an arbitrary arriving event.
          if (recovering || !startRequested || method !== 'turn/started') return;
          turnId = eventTurnId;
        }
        if (method === 'turn/started') {
          await started();
          if (controls.signal.aborted) await interrupt();
        }
        if (method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') text = params.item.text || '';
        await onEvent(task, event);
        if (method === 'turn/completed') {
          const result = resultFrom(params.turn || {});
          if (!terminal.has(result.status)) { finish({ status: 'unknown', error: '运行时返回了未知结束状态' }); return; }
          finish({ ...result, text: result.text || text });
        }
      });
    });
    const check = async () => {
      const value = await client.request('thread/read', { threadId, includeTurns: true });
      const turns = value.thread?.turns || [];
      const candidates = turns.filter(turn => turn.id && (turnId ? turn.id === turnId : !ignored.has(turn.id)));
      if (candidates.length > 1) return { status: 'unknown', error: '发现多次可能的执行，无法确认本次任务结果' };
      const found = candidates[0];
      const idle = value.thread?.status?.type === 'idle' || value.thread?.status === 'idle';
      if ((recovering || turnId) && idle && (!found || !terminal.has(found.status))) return {
        status: 'interrupted', text: found ? resultFrom(found).text : '', error: '原执行已不在运行，任务未自动重复启动',
      };
      if (!found) return { status: 'unknown', error: '尚未在原会话中确认这次执行' };
      if (!turnId) {
        await controls.checkpoint({ threadId, turnId: found.id });
        turnId = found.id;
      }
      if (terminal.has(found.status)) return resultFrom(found);
      if (value.thread?.status?.type === 'notLoaded') return { status: 'unknown', error: '原执行会话已断开，正在等待状态核对' };
      await started();
      if (controls.signal.aborted) await interrupt();
      return null;
    };
    const unsubscribeHealth = client.subscribeHealth?.(event => {
      if (!['recovering', 'recovered', 'failed'].includes(event.phase) || ended) return;
      queue(async () => { const result = await check(); if (result) finish(result); });
    });
    const aborted = () => { void interrupt().catch(() => {}); };
    controls.signal.addEventListener('abort', aborted);
    active.set(task.id, { interrupt, finish });
    let checking = false;
    const healthTimer = setInterval(() => {
      if (ended || checking || (!turnId && !recovering)) return;
      checking = true;
      queue(async () => {
        try { const result = await check(); if (result) finish(result); }
        finally { checking = false; }
      });
    }, healthIntervalMs);
    healthTimer.unref?.();
    try {
      if (recovering) {
        const result = await check();
        if (result) return result;
      } else {
        if (controls.signal.aborted) return { status: 'interrupted', text: '' };
        // Persist intent before the side effect. Lost RPC acknowledgment is reconciled, never replayed.
        await controls.checkpoint({ threadId, starting: true, previousTurnIds });
        startRequested = true;
        try {
          const response = await client.request('turn/start', { ...turnOptions, threadId, input });
          if (!response?.turn?.id) throw Error('运行时没有返回执行编号');
          turnId ||= response.turn.id;
          await started();
          if (controls.signal.aborted) await interrupt();
          if (terminal.has(response.turn.status)) finish(resultFrom(response.turn));
        } catch (error) {
          trace({ event: 'native_start_reconcile', taskId: task.id });
          try { const result = await check(); if (result) return result; }
          catch { throw Object.assign(new Error(error.message), { ambiguous: true }); }
        }
      }
      return await completion;
    } finally {
      clearInterval(healthTimer);
      unsubscribe?.(); unsubscribeHealth?.(); controls.signal.removeEventListener('abort', aborted); active.delete(task.id);
    }
  };
  return {
    execute: (task, controls) => run(task, controls, false),
    observe: (task, controls) => run(task, controls, true),
    cancel: async task => { await active.get(task.id)?.interrupt(); },
    detach: () => { for (const run of active.values()) run.finish({ status: 'unknown', error: '服务正在关闭，执行状态将在启动时核对' }); },
  };
}
