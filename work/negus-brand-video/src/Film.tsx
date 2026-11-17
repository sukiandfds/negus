import React from 'react';
import {interpolate,staticFile} from 'remotion';
import {Audio} from '@remotion/media';
import {TransitionSeries,linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {Idea} from './scenes/Idea';
import {Identity} from './scenes/Identity';
import {Workspace} from './scenes/Workspace';
import {Connect} from './scenes/Connect';
import {Yours} from './scenes/Yours';
import {End} from './scenes/End';
import {clamp} from './design';
export const Film=()=><>
 <Audio src={staticFile('negus-original-score.wav')} volume={f=>interpolate(f,[0,22,835,900],[0,.8,.8,0],clamp)}/>
 <TransitionSeries>
 <TransitionSeries.Sequence durationInFrames={132}><Idea/></TransitionSeries.Sequence>
 <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
 <TransitionSeries.Sequence durationInFrames={162}><Identity/></TransitionSeries.Sequence>
 <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
 <TransitionSeries.Sequence durationInFrames={192}><Workspace/></TransitionSeries.Sequence>
 <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
 <TransitionSeries.Sequence durationInFrames={192}><Connect/></TransitionSeries.Sequence>
 <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
 <TransitionSeries.Sequence durationInFrames={162}><Yours/></TransitionSeries.Sequence>
 <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
 <TransitionSeries.Sequence durationInFrames={120}><End/></TransitionSeries.Sequence>
 </TransitionSeries>
 </>;
