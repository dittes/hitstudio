// Objective music-quality checks for the generator: harmony, voice leading, melody shape and mix.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='immer')return {url:new URL('../vendor/immer.mjs',import.meta.url).href,shortCircuit:true};return next(specifier,context)}});
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};globalThis.window=globalThis;
const {chordFor,voiceChords,rowMidi,SCALES}=await import('../app/features/create/theory.js');
const {generateSetup,GENRES,MOODS,chordPitchClasses}=await import('../app/lib/songsmith.js');

// ── chord naming ──
assert.equal(chordFor(0,'major',0,'seventh').name,'Cmaj7');
assert.equal(chordFor(0,'major',4,'seventh').name,'G7');
assert.equal(chordFor(0,'major',1,'seventh').name,'Dm7');
assert.equal(chordFor(0,'major',6,'seventh').name,'Bm7b5');
assert.equal(chordFor(0,'major',0,'ninth').name,'Cmaj9');
assert.equal(chordFor(0,'major',0).name,'C');

// ── voice leading: contains every chord tone, stays in a playable register, and moves less than stacked root positions ──
const progs=[[0,4,5,3],[5,3,0,4],[1,4,0,5],[0,6,5,4],[3,4,2,5],[0,3,4,3]];
let voicedMove=0,naiveMove=0,pairs=0;
for(const scale of Object.keys(SCALES))for(const key of [0,3,7,10])for(const ext of ['triad','seventh','ninth'])for(const prog of progs){
  const v=voiceChords(key,scale,prog,ext);
  v.forEach((c,i)=>{
    const pcs=new Set(c.midi.map(m=>((m%12)+12)%12));
    for(const t of c.tones)assert.ok(pcs.has((((c.rootMidi+t)%12)+12)%12),'every chord tone is voiced');
    assert.ok(c.midi[0]>=50&&c.midi[c.midi.length-1]<=88,'chord stays in a comfortable range');
    assert.ok(c.midi.length>=4,'at least four voices');
    const next=v[(i+1)%v.length],naiveA=chordFor(key,scale,prog[i],ext).midi,naiveB=chordFor(key,scale,prog[(i+1)%v.length],ext).midi;
    const top=(arr)=>arr[arr.length-1];
    voicedMove+=Math.abs(top(next.midi)-top(c.midi));naiveMove+=Math.abs(top(naiveB)-top(naiveA));pairs++;
  });
}
assert.ok(voicedMove<naiveMove,`voice-led top line moves less than root position (${(voicedMove/pairs).toFixed(2)} vs ${(naiveMove/pairs).toFixed(2)} semitones per change)`);
assert.ok(voicedMove/pairs<3.2,'the top line moves by a few semitones at most on average');

// ── melodies ──
let ideas=0,strongTotal=0,strongHits=0,tonicEnds=0,ranges=[];
for(const genre of Object.keys(GENRES))for(const mood of GENRES[genre].moods)for(let seed=1;seed<=12;seed++){
  const s=generateSetup({genre,mood,seed,busy:[0.2,0.5,0.8][seed%3]});
  const st=s.state,notes=[...st.melody.notes].sort((a,b)=>a.step-b.step);ideas++;
  assert.ok(['triad','seventh','ninth'].includes(st.chords.ext),'chord colour is set');
  assert.ok(st.space>0.5&&st.space<2.2,'space is a sensible reverb amount');
  assert.ok(notes.length>=3&&notes.length<=26,`melody has a sensible number of notes (${notes.length}) for ${genre}/${mood}/${seed}`);
  for(const n of notes){assert.ok(n.row>=0&&n.row<=9,'melody row in the grid');assert.ok(n.step>=0&&n.step+n.len<=32,'melody note fits the two bars')}
  // no run of the same pitch longer than three notes
  let run=1;for(let i=1;i<notes.length;i++){run=notes[i].row===notes[i-1].row?run+1:1;assert.ok(run<=2,'no long repeated-note runs')}
  // beat-aligned notes are mostly chord tones of the chord under them
  for(const n of notes){if(n.step%4!==0)continue;const bar=Math.floor(n.step/16),pc=((rowMidi(st.key,st.scale,st.octave,n.row)-rowMidi(st.key,st.scale,st.octave,0))%12+12)%12;strongTotal++;const own=chordPitchClasses(st.scale,st.chords.prog[bar]);const rowPc=(SCALES[st.scale].intervals[n.row%SCALES[st.scale].intervals.length]);if(own.includes(rowPc))strongHits++;void pc}
  ranges.push(Math.max(...notes.map(n=>n.row))-Math.min(...notes.map(n=>n.row)));
  const last=notes[notes.length-1];if(last.row%SCALES[st.scale].intervals.length===0)tonicEnds++;
}
assert.ok(strongHits/strongTotal>0.6,`most strong-beat notes are chord tones (${(100*strongHits/strongTotal).toFixed(0)}%)`);
assert.ok(tonicEnds/ideas>0.9,'melodies come home to the tonic');
assert.ok(ranges.filter(r=>r>=3).length/ideas>0.85,'melodies have a real contour (range of at least a fourth)');
assert.ok(new Set(ranges).size>3,'melodies differ in range from idea to idea');

// ── determinism: the same code is the same idea ──
const a=generateSetup({genre:'lofi',mood:'chill',seed:42}),b=generateSetup({genre:'lofi',mood:'chill',seed:42});
assert.deepEqual(JSON.parse(JSON.stringify(a.state.chords)),JSON.parse(JSON.stringify(b.state.chords)));
assert.deepEqual(a.state.melody.notes.map(({step,row,len})=>[step,row,len]),b.state.melody.notes.map(({step,row,len})=>[step,row,len]));
console.log(`Generator quality: ${ideas} ideas checked for harmony, voice leading, melody shape and determinism passed.`);
