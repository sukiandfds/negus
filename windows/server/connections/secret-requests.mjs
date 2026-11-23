import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runtime} from '../../../scripts/negus-service-common.mjs';
export function slot(thread){if(!/^[\w-]{1,128}$/.test(thread))throw Error('会话编号无效');return path.join(runtime,'secret-requests',thread+'.json')}
export async function pending(thread){const r=await fs.readFile(slot(thread),'utf8').then(JSON.parse).catch(()=>null);return r?.until>Date.now()?r:null}
export async function requestSecret(thread,kind,label,instruction){if(!['google','resend'].includes(kind))throw Error('不支持的凭据');const f=slot(thread);await fs.mkdir(path.dirname(f),{recursive:true,mode:0o700});const data={id:randomUUID(),kind,label,instruction,until:Date.now()+600000};const tmp=f+'.'+data.id;await fs.writeFile(tmp,JSON.stringify(data),{mode:0o600});await fs.rename(tmp,f);return {requested:true,label:data.label}}
