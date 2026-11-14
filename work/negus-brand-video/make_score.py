import numpy as np
import wave
from pathlib import Path

# Original warm electronic score; deterministic synthesis, no sampled music.
sr=48000
length=30
mix=np.zeros((sr*length,2),dtype=np.float64)
rng=np.random.default_rng(61)
def add(start,duration,signal,pan=0):
    n=int(duration*sr); t=np.arange(n)/sr
    s=signal(t)
    begin=int(start*sr); end=min(begin+n,len(mix))
    if end<=begin:return
    mix[begin:end,0]+=s[:end-begin]*np.sqrt((1-pan)/2)
    mix[begin:end,1]+=s[:end-begin]*np.sqrt((1+pan)/2)
def hz(m):return 440*2**((m-69)/12)
chords=[[45,52,57,60,64],[41,48,53,57,60],[48,55,60,64,67],[43,50,55,59,62]]
for k,start in enumerate(np.arange(0,30,2.5)):
    chord=chords[(k//2)%4]
    for j,m in enumerate(chord):
        add(start,3.6,lambda t,m=m: .018*(np.sin(2*np.pi*hz(m)*t)+.18*np.sin(2*np.pi*hz(m)*2*t))*np.minimum(t/.35,1)*np.maximum(0,1-t/3.6)**.6,pan=(j-2)*.18)
    for j in range(8):
        note=chord[j%len(chord)]+24
        s=start+j*.3125
        add(s,.9,lambda t,note=note:.054*np.sin(2*np.pi*hz(note)*t)*np.exp(-t*7)*np.minimum(t/.006,1),pan=np.sin(j*1.2)*.55)
        add(s+.21,.75,lambda t,note=note:.015*np.sin(2*np.pi*hz(note)*t)*np.exp(-t*6)*np.minimum(t/.006,1),pan=-np.sin(j*1.2)*.5)
for beat,s in enumerate(np.arange(4,27,.625)):
    add(s,.42,lambda t:.15*np.sin(2*np.pi*(49*t+4.3*(1-np.exp(-t*19))))*np.exp(-t*12)*np.minimum(t/.003,1))
    if beat%2:
        noise=rng.standard_normal(int(.12*sr))
        add(s,.12,lambda t,noise=noise:.018*noise*np.exp(-t*35),pan=.15)
    if beat>4:
        noise=rng.standard_normal(int(.06*sr));noise=np.concatenate([[0],np.diff(noise)])
        add(s+.3125,.06,lambda t,noise=noise:.012*noise*np.exp(-t*65),pan=-.2)
# Soft impact at the mint closing frame.
add(26,2,lambda t:.085*(np.sin(2*np.pi*hz(45)*t)+.4*np.sin(2*np.pi*hz(57)*t))*np.exp(-t*2)*np.minimum(t/.025,1))
t=np.arange(len(mix))/sr
mix*=np.minimum(t/.5,1)[:,None]*np.minimum((30-t)/1.5,1)[:,None]
mix=np.tanh(mix*1.25)
mix*=.62/max(np.max(np.abs(mix)),.001)
Path('public').mkdir(exist_ok=True)
with wave.open('public/negus-original-score.wav','wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((mix*32767).astype('<i2').tobytes())
print('Original 30-second stereo score generated')
