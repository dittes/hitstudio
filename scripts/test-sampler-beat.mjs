// Sampler beat manager: step values, patterns, grooves, mutes, copy, length and persistence.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const B = await import('../app/features/sampler/beat.js');
const { useBeat, GROOVES, PATTERNS } = B;
const S = () => useBeat.getState();

assert.equal(S().patterns.length, 4);
assert.equal(PATTERNS.join(''), 'ABCD');
assert.ok(B.isEmpty(), 'starts empty');

// steps: 0 off, 1 normal, 2 accent; edits make new arrays so subscribers see them
const before = S().patterns;
B.setStep(0, 0, 1);
assert.notEqual(S().patterns, before);
assert.equal(B.getStep(0, 0), 1);
B.setStep(0, 0, 2);
assert.equal(B.getStep(0, 0), 2);
assert.ok(!B.isEmpty());
B.clearPattern();
assert.ok(B.isEmpty());

// every groove only fills real pads and steps, and sets a sane tempo
for (const g of GROOVES) {
  B.loadGroove(g.id);
  assert.ok(!B.isEmpty(), `${g.name} has notes`);
  assert.equal(S().bpm, g.bpm);
  for (const row of Object.keys(g.rows)) assert.ok(Number(row) >= 0 && Number(row) < 16);
  const kick = S().patterns[S().active][0];
  assert.ok(kick[0] === 2, `${g.name} starts with an accented kick`);
  for (let c = 16; c < 32; c++) assert.equal(kick[c], 0, 'one bar only fills the first 16 steps');
}

// two bars repeat the groove into the second bar
B.setLength(32);
B.loadGroove('house');
const k = S().patterns[S().active][0];
for (let c = 0; c < 16; c++) assert.equal(k[c], k[16 + c], 'bar 2 repeats bar 1');

// patterns are independent slots; copy duplicates the current one
B.setActive(1);
assert.ok(B.isEmpty(), 'pattern B is empty');
B.setActive(0);
B.copyTo(2);
B.setActive(2);
assert.ok(!B.isEmpty(), 'copy landed in C');
assert.deepEqual(S().patterns[2], S().patterns[0]);
B.setStep(0, 1, 1);
assert.notDeepEqual(S().patterns[2], S().patterns[0], 'copies do not share rows');

// mutes, tempo and swing are clamped
B.toggleMute(3);
assert.equal(S().mutes[3], true);
B.toggleMute(3);
assert.equal(S().mutes[3], false);
B.setBpm(5); assert.equal(S().bpm, 50);
B.setBpm(999); assert.equal(S().bpm, 220);
B.setSwing(9); assert.equal(S().swing, 0.6);
B.setSwing(-1); assert.equal(S().swing, 0);

// random fills the kick, snare and hats
B.setLength(16);
B.randomize();
const p = S().patterns[S().active];
assert.ok(p[0].some(Boolean) && p[1].some(Boolean) && p[4].some(Boolean), 'random makes a basic beat');

// the beat is saved (debounced) so it survives a reload
await new Promise((r) => setTimeout(r, 400));
const saved = JSON.parse(store.get('hitstudio.sampler.beat.v1'));
assert.equal(saved.patterns.length, 4);
assert.deepEqual(saved.patterns[S().active][0].slice(0, 16), p[0].slice(0, 16));
assert.equal(saved.bpm, S().bpm);

// recording: hits land on the nearest step while the beat runs (no audio clock here, so fake one)
assert.equal(B.recordHit(0, 0.8), -1, 'not recording → nothing happens');

// genre presets: one per genre of the Create screen, real library sounds, valid rows
import fs from 'node:fs';
const { PRESETS } = await import('../app/features/sampler/presets.js');
const { GENRES } = await import('../app/lib/songsmith.js');
const manifest = JSON.parse(fs.readFileSync(new URL('../assets/sampler/manifest.json', import.meta.url)));
assert.deepEqual(PRESETS.map((x) => x.id).sort(), Object.keys(GENRES).sort(), 'a preset for every genre');
for (const g of PRESETS) {
  assert.equal(g.sounds.length, 16, g.id);
  for (const id of g.sounds) assert.ok(manifest.sounds.some((x) => x.id === id), `${g.id}: ${id} exists in the library`);
  assert.equal(new Set(g.sounds).size, 16, `${g.id}: no sound twice`);
  for (const [row, str] of Object.entries(g.rows)) { assert.ok(+row >= 0 && +row < 16); assert.match(str.replace(/\s/g, ''), /^[.xX]{16}$/, `${g.id} row ${row}`); }
  assert.ok(g.rows[0] && g.bpm >= 60 && g.bpm <= 180);
  B.loadRows(g.rows, g.bpm, g.swing);
  assert.equal(S().bpm, g.bpm);
  assert.ok(S().mutes.every((m) => !m), 'presets unmute everything');
}

console.log('Sampler beat manager tests passed.');
process.exit(0);
