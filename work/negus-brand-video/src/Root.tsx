import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';
export const Root=()=> <Composition id="NegusBrand" component={Film} durationInFrames={900} fps={30} width={1920} height={1080}/>;
