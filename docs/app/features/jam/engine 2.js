// Jam: a virtual band that plays forever and freestyles around you.
//
// It reuses the Create song generator (lib/songsmith.js) for a starting idea and the Create synths
// (synth/mix.js → scheduleStep) for sound. On top of that sits a small "band brain":
//   • time runs in 4-bar phrases (64 sixteenths); every phrase is planned just before it starts
//   • sections (Intro → Groove → Build → Peak → Break) decide who plays and how hard
//   • each phrase the band may vary: the lead improvises new lines, the drummer fills or changes the
//     groove, the bass changes pattern, the keys move to new chords (how often = "Adventure")
//   • Follow me: while you play, the lead lays out; when you stop, it answers. Playing a lot during a
//     groove pushes the band to build up sooner.
// Everything is scheduled ahead on the shared AudioContext and goes out through the app master
// (so the master EQ and visualizer see it), and can be recorded straight onto the timeline.
import { create } from '../../lib/state.js'
import { getEngine } from '../../core/engine.js'
import { buffers } from '../../core/buffers.js'
import { makeClip, makeTrack, useStore } from '../../core/store.js'
import { toast } from '../../core/toast.js'
import { GENRES, MOODS, LANES, createRng, generateSetup, liteDrums, kickOnly, makeDrums, makeMelody, randomSeed } from '../../lib/songsmith.js'
import { configureAll, createBus, createOutputStage, dims, scheduleStep, swingOffset } from '../create/synth/mix.js'
import { INSTRUMENTS, playNote } from '../create/synth/instruments.js'
import { KITS, triggerDrum } from '../create/synth/drums.js'
import { SCALES, chordFor, rowMidi, voiceChords } from '../create/theory.js'
import { BASS_PATTERNS, STAB_STEPS, OFFBEAT_STEPS } from '../create/patterns.js'

export const MEMBERS = ['drums', 'bass', 'chords', 'melody']
export const MEMBER_INFO = {
  drums: { name: 'Drums', role: 'Keeps the groove', color: '#fb923c', icon: 'drum' },
  bass: { name: 'Bass', role: 'Locks in with the kick', color: '#4ade80', icon: 'bass' },
  chords: { name: 'Keys', role: 'Plays the chords', color: '#38bdf8', icon: 'piano' },
  melody: { name: 'Lead', role: 'Improvises melodies', color: '#a78bfa', icon: 'melody' },
}
export const SECTIONS = {
  intro: { name: 'Intro', hint: 'Keys and soft hats', drums: 'hats', bass: false, chords: true, melody: false, len: 1 },
  groove: { name: 'Groove', hint: 'Laid back, room for you', drums: 'lite', bass: true, chords: true, melody: 'sparse', len: 2 },
  build: { name: 'Build', hint: 'Rising snare roll', drums: 'build', bass: true, chords: true, melody: false, len: 1 },
  peak: { name: 'Peak', hint: 'Everyone, full power', drums: 'full', bass: true, chords: true, melody: true, len: 2 },
  break: { name: 'Break', hint: 'Drums and bass drop out', drums: null, bass: false, chords: true, melody: true, len: 1 },
}
const FLOW = { intro: 'groove', groove: 'build', build: 'peak', peak: 'break', break: 'groove' }
export const ADVENTURE = {
  steady: { name: 'Steady', hint: 'Sticks to the groove', lenMul: 2, change: 0.15 },
  lively: { name: 'Lively', hint: 'Mixes it up now and then', lenMul: 1, change: 0.35 },
  wild: { name: 'Wild', hint: 'Always trying something new', lenMul: 0.75, change: 0.65 },
}
export const YOU_INSTRUMENTS = ['piano', 'rhodes', 'pluck', 'saw', 'bell', 'organ', 'flute', 'brass', 'guitar', 'marimba', 'strings', 'drums']

const PHRASE = 64, BAR = 16, LOOKAHEAD = 0.14
const LS = 'hitstudio.jam.v1'
const prefs0 = {
  genre: 'lofi', mood: 'chill', busy: 0.5, adventure: 'lively', autoArrange: true, followMe: true, key: null,
  members: { drums: { on: true, vol: 0.9 }, bass: { on: true, vol: 0.85 }, chords: { on: true, vol: 0.8 }, melody: { on: true, vol: 0.75 } },
  you: { inst: 'piano', vol: 0.9, octave: 0 },
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS) || '{}')
    return { ...prefs0, ...p, members: { ...prefs0.members, ...(p.members || {}) }, you: { ...prefs0.you, ...(p.you || {}) } }
  } catch { return structuredClone(prefs0) }
}
const PREF_KEYS = ['genre', 'mood', 'busy', 'adventure', 'autoArrange', 'followMe', 'key', 'members', 'you']

export const useJam = create(() => ({
  ...loadPrefs(),
  playing: false, bpm: 90, bpmSet: false, title: '', section: 'intro', next: null, cue: null, phraseBar: 0, beat: 0, bars: 0,
  chord: null, nextChord: null, scale: 'minor', keyRoot: 0, insts: {}, spotlight: false, recording: false, recStart: 0, lastChange: '',
}))
useJam.subscribe((s, prev) => {
  if (PREF_KEYS.some((k) => s[k] !== prev[k])) try { localStorage.setItem(LS, JSON.stringify(Object.fromEntries(PREF_KEYS.map((k) => [k, s[k]])))) } catch {}
})
const J = () => useJam.getState()
const set = (patch) => useJam.setState(patch)

// ── audio graph ──────────────────────────────────────────────
let ctx = null, out = null, stage = null, band = null, youBus = null
function ensureGraph() {
  const e = getEngine()
  if (ctx === e.ctx && band) return
  ctx = e.ctx
  out = ctx.createGain()
  out.connect(e.externalInput)
  stage = createOutputStage(ctx, out)
  band = Object.fromEntries(MEMBERS.map((m) => [m, createBus(ctx, stage.input, stage.reverbIn)]))
  youBus = createBus(ctx, stage.input, stage.reverbIn)
}

// ── the song the band is playing ─────────────────────────────
let setup = null // songsmith setup: { genre, mood, busy, state, bpm, … }
let base = null // base drum grid (16 or 32 steps)
let S = null // the live Create-style state that scheduleStep reads (drums grid is the 64-step phrase grid)
let rng = createRng(randomSeed())
let lastMelody = null
const pending = { song: false, drums: false, chords: false, key: false }

function newSong(keepKey) {
  const p = J()
  const key = p.key ?? (keepKey && S ? S.key : undefined)
  setup = generateSetup({ genre: p.genre, mood: p.mood, busy: p.busy, key })
  S = structuredClone(setup.state)
  if (keepKey && S && p.key == null && key != null) S.key = key
  base = { grid: setup.state.drums.grid, long: setup.state.drums.long }
  S.drums.long = true // our phrase grid is always 64 steps; dims() below is overridden anyway
  S.humanize = 1
  lastMelody = S.melody.notes
  set({ bpm: J().bpmSet ? J().bpm : setup.bpm, title: setup.title, scale: S.scale, keyRoot: S.key, insts: instNames() })
}
const instNames = () => ({ drums: `${KITS[S.drums.kit]?.name ?? S.drums.kit} kit`, bass: INSTRUMENTS[S.bass.inst]?.name ?? 'Bass', chords: INSTRUMENTS[S.chords.inst]?.name ?? 'Keys', melody: INSTRUMENTS[S.melody.inst]?.name ?? 'Lead' })

// ── phrase planning ──────────────────────────────────────────
function tile(grid, len) {
  const g = {}
  for (const l of LANES) { g[l] = new Array(96).fill(0); for (let i = 0; i < PHRASE; i++) g[l][i] = grid[l][i % len] ?? 0 }
  return g
}
const zero = () => Object.fromEntries(LANES.map((l) => [l, new Array(96).fill(0)]))
function addFill(g, start, end, kind, energy) {
  for (let i = start; i < end; i++) {
    const t = (i - start) / Math.max(1, end - start - 1)
    if (kind === 'tom') { if ((i - start) % 2 === 0 || energy > 0.7) g.tom[i] = 0.6 + t * 0.35; g.chat[i] = 0; g.kick[i] = 0 }
    else if (kind === 'hats') g.chat[i] = 0.45 + t * 0.5
    else { if ((i - start) % 2 === 0 || i >= end - 3 || energy > 0.7) g.snare[i] = 0.35 + t * 0.6 }
  }
  g.ohat[end - 1] = 0
}
function phraseDrums(sec, opts) {
  const len = base.long ? 32 : 16
  let g = tile(base.grid, len)
  const kind = sec.drums
  if (kind === null) return zero()
  if (kind === 'hats') { const lite = liteDrums(g); g = zero(); g.chat = lite.chat.map((v) => v * 0.8); if (J().busy > 0.6) g.rim = lite.rim; return g }
  if (kind === 'lite') g = liteDrums(g)
  if (kind === 'build') {
    g = kickOnly(g)
    for (let i = 32; i < 48; i += 4) g.snare[i] = 0.45 + (i - 32) / 40
    for (let i = 48; i < 64; i += i < 56 ? 2 : 1) g.snare[i] = 0.5 + (i - 48) / 32
    return g
  }
  if (opts.accent) { g.ohat[0] = 0.95; g.kick[0] = 1; g.chat[0] = 0 }
  if (opts.fill) addFill(g, 64 - opts.fill, 64, opts.fillKind, J().busy)
  return g
}
/** Vary an existing 2-bar line: keep the rhythm, nudge some notes, drop or add a few. */
function varyMelody(notes, amount) {
  const rows = 10
  const out = []
  for (const n of notes) {
    if (rng.chance(amount * 0.25)) continue
    const shift = rng.chance(amount) ? rng.pick([-2, -1, 1, 2]) : 0
    out.push({ ...n, id: n.id + 'v', row: Math.max(0, Math.min(rows - 1, n.row + shift)) })
  }
  return out.length ? out : notes
}
function improvise(sec, adv) {
  const g = GENRES[setup.genre]
  const density = (sec.melody === 'sparse' ? 0.3 : g.density) + (J().busy - 0.5) * 0.4
  if (lastMelody && rng.chance(1 - adv.change)) return varyMelody(lastMelody, 0.35 + adv.change * 0.4) // develop the last idea
  return makeMelody({ scale: S.scale, prog: S.chords.prog, density: Math.max(0.2, Math.min(0.9, density)), rhythm: sec.melody === 'sparse' ? 'sparse' : g.rhythm, rng })
}

// arrangement state
let section = 'intro', phrasesIn = 0, phraseCount = 0, youNotes = [], spotlight = false, answerBar = -1, manualFill = null
const plan = { sec: SECTIONS.intro, melodyOn: false }

function sectionLen(id) { return Math.max(1, Math.round(SECTIONS[id].len * ADVENTURE[J().adventure].lenMul)) }
function youBusy(windowSec = 8) { const now = ctx.currentTime; return youNotes.filter((t) => now - t < windowSec).length }

function planPhrase() {
  const p = J(), adv = ADVENTURE[p.adventure] ?? ADVENTURE.lively
  const changes = []
  // 1) where are we in the song?
  let next = section
  if (p.cue === 'end') next = 'end'
  else if (p.cue) next = p.cue
  else if (p.autoArrange) {
    phrasesIn++
    let due = phrasesIn >= sectionLen(section)
    // follow me: lots of playing during a groove → build sooner; long silence at the peak → take a break
    if (p.followMe && section === 'groove' && youBusy(8) > 10) due = true
    if (p.followMe && section === 'peak' && youBusy(16) === 0 && phrasesIn >= 1 && rng.chance(0.3)) due = true
    if (due) next = FLOW[section]
  }
  if (next !== section) { section = next; phrasesIn = 0; if (section !== 'end') changes.push(SECTIONS[section].name) }
  const sec = section === 'end' ? SECTIONS.break : SECTIONS[section]
  // 2) structural changes the user asked for
  if (pending.song) { pending.song = false; newSong(true); changes.push('new song idea') }
  if (pending.key && p.key != null) { pending.key = false; S.key = p.key; set({ keyRoot: S.key }) }
  if (pending.drums) { pending.drums = false; const d = makeDrums(GENRES[setup.genre], rng, { busy: p.busy }); base = { grid: d.grid, long: d.long } }
  // 3) freestyle: the band varies things on its own
  const g = GENRES[setup.genre], m = MOODS[setup.mood]
  if (pending.chords || (phraseCount > 0 && phraseCount % 4 === 0 && rng.chance(adv.change * 0.8))) {
    pending.chords = false
    const options = m.progs.filter((pr) => pr.join() !== S.chords.prog.join())
    S.chords.prog = rng.pick(options).slice()
    lastMelody = null
    changes.push('new chords')
  }
  if (phraseCount > 0 && rng.chance(adv.change * 0.45)) {
    const d = makeDrums(g, rng, { busy: p.busy }); base = { grid: d.grid, long: d.long }; changes.push('new groove')
  }
  if (phraseCount > 0 && rng.chance(adv.change * 0.4)) {
    const opts = g.bass.filter(([b]) => b !== S.bass.pattern); if (opts.length) { S.bass.pattern = rng.weighted(opts); changes.push('new bass line') }
  }
  // chord style: soft pads in intros and breaks, the genre's own style elsewhere
  S.chords.style = section === 'intro' || section === 'break' || section === 'end' ? 'pad' : setup.state.chords.style
  // 4) drums for this phrase (fill into the next section, accent when the peak lands)
  const nextIsNew = section === 'end' || (p.autoArrange && phrasesIn + 1 >= sectionLen(section))
  const fill = sec.drums && sec.drums !== 'hats' && sec.drums !== 'build' && (nextIsNew || rng.chance(0.25 + adv.change * 0.3)) ? rng.pick(J().busy > 0.6 ? [6, 4, 8] : [4, 3]) : 0
  S.drums.grid = phraseDrums(sec, { fill, fillKind: rng.pick(g.fills.filter((f) => f !== 'none').concat('snare')), accent: section === 'peak' && phrasesIn === 0 })
  // 5) the lead's new lines
  if (sec.melody) { S.melody.notes = improvise(sec, adv); lastMelody = S.melody.notes }
  plan.sec = sec
  phraseCount++
  set({ section, cue: null, next: section !== 'end' && p.autoArrange && phrasesIn + 1 >= sectionLen(section) ? FLOW[section] : null, lastChange: changes.join(' · ') })
  if (section === 'end') ending = true
}

// ── live scheduler ───────────────────────────────────────────
let timer = 0, raf = 0, nextT = 0, counter = 0, ending = false, stopAt = 0
const queue = []
const tickListeners = new Set()
export const onTick = (fn) => (tickListeners.add(fn), () => tickListeners.delete(fn))

function configure() {
  const p = J()
  for (const m of MEMBERS) {
    const sec = setup.state.sections[m]
    S.sections[m] = { ...sec, vol: p.members[m].on ? sec.vol * p.members[m].vol * 1.1 : 0, mute: !p.members[m].on }
  }
  configureAll(band, ctx, S, p.bpm)
  const yi = INSTRUMENTS[p.you.inst]
  youBus.vol.gain.setTargetAtTime(p.you.vol * 0.9, ctx.currentTime, 0.03)
  youBus.tone.frequency.setTargetAtTime(9000, ctx.currentTime, 0.03)
  youBus.dSend.gain.setTargetAtTime(yi ? yi.delay.mix * 0.7 : 0, ctx.currentTime, 0.03)
  youBus.delay.delayTime.setTargetAtTime(Math.min(1.9, (60 / p.bpm) * (yi ? yi.delay.beats : 0.75)), ctx.currentTime, 0.05)
  youBus.cSend.gain.setTargetAtTime(yi ? yi.chorus : 0, ctx.currentTime, 0.03)
  youBus.rSend.gain.setTargetAtTime(yi ? Math.min(0.8, 0.22 * (yi.reverb ?? 1)) : 0.06, ctx.currentTime, 0.05)
}

function hitsAt(step) {
  const sb = step % BAR, h = {}
  h.drums = LANES.some((l) => S.drums.grid[l][step] > 0.3)
  h.melody = S.melody.notes.some((n) => n.step === step % 32)
  const st = S.chords.style
  h.chords = st === 'pad' ? sb === 0 : st === 'arp' ? sb % 2 === 0 : st === 'offbeat' ? OFFBEAT_STEPS.includes(sb) : st === 'power' ? sb % 2 === 0 : STAB_STEPS.includes(sb)
  const pat = BASS_PATTERNS[S.bass.pattern]
  h.bass = pat?.followKick ? S.drums.grid.kick[step] > 0 : !!pat?.hits.find((x) => x[0] === sb)
  return h
}

function pump() {
  const p = J()
  configure()
  const dm = { ...dims([4, 4], true, p.bpm), drumLen: PHRASE }
  while (nextT < ctx.currentTime + LOOKAHEAD) {
    if (stopAt) break // the final chord is ringing out; nothing more to schedule
    const step = counter % PHRASE, bar = Math.floor(step / BAR), sb = step % BAR
    if (step === 0) planPhrase()
    if (ending && step === 0 && counter > 0 && stopAt === 0) {
      // the ending: one final chord with a cymbal, then stop
      const chord = voiceChords(S.key, S.scale, S.chords.prog, S.chords.ext ?? 'triad')[0]
      const inst = INSTRUMENTS[S.chords.inst] ?? INSTRUMENTS.pad
      chord.midi.forEach((m, i) => playNote(ctx, band.chords.input, inst, m, nextT + i * 0.01, 3.2, 0.8))
      if (p.members.bass.on) playNote(ctx, band.bass.input, INSTRUMENTS[S.bass.inst] ?? INSTRUMENTS.bass, voiceChords(S.key, S.scale, S.chords.prog)[0].midi[0] - 12, nextT, 2.5, 0.9)
      if (p.members.drums.on) { triggerDrum(ctx, band.drums.input, 'kick', KITS[S.drums.kit] ?? KITS['808'], nextT, 1); triggerDrum(ctx, band.drums.input, 'ohat', KITS[S.drums.kit] ?? KITS['808'], nextT, 1) }
      stopAt = nextT + 3.4
      queue.push({ time: nextT, step: 0, bar: 0, hits: { drums: true, bass: true, chords: true, melody: false }, end: true })
      break
    }
    // follow me: the lead steps back while you play and answers you when you stop
    if (sb === 0) {
      const busyNow = p.followMe && youBusy(60 / p.bpm * 4 * 1.25) > 0
      if (busyNow !== spotlight) { spotlight = busyNow; set({ spotlight }) }
      if (manualFill && manualFill.bar === bar) { addFill(S.drums.grid, bar * BAR + BAR - 6, bar * BAR + BAR, 'snare', 0.8); manualFill = null }
    }
    const sec = plan.sec
    const parts = {}
    for (const m of MEMBERS) {
      if (!p.members[m].on) continue
      if (m === 'drums' && !sec.drums) continue
      if (m === 'bass' && !sec.bass) continue
      if (m === 'chords' && !sec.chords) continue
      if (m === 'melody' && (!sec.melody || spotlight)) continue
      parts[m] = band[m]
    }
    if (parts.melody && sec.melody === 'sparse' && bar % 2 === 0 && !p.followMe) delete parts.melody // groove: lead only answers in bars 2 and 4
    const t = nextT + swingOffset(step, dm.stepDur, S.drums.swing)
    scheduleStep(ctx, parts, S, dm, step, t)
    const h = hitsAt(step)
    for (const m of MEMBERS) h[m] = h[m] && !!parts[m]
    queue.push({ time: t, step, bar, hits: h })
    nextT += dm.stepDur
    counter++
  }
}

function poll() {
  if (ctx) {
    const now = ctx.currentTime - ((ctx.outputLatency || 0) + (ctx.baseLatency || 0))
    while (queue.length && queue[0].time <= now) {
      const ev = queue.shift()
      if (ev.step % 4 === 0 || ev.end) {
        const vc = voiceChords(S.key, S.scale, S.chords.prog, S.chords.ext ?? 'triad')
        set({ phraseBar: ev.bar, beat: Math.floor((ev.step % BAR) / 4), bars: Math.floor(counter / BAR), chord: vc[ev.bar], nextChord: vc[(ev.bar + 1) % 4] })
      }
      tickListeners.forEach((fn) => fn(ev))
    }
    if (stopAt && ctx.currentTime > stopAt) { stopJam(); return }
  }
  raf = requestAnimationFrame(poll)
}

export async function startJam() {
  if (J().playing) return
  ensureGraph()
  await getEngine().resume()
  newSong(false)
  section = J().autoArrange ? 'intro' : J().section && SECTIONS[J().section] ? J().section : 'groove'
  phrasesIn = -1; phraseCount = 0; ending = false; stopAt = 0; spotlight = false; youNotes = []; queue.length = 0; counter = 0
  rng = createRng(randomSeed())
  out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setValueAtTime(1, ctx.currentTime)
  nextT = ctx.currentTime + 0.1
  set({ playing: true, section, cue: null })
  pump()
  timer = setInterval(pump, 25)
  raf = requestAnimationFrame(poll)
}

export function stopJam() {
  if (!J().playing) return
  clearInterval(timer); cancelAnimationFrame(raf)
  if (ctx && out) { out.gain.setTargetAtTime(0, ctx.currentTime, 0.08) }
  queue.length = 0
  if (recording) stopRecording()
  set({ playing: false, spotlight: false, next: null, cue: null })
  tickListeners.forEach((fn) => fn({ stop: true }))
}
export const toggleJam = () => (J().playing ? stopJam() : startJam())

// ── controls ─────────────────────────────────────────────────
export function setPref(patch) {
  const prev = J()
  set(patch)
  if (!prev.playing) return
  if (('genre' in patch && patch.genre !== prev.genre) || ('mood' in patch && patch.mood !== prev.mood)) pending.song = true
  if ('busy' in patch) pending.drums = true
  if ('key' in patch) pending.key = true
}
export const setMember = (m, patch) => set({ members: { ...J().members, [m]: { ...J().members[m], ...patch } } })
export const setYou = (patch) => set({ you: { ...J().you, ...patch } })
/** Tempo you set yourself sticks (until you pick another style). */
export const setBpm = (bpm) => set({ bpm: Math.max(60, Math.min(180, Math.round(bpm))), bpmSet: true })
/** Cue a section (or 'end'); lands on the next phrase. */
export function cue(id) {
  if (!J().playing) { set({ section: id === 'end' ? J().section : id }); return }
  set({ cue: J().cue === id ? null : id })
}
export function cueFill() {
  if (!J().playing) return
  const bar = Math.floor((counter % PHRASE) / BAR)
  manualFill = { bar: (bar + 1) % 4 } // drummer fills the end of the next bar
  set({ lastChange: 'Drum fill coming up' })
}
export const newChords = () => { pending.chords = true; set({ lastChange: 'New chords next phrase' }) }
export const newIdea = () => { pending.song = true; set({ lastChange: 'New song idea next phrase' }) }
/** Bars left until the next phrase starts (for the cue countdown). */
export const barsToPhrase = () => 4 - Math.floor((counter % PHRASE) / BAR)

// ── you: play along ──────────────────────────────────────────
export const DRUM_KEYS = ['kick', 'snare', 'clap', 'chat', 'ohat', 'tom', 'rim', 'perc']
/** Current scale degrees for the 10 pads (lowest first) as MIDI notes. */
export function youMidi(row) {
  const k = S ? S.key : J().keyRoot, sc = S ? S.scale : J().scale
  return rowMidi(k, sc, J().you.octave, row)
}
/** Which pad rows are in the chord that is sounding right now. */
export function chordRows() {
  if (!J().playing || !S) return new Set()
  // only the core triad (root, third, fifth): rich 7th/9th voicings would light up almost every pad
  const triad = chordFor(S.key, S.scale, S.chords.prog[J().phraseBar] ?? 0, 'triad')
  const pcs = new Set(triad.midi.map((m) => ((m % 12) + 12) % 12))
  const rows = new Set()
  for (let r = 0; r < 17; r++) if (pcs.has(((youMidi(r) % 12) + 12) % 12)) rows.add(r)
  return rows
}
export function playYou(row, vel = 0.85) {
  ensureGraph()
  void getEngine().resume()
  configure0()
  const p = J(), t = ctx.currentTime + 0.004
  youNotes.push(ctx.currentTime); if (youNotes.length > 64) youNotes.shift()
  if (p.you.inst === 'drums') {
    const kit = KITS[S?.drums.kit] ?? KITS[GENRES[p.genre]?.kits?.[0]] ?? KITS['808']
    triggerDrum(ctx, youBus.input, DRUM_KEYS[row % DRUM_KEYS.length], kit, t, vel)
    return
  }
  const inst = INSTRUMENTS[p.you.inst] ?? INSTRUMENTS.piano
  playNote(ctx, youBus.input, inst, youMidi(row), t, Math.max(inst.liveDur ?? 0.5, 0.35), vel)
}
/** MIDI keyboards: snap any note to the jam's scale so it always fits. */
export function playMidi(note, vel) {
  ensureGraph(); void getEngine().resume(); configure0()
  const p = J()
  youNotes.push(ctx.currentTime)
  if (p.you.inst === 'drums') { triggerDrum(ctx, youBus.input, DRUM_KEYS[((note % 12) + 12) % 8], KITS[S?.drums.kit] ?? KITS['808'], ctx.currentTime + 0.004, vel); return }
  const k = S ? S.key : 0, iv = SCALES[S ? S.scale : 'minor'].intervals
  const rel = (((note - k) % 12) + 12) % 12
  const best = iv.reduce((a, b) => (Math.abs(b - rel) < Math.abs(a - rel) ? b : a), iv[0])
  const inst = INSTRUMENTS[p.you.inst] ?? INSTRUMENTS.piano
  playNote(ctx, youBus.input, inst, note - rel + best, ctx.currentTime + 0.004, Math.max(inst.liveDur ?? 0.5, 0.35), vel)
}
let configured0 = false
function configure0() {
  if (J().playing && configured0) return
  configured0 = true
  if (!S) newSong(false)
  if (!J().playing) {
    // the band is stopped (its output may have faded out): make sure your own notes are heard
    out.gain.cancelScheduledValues(ctx.currentTime)
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.01)
    configure()
  }
}

// ── record the jam onto the timeline ─────────────────────────
let recording = null
export function startRecording() {
  if (recording) return
  ensureGraph()
  const sp = ctx.createScriptProcessor(4096, 2, 2), sink = ctx.createGain()
  sink.gain.value = 0
  const rec = { sp, sink, L: [], R: [], frames: 0 }
  sp.onaudioprocess = (e) => { const b = e.inputBuffer; rec.L.push(new Float32Array(b.getChannelData(0))); rec.R.push(new Float32Array(b.getChannelData(b.numberOfChannels > 1 ? 1 : 0))); rec.frames += b.length }
  out.connect(sp); sp.connect(sink).connect(ctx.destination)
  recording = rec
  set({ recording: true, recStart: performance.now() })
}
export function stopRecording() {
  const rec = recording
  if (!rec) return 0
  recording = null
  try { out.disconnect(rec.sp) } catch {}
  rec.sp.disconnect(); rec.sink.disconnect(); rec.sp.onaudioprocess = null
  set({ recording: false })
  const join = (parts) => { const a = new Float32Array(rec.frames); let o = 0; for (const p of parts) { a.set(p, o); o += p.length } return a }
  const L = join(rec.L), R = join(rec.R)
  let s = 0, e = rec.frames
  while (s < e && Math.abs(L[s]) < 1e-4 && Math.abs(R[s]) < 1e-4) s++
  while (e > s && Math.abs(L[e - 1]) < 1e-4 && Math.abs(R[e - 1]) < 1e-4) e--
  if (e - s < ctx.sampleRate) { toast('That take was too short, so nothing was added.'); return 0 }
  const buf = buffers.create(2, e - s, ctx.sampleRate)
  buf.copyToChannel(L.subarray(s, e), 0); buf.copyToChannel(R.subarray(s, e), 1)
  const name = `Jam · ${GENRES[J().genre]?.name ?? ''} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  const entry = buffers.add(buf, name)
  useStore.getState().mutate('Record jam', (p) => {
    const t = makeTrack(p, { name: 'Jam take' })
    p.tracks.push(t)
    p.clips.push(makeClip({ trackId: t.id, bufferId: entry.id, duration: buf.duration, name }))
  })
  toast({ title: `Jam take added to your song (${Math.round(buf.duration)} s)`, body: 'Find it as a new track in Edit.', action: { label: 'Open Edit', run: () => useStore.getState().setMode('edit') } })
  return buf.duration
}
export const toggleRecording = () => (recording ? stopRecording() : startRecording())
export const isJamPlaying = () => J().playing
