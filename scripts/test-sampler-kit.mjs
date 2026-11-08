// The factory sampler kit: 16 files exist, decode, are sane (no clipping, no silence, sensible length) and match the kit definition.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const {decodeWav}=await import('../app/features/io/export/wav.js');
const {DEFAULT_KIT,DEFAULT_PARAMS,PAD_KEYS,GROUPS}=await import('../app/features/sampler/kit.js');
assert.equal(DEFAULT_KIT.length,16);assert.equal(PAD_KEYS.length,16);assert.equal(new Set(PAD_KEYS).size,16,'one key per pad');
assert.equal(GROUPS.length,4);
for(const [i,pad] of DEFAULT_KIT.entries()){
  assert.ok(pad.group===Math.floor(i/4),`pad ${i+1} is in row ${Math.floor(i/4)+1}`);
  const file=new URL(`../assets/sampler/${pad.file}.wav`,import.meta.url);
  assert.ok(fs.existsSync(file),`${pad.file}.wav exists`);
  const pcm=decodeWav(new Uint8Array(fs.readFileSync(file)));
  assert.equal(pcm.sampleRate,44100);
  const ch=pcm.channels[0];let peak=0,energy=0;for(const v of ch){assert.ok(Number.isFinite(v));peak=Math.max(peak,Math.abs(v));energy+=v*v}
  const sec=ch.length/pcm.sampleRate;
  assert.ok(peak>0.5&&peak<0.99,`${pad.file} is loud enough and does not clip (peak ${peak.toFixed(2)})`);
  assert.ok(Math.sqrt(energy/ch.length)>0.03,`${pad.file} is not silent`);
  assert.ok(sec>0.1&&sec<4,`${pad.file} has a sensible length (${sec.toFixed(2)} s)`);
  assert.ok(Math.abs(ch[ch.length-1])<0.01&&Math.abs(ch[0])<0.05,`${pad.file} starts and ends cleanly`);
  const p={...DEFAULT_PARAMS,...pad.params};
  assert.ok(p.vol>0&&p.vol<=1.2&&p.start===0&&p.end===1&&['oneshot','gate','loop'].includes(p.mode)&&p.choke>=0&&p.choke<=4);
}
// hats choke each other, everything else is independent
const chokes=DEFAULT_KIT.map((p)=>({...DEFAULT_PARAMS,...p.params}).choke);
assert.deepEqual(chokes.map((c,i)=>c?i:-1).filter(i=>i>=0),[4,5],'closed and open hat share a choke group');
console.log('Sampler kit: 16 factory sounds decode, stay below clipping, start and end cleanly; hats choke each other.');
