"""Read-only GitHub discovery and pinned source snapshots. Never execute repos."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from hashlib import sha256
import urllib.request, urllib.parse, json, base64
ROOT=Path(__file__).parent; DEST=ROOT/'sources'/'github';DEST.mkdir(parents=True,exist_ok=True)
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def get(path):
    request=urllib.request.Request('https://api.github.com/'+path,headers={'User-Agent':'Negus-product-research','Accept':'application/vnd.github+json'})
    with opener.open(request,timeout=25) as response:return json.load(response)
def search(query):
    try:
        data=get('search/repositories?'+urllib.parse.urlencode({'q':query,'per_page':12,'sort':'updated'}))
        return {'query':query,'total':data.get('total_count'), 'items':[{k:r.get(k) for k in ['full_name','description','html_url','stargazers_count','pushed_at','archived','license']} for r in data.get('items',[])]}
    except Exception as e:return {'query':query,'error':str(e)}
queries=['"Grok Bot"','"OpenMausBot"','multi agent group chat','AI coworkers chat','"group chat" agents in:readme language:TypeScript','org:xai-org bot','org:openai dots']
# Search rate limit is low; sequential requests, no search retry storm.
searches=[search(q) for q in queries]
(DEST/'searches.json').write_text(json.dumps({'collectedAt':datetime.now(timezone.utc).isoformat(),'searches':searches},ensure_ascii=False,indent=2)+'\n')
for x in searches:print(x['query'],x.get('total',x.get('error')),[r['full_name'] for r in x.get('items',[])][:8])
repos=['milind-soni/OpenMausBot','ScriptedAlchemy/grok-bot-cli','openclaw/openclaw','HKUDS/nanobot','lobehub/lobe-chat','danny-avila/LibreChat','microsoft/autogen','langchain-ai/langgraph']
def inspect(repo):
    entry={'repo':repo,'collectedAt':datetime.now(timezone.utc).isoformat(),'files':[]}
    folder=DEST/repo.replace('/','--');folder.mkdir(exist_ok=True)
    try:
        meta=get('repos/'+repo); entry.update({k:meta.get(k) for k in ['html_url','description','license','stargazers_count','pushed_at','updated_at','archived','default_branch','fork']})
        commit=get('repos/'+repo+'/commits/'+meta['default_branch']);entry['commit']=commit['sha'];entry['commitDate']=commit['commit']['committer']['date']
        tree=get('repos/'+repo+'/git/trees/'+entry['commit']+'?recursive=1');entry['treeTruncated']=tree.get('truncated');(folder/'tree.json').write_text(json.dumps(tree,indent=2)+'\n')
        paths=[x['path'] for x in tree.get('tree',[]) if x['type']=='blob'];entry['candidateFiles']=[p for p in paths if any(t in p.lower() for t in ['groupchat','group-chat','group_chat','delegation','subagent','teamchat','team-chat','groupagent','group-agent','speaker','manager.ts','announce'])][:150]
        for path in ['README.md','LICENSE','LICENSE.md','package.json','pyproject.toml']:
            if path not in paths:continue
            data=get('repos/'+repo+'/contents/'+path+'?ref='+entry['commit']); body=base64.b64decode(data['content']); filename=path.replace('/','__');(folder/filename).write_bytes(body);entry['files'].append({'path':path,'file':str((folder/filename).relative_to(ROOT)),'blob':data['sha'],'sha256':sha256(body).hexdigest(),'url':'https://github.com/'+repo+'/blob/'+entry['commit']+'/'+path})
        try:
            rel=get('repos/'+repo+'/releases/latest');entry['latestRelease']={k:rel.get(k) for k in ['tag_name','published_at','html_url','prerelease']}
        except Exception as e:entry['latestReleaseError']=str(e)
    except Exception as e:entry['error']=str(e)
    return entry
with ThreadPoolExecutor(max_workers=4) as pool:entries=list(pool.map(inspect,repos))
(DEST/'manifest.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
for x in entries:print(x['repo'],x.get('commit'),x.get('license',{}),x.get('error',''))
