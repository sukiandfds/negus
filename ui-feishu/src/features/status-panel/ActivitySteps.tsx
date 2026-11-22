import { ChevronDown, FileSearch, Globe, Minimize2, Network, Puzzle, SquareTerminal, Target, Wrench } from 'lucide-react';

export type Tag = {kind:string;label:string};
export type Step = {id:string;at:string;tags:Tag[];command?:string};
export const icons = {search:Globe,compact:Minimize2,review:FileSearch,goal:Target,dispatch:Network,command:SquareTerminal,skill:Puzzle,tool:Wrench};
export const time = (v:string|number) => new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
export function Badge({kind,label}:Tag){const Icon=icons[kind as keyof typeof icons]||Wrench;return <span className={'sp-badge sp-'+kind}><Icon size={14}/>{label}</span>;}

export function ActivitySteps({steps}:{steps:Step[]}) {
  const groups:{command:boolean;steps:Step[]}[]=[];
  for(const step of steps){
    const command=step.tags.some(tag=>tag.kind==='command'), last=groups.at(-1);
    if(command && last?.command) last.steps.push(step);
    else groups.push({command,steps:[step]});
  }
  return groups.map(group=>{
    const first=group.steps[0];
    if(!group.command)return <div className="sp-step" key={first.id}><time>{time(first.at)}</time>{first.tags.map((t,i)=><Badge key={i} {...t}/>)}</div>;
    const labels=[...new Set(group.steps.flatMap(s=>s.tags.filter(t=>t.kind==='skill').map(t=>t.label)))];
    return <details key={first.id} className="sp-commands"><summary><SquareTerminal size={15}/>执行命令 · {group.steps.length} 次<ChevronDown size={14}/></summary>
      <pre aria-label="命令明细">{group.steps.map(s=>[time(s.at),...s.tags.filter(t=>t.kind!=='command').map(t=>t.label)].join(' · ')+'\n'+(s.command||'本条记录没有命令正文')).join('\n\n')}</pre>
      {labels.length>0&&<small>使用技能：{labels.join('、')}</small>}</details>;
  });
}
