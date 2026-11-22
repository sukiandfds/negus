// This deadline tracks the promise to the parent chat, independently of whether the panel is open.
export const checkWindow = 5 * 60 * 1000;
export function backgroundChecks({read,save,probe,notify,onError=console.error,now=Date.now,delay=setTimeout,cancel=clearTimeout}) {
  let timer, closed=false, revision=0;
  const arm=(next)=>{cancel(timer);if(!closed){timer=delay(()=>void check().catch(onError),Math.max(0,next-now()));timer.unref?.();}};
  const check=async()=>{
    const version=revision; const last=now();let error='';
    try {const state=await probe();if(closed||version!==revision||['completed','failed','interrupted'].includes(state))return;}
    catch(e){error='状态查询失败：'+e.message;}
    if(closed||version!==revision)return;
    const next=last+checkWindow;
    try{await save({...read(),last,next,error});}finally{if(!closed&&version===revision)arm(next);}
  };
  return {
    async start(){const next=read()?.next||now()+checkWindow;if(!read()?.next)await save({next});arm(next);},
    async progress(id,text){if(read()?.reportId===id)return;const next=now()+checkWindow;await notify(id,text);revision++;await save({...read(),reportId:id,next,text,error:''});arm(next);},
    close(){closed=true;revision++;cancel(timer);}
  };
}
