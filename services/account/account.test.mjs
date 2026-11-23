import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createAccountService} from './auth.mjs';

test('邮箱验证、跨设备同一身份、退出、Google 登录及主动关联',async()=>{
  const db = new DatabaseSync(':memory:');
  const origin='https://auth.example.com';
  const mail=new Map();
  const a=createAccountService({database:db,origin,secret:randomBytes(32).toString('hex'),
    google:{clientId:'test.apps.googleusercontent.com',clientSecret:'fixture'},
    sendCode:async(email,otp)=>mail.set(email,otp)});
  db.exec(readFileSync(new URL('./migrations/0001.sql',import.meta.url),'utf8'));
  let device=0;
  const req=(path,body,cookie='')=>a.handler(new Request(origin+'/api/auth/'+path,{
    method:body?'POST':'GET',headers:{origin,'content-type':'application/json',cookie,'cf-connecting-ip':'192.0.2.'+device},
    body:body?JSON.stringify(body):undefined}));
  const signin=async email=>{
    device++;
    assert.equal((await req('email-otp/send-verification-otp',{email,type:'sign-in'})).status,200);
    const payload={email,otp:mail.get(email)};
    assert.ok(payload.otp);
    const r=await req('sign-in/email-otp',payload);
    assert.equal(r.status,200);
    assert.ok((await req('sign-in/email-otp',payload)).status>=400);
    return {user:(await r.json()).user,cookie:r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
  };
  const one=await signin('first@example.com'),two=await signin('first@example.com');
  assert.equal(one.user.id,two.user.id);
  assert.notEqual(one.cookie,two.cookie);
  const other=await signin('second@example.com');
  assert.notEqual(other.user.id,one.user.id);
  assert.equal((await (await req('get-session',null,two.cookie)).json()).user.id,one.user.id);
  assert.equal((await req('sign-out',{},one.cookie)).status,200);
  assert.equal(await (await req('get-session',null,one.cookie)).json(),null);
  for(const [path,cookie] of [['sign-in/social',''],['link-social',two.cookie]]){
    const r=await req(path,{provider:'google',callbackURL:'/'},cookie);
    assert.equal(r.status,200);
    const u=new URL((await r.json()).url);
    assert.equal(u.hostname,'accounts.google.com');
    assert.equal(u.searchParams.get('redirect_uri'),origin+'/api/auth/callback/google');
  }
  db.close();
});
