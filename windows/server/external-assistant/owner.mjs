import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readJsonFile, writeJsonFileAtomic } from '../persistence/json-file.mjs';
const exec = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');
const error = (message,statusCode) => Object.assign(Error(message),{statusCode});
const origin='https://auth.negus.us.ci';
const approveBinding = async email => {
  if(process.platform!=='darwin') throw error('请由主机管理员预设 NEGUS_OWNER_ACCOUNT_ID 后登录',403);
  // Pass the identity as data, never interpolate it in script source.
  await exec('/usr/bin/osascript',['-e','on run argv','-e','display dialog ("将这个已验证的 Negus 账号绑定为唯一管理者？" & return & item 1 of argv) buttons {"取消","绑定此账号"} default button "取消" with title "Negus 本人账号绑定"','-e','do shell script "/usr/bin/true" with administrator privileges','-e','end run','--',email],{timeout:90000});
};
export function ownerSessions(root,{ request=fetch, confirmBinding=approveBinding, configured=process.env.NEGUS_OWNER_ACCOUNT_ID }={}) {
  const file=path.join(root,'runtime','external-assistant-owner.json');
  const sessions=new Map(), expires=15*60000;
  let binding;
  async function api(route,body) {
    const response=await request(origin+'/api/auth/'+route,{method:'POST',redirect:'error',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw error('账号服务未通过验证；请检查验证码、有效期或稍后重试',403);
    return response.json();
  }
  const checkEmail = email => {
    if(typeof email!=='string'||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||/[\r\n]/.test(email)) throw error('请输入有效的本人账号邮箱',400);
  };
  return {
    async send(email) { checkEmail(email); await api('email-otp/send-verification-otp',{email,type:'sign-in'}); },
    async verify(email,otp) {
      checkEmail(email);
      if(typeof otp!=='string'||!/^\d{6}$/.test(otp)) throw error('请输入六位验证码',400);
      const {user}=await api('sign-in/email-otp',{email,otp});
      if(!user?.emailVerified||typeof user.id!=='string'||user.email?.toLowerCase()!==email.toLowerCase()) throw error('账号身份验证未通过',403);
      const who=digest(user.id);
      const verifyBinding=async()=>{
        const saved=await readJsonFile(file,null);
        if(configured || saved) {
          if(who!==(configured?digest(configured):saved.account)) throw error('此账号不是已绑定的本人账号',403);
        } else {
          try { await confirmBinding(user.email); } catch { throw error('首次绑定需要在 Negus 主机确认此账号',403); }
          await writeJsonFileAtomic(file,{account:who},{mode:0o600});
        }
      };
      if(binding) throw error('有账号正在验证，请稍后重试',409);
      binding=verifyBinding();try {await binding;} finally {binding=null;}
      for(const [k,v] of sessions) if(v<=Date.now()) sessions.delete(k);
      const value=randomBytes(32).toString('base64url');
      sessions.set(digest(value),Date.now()+expires);return value;
    },
    check(cookie) {
      const value=String(cookie||'').match(/(?:^|;\s*)negus_owner=([a-zA-Z0-9_-]{43})(?:;|$)/)?.[1];
      return Boolean(value && sessions.get(digest(value))>Date.now());
    },
  };
}
