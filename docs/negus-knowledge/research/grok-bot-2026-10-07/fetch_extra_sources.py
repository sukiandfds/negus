from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,urllib.request
from hashlib import sha256
root=Path(__file__).parent;dest=root/'sources/github';entries=json.loads((dest/'manifest.json').read_text())
selected={
'lobehub/lobe-chat':['apps/server/src/services/agentGroup/index.ts','packages/agent-runtime/src/groupOrchestration/GroupOrchestrationSupervisor.ts','packages/agent-runtime/src/groupOrchestration/GroupOrchestrationRuntime.ts','apps/server/src/routers/lambda/agentGroup.ts','packages/builtin-agents/src/agents/group-supervisor/systemRole.ts'],
'danny-avila/LibreChat':['client/src/components/Chat/Subagents/SubagentThreadPanel.tsx','client/src/components/Chat/Subagents/task.ts','client/src/components/Chat/Subagents/identity.ts'],
'langchain-ai/langgraph':['libs/checkpoint/langgraph/checkpoint/base/__init__.py'],
'openclaw/openclaw':['src/agents/subagents/registry/subagent-registry-state.ts','src/agents/subagents/registry/subagent-registry-persistence.ts','src/agents/subagents/registry/subagent-recovery-state.ts'],
}
op=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7892'}))
def fetch(item):
 e,path=item;url='https://raw.githubusercontent.com/'+e.get('full_name',e['repo'])+'/'+e['commit']+'/'+path
 try:
  with op.open(urllib.request.Request(url,headers={'User-Agent':'Negus-product-research'}),timeout=25) as r:body=r.read()
  target=dest/e['repo'].replace('/','--')/path.replace('/','__');target.write_bytes(body)
  return e['repo'],{'path':path,'file':str(target.relative_to(root)),'url':'https://github.com/'+e.get('full_name',e['repo'])+'/blob/'+e['commit']+'/'+path,'bytes':len(body),'sha256':sha256(body).hexdigest()}
 except Exception as err:return e['repo'],{'path':path,'url':url,'error':str(err)}
args=[(e,p) for e in entries for p in selected.get(e['repo'],[])]
with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(fetch,args))
for repo,file in results:
 next(e for e in entries if e['repo']==repo)['files'].append(file); print(repo,file['path'],file.get('bytes',file.get('error')))
(dest/'manifest.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
