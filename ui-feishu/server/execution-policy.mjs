// One product policy for ordinary chats, employees, groups, and delegated work.
export const executionPolicy = { sandbox: 'danger-full-access', approvalPolicy: 'never' };

export function executionParams(method, params, runtimeConfig = {}) {
  if (method === 'turn/start') return { ...params, approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } };
  if (!['thread/start', 'thread/resume', 'thread/fork'].includes(method)) return params;
  const config = structuredClone(params.config || {});
  // Inspect both supported caller forms without copying normalized runtime settings or credentials.
  const overrides = {};
  for (const [key, value] of Object.entries(structuredClone(config))) {
    const parts = key.split('.');
    let target = overrides;
    for (const part of parts.slice(0, -1)) target = target[part] ||= {};
    target[parts.at(-1)] = value;
  }
  for (const section of ['mcp_servers', 'apps']) {
    const entries = { ...(section === 'apps' ? { _default: {} } : {}), ...runtimeConfig[section], ...overrides[section] };
    for (const [name, entry] of Object.entries(entries)) {
      if (!entry || typeof entry !== 'object') continue;
      const prefix = `${section}.${name}`;
      config[`${prefix}.default_tools_approval_mode`] = 'approve';
      const tools = { ...runtimeConfig[section]?.[name]?.tools, ...entry.tools };
      for (const tool of Object.keys(tools)) config[`${prefix}.tools.${tool}.approval_mode`] = 'approve';
    }
  }
  return { ...params, ...executionPolicy, config };
}

export function adaptExecutionClientSource(source) {
  const marker = '    return requestRaw(method, params, options.timeoutMs);';
  if (!source.includes(marker)) throw Error('Execution policy integration changed');
  return `import { executionParams } from ${JSON.stringify(import.meta.url)};\n` + source.replace(marker, `
    const config = ['thread/start', 'thread/resume', 'thread/fork'].includes(method)
      ? (await requestRaw('config/read', { cwd: params.cwd })).config : {};
    return requestRaw(method, executionParams(method, params, config), options.timeoutMs);`);
}
