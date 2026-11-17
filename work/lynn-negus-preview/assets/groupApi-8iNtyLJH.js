import{c as h,p as d,w as g,f as o}from"./global-Cp_gNpWw.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=h("ArrowUpRight",[["path",{d:"M7 7h10v10",key:"1tivn9"}],["path",{d:"M7 17 17 7",key:"1vkiza"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=h("Eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v=h("RefreshCw",[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=h("Sparkles",[["path",{d:"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",key:"4pj2yx"}],["path",{d:"M20 3v4",key:"1olli1"}],["path",{d:"M22 5h-4",key:"1gvqau"}],["path",{d:"M4 17v2",key:"vumght"}],["path",{d:"M5 18H3",key:"zchphs"}]]);async function w({agentId:e,threadId:i="",conversationId:n="",projectContext:a}){const r=i?{threadId:i,conversationId:n}:await d("/api/agent-conversations/open",{agentId:e});if(!r.threadId)throw new Error("当前 Runtime 暂不支持此单聊页面");const s=new URLSearchParams(window.location.search);s.delete("view"),s.delete("archived"),s.delete("employee"),s.delete("employeeId"),s.set("agent",e),a!=null&&a.id?s.set("managerProjectId",a.id):s.delete("managerProjectId"),a!=null&&a.title?s.set("managerProjectTitle",a.title):s.delete("managerProjectTitle"),a!=null&&a.phase?s.set("managerProjectPhase",a.phase):s.delete("managerProjectPhase"),a!=null&&a.goal?s.set("managerProjectGoal",a.goal):s.delete("managerProjectGoal"),s.set("thread",r.threadId),r.conversationId?s.set("conversation",r.conversationId):s.delete("conversation");const t=s.toString();return window.history.pushState({surface:"conversation",agentId:e,threadId:r.threadId},"",`/${t?`?${t}`:""}`),window.dispatchEvent(new Event("negus:navigate")),r}const l=e=>e?`?roomId=${encodeURIComponent(e)}`:"",p=(e,i)=>{const n=new URLSearchParams(e?{roomId:e}:{});return Object.entries(i).forEach(([a,r])=>{r!==void 0&&r!==""&&n.set(a,String(r))}),n.toString()},k={rooms:e=>o("/api/group/rooms",e),snapshot:(e="",i)=>o(`/api/group/snapshot${l(e)}`,i),messages:(e="",i={},n)=>o(`/api/group/messages?${p(e,i)}`,n),join:(e,i="",n)=>d("/api/group/join",{memberId:e.id,name:e.name,roomId:i},n),presence:(e,i="",n)=>d("/api/group/presence",{memberId:e.id,name:e.name,roomId:i},n),updateAgentSettings:(e,i,n,a,r="",s)=>d("/api/group/agent-settings",{agentId:e,modelProviderId:i,model:n,reasoningEffort:a,roomId:r},s),send:(e,i,n,a,r=[],s=null,t)=>d("/api/group/message",{memberId:e.id,authorName:e.name,roomId:i,text:n,attachmentIds:r,clientMessageId:a,replyTo:s},t),interrupt:(e="",i)=>d("/api/group/interrupt",{roomId:e},i),eventsUrl:()=>g("/events")};export{m as A,u as E,v as R,y as S,k as g,w as o};
