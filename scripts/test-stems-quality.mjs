// Quality regression: on a synthetic song with known stems, the current separator must beat the old filter-style
// one by a wide margin (SDR in dB, higher is better) and keep a sane absolute level.
import assert from 'node:assert/strict';
const {makeSong}=await import('./fixtures/synth-song.mjs');
const v1=await import('./fixtures/stems-v1.mjs');
const v2=await import('../app/features/tools/stems-core.js');
const sdr=(ref,est)=>{let r=0,e=0;for(let c=0;c<2;c++)for(let i=0;i<ref[c].length;i++){r+=ref[c][i]**2;e+=(ref[c][i]-est[c][i])**2}return 10*Math.log10(r/(e+1e-20))};
const add=(a,b)=>[a[0].map((v,i)=>v+b[0][i]),a[1].map((v,i)=>v+b[1][i])];
const score=async(mod,song)=>{const st=await mod.separateStems(song.mix[0],song.mix[1],song.sr);const t=song.truth;
  return{vocals:sdr(t.vocals,st.vocals),instrumental:sdr(add(add(t.drums,t.bass),t.other),add(add(st.drums,st.bass),st.other)),other:sdr(t.other,st.other),drums:sdr(t.drums,st.drums),bass:sdr(t.bass,st.bass)}};
const song=makeSong({seed:7});
const a=await score(v1,song),b=await score(v2,song);
const f=(x)=>Object.entries(x).map(([k,v])=>`${k} ${v.toFixed(1)}`).join(', ');
assert.ok(b.vocals>a.vocals+5,`vocals improve by 5+ dB (${a.vocals.toFixed(1)} → ${b.vocals.toFixed(1)})`);
assert.ok(b.instrumental>a.instrumental+5,`the instrumental improves by 5+ dB (${a.instrumental.toFixed(1)} → ${b.instrumental.toFixed(1)})`);
assert.ok(b.other>a.other+3,`"other" improves by 3+ dB (${a.other.toFixed(1)} → ${b.other.toFixed(1)})`);
assert.ok(b.drums>=a.drums-0.5&&b.bass>=a.bass-0.5,'drums and bass do not get worse');
assert.ok(b.vocals>1.5&&b.instrumental>14,'absolute quality floor on the synthetic song');
// without a detectable loop it still beats the old method
const c=await v2.separateStems(song.mix[0],song.mix[1],song.sr,{params:{noLoop:true}});
const t=song.truth,cv=sdr(t.vocals,c.vocals),ci=sdr(add(add(t.drums,t.bass),t.other),add(add(c.drums,c.bass),c.other));
assert.ok(cv>a.vocals+1.5&&ci>a.instrumental+1,'the no-loop fallback is still better than the old method');
console.log(`Stem quality (SDR dB): old [${f(a)}] → new [${f(b)}]; no-loop fallback vocals ${cv.toFixed(1)}, instrumental ${ci.toFixed(1)}.`);
