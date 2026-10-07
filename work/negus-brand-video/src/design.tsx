import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';

export const C={ink:'#101716',paper:'#F3F5F0',accent:'#A5F2CE',muted:'#90A29A'};
export const ease=Easing.bezier(.16,1,.3,1);
export const clamp={extrapolateLeft:'clamp' as const,extrapolateRight:'clamp' as const};
export const Logo:React.FC<{size?:number;color?:string}> = ({size=80,color=C.paper})=><svg width={size} height={size} viewBox="0 0 1000 1000"><polygon points="222,222 222,778 333,778 333,333 444,333 556,500 556,222" fill={color}/><polygon points="778,778 778,222 667,222 667,667 556,667 444,500 444,778" fill={color}/></svg>;
export const Label:React.FC<{children:React.ReactNode;light?:boolean}>=({children,light=false})=><div style={{fontSize:23,letterSpacing:4,fontWeight:600,color:light?'#50605A':C.muted,textTransform:'uppercase'}}>{children}</div>;
export const Reveal:React.FC<{children:React.ReactNode;delay?:number;style?:React.CSSProperties}>=({children,delay=0,style})=>{const f=useCurrentFrame();return <div style={{...style,opacity:interpolate(f,[delay,delay+24],[0,1],clamp),translate:`0 ${interpolate(f,[delay,delay+32],[44,0],{...clamp,easing:ease})}px`}}>{children}</div>};
export const Frame:React.FC<{children:React.ReactNode;light?:boolean;kicker?:string;number?:string}>=({children,light=false,kicker,number})=>{const f=useCurrentFrame();return <AbsoluteFill style={{background:light?C.paper:C.ink,color:light?C.ink:C.paper,fontFamily:'"PingFang SC", "Helvetica Neue", sans-serif',overflow:'hidden'}}>
 <svg width="1920" height="1080" style={{position:'absolute',opacity:light?.035:.045}}><defs><pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M 80 0 L 0 0 0 80" stroke={light?'#10251C':'#D3FAE7'} fill="none" strokeWidth="1"/></pattern></defs><rect width="1920" height="1080" fill="url(#grid)"/></svg>
 <div style={{position:'absolute',width:1000,height:1000,right:-400,top:-500,border:'1px solid '+(light?'#D4DFD7':'#253A30'),borderRadius:'50%',scale:interpolate(f,[0,180],[.95,1.15],clamp)}}/>
 <div style={{position:'absolute',top:54,left:82,display:'flex',alignItems:'center',gap:8}}><Logo size={53} color={light?C.ink:C.paper}/><span style={{fontSize:30,fontWeight:700,letterSpacing:-1}}>negus</span></div>
 {kicker&&<div style={{position:'absolute',right:92,top:75}}><Label light={light}>{kicker}</Label></div>}
 {children}
 <div style={{position:'absolute',left:100,bottom:54,height:2,width:68,background:light?'#617F6B':C.accent}}/>
 <div style={{position:'absolute',right:98,bottom:44,fontSize:19,fontVariantNumeric:'tabular-nums',color:light?'#6F8177':C.muted}}>{number} / 06</div>
 </AbsoluteFill>};
export const Arrow=({color=C.ink,size=30}:{color?:string;size?:number})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 12h16M13 5l7 7-7 7" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
