import pathlib,json,datetime,re,collections
base=pathlib.Path('/Users/hans/myproject/negus')
roots=[pathlib.Path('/Users/hans/.codex/sessions'),pathlib.Path('/Users/hans/.codex/archived_sessions'),base/'runtime/model-providers']
rows=[]; threads=[]
for root in roots:
 for f in root.rglob('rollout-*.jsonl'):
  meta={}; users=[]; finals=[]
  for ln,line in enumerate(f.open(),1):
   try:o=json.loads(line)
   except:continue
   p=o.get('payload',{})
   if o.get('type')=='session_meta':meta=p
   if o.get('type')!='response_item' or p.get('type')!='message':continue
   txt='\n'.join(c.get('text','') for c in p.get('content',[]) if isinstance(c,dict))
   if p.get('role')=='assistant' and p.get('phase') in ('final','final_answer',None):finals.append({'time':o.get('timestamp'),'text':txt,'line':ln})
   if p.get('role')!='user':continue
   if txt.startswith(('<environment_context>','# AGENTS.md','<permissions instructions>','<turn_aborted>')):continue
   if not txt.strip():continue
   ts=o.get('timestamp','')
   try:date=datetime.datetime.fromisoformat(ts.replace('Z','+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=8))).isoformat()
   except:date=ts
   if date[:10]<'2026-09-26' or date[:10]>'2026-10-02':continue
   users.append({'time':date,'text':txt,'line':ln,'msg_id':p.get('id')})
  if not users:continue
  threads.append({'thread':meta.get('id'),'cwd':meta.get('cwd'),'file':str(f),'users':users,'finals':finals})
# Retain all candidates to inspect related projectless conversations, excluding current review chat.
threads=[t for t in threads if t['thread']!='01a0fd55-fc50-7e82-b264-98ac3b364add']
pathlib.Path('work/conversation_extract.json').write_text(json.dumps(threads,ensure_ascii=False,indent=2))
for t in threads:
 print(t['thread'],t['cwd'],'USER',len(t['users']),t['users'][0]['time'],t['users'][-1]['time'])
 print(' FIRST:',t['users'][0]['text'][:230].replace('\n',' '))
print('TOTAL',len(threads),sum(len(t['users']) for t in threads))
