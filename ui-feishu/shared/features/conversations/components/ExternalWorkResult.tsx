import type {ExternalWorkRecord} from '../model/types';

const labels:Record<string,string>={starting:'准备启动',running:'执行中',completed:'已完成',failed:'失败',interrupted:'已中断',denied:'授权已变化'};
export function ExternalWorkResult({work:w}:{work:ExternalWorkRecord}) {
  // Plain text only: neither external input nor model output can load a URL.
  return <article style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',padding:'0.5rem'}}>
    <strong>{w.actor} → {w.employeeName} · {w.tool==='task_create'?'后台文字任务':'文字投递'}（离线，不外发） · {labels[w.state]||w.state}</strong>
    <p>{w.text}</p>{w.acceptance && <p>验收：{w.acceptance}</p>}
    {(w.result || w.error) && <p>{w.result || w.error}</p>}
    <small>调用 {w.callId} · 工作 {w.id}</small>
  </article>;
}

export function ThreadExternalWork({rows}:{rows?:ExternalWorkRecord[]}) {
  if(!rows?.length)return null;
  return <details style={{maxHeight:'35vh',overflow:'auto'}}>
    <summary>本会话的外部派活（{rows.length}）</summary>
    {rows.map(work=><ExternalWorkResult key={work.id} work={work}/>)}
  </details>;
}
