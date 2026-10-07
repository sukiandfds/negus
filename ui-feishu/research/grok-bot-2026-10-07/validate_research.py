"""Artifact integrity only; this does not test product behavior."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,re,csv
ROOT=Path(__file__).parent.resolve();REPO=ROOT.parents[2]
errors=[];original=json.loads((REPO/'ui-feishu/validation/original-files.json').read_text());changes=[]
for name,digest in original.items():
 p=REPO/name
 if not p.exists() or sha256(p.read_bytes()).hexdigest()!=digest:changes.append(name)
if changes:errors.append('original files changed: '+', '.join(changes))
manifest=json.loads((ROOT/'official-manifest.json').read_text());official_count=0
for e in manifest:
 if 'file' not in e:errors.append('official fetch failed '+e['url']);continue
 p=ROOT/e['file']
 if sha256(p.read_bytes()).hexdigest()!=e['sha256']:errors.append('hash '+str(p))
 if e['status']!=200:errors.append('non-200 '+e['url'])
 if not e['url'].endswith('/llms.txt'):official_count+=1
if official_count!=39:errors.append('unexpected doc count '+str(official_count))
git_entries=json.loads((ROOT/'sources/github/manifest.json').read_text());github_files=0;failed=[]
for e in git_entries:
 if not e.get('commit'):errors.append('missing commit '+e['repo'])
 for f in e.get('files',[]):
  if 'error' in f:failed.append({'repo':e['repo'],**f});continue
  p=ROOT/f['file'];github_files+=1
  if sha256(p.read_bytes()).hexdigest()!=f['sha256']:errors.append('github hash '+str(p))
for f in json.loads((ROOT/'sources/github/discovery-extra-files.json').read_text()):
 if 'file' in f:
  p=ROOT/f['file']
  if sha256(p.read_bytes()).hexdigest()!=f['sha256']:errors.append('extra hash '+str(p))
rows=json.loads((ROOT/'feature-matrix.json').read_text());seen=set()
for r in rows:
 if r['id'] in seen:errors.append('duplicate feature ID '+r['id'])
 seen.add(r['id']);p=ROOT/'sources/official'/r['source']
 if not p.exists() or not 1<=r['source_line']<=len(p.read_text().splitlines()):errors.append('bad feature reference '+r['id'])
links=0
for filename in ['REPORT.md','FEATURE_MATRIX.md','REPLICA_SPEC.md','OPEN_SOURCE.md','ACCEPTANCE.md']:
 p=ROOT/filename
 for raw in re.findall(r'\]\(([^)]+)\)',p.read_text()):
  if raw.startswith(('http://','https://','#','mailto:')):continue
  raw=raw.split('#',1)[0];target=re.sub(r':\d+$','',raw);q=Path(target) if target.startswith('/') else p.parent/target;links+=1
  if not q.exists() and q.name!='VALIDATION.json':errors.append('missing local link '+raw)
ac=(ROOT/'ACCEPTANCE.md').read_text();cases=re.findall(r'^\| ([GRPS]\d{2}) \|',ac,re.M)
if len(cases)!=62:errors.append('case count '+str(len(cases)))
if len(set(cases))!=len(cases):errors.append('duplicate case ID')
coverage=json.loads((ROOT/'coverage.json').read_text());matrix_empty=[d['source'] for d in coverage['documents'] if not d['matrixIds']]
# Pages without own rows are redundant summaries or diagnostics reviewed alongside concrete help pages.
result={'validatedAt':datetime.now(timezone.utc).isoformat(),'validationKind':'research artifact integrity; NOT product/runtime acceptance','originalFilesChecked':len(original),'originalFilesChanged':changes,'officialDocuments200':official_count,'officialIndexedDocuments':sum(1 for e in manifest if e['url'].startswith('https://docs.x.ai/grok-bot/')),'officialHelpDocuments':sum(1 for e in manifest if e['url'].startswith('https://cursor.com/help/grok-bot/')),'githubRepositoriesPinned':len(git_entries),'githubSourceSnapshotsVerified':github_files,'featureRows':len(rows),'plannedAcceptanceCases':len(cases),'localLinksChecked':links,'consolidatedOfficialPages':matrix_empty,'documentedSourceFetchFailures':failed,'productRuntimeTested':False,'errors':errors,'passed':not errors}
(ROOT/'VALIDATION.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['documentedSourceFetchFailures','consolidatedOfficialPages']},ensure_ascii=False,indent=2))
raise SystemExit(bool(errors))
