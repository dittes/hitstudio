// The sound library: the manifest lists at least ten times the kit, every file exists, names are unique per category, categories line up with the four pad rows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../assets/sampler/',import.meta.url);
const m=JSON.parse(fs.readFileSync(new URL('manifest.json',root),'utf8'));
assert.equal(m.version,1);
assert.ok(m.sounds.length>=160+16,`at least ten times the 16 kit sounds (${m.sounds.length})`);
const cats=new Set(m.categories.map(c=>c.id));
assert.equal(cats.size,m.categories.length,'category ids are unique');
for(const c of m.categories)assert.ok([0,1,2,3].includes(c.row),`${c.id} belongs to a pad row`);
for(const r of [0,1,2,3])assert.ok(m.categories.some(c=>c.row===r),`row ${r} has categories to suggest`);
const ids=new Set(),names=new Set();let bytes=0;
for(const s of m.sounds){
  assert.ok(cats.has(s.cat),`${s.id} has a known category`);
  assert.ok(!ids.has(s.id),`${s.id} is unique`);ids.add(s.id);
  const key=s.cat+'|'+s.name;assert.ok(!names.has(key),`${key} is not duplicated`);names.add(key);
  const file=new URL(s.file,root);assert.ok(fs.existsSync(file),`${s.file} exists`);
  const size=fs.statSync(file).size;bytes+=size;assert.ok(size>200&&size<900*1024,`${s.file} has a sane size`);
  assert.ok(s.dur>0.04&&s.dur<=3.2,`${s.id} has a sane length (${s.dur})`);
  assert.ok(s.ch===1||s.ch===2);
  if(s.file.endsWith('.flac'))assert.equal(fs.readFileSync(file).subarray(0,4).toString('latin1'),'fLaC',`${s.file} really is FLAC`);
}
for(const c of m.categories)assert.ok(m.sounds.filter(s=>s.cat===c.id).length>=8,`${c.id} has plenty to choose from`);
assert.ok(bytes<16e6,`the whole library stays small (${(bytes/1e6).toFixed(1)} MB)`);
console.log(`Sampler library: ${m.sounds.length} sounds in ${m.categories.length} categories, ${(bytes/1e6).toFixed(1)} MB; every file exists and is FLAC or WAV.`);
