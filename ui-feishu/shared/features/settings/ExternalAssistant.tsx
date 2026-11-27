import {ExternalWorkResult} from '../conversations/components/ExternalWorkResult';
import type {ExternalWorkRecord} from '../conversations/model/types';
import {useEffect,useState} from 'react';
import {fetchJson,postJson} from '../../shared/api/http';
import styles from './SettingsPage.module.css';
const endpoint='/api/external-assistant';
type State={owner:boolean;revision:number;active:boolean;allProjects:boolean;projects:string[];directory:{projectId:string;name:string}[]};
type Waiting={id:string;kind:string;fingerprint?:string;revision?:string;target?:string;version?:number;title:string;state:string};
type ModelSelection={model:string;modelProviderId:string;reasoningEffort?:string};
type Entry={actor:string;id:string;callId:string;tool:string;state:string;at:string;objectId?:string;work?:ExternalWorkRecord;
 modelChange?:{threadId:string;title:string;previous:ModelSelection;next:ModelSelection}};
const labels:Record<string,string>={starting:'准备启动',running:'已启动',interrupted:'已中断',started:'开始',completed:'完成',failed:'失败',denied:'未获授权',pending:'等待本人审批',approved:'已批准',rejected:'已驳回',
 pending_application:'待生效',applied:'已生效',apply_failed:'接续失败，原绑定保留',superseded:'被后续选择替换'};
const modelLabel=(selection:ModelSelection)=>[selection.modelProviderId,selection.model?.split('::').at(-1),selection.reasoningEffort].filter(Boolean).join(' / ') || '无记录';
export function ExternalAssistant(){
 const [state,setState]=useState<State|null>(null),[email,setEmail]=useState(''),[code,setCode]=useState('');
 const [waiting,setWaiting]=useState<Waiting[]>([]);
 const [link,setLink]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[project,setProject]=useState('@access'),[rows,setRows]=useState<Entry[]>([]);
 useEffect(()=>{const c=new AbortController();fetchJson<State>(endpoint,c.signal).then(setState).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort();},[]);
 useEffect(()=>{
   if(!state?.owner)return;
   const c=new AbortController();let timer:ReturnType<typeof setTimeout>,after='',lastApprovalRead=0;setRows([]);setWaiting([]);
   const refresh=async()=>{try{
     const data=await fetchJson<{events:Entry[];next:string|null}>(endpoint+'?'+new URLSearchParams({project,after}),c.signal);
     if(c.signal.aborted)return;
     if(!Array.isArray(data.events)){setLink('');setState({owner:false} as State);setRows([]);return;}
     if(project!=='@access' && (Date.now()-lastApprovalRead>30000 || data.events.some(e=>['artifact_review','approval_requested','approval_decided'].includes(e.tool)))) {
       lastApprovalRead=Date.now();
       const approvals=await fetchJson<{items:Waiting[]}>(endpoint+'?'+new URLSearchParams({waiting:project}),c.signal);
       if(c.signal.aborted)return;setWaiting(approvals.items||[]);
     }
     after=data.next||after;if(data.events.length)setRows(old=>[...old,...data.events]);
     timer=setTimeout(refresh,data.events.length===100?0:2000);
   }catch(e){if(!c.signal.aborted){setError(String(e));timer=setTimeout(refresh,5000);}}};void refresh();return()=>{c.abort();clearTimeout(timer)};
 },[project,state?.owner]);
 async function act(action:string,extra:Record<string,unknown>={}){
   setError('');setBusy(true);
   try{
     const data=await postJson<State & {link?:string}>(endpoint,{action,revision:state?.revision,...extra});
     if(action==='sendCode')return;
     if(action==='login'){setCode('');setState(data);return;}
     if(action==='review'){setWaiting(old=>old.filter(x=>x.id!==extra.id));return;}
     if(action==='revoke')setLink('');
     if(data.link)setLink(data.link);
     setState(current=>current?{...current,allProjects:data.allProjects,projects:data.projects,active:data.active,revision:data.revision}:current);
   }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 return <><header className={styles.contentHeader}><div><h1>外部助手活动</h1><p>Muse · 00</p></div></header>
 {error&&<p role="alert" className={styles.error}>{error}</p>}
 {!state?<p>正在连接…</p>:!state.owner?<section className={styles.section}><h2>验证本人的 Negus 账号</h2>
 <label>账号邮箱<input type="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setCode('');}}/></label>
 <button disabled={busy||!email} onClick={()=>void act('sendCode',{email})}>发送验证码</button>
 <label>邮箱验证码<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/></label><button disabled={busy||!email||!/^\d{6}$/.test(code)} onClick={()=>void act('login',{email,code})}>验证本人账号</button>
 <p>首次绑定请在主机确认账号。之后可在手机或电脑验证。</p></section>:<>
 <section className={styles.section}><h2>接入与项目授权</h2><p>{state.active?'00 的令牌有效':'尚无有效令牌'} · 可在已勾选的项目中读取资料，在普通项目中选择已配置的模型新建对话</p>
 <label><input type="checkbox" style={{width:'auto',minHeight:0}} disabled={busy} checked={!!state.allProjects} onChange={e=>void act('grant',{projects:state.projects,allProjects:e.target.checked})}/> 管理所有现有及以后新增的项目</label>
 {state.directory.map(p=><div key={p.projectId}><label><input type="checkbox" style={{width:'auto',minHeight:0}} disabled={busy||state.allProjects} checked={state.allProjects||state.projects.includes(p.projectId)} onChange={e=>void act('grant',{projects:e.target.checked?[...state.projects,p.projectId]:state.projects.filter(x=>x!==p.projectId)})}/> {p.name}</label></div>)}
 <button disabled={busy} onClick={()=>{if(!state.active)void act('issue');else if(window.confirm('撤销后，00 将立即失去接入权限。继续？'))void act('revoke');}}>{state.active?'撤销接入令牌':'为 00 发放接入链接'}</button>
 {link&&<div><label>接入链接（仅本次显示）<input readOnly type="password" value={link}/></label><button onClick={()=>void navigator.clipboard.writeText(link).catch(()=>setError('浏览器未允许复制，请选择输入框中的链接并复制'))}>复制给 Muse</button></div>}
 </section><section className={styles.section}><h2>活动与等待审批</h2><label>查看范围<select value={project} onChange={e=>setProject(e.target.value)}><option value="@access">接入与目录查询</option>{state.directory.map(p=><option key={p.projectId} value={p.projectId}>{p.name}</option>)}</select></label>
 <h3>等待本人审批</h3>
 {waiting.length===0?<p>没有待审批事项。</p>:waiting.map(w=><div key={w.id}>{w.title} {w.target} · 版本 {w.version??w.revision} · {w.id} {(['approve','reject'] as const).map(decision=><button key={decision} disabled={busy} onClick={()=>{if(window.confirm((decision==='approve'?'批准':'驳回')+'「'+w.title+'」版本 '+(w.version??w.revision)+'？'))void act('review',{id:w.id,kind:w.kind,fingerprint:w.fingerprint,version:w.version,project,decision});}}>{decision==='approve'?'批准':'驳回'}</button>)}</div>)}
 <h3>活动时间线</h3>{rows.length===0?<p>这个范围暂无活动。</p>:<ol>{rows.slice().reverse().map(r=><li key={r.id}><time>{new Date(r.at).toLocaleString()}</time> · {r.actor==='owner'?'本人':r.actor==='00'?'Muse · 00':r.actor} · {r.modelChange?'切换对话模型':r.tool} · {labels[r.state]||r.state}<br/><small>调用编号 {r.callId}{r.modelChange
  ? <> · <a href={'/?thread='+encodeURIComponent(r.modelChange.threadId)}>{r.modelChange.title || '打开原对话'}</a> · 对话编号 {r.modelChange.threadId}</>
  : r.objectId && <> · 对象 {['message_list','topic_list'].includes(r.tool)?<a href={'/?thread='+encodeURIComponent(r.objectId)}>打开原对话</a>:r.objectId}</>}</small>
 {r.modelChange && <p>原配置：{modelLabel(r.modelChange.previous)} → 所选配置：{modelLabel(r.modelChange.next)}</p>}
 {r.work && r.state!=='started' && <details><summary>查看派活结果</summary><ExternalWorkResult work={r.work}/></details>}</li>)}</ol>}
 </section></>}</>;
}
