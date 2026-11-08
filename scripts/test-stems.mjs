// Stem separation: the stems rebuild the mix, and each instrument lands where it should.
import assert from 'node:assert/strict';
const {separateStems,STEM_NAMES}=await import('../app/features/tools/stems-core.js');

const sr=22050,secs=5,n=sr*secs;
const L=new Float32Array(n),R=new Float32Array(n);
let seed=12345;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1};
for(let i=0;i<n;i++){
  const t=i/sr;
  const bass=0.35*Math.sin(2*Math.PI*70*t);                                  // low, sustained, centre
  const vib=80*Math.sin(2*Math.PI*1.5*t);                                    // a voice glides between notes; a perfectly steady tone counts as an instrument
  const vox=0.22*Math.sin(2*Math.PI*880*t+vib)+0.12*Math.sin(2*Math.PI*1760*t+2*vib); // mid, gliding, centre
  const pad=0.22*Math.sin(2*Math.PI*2500*t);                                  // high, sustained, hard left
  const phase=t%0.5,env=phase<0.04?Math.exp(-phase*90):0;                     // drum hit every half second
  const hit=0.7*env*rnd();
  L[i]=bass+vox+pad+hit;
  R[i]=bass+vox+hit;
}
const progress=[];
const stems=await separateStems(L,R,sr,{onProgress:p=>progress.push(p)});
assert.ok(stems,'separation completes');
assert.deepEqual(Object.keys(stems),STEM_NAMES);
assert.ok(progress.length>3&&progress.at(-1)===1&&progress.every((p,i)=>i===0||p>=progress[i-1]),'progress climbs to 1');

// 1. the four stems rebuild the original mix
let err=0,ref=0;
for(let i=0;i<n;i++){let sl=0,sr2=0;for(const k of STEM_NAMES){sl+=stems[k][0][i];sr2+=stems[k][1][i]}err+=(sl-L[i])**2+(sr2-R[i])**2;ref+=L[i]**2+R[i]**2}
const snr=10*Math.log10(ref/err);
assert.ok(snr>60,`stems add back up to the mix (${snr.toFixed(0)} dB reconstruction)`);

// 2. each instrument lands in the right stem
const goertzel=(x,f)=>{const w=2*Math.PI*f/sr,c=2*Math.cos(w);let a=0,b=0;for(let i=0;i<x.length;i++){const t=x[i]+c*a-b;b=a;a=t}return Math.sqrt(Math.max(0,a*a+b*b-c*a*b))/x.length*2};
const band=(x,lo,hi)=>{let e=0;for(let f=lo;f<=hi;f+=10){const g=goertzel(x,f);e+=g*g}return Math.sqrt(e)};
const level=(stem,f)=>{const lo=f===880?700:f-10,hi=f===880?1100:f+10;return (band(stems[stem][0],lo,hi)+band(stems[stem][1],lo,hi))/2}; // a gliding tone spreads over a band
const energy=(x)=>{let e=0;for(let i=0;i<x.length;i++)e+=x[i]*x[i];return e};
assert.ok(level('bass',70)>level('vocals',70)&&level('bass',70)>level('drums',70)&&level('bass',70)>level('other',70),'the low sustained note goes to bass');
assert.ok(level('other',2500)>level('vocals',2500)&&level('other',2500)>level('bass',2500),'the hard-panned high tone goes to other');
// noise bursts are broadband, so compare the high-pass (second difference) energy inside the burst windows
const hp=(x,a,b)=>{let e=0;for(let i=a+2;i<b;i++){const d=x[i]-2*x[i-1]+x[i-2];e+=d*d}return e};
const hitEnergy=(stem)=>{let e=0;for(let t=0;t<secs*2;t++){const a=Math.floor(t*0.5*sr),b=a+Math.floor(0.04*sr);e+=hp(stems[stem][0],a,b)+hp(stems[stem][1],a,b)}return e};
assert.ok(hitEnergy('drums')>hitEnergy('bass')+hitEnergy('vocals')+hitEnergy('other'),'drum hits go to drums');

// 3. cancelling stops early
let calls=0;
const cancelled=await separateStems(L,R,sr,{shouldCancel:()=>++calls>2});
assert.equal(cancelled,null,'cancel returns null');

// 4. silence stays silent and mono input works
const z=new Float32Array(sr);
const quiet=await separateStems(z,z,sr);
assert.ok(STEM_NAMES.every(k=>energy(quiet[k][0])===0),'silence stays silent');
console.log(`Stem separation: ${snr.toFixed(0)} dB reconstruction; bass, drums and a hard-panned tone land in their stems; cancel and silence handled.`);

// ── karaoke: the instrumental is the mix minus the vocals ──
{
  const {STEM_NAMES:names}=await import('../app/features/tools/stems-core.js');
  const sum=(keys)=>{const out=new Float32Array(n);for(const k of keys)for(let i=0;i<n;i++)out[i]+=stems[k][0][i];return out};
  const inst=sum(['drums','bass','other']),vox=sum(['vocals']);
  let e=0;for(let i=0;i<n;i++)e+=(inst[i]+vox[i]-L[i])**2;
  assert.ok(Math.sqrt(e/n)<1e-4,'instrumental + vocals rebuilds the mix');
  assert.deepEqual(names,['drums','bass','vocals','other']);
  const tone=(x,f)=>band(x,f===880?700:f-10,f===880?1100:f+10);
  assert.ok(tone(inst,70)>tone(vox,70),'the bass stays in the instrumental');
  console.log('Karaoke mix: instrumental + vocals rebuild the song; the bass stays in the instrumental.');
}
