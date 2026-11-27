import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {submissionIdOf} from '../message-identity.mjs';

const identity={authorId:'external:muse',authorName:'Muse',displaySourceAgentId:'external:muse'};
export function externalMessages(root){
  let db;
  function store(){
    if(!db){
      const dir=path.join(root,'runtime','external-work');
      mkdirSync(dir,{recursive:true,mode:0o700});
      db=new DatabaseSync(path.join(dir,'messages.sqlite'));
      db.exec('CREATE TABLE IF NOT EXISTS messages (key TEXT PRIMARY KEY, thread TEXT NOT NULL, digest TEXT NOT NULL, id TEXT UNIQUE NOT NULL, state TEXT NOT NULL)');
      db.exec('CREATE TABLE IF NOT EXISTS started_turns (thread TEXT NOT NULL, turn TEXT NOT NULL, submission TEXT NOT NULL, PRIMARY KEY(thread,turn))');
    }
    return db;
  }
  const actorFor=(thread,id)=>typeof id==='string' && id.startsWith('muse-') && store().prepare('SELECT 1 FROM messages WHERE thread=? AND id=?').get(thread,id)?identity:null;
  return {actorFor,recordStartedTurn(thread,id,reply){
    const turn=reply?.turn?.id || reply?.turnId;
    if(!turn || reply?.status==='steered' || !actorFor(thread,id))return;
    store().prepare('INSERT OR IGNORE INTO started_turns VALUES(?,?,?)').run(thread,turn,id);
  },ownsTurn(thread,turn,actor){
    const row=store().prepare('SELECT m.key FROM started_turns t JOIN messages m ON m.id=t.submission AND m.thread=t.thread WHERE t.thread=? AND t.turn=?').get(thread,turn);
    return !!row && JSON.parse(row.key)[0]===actor;
  },decorate(thread,session){
    if(!session)return session;
    const decorate=m=>m.role==='user' && actorFor(thread,submissionIdOf(m))?{...m,...identity}:m;
    return {...session,...(session.messages&&{messages:session.messages.map(decorate)}),...(session.upserts&&{upserts:session.upserts.map(decorate)})};
  },async submit({project,thread,text,submissionId},ctx,queue){
    await ctx.checkGrant();
    const key=JSON.stringify([ctx.actor,project,thread,submissionId]),digest=createHash('sha256').update(text).digest('hex');
    const s=store(), prior=s.prepare('SELECT * FROM messages WHERE key=?').get(key);
    if(prior && prior.digest!==digest)throw Object.assign(Error('同一提交号不能更改正文'),{publicWorkError:true});
    if(prior)return {threadId:thread,submissionId:prior.id,state:prior.state};
    const id='muse-'+randomUUID();
    s.prepare('INSERT INTO messages VALUES(?,?,?,?,?)').run(key,thread,digest,id,'pending');
    try{
      await queue.enqueue({threadId:thread,text,submissionId:id,stableDispatchId:id});
      s.prepare('UPDATE messages SET state=? WHERE key=?').run('accepted',key);
      return {threadId:thread,submissionId:id,state:'accepted'};
    }catch(e){s.prepare('UPDATE messages SET state=? WHERE key=?').run('failed',key);throw e;}
  }};
}
