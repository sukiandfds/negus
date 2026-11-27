import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { optimisticMessageId, submissionIdOf } from './message-identity.mjs';

// Keep upstream bodies, headers, URLs and credentials out of the ledger.
export function modelFailure(error) {
  const message = String(error?.message || error || '');
  const detail = error?.data;
  const information = error?.codexErrorInfo ?? detail?.codexErrorInfo;
  const httpStatus = Number(error?.httpStatus ?? error?.httpStatusCode ?? detail?.httpStatus ?? detail?.httpStatusCode ??
    (information && typeof information==='object' && Object.values(information).find(v=>v?.httpStatusCode)?.httpStatusCode));
  const status = httpStatus || Number(error?.statusCode ?? error?.status);
  if (error?.code === 'MODEL_CHANNEL_BALANCE') return { code: 'channel_unavailable', reason: '所选计费渠道因余额不足已停用' };
  const rateLimited = status === 429 || (!httpStatus && /\b429\b|rate.?limit|限流/iu.test(message));
  const timedOut = status === 408 || error?.name === 'TimeoutError' || (!httpStatus && /timeout|timed out|超时/iu.test(message));
  const balance = status === 402 || (!httpStatus && !rateLimited && !timedOut &&
    /\b402\b(?=\s*(?:payment required|insufficient balance|\)|:|$))|\binsufficient[_ ](?:account[_ ])?balance\b|余额不足/iu.test(message));
  if (balance) return { code: 'balance', reason: '计费渠道余额不足（402）' };
  if (rateLimited) return { code: 'rate_limit', reason: '渠道请求受到限流，请稍后重试' };
  if (timedOut) return { code: 'timeout', reason: '渠道请求超时，请重试' };
  if ([401, 403].includes(status) || /\b(?:401|403)\b|unauthori[sz]ed|invalid (?:api key|token)|凭据|鉴权/iu.test(message)) return { code: 'authentication', reason: '渠道认证失败，请核对配置' };
  return { code: 'execution_failed', reason: '渠道执行失败，请重试或核对配置' };
}

export const finalModelError = (method, params) =>
  method === 'error' && params?.willRetry === false && Boolean(params.error && (params.turnId || params.turn?.id));

function messageAttachments(attachments) {
  // The existing upload service exposes media by ID. Do not store local paths,
  // signed URLs or inspection errors from the input object.
  return (attachments || []).filter(({ id, url }) => id && typeof url === 'string' &&
    /^\/api\/media\/[\w.-]+(?:\?w=\d+&h=\d+)?$/u.test(url))
    .map(({ id, name, mimeType, url, width, height }) => ({ id, name, mimeType, url,
      ...(Number.isSafeInteger(width) && Number.isSafeInteger(height) ? { width, height } : {}) }));
}

export function createModelExecutionRecords(file) {
  let db;
  const store = () => {
    if (db) return db;
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    db.exec(`
      PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS unavailable (channel TEXT PRIMARY KEY, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS successful (thread TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (
        thread TEXT NOT NULL, submission TEXT NOT NULL, task TEXT NOT NULL, turn TEXT NOT NULL,
        state TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread,submission,task)
      );
      CREATE INDEX IF NOT EXISTS attempts_turn ON attempts(thread,turn);
      CREATE INDEX IF NOT EXISTS attempts_task ON attempts(task);
    `);
    return db;
  };
  const hasStore = () => Boolean(db) || existsSync(file);
  const disabled = (channel, account = '') => channel && hasStore()
    ? store().prepare('SELECT at FROM unavailable WHERE channel IN (?,?) ORDER BY at LIMIT 1').get(channel, account) : null;
  const upsert = row => store().prepare(`INSERT INTO attempts VALUES(?,?,?,?,?,?)
    ON CONFLICT(thread,submission,task) DO UPDATE SET turn=excluded.turn,state=excluded.state,data=excluded.data`)
    .run(row.threadId, row.submissionId, row.taskId, row.turnId, row.state, JSON.stringify(row));
  const normalize = input => ({
    threadId: input.threadId || '', submissionId: input.submissionId || '', taskId: input.taskId || '',
    turnId: input.turnId || '', modelProviderId: input.modelProviderId || '', billingChannelId: input.billingChannelId || '',
    ...(input.billingAccountId ? { billingAccountId: input.billingAccountId } : {}),
    model: input.model || '', ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.attachments?.length ? { attachments: messageAttachments(input.attachments) } : {}),
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    createdAt: input.createdAt || new Date().toISOString(),
  });
  const fail = (input, error) => {
    const row = { ...normalize(input), state: 'failed', ...modelFailure(error) };
    const data = store();
    data.exec('BEGIN IMMEDIATE');
    try {
      if (row.code === 'balance' && row.billingChannelId) {
        const disable = data.prepare('INSERT OR IGNORE INTO unavailable VALUES(?,?)');
        const at = new Date().toISOString();
        for (const identity of new Set([row.billingChannelId, row.modelProviderId, row.billingAccountId]))
          if (identity && (identity !== 'current' || !row.billingAccountId)) disable.run(identity, at);
      }
      if (row.submissionId || row.taskId) upsert(row);
      data.exec('COMMIT');
    } catch (failure) { data.exec('ROLLBACK'); throw failure; }
    return row;
  };
  const active = input => { if (input.submissionId || input.taskId) upsert({ ...normalize(input), state: 'running' }); };
  const rememberSuccess = (threadId, settings, seed = false) => store()
    .prepare(`INSERT ${seed ? 'OR IGNORE' : 'OR REPLACE'} INTO successful VALUES(?,?)`).run(threadId,JSON.stringify(settings));
  const lastSuccess = threadId => {
    const row = hasStore() && store().prepare('SELECT data FROM successful WHERE thread=?').get(threadId);
    return row ? JSON.parse(row.data) : null;
  };
  const terminal = (threadId, turnId, error, { failed = false, completed = false } = {}) => {
    if (!threadId || !turnId || !hasStore()) return false;
    const data = store();
    const rows = data.prepare("SELECT data FROM attempts WHERE thread=? AND turn=? AND state='running'").all(threadId, turnId);
    if (failed) for (const row of rows) fail(JSON.parse(row.data), error);
    else if (rows.length) {
      const row = JSON.parse(rows[0].data);
      if (completed && row.model) rememberSuccess(threadId, {model:row.model,modelProviderId:row.modelProviderId,reasoningEffort:row.reasoningEffort || ''});
      data.prepare("DELETE FROM attempts WHERE thread=? AND turn=? AND state='running'").run(threadId, turnId);
    }
    return rows.length > 0;
  };
  const list = thread => hasStore() ? store().prepare('SELECT data FROM attempts WHERE thread=? ORDER BY rowid').all(thread).map(row => JSON.parse(row.data)) : [];
  const task = id => {
    if (!hasStore()) return null;
    const row = store().prepare("SELECT data FROM attempts WHERE task=? AND state='failed' ORDER BY rowid DESC LIMIT 1").get(id);
    return row && JSON.parse(row.data);
  };
  const revision = thread => hasStore() ? store().prepare("SELECT COUNT(*) AS count FROM attempts WHERE thread=? AND state='failed'").get(thread).count || '' : '';
  const observe = (input, client, nativeThreadId) => {
    const ended = new Map();
    const unsubscribe = client?.subscribe?.(({ method, params }) => {
      if (params?.threadId !== nativeThreadId) return;
      const id = params.turn?.id || params.turnId;
      if (!id || ended.has(id)) return;
      if (finalModelError(method, params)) ended.set(id, { status: 'failed', error: params.error });
      else if (method === 'turn/completed') ended.set(id, params.turn);
    });
    return { accept(turnId, immediateTurn) {
      if (!turnId) return;
      const turn = ended.get(turnId) || (['failed','completed','interrupted'].includes(immediateTurn?.status) && immediateTurn);
      if (!turn) active({ ...input, turnId });
      else if (turn.status === 'failed' || turn.error && turn.status !== 'interrupted') fail({ ...input, turnId }, turn.error);
    }, close: () => unsubscribe?.() };
  };
  return { disabled, fail, active, terminal, list, task, revision, observe, rememberSuccess, lastSuccess,
    close: () => { if (db) { db.close(); db = null; } } };
}

export function withModelFailures(session, records, { recent = false } = {}) {
  if (!session || !records?.length || !Array.isArray(session.messages)) return session;
  const failures = records.filter(row => row.state === 'failed' && row.submissionId && !row.taskId);
  if (!failures.length) return session;
  const bySubmission = new Map(failures.map(row => [row.submissionId, row]));
  const mark = (message, row) => ({ ...message, deliveryState: 'failed', deliveryError: row.reason });
  const messages = session.messages.map(message => {
    const row = message.role === 'user' && bySubmission.get(submissionIdOf(message));
    if (!row) return message;
    bySubmission.delete(row.submissionId);
    return mark(message, row);
  });
  const oldest = Date.parse(messages[0]?.createdAt || '');
  if (recent) for (const row of bySubmission.values()) {
    if (row.text === undefined || (session.hasMore && (row.turnId || Date.parse(row.createdAt) < oldest))) continue;
    const message = mark({ id: optimisticMessageId(row.submissionId), role: 'user', text: row.text,
      createdAt: row.createdAt, turnId: row.turnId || undefined, submissionId: row.submissionId,
      ...(row.attachments?.length ? { attachments: row.attachments } : {}) }, row);
    const index = messages.findIndex(existing=>Date.parse(existing.createdAt) > Date.parse(row.createdAt));
    if (index < 0) messages.push(message);
    else messages.splice(index,0,message);
  }
  return { ...session, messages, ...(!session.hasMore ? { messageCount: messages.length } : {}) };
}
