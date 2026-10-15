from pathlib import Path
import json,runpy,urllib.request,base64
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
ROOT=Path(__file__).parent
ns={'__file__':str((ROOT/'collect_github.py').resolve())}
# Load helper definitions without replaying earlier searches.
s=(ROOT/'collect_github.py').read_text();exec(s.split('queries=',1)[0],ns)
ns['opener']=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7892'}))
get=ns['get'];dest=ROOT/'sources/github';entries=json.loads((dest/'manifest.json').read_text())
for e in entries:
 if e.get('commit'):continue
 try:
  meta=get('repos/'+e['repo']);e.update({k:meta.get(k) for k in ['full_name','html_url','description','license','stargazers_count','pushed_at','archived','default_branch']});c=get('repos/'+e['repo']+'/commits/'+meta['default_branch']);e.update(commit=c['sha'],commitDate=c['commit']['committer']['date']);tree=get('repos/'+e['repo']+'/git/trees/'+e['commit']+'?recursive=1');folder=dest/e['repo'].replace('/','--');folder.mkdir(exist_ok=True);(folder/'tree.json').write_text(json.dumps(tree,indent=2)+'\n');e['treeTruncated']=tree.get('truncated');paths=[x['path'] for x in tree.get('tree',[]) if x['type']=='blob'];e['candidateFiles']=[p for p in paths if any(t in p.lower() for t in ['groupchat','group-chat','group_chat','delegation','subagent','speaker','selector_group','supervisor'])][:100];e.pop('error',None)
 except Exception as err:e['retryError']=str(err)
(dest/'manifest.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
for e in entries: print(e['repo'],e.get('full_name'),e.get('commit'),e.get('retryError',''))
# Pin source reads to recorded commits; use raw host rather than API content quota.
selected={
 'milind-soni/OpenMausBot':['server/delegations.ts','server/room-handoffs.ts','server/decider/room-routing.ts','src/lib/group-routing.ts','src/components/GroupView.tsx','docs/decision-model.md','server/room-turn-timeout.ts','server/room-turn-end.ts','server/room-recovery.e2e.test.ts'],
 'ScriptedAlchemy/grok-bot-cli':['src/core/gateway.js'],
 'HKUDS/nanobot':['nanobot/agent/subagent.py','nanobot/agent/subagent_sessions.py','webui/src/components/thread/SubagentTasks.tsx'],
 'openclaw/openclaw':['docs/tools/subagents.md','docs/tools/subagents/announce.md','src/agents/subagents/registry/subagent-registry-store.ts','src/agents/subagents/announce/subagent-announce-origin.ts'],
}
for e in entries:
 folder=dest/e['repo'].replace('/','--');path=folder/'tree.json'
 if not e.get('commit') or not path.exists():continue
 paths=[x['path'] for x in json.loads(path.read_text()).get('tree',[]) if x['type']=='blob']
 base=[p for p in ['README.md','LICENSE','LICENSE.md','LICENSE.txt','package.json','pyproject.toml'] if p in paths and not (folder/p).exists()]
 if e['repo']=='lobehub/lobe-chat':selected[e['repo']]=[p for p in paths if p.endswith(('.ts','.tsx')) and ('group' in p.lower()) and any(x in p for x in ['server/services/agent','server/routers','database/schemas'])][:5]
 if e['repo']=='danny-avila/LibreChat':selected[e['repo']]=[p for p in paths if p.endswith(('.ts','.js')) and any(x in p.lower() for x in ['agentchain','agent-chain','agents/run','agents/client'])][:3]
 if e['repo']=='microsoft/autogen':selected[e['repo']]=[p for p in paths if p.endswith('.py') and any(x in p for x in ['_selector_group_chat.py','_round_robin_group_chat.py','_swarm_group_chat.py'])][:3]
 if e['repo']=='langchain-ai/langgraph':selected[e['repo']]=['libs/langgraph/langgraph/types.py','libs/langgraph/langgraph/checkpoint/base/__init__.py']
 selected[e['repo']]=base+selected.get(e['repo'],[])
raw=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7892'}))
def fetch(arg):
 e,path=arg;url='https://raw.githubusercontent.com/'+e['repo']+'/'+e['commit']+'/'+path;folder=dest/e['repo'].replace('/','--');target=folder/path.replace('/','__')
 try:
  with raw.open(urllib.request.Request(url,headers={'User-Agent':'Negus-product-research'}),timeout=25) as response:body=response.read()
  target.write_bytes(body)
  return e['repo'],{'path':path,'file':str(target.relative_to(ROOT)),'url':'https://github.com/'+e['repo']+'/blob/'+e['commit']+'/'+path,'sha256':sha256(body).hexdigest(),'bytes':len(body)}
 except Exception as err:return e['repo'],{'path':path,'error':str(err),'url':url}
args=[(e,p) for e in entries if e.get('commit') for p in selected.get(e['repo'],[])]
with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(fetch,args))
for repo,file in results:
 next(e for e in entries if e['repo']==repo)['files'].append(file)
 print(repo,file['path'],file.get('bytes',file.get('error')))
(dest/'manifest.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
