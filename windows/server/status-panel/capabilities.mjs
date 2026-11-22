import guides from '../tool-guides/catalog.json' with { type: 'json' };

// Only structured runtime actions enter the panel. Never infer an invocation from chat prose.
export function capabilities(type, name = '', args = {}) {
  const tools = [];
  const add = (kind, label) => tools.push({ kind, label });
  const tail = name.split(/__|\./).at(-1);
  if (['mcpToolCall','dynamicToolCall'].includes(type) && !name) return [];
  if (['web_search_call','webSearch'].includes(type) || ['web_search','search_web','web_search_preview'].includes(tail)) add('search','联网搜索');
  else if (['compacted','context_compacted','contextCompaction'].includes(type)) add('compact','上下文压缩');
  else if (['entered_review_mode','enteredReviewMode','exited_review_mode','exitedReviewMode'].includes(type) || tail === 'review') add('review','代码审查');
  else if (['create_goal','get_goal','update_goal'].includes(tail)) add('goal','Goal 模式');
  else if (['create_background_task','spawn_agent'].includes(tail)) add('dispatch','派发后台任务');
  else if (['exec_command','shell_command','shell'].includes(tail)) {
    add('command','执行命令');
    const cmd = args.cmd || args.command || '';
    // Only report guide reads, not a filename mentioned in a prompt, patch or output.
    for (const m of String(cmd).matchAll(/(?:^|[;&|\n])\s*(?:cat|Get-Content|type)\s+([^;&|\n]+)/giu)) {
      for(const file of m[1].matchAll(/(?:^|[/\\])([^/\\'"]+)[/\\]SKILL\.md(?=$|[\s'"])/giu)) {
        const slug=file[1].trim(); add('skill',guides.find(x=>x.id===slug)?.label || slug);
      }
    }
  } else if (name) {
    const server=name.split('__').at(-2)?.replace(/^negus_/, '');
    const guide=guides.find(g=>g.id===server);
    add(guide?'skill':'tool',guide?guide.label+' · '+tail:tail);
  }
  return tools;
}


// Preserve multiline commands and argv. Shell wrappers carry the script after -c / -Command.
export function panelCommand(value) {
  const wrapped=Array.isArray(value) && /(?:^|[/\\])(?:zsh|bash|sh|fish|pwsh|powershell)(?:\.exe)?$/i.test(value[0]) && /^-(?:[a-z]*c|command)$/i.test(value[1]);
  const text=Array.isArray(value) ? wrapped ? value[2] : value.map(v=>/^[\w./:-]+$/.test(v)?v:JSON.stringify(v)).join(' ') : value;
  return typeof text==='string' ? text
    .replace(/(\bBearer\s+)[^\s'"]+/gi,'$1••••')
    .replace(/((?:[\w-]*(?:token|password|api[_-]?key|secret))=)("[^"]*"|'[^']*'|[^\s;&|]+)/gi,'$1••••') : '';
}
