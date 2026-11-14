import json,pathlib,collections,re
raw=json.loads(pathlib.Path('work/conversation_extract.json').read_text()); threads={}
for t in raw:
 if t['cwd'] not in ['/Users/hans/myproject/negus','/Users/hans/myproject']:continue
 g=threads.setdefault(t['thread'],{'thread':t['thread'],'users':[],'finals':[],'files':[]})
 g['files'].append(t['file']);g['finals']+=t['finals']
 for u in t['users']:
  if u['text'].startswith(('<codex_internal_context','<subagent_notification')):continue
  if any((v.get('msg_id') and v['msg_id']==u.get('msg_id')) or (v['time']==u['time'] and v['text']==u['text']) for v in g['users']):continue
  g['users'].append({**u,'file':t['file']})
ts=sorted(threads.values(),key=lambda t:min([u['time'] for u in t['users']] or ['z']))
lines=[];n=0
for i,t in enumerate(ts,1):
 t['key']=f'T{i:02}'
 lines.append(f"\n### {t['key']} {t['thread']} ({len(t['users'])} messages)")
 for u in sorted(t['users'],key=lambda u:u['time']):
  n+=1;u['key']=f'U{n:03}';text=u['text']
  text=re.sub(r'\[附件正文：[\s\S]*','[附件正文略]',text)
  text=re.sub(r'sk-[A-Za-z0-9_-]{10,}','[凭据已隐去]',text)
  lines.append(f"{u['key']} {u['time'][:16]} {text}")
pathlib.Path('work/feedback_corpus.json').write_text(json.dumps(ts,ensure_ascii=False,indent=2))
pathlib.Path('work/user_messages.txt').write_text('\n'.join(lines))
print('THREADS',len(ts),'MESSAGES',n,'DAYS',dict(collections.Counter(u['time'][:10] for t in ts for u in t['users'])))
