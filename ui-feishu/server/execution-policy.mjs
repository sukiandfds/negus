// One product policy for ordinary chats, employees, groups, and delegated work.
// `sandbox` is used by thread/start and thread/resume. Native turn/start uses
// the protocol's sandboxPolicy spelling, so keep both forms explicit at the
// call sites that bypass the client adapter.
export const executionPolicy = { sandbox: 'danger-full-access', approvalPolicy: 'never' };
export const turnExecutionPolicy = { sandboxPolicy: { type: 'dangerFullAccess' }, approvalPolicy: 'never' };

export function executionParams(method, params, runtimeConfig = {}) {
  if (method === 'turn/start') return { ...params, approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } };
  if (!['thread/start', 'thread/resume', 'thread/fork'].includes(method)) return params;
  // Do not inject per-tool approval modes. They override the host policy and
  // were the source of employee turns getting stuck waiting for approval.
  return { ...params, ...executionPolicy };
}

export function adaptExecutionClientSource(source) {
  const marker = '    return requestRaw(method, params, options.timeoutMs);';
  if (!source.includes(marker)) throw Error('Execution policy integration changed');
  return `import { executionParams } from ${JSON.stringify(import.meta.url)};\n` + source.replace(marker, `
    return requestRaw(method, executionParams(method, params), options.timeoutMs);`);
}
