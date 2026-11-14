import React from 'react';
import {interpolate,useCurrentFrame} from 'remotion';
import {C,Frame,Reveal,Label,Logo,clamp,ease} from '../design';
export const Identity=()=>{const f=useCurrentFrame();return <Frame light kicker="BUILT AROUND YOU" number="02">
 <div style={{position:'absolute',left:160,top:290}}><Reveal><Label light>从一次对话，开始</Label></Reveal><Reveal delay={8}><h1 style={{fontSize:108,lineHeight:1.38,letterSpacing:-5,fontWeight:600,margin:'34px 0'}}>你的助理。<br/>你的工作空间。</h1></Reveal></div>
 <div style={{position:'absolute',right:245,top:290,width:470,height:470,border:'1px solid #BCD3C3',borderRadius:'50%',scale:interpolate(f,[0,60],[.85,1],{...clamp,easing:ease})}}><div style={{position:'absolute',inset:58,border:'1px solid #C6DCCB',borderRadius:'50%'}}/><div style={{position:'absolute',inset:122,background:C.ink,borderRadius:40,display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 24px 60px #19342622'}}><Logo size={180}/></div>
 {['项目','对话','成果'].map((s,i)=>{const a=i*2.094+f*.0015;return <div key={s} style={{position:'absolute',left:210+Math.cos(a)*236-46,top:210+Math.sin(a)*236-22,border:'1px solid #C2D7C6',background:'#F8FAF5',borderRadius:40,padding:'18px 32px',fontSize:30,fontWeight:500,whiteSpace:'nowrap',opacity:interpolate(f,[20+i*9,40+i*9],[0,1],clamp)}}>{s}</div>})}</div>
 </Frame>};
