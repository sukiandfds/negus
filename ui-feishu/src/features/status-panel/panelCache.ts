import {useEffect,useState,useSyncExternalStore} from 'react';
import {openConversationCache} from '../../../shared/features/conversations/data/conversationSnapshot';
import {fetchJson} from '../../../shared/shared/api/http';
import {observeProjectStream} from '../../projectEvents';

type Row={id:string};
type Entry={version:string;revision:string;rows:Row[];meta:{warnings?:string[]}};
type Delta={version:string;signal?:string;order:string[];rows:Row[];meta:Entry['meta']};
const memory=new Map<string,Entry>(),pending=new Map<string,Promise<Entry>>();
const indexes=new Map<string,{versions:Record<string,string>;warnings:string}>(),callbacks=new Set<()=>void>();
const stream=observeProjectStream();
stream.onmessage=e=>{
  if(typeof e.data==='string' && e.data.startsWith('{"type":"topic_updated"')){
    const {threadId,version}=JSON.parse(e.data);const versions={...indexes.get('topics')?.versions,[threadId]:version};
    indexes.set('topics',{versions,warnings:''});for(const cb of callbacks)cb();return;
  }
  if(typeof e.data!=='string'||!e.data.startsWith('{"type":"panel_versions"'))return;
  const msg=JSON.parse(e.data);if(msg.type!=='panel_versions')return;
  indexes.set(msg.section,msg);for(const cb of callbacks)cb();
};
const subscribe=(cb:()=>void)=>{callbacks.add(cb);return ()=>{callbacks.delete(cb);};};
export function usePanelSignal(thread:string,section:string){
  return useSyncExternalStore(subscribe,()=>{const index=indexes.get(section);
    return index?(index.versions[thread]||'-')+':'+index.warnings:'';});
}
const remember=(key:string,value:Entry)=>{
  memory.delete(key);memory.set(key,value);
  if(memory.size>128)memory.delete(memory.keys().next().value!);
};
async function restore(key:string):Promise<Entry|undefined>{
  if(memory.has(key))return memory.get(key);
  try{const db=await openConversationCache();return await new Promise((resolve,reject)=>{
    const req=db.transaction('metadata').objectStore('metadata').get(key);
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });}catch{return undefined;}
}
function save(key:string,value:Entry){
  remember(key,value);void openConversationCache().then(db=>{
    db.transaction('metadata','readwrite').objectStore('metadata').put(value,key);
  }).catch(()=>{});
}
export function usePanelRows<T extends Row>(thread:string,section:string,revision:string,turn=''){
  const key=JSON.stringify([section==='activity'?'panel-v2':'panel-v1',thread,section,turn]);
  const [entry,set]=useState<Entry|undefined>(()=>memory.get(key)),[error,fail]=useState('');
  useEffect(()=>{let active=true;
    async function read(){
      const cached=memory.get(key)||await restore(key);
      if(!active)return;
      if(cached){set(cached);remember(key,cached);}
      fail('');
      if(cached && (!revision || cached.revision===revision))return;
      const requestKey=JSON.stringify([key,revision]);
      let request=pending.get(requestKey);
      if(!request){
        const params=new URLSearchParams({threadId:thread,section,delta:'1'});
        if(turn)params.set('turnId',turn);if(cached)params.set('base',cached.version);
        request=fetchJson<Delta>('/api/session/status-panel?'+params).then(delta=>{
          const items=new Map(cached?.rows.map(row=>[row.id,row]));for(const row of delta.rows)items.set(row.id,row);
          return {version:delta.version,revision:delta.signal??revision,meta:delta.meta,rows:delta.order.map(id=>items.get(id)!)};
        }).finally(()=>pending.delete(requestKey));
        pending.set(requestKey,request);
      }
      const next=await request;if(active){save(key,next);set(next);}
    }
    if(thread)void read().catch(e=>{if(active)fail(e.message);});return ()=>{active=false;};
  },[key,thread,section,turn,revision]);
  return {data:entry?.rows as T[]|undefined,warnings:entry?.meta.warnings||[],error};
}
