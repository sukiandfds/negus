import React from 'react';
import {interpolate,useCurrentFrame} from 'remotion';
import {C,Frame,Reveal,Label,clamp,ease} from '../design';
export const Idea=()=>{const f=useCurrentFrame();return <Frame kicker="A SPACE FOR YOUR IDEAS" number="01">
 <div style={{position:'absolute',left:160,top:240}}><Reveal><Label>每一个想法，都值得向前一步</Label></Reveal><Reveal delay={7}><h1 style={{fontSize:124,lineHeight:1.26,letterSpacing:-6,fontWeight:600,margin:'35px 0'}}>把想法，<br/><span style={{color:C.accent}}>变成下一步。</span></h1></Reveal></div>
 <div style={{position:'absolute',right:160,top:250,width:430,height:520}}>{['一个新项目','一个好问题','一次新尝试'].map((s,i)=><div key={s} style={{position:'absolute',top:i*142,width:430,height:106,border:'1px solid #385144',borderRadius:18,background:'#18251E',display:'flex',alignItems:'center',padding:'0 32px',gap:25,fontSize:35,opacity:interpolate(f,[12+i*9,33+i*9],[0,1],clamp),translate:`${interpolate(f,[12+i*9,47+i*9],[100,0],{...clamp,easing:ease})}px 0`,rotate:`${interpolate(f,[12+i*9,47+i*9],[8,0],{...clamp,easing:ease})}deg`}}><span style={{width:11,height:11,borderRadius:'50%',background:C.accent}}/>{s}</div>)}</div>
 </Frame>};
