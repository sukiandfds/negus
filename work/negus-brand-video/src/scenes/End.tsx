import React from 'react';
import {AbsoluteFill,interpolate,useCurrentFrame} from 'remotion';
import {C,Logo,Reveal,clamp,ease} from '../design';
export const End=()=>{const f=useCurrentFrame();return <AbsoluteFill style={{background:C.accent,color:C.ink,fontFamily:'"PingFang SC","Helvetica Neue",sans-serif',alignItems:'center',justifyContent:'center'}}><div style={{position:'absolute',width:900,height:900,border:'1px solid #89C9A8',borderRadius:'50%',scale:interpolate(f,[0,120],[.9,1.08],clamp)}}/>
 <div style={{display:'flex',alignItems:'center',gap:18,opacity:interpolate(f,[0,20],[0,1],clamp),scale:interpolate(f,[0,35],[.94,1],{...clamp,easing:ease})}}><Logo size={210} color={C.ink}/><span style={{fontSize:228,fontWeight:650,letterSpacing:-12,lineHeight:1}}>negus</span></div>
 <Reveal delay={16} style={{marginTop:52,fontSize:53,fontWeight:500,letterSpacing:2}}>让工作，围绕你展开。</Reveal><Reveal delay={28} style={{marginTop:25,fontSize:23,fontWeight:600,letterSpacing:5,color:'#52785E'}}>YOUR WORK. YOUR WAY.</Reveal>
 </AbsoluteFill>};
