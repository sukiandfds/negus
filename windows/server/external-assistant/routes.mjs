import path from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { readJson, sendJson } from '../http/request-utils.mjs';
import { readJsonFile } from '../persistence/json-file.mjs';
import { externalAccess, denied } from './access.mjs';
import { projectEvents } from './project-events.mjs';
import { ownerSessions } from './owner.mjs';
import { approvalInbox } from './approvals.mjs';
import { projectData } from './project-data.mjs';
import { externalTools } from './tools.mjs';

export function externalRoutes(deps) {
  const {projectRoot,directory}=deps;
  const access=externalAccess(projectRoot), events=deps.events||projectEvents(projectRoot), owners=ownerSessions(projectRoot,deps.ownerOptions);
  const approvals=approvalInbox(events);
  const state=async()=>({owner:true,...await access.status(),directory:(await directory.list()).projects.map(({projectId,name})=>({projectId,name}))});
  return {
    requestApproval:approvals.request,
    projectActivity:async(project,window)=>(await events.history(project)).filter(e=>e.at>=window.start&&e.at<window.end)
      .map(e=>({id:e.id,kind:'external_activity',source:'external-assistant',projectId:project,occurredAt:e.at,authorName:e.actor==='owner'?'本人':'Muse · 00',text:e.tool+' · '+e.state,callId:e.callId,objectId:e.objectId})),
    async admin(req,res,url) {
      if(url.pathname!=='/api/external-assistant') return false;
      const owner=owners.check(req.headers.cookie);
      if(req.method==='GET') {
        if(!owner) sendJson(res,{owner:false});
        else if(url.searchParams.has('waiting')) {
          const p=(await directory.list()).projects.find(p=>p.projectId===url.searchParams.get('waiting'));
          if(!p)throw denied();
          sendJson(res,{items:[...projectData(deps).reviews(p),...await approvals.list(p.projectId)].filter(x=>x.state==='pending')});
        } else if(url.searchParams.has('project')) {
          const project=url.searchParams.get('project');
          const page=await events.list(project,url.searchParams.get('after'));
          sendJson(res,{...page,events:page.events.map(e=>({...e,...(e.tool==='message_submit'||e.tool==='task_create'?{work:deps.externalDispatch?.forCall(project,e.callId)}:{})}))});
        }
        else sendJson(res,await state());
        return true;
      }
      const host=req.headers.host;
      const local=/^(localhost|127\.0\.0\.1):\d+$/.test(host);
      const official=(await readJsonFile(path.join(projectRoot,'runtime','negus-tunnel.json'),{})).hostname;
      const origin=local?'http://'+host : official && official===host?'https://'+official:'';
      if(req.method!=='POST'||!origin||req.headers.origin!==origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) throw denied();
      const b=await readJson(req,8192);
      if(b.action==='sendCode'){await owners.send(b.email);sendJson(res,{sent:true});return true;}
      if(b.action==='login'){
        const sid=await owners.verify(b.email,b.code);
        res.setHeader('Set-Cookie','negus_owner='+sid+'; Path=/api/external-assistant; HttpOnly; SameSite=Strict; Max-Age=900'+(local?'':'; Secure'));
        sendJson(res,await state());return true;
      }
      if(!owner) throw denied();
      if(b.action==='grant'){
        const ids=new Set((await directory.list()).projects.map(p=>p.projectId));
        sendJson(res,await access.grant(b.revision,b.projects,ids,b.allProjects));
      } else if(b.action==='issue'){
        const {secret,...s}=await access.issue(b.revision);
        sendJson(res,{...s,link:(official && /^[a-z0-9.-]+$/i.test(official)?'https://'+official:origin)+'/mcp/muse?access='+secret});
      } else if(b.action==='revoke') sendJson(res,await access.revoke(b.revision));
      else if(b.action==='review'){
        const p=(await directory.list()).projects.find(p=>p.projectId===b.project);
        if(b.kind==='action' && p){sendJson(res,await approvals.decide(p.projectId,b.id,b.fingerprint,b.decision));return true;}
        const item=p && projectData(deps).reviews(p).find(x=>x.id===b.id && x.version===b.version && x.state==='pending');
        if(!item || !['approve','reject'].includes(b.decision))throw denied();
        await deps.artifacts.review(item.id,b.decision,'','owner');
        await events.append(p.projectId,{tool:'artifact_review',actor:'owner',state:b.decision==='approve'?'approved':'rejected',objectId:item.id});
        sendJson(res,{ok:true});
      } else throw denied();
      return true;
    },
    async mcp(req,res,url) {
      res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
      // Machine endpoint never accepts a browser login, sets a cookie or forwards a URL.
      if(req.headers.origin) throw denied();
      const secret=url.searchParams.get('access')||String(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
      const credential=await access.authorize(secret);
      if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'});res.end();return;}
      const body=await readJson(req);
      let logged=false;
      const trace={...events,append:(...args)=>{logged=true;return events.append(...args);}};
      const server=externalTools({...deps,access,secret,events:trace,approvals});
      const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      try {
        await server.connect(transport);
        const headers=new Headers();
        for(const key of ['accept','content-type','mcp-protocol-version']) if(req.headers[key]) headers.set(key,req.headers[key]);
        const request=new Request('https://negus.invalid/mcp/muse',{method:'POST',headers,body:JSON.stringify(body)});
        const result=await transport.handleRequest(request,{parsedBody:body});
        const payload=Buffer.from(await result.arrayBuffer());
        if(!logged){
          // Protocol rejections and unknown tool names must also be visible; never
          // log caller-defined names, arguments or arbitrary RPC ids.
          const method=['initialize','notifications/initialized','ping','tools/list'].includes(body?.method)?body.method:'unregistered_or_invalid_request';
          const authorizedProject=credential.projects.includes(body?.params?.arguments?.project)?body.params.arguments.project:'@access';
          await events.append(authorizedProject,{tool:method,state:method==='unregistered_or_invalid_request'||!result.ok?'denied':'completed'});
        }
        const current=await access.authorize(secret);
        if(current.revision!==credential.revision)throw denied();
        res.writeHead(result.status,{'Content-Type':result.headers.get('content-type')||'application/json'});
        res.end(payload);
      } finally {await server.close();}
    }
  };
}
