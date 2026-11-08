"""HitStudio — original instrumental startup ident; deterministic synthesis, no samples."""
import numpy as np
import wave
from pathlib import Path
SR=48000
DURATION=5.65
rng=np.random.default_rng(20261106)
bus=np.zeros((int(SR*DURATION),2))
def note(m): return 440*2**((m-69)/12)
def add(x,start,pan=0,gain=1):
    i=int(start*SR); n=min(len(x),len(bus)-i)
    if n<=0:return
    if x.ndim==1:x=x[:,None]*np.array([np.sqrt((1-pan)/2),np.sqrt((1+pan)/2)])
    bus[i:i+n]+=gain*x[:n]
def pluck(m,dur=1.5):
    t=np.arange(int(dur*SR))/SR; f=note(m)
    # Rounded bell transient gives way to a warm glass-like fundamental.
    x=sum(a*np.sin(2*np.pi*f*r*t)*np.exp(-t/tau) for r,a,tau in [(1,1,.48),(2,.23,.22),(3,.08,.13),(4,.028,.08)])
    return x*(1-np.exp(-t/.003))*np.minimum(1,(dur-t)/.12)
# Quiet reverse-light opening, with stereo movement and a clean deliberate arrival.
t=np.arange(int(.92*SR))/SR
noise=rng.standard_normal(len(t)); noise=noise-np.convolve(noise,np.ones(19)/19,'same')
sweep=.033*noise*np.sin(np.pi*t/.92)**2+.045*np.sin(2*np.pi*(420*t+800*t*t))*(t/.92)**2
add(sweep,0,-.25)
# Six-note bespoke rising motif, with dotted-space reflections.
for onset,m,pan,amp in [(.13,64,-.4,.18),(.34,71,.3,.19),(.57,75,-.2,.22),(.83,78,.35,.26),(1.15,80,-.15,.29),(1.58,83,.12,.28)]:
    x=pluck(m)
    add(x,onset,pan,amp)
    add(x,onset+.235,-pan,amp*.22)
    add(x,onset+.47,pan*.7,amp*.09)
# Restrained impact: pitch-falling sine drum, velvety low E and a short noise tick.
t=np.arange(int(.85*SR))/SR
phase=2*np.pi*(45*t+75*.035*(1-np.exp(-t/.035)))
kick=np.sin(phase)*np.exp(-t/.18)*(1-np.exp(-t/.0015))
add(kick,.83,0,.34)
t=np.arange(int(2.9*SR))/SR
bass=(np.sin(2*np.pi*note(40)*t)+.18*np.sin(2*np.pi*note(52)*t))*(1-np.exp(-t/.025))*np.exp(-t/1.0)*np.minimum(1,(2.9-t)/.3)
add(bass,.85,0,.24)
# Broad E-major-add9 resolution, hand-voiced with mild detune and evolving colour.
for m,pan in [(52,-.15),(59,.15),(64,-.6),(68,.55),(71,-.3),(78,.3)]:
    t=np.arange(int(3.8*SR))/SR; f=note(m)
    env=(1-np.exp(-t/.12))*np.exp(-t/.95)*np.minimum(1,(3.8-t)/.65)
    x=sum(np.sin(2*np.pi*f*2**(c/1200)*t+p) for c,p in [(-5,.3),(0,0),(5,-.3)])/3
    x+=.10*np.sin(2*np.pi*2*f*t)*np.exp(-t/.5)
    add(x*env,1.58,pan,.105 if m<64 else .075)
# Signature upper sparkle, independent of any pre-existing sound or tune.
for onset,m,pan,amp in [(1.77,90,-.6,.055),(1.98,95,.6,.042),(2.20,92,-.3,.032)]:add(pluck(m,1.2),onset,pan,amp)
# Sparse diffusion network: early reflections plus exponentially fading stereo tail.
dry=bus.copy()
for delay,amount in [(.037,.12),(.061,.10),(.101,.08),(.163,.07),(.227,.055),(.313,.045),(.431,.035),(.593,.025),(.811,.016)]:
    n=int(delay*SR); bus[n:]+=dry[:-n,::-1]*amount
# DC removal and conservative peak control; mastering normalization is performed by ffmpeg.
bus-=bus.mean(axis=0)
bus=np.tanh(bus*1.25)/1.25
bus*=min(1,.78/np.max(np.abs(bus)))
f=int(.38*SR); bus[-f:]*=np.linspace(1,0,f)[:,None]**2
bus[:240]*=np.linspace(0,1,240)[:,None]
out=Path(__file__).with_name('hitstudio-instrumental.wav')
with wave.open(str(out),'wb') as w:
    w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((bus*32767).astype('<i2').tobytes())
print(out)
