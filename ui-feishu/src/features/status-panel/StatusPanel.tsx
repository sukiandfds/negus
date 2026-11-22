import {usePanelRows,usePanelSignal} from './panelCache';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { BadgeCheck, Bolt, CalendarClock, ChevronDown, ChevronRight, Fingerprint, List, X } from 'lucide-react';
import { postJson } from '../../../shared/shared/api/http';
import { ExecutionTimeline } from '../../../shared/features/execution/components/ExecutionTimeline';
import { scheduleLabel } from '../../../shared/features/desktop/AutomationsWidget';
import { goalStatusLabels } from '../../../shared/features/goals/model/types';
import type { ExecutionStatus } from '../../../shared/features/execution/model/types';
import type { ContextStatus } from '../../../shared/features/context-management/model/types';
import type { ThreadGoal } from '../../../shared/features/goals/model/types';
import { Avatar } from '../../components/Avatar';
import { WorkOutputs } from './WorkOutputs';
import './panel.css';

import { ActivitySteps, Badge, icons, time, type Step } from './ActivitySteps';
type Work = {id:string;title:string;summary:string;state:string;at:string;steps:Step[]};
type Schedule = {id:string;name:string;schedule:string;status:string;nextRunAt:number|null;runs:{createdAt:number;status:string}[]};
type Task = {id:string;title:string;state:string;result:string;at:string;check?:{next:number;last?:number;text?:string;error?:string}};
type PanelProps = {
  thread: string; revision: string; name: string; connected: boolean; status: ExecutionStatus; context: ContextStatus;
  goal: ThreadGoal | null; onStop: () => Promise<boolean>; onClose: () => void; controls: ReactNode;
};
export function StatusPanel({thread,revision,name,connected,status,context,goal,onStop,onClose,controls}:PanelProps){
  const [tab,select]=useState('activity'),[limit,more]=useState(30);
  const [opened,setOpened]=useState<Set<string>>(()=>new Set());
  const panel=useRef<HTMLElement>(null);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape' && !document.querySelector('dialog[open]'))onClose();};
    const outside=(e:PointerEvent)=>{if(e.target instanceof Element && !panel.current?.contains(e.target) && !e.target.closest('[aria-label="对话详情"],[aria-label="查看助手状态"],dialog'))onClose();};
    document.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);
    return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);};
  },[onClose]);
  const current=!!thread && status.threadId===thread, compact=context.threadId===thread && context.phase==='compacting';
  const topicSignal=usePanelSignal(thread,'topics');
  const topics=usePanelRows<{id:string;title:string;mainline:string;summary:string}>(thread,'topics',revision+topicSignal);
  const history=usePanelRows<Work>(thread,'activity',revision);
  const taskSignal=usePanelSignal(thread,'tasks'),scheduleSignal=usePanelSignal(thread,'schedules');
  const [stopError,setStopError]=useState('');
  const tasks=usePanelRows<Task>(thread,'tasks',taskSignal);
  async function stopTask(task:Task){
    if(!window.confirm('停止后台任务「'+task.title+'」？'))return;
    try{await postJson('/api/session/status-panel?'+new URLSearchParams({threadId:thread,section:'tasks',stop:task.id}),{});setStopError('');}
    catch(e){setStopError(e instanceof Error?e.message:String(e));}
  }
  const schedules=usePanelRows<Schedule>(thread,'schedules',scheduleSignal);
  const allWorks=history.data||[];
  const live=current && status.active ? allWorks.find(w=>w.id===status.turnId) : undefined;
  const works=allWorks.filter(w=>w!==live);
  const liveSteps=new Map((live?.steps||[]).map(s=>[s.id,s]));
  for(const step of current && status.active ? status.activities||[] : []){
    if(step.capabilities?.length)liveSteps.set(step.id,{id:step.id,at:step.updatedAt,tags:step.capabilities,command:step.command||liveSteps.get(step.id)?.command});
  }
  const groups=new Map<string,Work[]>();
  const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
  for(const work of works.slice(0,limit)){const day=work.at?new Date(work.at).toLocaleDateString():'日期未记录';
    const label=day===new Date().toLocaleDateString()?'今天':day===yesterday.toLocaleDateString()?'昨天':work.at?new Date(work.at).toLocaleDateString('zh-CN',{month:'long',day:'numeric',...(new Date(work.at).getFullYear()!==new Date().getFullYear()?{year:'numeric'}:{})}):day;const group=groups.get(label)||[];group.push(work);groups.set(label,group);}

  return <aside ref={panel} className="detail-panel status-panel" aria-label="对话详情">
    <header><button className="icon-button" aria-label="关闭对话详情" onClick={onClose}><X size={18}/></button></header>
    <div className="profile-card"><Avatar name={name} size="large"/><h3>{name}</h3><span className="sp-connection"><Bolt size={15} color={connected?'#55b947':undefined}/>{connected?'已连接':'正在连接'}</span></div>
    <nav aria-label="助手状态"><button aria-label="活动" title="活动" aria-pressed={tab==='activity'} onClick={()=>select('activity')}><List size={16}/></button><button aria-label="日程" title="日程" aria-pressed={tab==='schedule'} onClick={()=>select('schedule')}><CalendarClock size={16}/></button><button aria-label="会话信息" title="会话信息" aria-pressed={tab==='info'} onClick={()=>select('info')}><Fingerprint size={16}/></button></nav>
    {tab==='activity'?<>
      {topics.error && <p role="alert">{topics.error}</p>}
      {!!topics.data?.length && <section aria-label="对话提纲"><h3>用户主线</h3><p>{topics.data[0].mainline}</p><h3>话题记录</h3>{topics.data.map(row=><details key={row.id}><summary>{row.title}</summary><p>{row.summary}</p></details>)}</section>}
      {current && status.active && <section><h3>正在运行</h3><ExecutionTimeline status={status} contextStatus={context} compactSummary/><ActivitySteps steps={[...liveSteps.values()]}/><button onClick={()=>void onStop()}>停止本轮</button></section>}
      {compact && <Badge kind="compact" label="正在压缩上下文"/>}
      {goal?.threadId===thread && <p><Badge kind="goal" label={goalStatusLabels[goal.status]}/> {goal.displayObjective||goal.objective}</p>}
      {schedules.data && <details className="sp-section" open><summary>{schedules.data.length} 项日程<ChevronDown size={16}/></summary>{schedules.data.map(s=><div className="sp-entry" key={s.id}><i><CalendarClock size={17}/></i><div>{s.name}<small>{scheduleLabel(s.schedule)}</small></div></div>)}<button className="sp-all" onClick={()=>select('schedule')}>查看全部日程</button></details>}
      {(tasks.error||stopError) && <p role="alert">{tasks.error||stopError}</p>}
      {tasks.data?.map(t=><details key={t.id}><summary><Badge kind="dispatch" label="后台任务"/><strong>{t.title}</strong>{t.check && t.state==='running' && <small>最迟 {time(t.check.next)} 确认后台任务状态</small>}</summary>
        <p>{({queued:'等待派发',starting:'正在启动',running:'已派发后台任务',completed:'已完成',failed:'失败',interrupted:'已中断'} as Record<string,string>)[t.state]||t.state}</p>
        {['queued','starting','running'].includes(t.state)&&<button type="button" disabled={!connected} onClick={()=>void stopTask(t)}>停止此任务</button>}{t.result&&<p>{t.result}</p>}{t.check && t.state==='running' && <p>{t.check.error||t.check.text}{t.check.last?' · '+time(t.check.last)+' 已检查':''}</p>}</details>)}
      {history.error?<p role="alert">{history.error}</p>:!history.data?<p>正在读取活动…</p>:!works.length?<p>暂无活动记录</p>:null}
      {[...groups].map(([day,group])=><details className="sp-section" open key={day}><summary>{day}<ChevronDown size={16}/></summary>{group.map(w=>{
        const kind=w.steps[0]?.tags[0]?.kind;
        const Icon=icons[kind as keyof typeof icons]||BadgeCheck;
        return <details className="sp-work" key={w.id} onToggle={event=>{if(event.target!==event.currentTarget)return;const open=event.currentTarget.open;setOpened(ids=>{const next=new Set(ids);if(open)next.add(w.id);else next.delete(w.id);return next;});}}><summary className="sp-entry"><i><Icon size={18}/></i><span><strong>{w.title||w.steps[0]?.tags[0]?.label||'对话工作'}</strong><small>{w.summary||w.state}</small><time>{w.at&&time(w.at)}</time></span></summary>
        {opened.has(w.id)&&<div className="sp-expanded">{w.summary&&<p>{w.summary}</p>}<ActivitySteps steps={w.steps}/><WorkOutputs revision={revision} thread={thread} turn={w.id}/></div>}</details>})}</details>)}
      {works.length>limit&&<button onClick={()=>more(limit+30)}>查看更多活动 <ChevronRight size={14}/></button>}
    </>:tab==='schedule'?<section><h3>当前对话的日程</h3>{schedules.error&&<p role="alert">{schedules.error}</p>}{schedules.warnings.map(w=><p key={w}>{w}</p>)}
      {!schedules.error&&!schedules.data?<p>正在读取日程…</p>:null}
      {schedules.data&&!schedules.data.length&&!schedules.warnings.length&&<p>暂无日程</p>}
      {schedules.data?.map(s=><details key={s.id}><summary>{s.name}</summary><p>{scheduleLabel(s.schedule)} · {s.status==='ACTIVE'?'已启用':s.status==='PAUSED'?'已暂停':s.status}</p>
        <p>下次运行：{s.nextRunAt&&s.status==='ACTIVE'?new Date(s.nextRunAt).toLocaleString():'未安排'}</p><h4>运行历史</h4>{s.runs.length?s.runs.map((r,i)=><p key={i}>{new Date(r.createdAt).toLocaleString()} · {r.status}</p>):<p>暂无运行记录</p>}</details>)}</section>:<section aria-label="会话信息">{controls}</section>}
  </aside>;
}
