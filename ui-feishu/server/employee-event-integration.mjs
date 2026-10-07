// The execution tracker owns generic conversation events; employee events only update employee views.
export function adaptEmployeeRuntimeSource(source) {
  const replace = (before, after) => {
    if (!source.includes(before)) throw Error(`Employee event integration changed: ${before}`);
    source = source.replace(before, after);
  };
  replace('const publishStatus = (employeeId, patch = {}) => {', 'const publishStatus = (employeeId, patch = {}, syncExecution = true) => {');
  replace('if (threadId && execution?.publishStatus) {', 'if (syncExecution && threadId && execution?.publishStatus) {');
  const start = source.indexOf('  const handleProtocolMessage = (message) => {');
  const end = source.indexOf('  subscribeClient(defaultClient);', start);
  if (start < 0 || end < 0) throw Error('Employee event handler integration changed');
  let handler = source.slice(start, end);
  handler = handler.replace('    if (!employeeId) return;', `    if (!employeeId) return;
    execution?.handleProtocolMessage?.(message);
    const publishNativeStatus = patch => publishStatus(employeeId, patch, false);`)
    .replaceAll('publishStatus(employeeId, {', 'publishNativeStatus({');
  const duplicate = `      execution?.publishThreadEvent?.(threadId, {
        type: "assistant_delta",
        threadId,
        turnId: deltaEvent.turnId,
        itemId: deltaEvent.itemId,
        delta: deltaEvent.delta,
      });\n`;
  if (!handler.includes(duplicate)) throw Error('Employee delta integration changed');
  handler = handler.replace(duplicate, '');
  return source.slice(0, start) + handler + source.slice(end);
}
