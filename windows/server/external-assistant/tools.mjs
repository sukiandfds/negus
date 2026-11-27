import path from 'node:path';
import {submissionIdOf} from '../message-identity.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import { projectData } from './project-data.mjs';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readProjectManagement, readProjectManagementEntry } from '../project-management-store.mjs';
import { readTopics } from '../status-panel/topics.mjs';
import { denied } from './access.mjs';
import { backgroundTaskRoute, modelDefaultsFromRoute } from '../background-tasks/model-policy.mjs';

const id = z.string().min(1).max(240);
const select = (o, fields) => Object.fromEntries(fields.filter(k => o?.[k] !== undefined).map(k => [k,o[k]]));
const projectFields = ['projectId','name','kind'];
const entryFields = ['id','title','status','category','summary','updatedAt'];
const threadFields = ['threadId','title','role','updatedAt','messageCount'];
const messageFields = ['id','turnId','role','authorName','text','createdAt'];
const workError = message => Object.assign(Error(message), { publicWorkError: true });
export function externalTools(deps) {
  const {access,secret,directory,events,schedules,conversations,projectRoot,media,fushengUsage,readWebVersion}=deps;
  const {rooms,records,reviews}=projectData(deps);
  const server = new McpServer({ name: 'negus-projects', version: '1.0.0' });
  const protectedValues=[deps.workspaceToken,secret].filter(x=>typeof x==='string' && x.length>=12);
  const present=value=>typeof value!=='string'?value:protectedValues.reduce((text,token)=>text.replaceAll(token,'[已隐藏]'),value)
    .replace(/([?&](?:token|access|api_key)=)[^&#\s)]+/gi,'$1[已隐藏]')
    .replace(/((?:authorization\s*:\s*)?bearer\s+)[A-Za-z0-9._~+/-]{16,}/gi,'$1[已隐藏]');
  function register(name, desc, fields, run, catalog = false, write = false) {
    server.registerTool(name,{description:desc,inputSchema:z.strictObject(catalog ? fields : { project:id,...fields }),
      annotations:{readOnlyHint:!write,destructiveHint:false,openWorldHint:false}},async args => {
      const original = await access.authorize(secret);
      const projects = (await directory.list()).projects.filter(p => original.allProjects || original.projects.includes(p.projectId));
      const authorizedProject = !catalog && projects.some(p=>p.projectId===args.project);
      const auditProject = authorizedProject ? args.project : '@access';
      const {callId} = await events.append(auditProject,{actor:original.actor,tool:name,state:'started'});
      try {
        if (!catalog && !authorizedProject) throw denied();
        const p = projects.find(p=>p.projectId===args.project);
        if (!catalog && !p) throw denied();
        const checkGrant = async () => { if ((await access.authorize(secret)).revision !== original.revision) throw denied(); };
        if(write) {
          await checkGrant();
          if (Object.values(args).some(v=>typeof v==='string' && protectedValues.some(s=>v.includes(s)))) throw denied();
        }
        const result = await run(args,p,projects,{callId,actor:original.actor,credentialId:original.id,checkGrant});
        const current = await access.authorize(secret);
        if (current.revision !== original.revision) throw denied();
        if (name !== 'conversation_model_set') await events.append(auditProject,{actor:original.actor,tool:name,callId,state:result?.startup?.state || 'completed',objectId:result?.threadId||result?.task?.id||args.thread||args.entry||args.file||undefined});
        return { ...(result?.startup && ['denied','failed','interrupted'].includes(result.startup.state)?{isError:true}:{}),content:[{type:'text',text:JSON.stringify({callId,...result},(_key,value)=>present(value))}] };
      } catch (error) {
        await events.append(auditProject,{actor:original.actor,tool:name,callId,state:error.statusCode===403?'denied':'failed'});
        return { isError:true,content:[{type:'text',text:JSON.stringify({callId,error:error.statusCode===403?'当前项目未授权此对象':write&&error.publicWorkError?error.message:write?'派活未确认，请按调用编号查看项目记录':'读取失败，请按调用编号在项目中核查'})}] };
      }
    });
  }
  const thread = (p,t) => { const row=p.conversations?.find(c=>c.threadId===t); if(!row) throw denied(); return row; };
  if(deps.museMessages && deps.followUpQueue) register('message_submit','发文字到原对话；收到 accepted 表示已入队，用 message_list 读取回复',
    {thread:id,text:z.string().trim().min(1).max(32000),submissionId:id},async(a,p,_,ctx)=>{
      const target=thread(p,a.thread);
      if(target.archived || (target.targetProjectId && target.targetProjectId!==p.projectId))throw denied();
      return deps.museMessages.submit(a,ctx,deps.followUpQueue);
    },false,true);
  const models=async()=>(await conversations.listModels()).filter(m=>m.available!==false)
    .map(m=>select(m,['model','modelProviderId','displayName','providerDisplayName']));
  const defaults = async () => {
    const configured = await deps.modelDefaults?.read();
    if (!deps.modelProviders) return { configured: configured || null, executionFallback: null };
    try { return { configured, executionFallback: modelDefaultsFromRoute(await backgroundTaskRoute(deps.modelProviders)) }; }
    catch { return { configured, executionFallback: null, fallbackStatus: 'unavailable' }; }
  };
  register('model_list','查看 Negus 当前可选的配置、模型和默认值',{},async()=>({models:await models(),defaults:await defaults()}));
  if (deps.modelProviders?.channelAvailability) register('channel_list','查看渠道可用状态和停用原因（不读取余额或凭证）',{},async()=>{
    await deps.modelProviders.refreshShared?.().catch(()=>{});
    return { channels:deps.modelProviders.providers().map(provider=>({modelProviderId:provider.id,
      name:provider.displayName,...deps.modelProviders.channelAvailability(provider.id)})) };
  });
  if (deps.modelDefaults) register('model_defaults_get','读取与前端相同的已配置默认值及实际执行回退',{},defaults);
  const selectionFor = async (p,t) => {
    if (p.employeeId && p.mainThreadId===t) return deps.employeeRuntime.getModelSelection(p.employeeId);
    const binding = deps.agentConversationStore?.findByRuntimeSession?.('codex',t);
    const agent = binding?.conversationKind==='group' && deps.roomDirectory?.get?.(binding.roomId)?.getAgent?.(binding.agentId);
    if (!agent || agent.threadId!==t) return conversations.getModelSelection(t);
    const pick = selection => ({model:selection.model||'',modelProviderId:selection.modelProviderId||'current',reasoningEffort:selection.reasoningEffort||''});
    const current=pick(agent);
    const stored=await conversations.getModelSelection(t,{modelProviderId:current.modelProviderId});
    return {threadId:t,current,next:pick(agent.pendingModelSettings||agent),lastSuccessfulSettings:stored?.lastSuccessfulSettings||null};
  };
  if (conversations.getModelSelection) register('conversation_model_get','读取授权对话的当前、下次以及最后成功的模型和渠道',{thread:id},async(a,p)=>{
    thread(p,a.thread);
    return selectionFor(p,a.thread);
  });
  if (deps.modelProviders?.modelEvents && deps.followUpQueue?.withThreadLock)
    register('conversation_model_set','为授权项目内已有会话选择模型和渠道，跨渠道保留原对话并在后续执行应用',
      {thread:id,model:id,modelProviderId:id,effort:z.enum(['none','minimal','low','medium','high','xhigh','max','ultra']).optional()},async(a,p,_,ctx)=>{
        const target=thread(p,a.thread);
        if(target.archived || target.nativeSubagent || target.role==='project' || (target.targetProjectId && target.targetProjectId!==p.projectId)) throw denied();
        const binding = deps.agentConversationStore?.findByRuntimeSession?.('codex',a.thread);
        if(binding?.conversationKind==='group') throw workError('群聊投影沿用群内员工设置，不能在此切换');
        const direct = p.employeeId && p.mainThreadId===a.thread;
        const result = await deps.followUpQueue.withThreadLock(a.thread, async () => {
          if (deps.execution?.getStatus(a.thread)?.active) throw workError('当前任务运行中，请在完成后切换模型');
          const before = await selectionFor(p,a.thread);
          if (!before || before.threadId !== a.thread) throw denied();
          await deps.modelProviders.refreshShared?.();
          const route = deps.modelProviders.resolveRoute({ model: a.model, modelProviderId: a.modelProviderId });
          if (route.model !== a.model.split('::').at(-1) || (a.model.includes('::') && a.model.split('::')[0] !== a.modelProviderId))
            throw workError('所选模型与渠道不匹配，请重新读取模型列表');
          deps.modelProviders.assertChannelAvailable?.(route.modelProviderId);
          const change = { callId:ctx.callId, actor:ctx.actor, credentialId:ctx.credentialId, project:p.projectId,
            threadId:a.thread,title:target.title || '', previous:before.current, requested: { model:route.model, modelProviderId:route.modelProviderId } };
          await ctx.checkGrant();
          if (direct) await deps.employeeRuntime.updateModelSettings(p.employeeId,
            { model:route.model, modelProviderId:route.modelProviderId, ...(a.effort ? {reasoningEffort:a.effort} : {}) }, { modelChange:change });
          else {
            if (target.role === 'task' && before.current.modelProviderId !== route.modelProviderId)
              throw workError('该任务对话仍受原有跨渠道限制');
            await conversations.updateModel(a.thread,a.model,{ modelProviderId:route.modelProviderId,allowProviderSwitch:target.role!=='task',
              reasoningEffort:a.effort ?? before.next.reasoningEffort,modelChange:change });
          }
          const selected = await selectionFor(p,a.thread);
          const state = direct || selected.current.modelProviderId !== selected.next.modelProviderId ? 'pending_application' : 'applied';
          await deps.modelProviders.modelEvents.record({ ...change, next:selected.next },state);
          return {...selected,state};
        });
        deps.execution?.publishThreadEvent?.(a.thread,{type:'sessions_changed',threadId:a.thread});
        return result;
      },false,true);
  register('conversation_create','在授权的普通项目中用所选配置和模型新建对话',
    {model:id,modelProviderId:id},async(a,p,_projects,ctx)=>{
      if(p.kind==='employee' || !p.root) throw Object.assign(Error('请选择可新建普通对话的项目'),{publicWorkError:true});
      if(!(await models()).some(m=>m.model===a.model && m.modelProviderId===a.modelProviderId))
        throw Object.assign(Error('所选配置和模型不可用，请重新读取模型列表'),{publicWorkError:true});
      await ctx.checkGrant();
      const session=await conversations.createSession(a.model,p.root,a.modelProviderId,{createdBy:'assistant',persistEmptyThread:true});
      return {threadId:session.threadId,projectId:p.projectId,model:a.model,modelProviderId:a.modelProviderId};
    },false,true);
  register('project_list','列出本人已授权给 00 的项目',{},async (a,p,projects)=>({projects:projects.map(v=>select(v,projectFields))}),true);
  register('project_get','读取授权项目身份',{},async(a,p)=>select(p,projectFields));
  register('conversation_list','列出项目目录已归属的会话',{},async(a,p)=>({threads:p.conversations.map(v=>select(v,threadFields))}));
  register('topic_list','读取会话已发布的话题',{thread:id},async(a,p)=>{
    thread(p,a.thread);return {topics:(await readTopics(projectRoot,a.thread)).map(v=>select(v,['id','title','mainline','summary']))};
  });
  register('message_list','分页读取授权会话消息，可按原提交编号查仍在运行或已失败的消息',
    {thread:id,limit:z.number().int().min(1).max(100).default(30),cursor:z.string().max(2048).optional(),before:z.number().int().nonnegative().optional(),submissionId:id.optional()},async(a,p)=>{
    thread(p,a.thread);
    const status = deps.execution?.getStatus(a.thread);
    const attempts = deps.modelProviders?.executionRecords?.list(a.thread).filter(r=>!r.taskId) || [];
    const fields = ['code','model','modelProviderId','billingChannelId','turnId'];
    const fromAttempt = row => ({id:row.submissionId,submissionId:row.submissionId,role:'user',text:row.text,createdAt:row.createdAt,
      ...(row.attachments?.length ? { attachments:row.attachments } : {}),
      ...(row.turnId?{turnId:row.turnId}:{}),...(deps.museMessages?.actorFor(a.thread,row.submissionId)||{}),
      ...(row.state==='failed'?{state:'failed',error:row.reason,failure:select(row,fields)}:
        {state:status?.active&&status.turnId===row.turnId?'running':'submitted'})});
    if(a.submissionId) {
      const attempt=attempts.find(row=>row.submissionId===a.submissionId);
      return {messages:attempt?[fromAttempt(attempt)]:[]};
    }
    const pagination={limit:a.limit,before:a.before,cursor:a.cursor,readOnly:true};
    let raw;
    try { raw=p.employeeId && p.mainThreadId===a.thread ? await deps.employeeRuntime.readSession(p.employeeId,pagination) : await conversations.findSession(a.thread,'all',pagination); }
    catch(error){ if(error.statusCode!==404 && (error.statusCode || !/no persisted turns/i.test(error.message)))throw error; }
    const session=deps.museMessages?.decorate(a.thread,raw) || raw;
    const work=deps.externalDispatch?.forThread?.(p.projectId,a.thread)||[];
    if(session && session.threadId!==a.thread) throw denied();
    const body=session?.messages||[];
    const replies=new Map(body.filter(m=>m.role==='assistant' && m.turnId && m.phase!=='commentary' && m.text?.trim()).map(m=>[m.turnId,m.id]));
    const bySubmission = new Map(attempts.map(r=>[r.submissionId,r]));
    const seen=new Set();
    const messages=body.map(m=>{
      const row=select(m,messageFields), submissionId=submissionIdOf(m);
      const attempt = bySubmission.get(submissionId);
      if(m.role==='user' && submissionId && (attempt || deps.museMessages?.actorFor(a.thread,submissionId))){
        seen.add(submissionId);
        Object.assign(row,{submissionId,state:attempt?.state==='failed'?'failed':replies.has(m.turnId)?'replied':
          (status?.active && status.turnId && status.turnId===(attempt?.turnId || m.turnId) ? 'running' : 'submitted'),
          ...(attempt?.state==='failed'?{error:attempt.reason,failure:select(attempt,fields)}:{replyId:replies.get(m.turnId)})});
      }
      return row;
    });
    if(!a.cursor && a.before===undefined)for(const q of deps.followUpQueue?.list?.(a.thread)||[]){
      const id=q.dispatchSubmissionId||q.submissionId;
      if(!seen.has(id) && deps.museMessages?.actorFor(a.thread,q.submissionId))
        messages.push({id:q.id,submissionId:id,role:'user',authorName:'Muse',text:q.text,createdAt:q.createdAt,state:q.state,error:bySubmission.get(id)?.reason || q.error || undefined});
    }
    if(!a.cursor && a.before===undefined) for(const attempt of attempts){
      if(seen.has(attempt.submissionId) || attempt.state!=='running' || !status?.active || status.turnId!==attempt.turnId)continue;
      messages.push(fromAttempt(attempt));
    }
    return {messages,...(work.length?{dispatches:work}:{}),pagination:select(session,['hasMore','nextBefore','nextCursor'])};
  });
  // This is a task view, not an artifact ownership grant.
  const taskRows=(p,detailId)=>{
    const threads=new Set(p.conversations.map(c=>c.threadId));
    const rows=[];
    const add=(service,allowed,roomId)=>{
      const receipts=new Map((service?.deliveries?.()||[]).map(d=>[d.taskId,d]));
      for(const t of service?.tasks?.()||[]){
        if(!allowed(t))continue;
        const receipt=receipts.get(t.id);
        const failure=deps.modelProviders?.executionRecords?.task(t.id);
        rows.push({...select(t,['id','title','state','agentId','agentName','employeeId','createdAt','updatedAt','startedAt','completedAt','parentTaskId','result','error','artifactIds']),
          ...(failure && { ...(t.state==='failed' ? {error:failure.reason} : {}),
            failure:{...select(failure,['code','model','modelProviderId','billingChannelId','turnId','submissionId']),reason:failure.reason} }),
          threadId:t.runtime?.threadId||t.threadId,turnId:t.runtime?.turnId,
          ...(t.id===detailId && {steps:(t.progress||[]).map(step=>select(step,['id','text','phase','createdAt']))}),
          ...(roomId&&{roomId}),...(receipt&&{delivery:select(receipt,['id','state','attempts','error'])})});
      }
    };
    add(deps.tasks,t=>(p.employeeId && t.agentId===p.employeeId) ||
      (t.workProjectId ? t.workProjectId===p.projectId : t.source?.projectId ? t.source.projectId===p.projectId :
        threads.has(t.source?.threadId)));
    for(const room of rooms(p))add(deps.multiAgentDirectory?.get(room.id),()=>true,room.id);
    for(const t of deps.externalDispatch?.tasks?.(p.projectId)||[])rows.push({...select(t,['id','state','agentId','createdAt','updatedAt','threadId','actor']),title:t.text.slice(0,120)});
    return rows;
  };
  register('task_list','读取项目发起或员工承接的任务',{},async(a,p)=>({tasks:taskRows(p)}));
  register('task_get','按编号读取任务、投递状态、当前工作过程与子任务',{task:id},async(a,p)=>{
    const rows=taskRows(p,a.task), task=rows.find(t=>t.id===a.task);
    if(!task)throw denied();
    const status=task.turnId && task.threadId && deps.execution?.getStatus(task.threadId);
    return {task,children:rows.filter(t=>t.parentTaskId===task.id).map(t=>select(t,['id','title','state'])),
      nativeSubagents:task.threadId?p.conversations.filter(c=>c.nativeSubagent && c.parentThreadId===task.threadId).map(c=>select(c,[...threadFields,'status'])):[],
      ...(status && status.turnId===task.turnId && {progress:select(status,['phase','label','detail','activities','startedAt','updatedAt'])})};
  });
  register('task_stop','停止由当前外部助手发起的后台任务；用 task_get 查看最终状态',{task:id},async(a,p,_,ctx)=>{
    if(!taskRows(p).some(t=>t.id===a.task && !t.roomId))throw denied();
    const origin=deps.tasks?.dispatchOrigin?.(a.task);
    if(!origin?.turnId || !deps.museMessages.ownsTurn(origin.threadId,origin.turnId,ctx.actor))throw denied();
    await ctx.checkGrant();
    const task=await deps.tasks.cancelTask(a.task,{suppressContinuation:true});
    return {task:select(task,['id','state','cancelRequested'])};
  },false,true);
  register('schedule_list','按项目已绑定的会话查询定期任务',{thread:id.optional()},async(a,p)=>{
    if(a.thread) thread(p,a.thread);
    return {schedules:(await schedules()).items.filter(s=>s.threadId && p.conversations.some(c=>c.threadId===s.threadId) && (!a.thread||s.threadId===a.thread)).map(s=>select(s,['id','name','status','schedule','nextRunAt','threadId']))};
  });
  register('artifact_list','列出项目成果及版本',{},async(a,p)=>({artifacts:records(p).map(v=>({...select(v,['id','taskId','messageId','currentVersion']),versions:v.versions.map(x=>select(x,['version','name','mimeType','size','status','reviewDecision','sourceMediaId']))}))}));
  register('approval_list','读取项目成果的审核状态',{pendingOnly:z.boolean().default(true)},async(a,p)=>({items:[...reviews(p),...await deps.approvals.list(p.projectId)].filter(x=>!a.pendingOnly||x.state==='pending')}));

  const management=p=>readProjectManagement({project:p.name,projectRoot:p.root});
  register('project_entries','读取项目需求目录',{},async(a,p)=>({entries:(await management(p)).entries.map(e=>select(e,entryFields))}));
  register('project_status','读取项目管理记录中的状态、进度和待决项',{},async(a,p)=>{
    const v=await management(p);return {project:select(v.project,['title','phase','goal','status','updatedAt']),stats:v.stats,inProgress:v.inProgress.map(e=>select(e,entryFields))};
  });
  register('project_entry_get','读需求原话、验收说明及更新摘要',{entry:z.string().regex(/^[A-Z][A-Z0-9]+-\d{3}$/)},async(a,p)=>select(await readProjectManagementEntry({projectRoot:path.resolve(p.root),entryId:a.entry}),[...entryFields,'userQuote','concreteContent','expectedEffect']));
  register('external_activity_list','按游标追溯 00 的项目活动',{after:id.optional()},(a,p)=>events.list(p.projectId,a.after));
  register('room_list','查看本项目群列表',{},async(a,p)=>({rooms:rooms(p).map(x=>select(x,['id','name','projectId']))}));
  register('file_read','分段读取已归属本项目的成果版本',{file:id,offset:z.number().int().nonnegative().default(0),size:z.number().int().min(1).max(65536).default(32768)},async(a,p)=>{
    const version=records(p).flatMap(r=>r.versions).find(v=>v.sourceMediaId===a.file);
    if(!version?.sha256)throw denied();
    const entry=media.resolveMany([a.file])[0];
    if(!entry)throw Error('文件不可用');
    const handle=await fs.open(entry.path,'r');
    try{const stat=await handle.stat();
      if(!stat.isFile()||stat.size!==version.size)throw denied();
      const buf=Buffer.alloc(a.size);const {bytesRead}=await handle.read(buf,0,a.size,a.offset);
      const hash=createHash('sha256');
      const patterns=protectedValues.map(x=>Buffer.from(x));
      const overlap=Math.max(0,...patterns.map(x=>x.length-1));let tail=Buffer.alloc(0);
      for await(const chunk of handle.createReadStream({start:0,autoClose:false})){
        hash.update(chunk);const window=Buffer.concat([tail,chunk]);if(patterns.some(x=>window.includes(x)))throw denied();
        tail=overlap?window.subarray(-overlap):Buffer.alloc(0);
      }
      if(hash.digest('hex')!==version.sha256 || (await handle.stat()).ctimeMs!==stat.ctimeMs)throw denied();
      return {content:buf.subarray(0,bytesRead).toString('base64'),encoding:'base64',mime:entry.mimeType,size:stat.size,next:a.offset+bytesRead<stat.size?a.offset+bytesRead:null};
    }finally{await handle.close();}
  });
  register('usage_get','读取工作区用量摘要，仅限本人明确授权个人主项目',{},async(a,p)=>{
    if(p.kind!=='personal')throw denied();const s=await fushengUsage.read();return {asOf:s.updatedAt,usage:select(s.today,['amountUsd','requests','tokens'])};
  });
  register('version_get','读取 Negus 当前网页版本',{},async()=>select(await readWebVersion(),['buildId','builtAt']));
  return server;
}
