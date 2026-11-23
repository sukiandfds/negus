import {readTopics} from './topics.mjs';
import {digest,taskRows} from './resources.mjs';
import { readJson, sendJson } from '../http/request-utils.mjs';
import { panelHistory } from './activity.mjs';
import { approveProfileCandidate, listProfileCandidates, rejectProfileCandidate } from '../profile-service.mjs';
export function statusPanelRoute({projectRoot,conversations, agentTasks, readAutomations, authorizeAgentThread}) {
  const recent = new Map(), versions=new Map();
  return async (req,res,url)=>{
    // Profile candidates are global (not per-thread); the upstream token check
    // in request-handler.mjs already guards this route like every other API.
    if(url.pathname==='/api/session/profile-candidates'){
      if(req.method==='GET'){
        sendJson(res,{items:await listProfileCandidates(projectRoot,{status:url.searchParams.get('status')||undefined})});
        return true;
      }
      if(req.method==='POST'){
        const body=await readJson(req);
        if(!body.id)throw Object.assign(Error('请选择画像候选'),{statusCode:400});
        if(body.action==='approve'){
          const result=await approveProfileCandidate(projectRoot,body.id);
          sendJson(res,result,result.status==='overflow'?409:200);return true;
        }
        if(body.action==='reject'){sendJson(res,await rejectProfileCandidate(projectRoot,body.id));return true;}
        throw Object.assign(Error('未知的候选操作'),{statusCode:400});
      }
      return false;
    }
    if(url.pathname!=='/api/session/status-panel')return false;
    const threadId=url.searchParams.get('threadId');
    if(!threadId)throw Object.assign(Error('请选择对话'),{statusCode:400});
    await authorizeAgentThread({threadId});
    const scope=url.searchParams.get('section');
    if(scope==='tasks' && req.method==='POST'){
      const id=url.searchParams.get('stop');
      const task=agentTasks.tasks().find(t=>t.id===id && t.background && t.source?.kind==='conversation' && t.source.threadId===threadId);
      if(!task)throw Object.assign(Error('当前对话没有这项后台任务'),{statusCode:404});
      await agentTasks.cancelTask(id);sendJson(res,{accepted:true},202);return true;
    }
    if(req.method!=='GET')return false;
    // Old clients keep their original response. New clients receive only changed rows.
    const reply=(data)=>{
      if(!url.searchParams.has('delta')){sendJson(res,data);return;}
      const field=scope==='activity'?'activities':scope==='schedules'?'items':'';
      const rows=field?data[field]:data, meta=scope==='schedules'?{warnings:data.warnings}:{};
      const key=JSON.stringify([threadId,scope,url.searchParams.get('turnId')]), base=url.searchParams.get('base');
      const hashes=new Map(rows.map(row=>[row.id,digest(row)])),order=[...hashes.keys()],version=digest([[...hashes],meta]);
      const prior=versions.get(key), known=prior?.find(x=>x.version===base);
      if(!prior?.some(x=>x.version===version)){
        versions.delete(key);versions.set(key,[{version,hashes},...(prior||[]).slice(0,1)]);
        if(versions.size>128)versions.delete(versions.keys().next().value);
      }
      const signal=['tasks','schedules'].includes(scope)?(rows.length?digest(rows):'-')+':'+(meta.warnings?.length?digest(meta.warnings):''):undefined;
      sendJson(res,{version,order,meta,signal,rows:known?rows.filter(row=>known.hashes.get(row.id)!==hashes.get(row.id)):rows});
    };
    if(scope==='topics'){reply(await readTopics(projectRoot,threadId));return true;}
    if(scope==='outputs'){
      const turnId=url.searchParams.get('turnId');
      if(!turnId)throw Object.assign(Error('请选择活动'),{statusCode:400});
      const session=await conversations.findSession(threadId,'all');
      const outputs=(session?.messages || []).filter(m=>m.role==='assistant' && (m.protocolTurnId||m.turnId)===turnId)
        .flatMap(m=>{
          const blocks=(m.blocks||[]).filter(b=>b.type!=='markdown' && b.type!=='options');
          return blocks.length ? [{id:m.id,role:m.role,text:'',blocks}] : [];
        });
      reply(outputs);return true;
    }
    if(scope==='schedules'){
      const {items,warnings}=await readAutomations();
      reply({items:items.filter(x=>x.threadId===threadId),warnings});return true;
    }
    if(scope==='tasks'){
      reply(taskRows(agentTasks?.tasks?.()).filter(t=>t.threadId===threadId));return true;
    }
    const info=await conversations.getPanelHistoryInfo(threadId);
    if(!info){reply({activities:[]});return true;}
    const cached=recent.get(threadId);
    if(cached && cached.revision===info.sourceRevision){reply(cached.value);return true;}
    const value={activities:await panelHistory(info.paths || (info.path?[info.path]:[]))};
    if(recent.size>=8)recent.delete(recent.keys().next().value);
    recent.set(threadId,{revision:info.sourceRevision,value});
    reply(value);return true;
  };
}
