// "Sunny Loop": a procedurally synthesised 16-bar, 120 BPM demo song in four tracks.
import { buffers } from '../../core/buffers.js'
import { getEngine } from '../../core/engine.js'
import { makeClip, makeTrack, newProject, useStore } from '../../core/store.js'
import { toast } from '../../core/toast.js'

import { burst } from '../../ui/kit.js'
import { isProjectEmpty } from './project-file.js'
import { askConfirm } from './state.js'

const SR = 44100
const BPM = 120
const BEAT = 60 / BPM
const BAR = BEAT * 4
const LOOP_BARS = 4
const LOOP_LEN = BAR * LOOP_BARS // 8 s
const TAIL = 1.5

const mtof = (m        ) => 440 * Math.pow(2, (m - 69) / 12)

function noiseBuffer(ctx                  , secs = 1) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate)
  const d = b.getChannelData(0)
  let seed = 12345
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    d[i] = seed / 2147483648 - 1
  }
  return b
}

function env(g          , t        , a        , peak        , hold        , r        ) {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + a)
  g.gain.setValueAtTime(peak, t + a + hold)
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r)
}

// chord progression: Am – F – C – G, one chord per bar (MIDI notes)
const CHORDS = [
  { root: 45, notes: [57, 60, 64] }, // Am
  { root: 41, notes: [57, 60, 65] }, // F
  { root: 48, notes: [55, 60, 64] }, // C
  { root: 43, notes: [55, 59, 62] }, // G
]

function renderDrums(ctx                     ) {
  const noise = noiseBuffer(ctx, 1)
  for (let bar = 0; bar < LOOP_BARS; bar++) {
    for (let step = 0; step < 16; step++) {
      const t = bar * BAR + step * (BEAT / 4)
      // kick on every beat (+ a little extra on bar ends)
      if (step % 4 === 0 || (bar % 2 === 1 && step === 14)) {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.setValueAtTime(150, t)
        o.frequency.exponentialRampToValueAtTime(46, t + 0.12)
        env(g, t, 0.003, 0.95, 0.04, 0.28)
        o.connect(g).connect(ctx.destination)
        o.start(t)
        o.stop(t + 0.4)
      }
      // clap on 2 & 4
      if (step === 4 || step === 12) {
        const s = ctx.createBufferSource()
        s.buffer = noise
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = 1700
        f.Q.value = 0.9
        const g = ctx.createGain()
        env(g, t, 0.002, 0.55, 0.015, 0.16)
        s.connect(f).connect(g).connect(ctx.destination)
        s.start(t, 0.1)
        s.stop(t + 0.25)
      }
      // hats on 8ths, open hat on the off-beat
      if (step % 2 === 0) {
        const open = step % 4 === 2
        const s = ctx.createBufferSource()
        s.buffer = noise
        const f = ctx.createBiquadFilter()
        f.type = 'highpass'
        f.frequency.value = 7500
        const g = ctx.createGain()
        env(g, t, 0.001, open ? 0.22 : 0.14, 0.005, open ? 0.16 : 0.04)
        s.connect(f).connect(g).connect(ctx.destination)
        s.start(t, 0.3)
        s.stop(t + 0.25)
      }
      // shaker 16ths (very quiet)
      if (step % 2 === 1) {
        const s = ctx.createBufferSource()
        s.buffer = noise
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = 5500
        const g = ctx.createGain()
        env(g, t, 0.002, 0.05, 0.004, 0.03)
        s.connect(f).connect(g).connect(ctx.destination)
        s.start(t, 0.6)
        s.stop(t + 0.1)
      }
    }
  }
}

function renderBass(ctx                     ) {
  // root, root(8th), octave, fifth – a bouncy sunny line
  const pattern = [0, 0.75, 1.5, 2, 2.75, 3.25]
  for (let bar = 0; bar < LOOP_BARS; bar++) {
    const { root } = CHORDS[bar]
    pattern.forEach((beat, i) => {
      const t = bar * BAR + beat * BEAT
      const midi = root + (i === 2 ? 12 : i === 5 ? 7 : 0)
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = mtof(midi)
      const sub = ctx.createOscillator()
      sub.type = 'sine'
      sub.frequency.value = mtof(midi - 12 + 12)
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.Q.value = 3
      f.frequency.setValueAtTime(900, t)
      f.frequency.exponentialRampToValueAtTime(180, t + 0.22)
      const g = ctx.createGain()
      const len = i === 1 ? 0.18 : 0.32
      env(g, t, 0.01, 0.45, len * 0.5, len * 0.6)
      o.connect(f)
      sub.connect(f)
      f.connect(g).connect(ctx.destination)
      o.start(t)
      sub.start(t)
      o.stop(t + len + 0.2)
      sub.stop(t + len + 0.2)
    })
  }
}

function renderChords(ctx                     ) {
  for (let bar = 0; bar < LOOP_BARS; bar++) {
    const t = bar * BAR
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900, t)
    lp.frequency.linearRampToValueAtTime(2600, t + BAR * 0.5)
    lp.frequency.linearRampToValueAtTime(1200, t + BAR)
    lp.Q.value = 0.7
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.5, t + 0.35)
    g.gain.setValueAtTime(0.5, t + BAR - 0.4)
    g.gain.linearRampToValueAtTime(0.0001, t + BAR + 0.5)
    lp.connect(g).connect(ctx.destination)
    for (const m of CHORDS[bar].notes) {
      for (const det of [-9, 0, 9]) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = mtof(m)
        o.detune.value = det
        const og = ctx.createGain()
        og.gain.value = 0.11
        o.connect(og).connect(lp)
        o.start(t)
        o.stop(t + BAR + 0.55)
      }
    }
  }
}

// A 4-bar melody in A minor pentatonic: [beatPosition, midi, lengthInBeats]
const MELODY                             = [
  [0, 72, 1], [1, 76, 0.5], [1.5, 79, 1.5], [3, 76, 1],
  [4, 74, 1], [5, 72, 0.5], [5.5, 74, 1.5], [7, 69, 1],
  [8, 72, 1], [9, 76, 1], [10, 79, 0.5], [10.5, 81, 1.5],
  [12, 79, 1], [13, 76, 1], [14, 74, 1], [15, 72, 1],
]

function renderLead(ctx                     ) {
  const delay = ctx.createDelay(1)
  delay.delayTime.value = BEAT * 0.75
  const fb = ctx.createGain()
  fb.gain.value = 0.34
  const wet = ctx.createGain()
  wet.gain.value = 0.38
  delay.connect(fb).connect(delay)
  delay.connect(wet).connect(ctx.destination)
  for (const [beat, midi, len] of MELODY) {
    const t = beat * BEAT
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = mtof(midi)
    const o2 = ctx.createOscillator()
    o2.type = 'square'
    o2.frequency.value = mtof(midi)
    o2.detune.value = 6
    const o2g = ctx.createGain()
    o2g.gain.value = 0.18
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 5.2
    const lfoG = ctx.createGain()
    lfoG.gain.value = 7
    lfo.connect(lfoG)
    lfoG.connect(o.detune)
    lfoG.connect(o2.detune)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(4200, t)
    f.frequency.exponentialRampToValueAtTime(1500, t + len * BEAT)
    const g = ctx.createGain()
    const d = len * BEAT
    env(g, t, 0.012, 0.42, d * 0.45, d * 0.55)
    o.connect(f)
    o2.connect(o2g).connect(f)
    f.connect(g)
    g.connect(ctx.destination)
    g.connect(delay)
    for (const n of [o, o2, lfo]) {
      n.start(t)
      n.stop(t + d + 0.3)
    }
  }
}

async function renderLoop(fn                                    , stereoWide = false)                       {
  const len = Math.ceil((LOOP_LEN + TAIL) * SR)
  const ctx = new OfflineAudioContext(2, len, SR)
  fn(ctx)
  const out = await ctx.startRendering()
  // fold the ring-out tail back onto the start so the loop is seamless
  const loopN = Math.round(LOOP_LEN * SR)
  const res = new AudioBuffer({ numberOfChannels: 2, length: loopN, sampleRate: SR })
  for (let c = 0; c < 2; c++) {
    const src = out.getChannelData(c)
    const dst = new Float32Array(loopN)
    dst.set(src.subarray(0, loopN))
    for (let i = loopN; i < src.length; i++) dst[i - loopN] += src[i]
    // a haas-style widening for pads
    if (stereoWide && c === 1) {
      const sh = Math.round(0.011 * SR)
      const copy = dst.slice()
      for (let i = sh; i < loopN; i++) dst[i] = copy[i - sh]
    }
    // tiny edge fades against clicks
    const f = Math.round(0.004 * SR)
    for (let i = 0; i < f; i++) {
      dst[i] *= i / f
      dst[loopN - 1 - i] *= i / f
    }
    res.copyToChannel(dst, c)
  }
  return res
}

export async function loadDemoSong() {
  const st = useStore.getState()
  if (!isProjectEmpty(st.project)) {
    const ok = await askConfirm('Load the demo song?', 'Your current song will be replaced by “Demo – Sunny Loop”.', 'Load demo')
    if (!ok) return
  }
  toast({ title: 'Cooking up a demo song…', body: 'Making drums, bass, chords and a melody right here in your browser.', ms: 3500 })
  const [drums, bass, chords, lead] = await Promise.all([
    renderLoop(renderDrums),
    renderLoop(renderBass),
    renderLoop(renderChords, true),
    renderLoop(renderLead),
  ])
  const eng = getEngine()
  eng.stop(false)
  const proj = newProject('Demo – Sunny Loop')
  proj.bpm = BPM
  proj.sampleRate = SR
  proj.loop = { enabled: false, start: 0, end: LOOP_LEN * 2 }
  const defs                                                                                                     = [
    { name: 'Drums', buf: drums, color: '#fb923c', volume: 0.9, pan: 0, starts: [0, 1, 2, 3] },
    { name: 'Bass', buf: bass, color: '#818cf8', volume: 0.85, pan: 0, starts: [0, 1, 2, 3] },
    { name: 'Chords', buf: chords, color: '#a78bfa', volume: 0.6, pan: -0.15, starts: [0, 1, 2, 3] },
    { name: 'Melody', buf: lead, color: '#f472b6', volume: 0.75, pan: 0.15, starts: [1, 2, 3] },
  ]
  for (const d of defs) {
    const entry = buffers.add(d.buf, `Demo ${d.name}`)
    const tr        = makeTrack(proj, { name: d.name, color: d.color, volume: d.volume, pan: d.pan })
    proj.tracks.push(tr)
    for (const k of d.starts)
      proj.clips.push(makeClip({ trackId: tr.id, bufferId: entry.id, duration: d.buf.duration, name: `${d.name} ${LOOP_BARS * k + 1}–${LOOP_BARS * (k + 1)}`, start: k * LOOP_LEN, color: d.color }))
  }
  useStore.getState().loadProject(proj)
  useStore.getState().setMode('edit')
  eng.seek(0)
  toast({
    title: 'Demo song ready 🌞',
    body: 'Four tracks, 16 bars. Press Space to play, then try muting a track or cutting a clip with S.',
    kind: 'celebrate',
    ms: 5000,
  })
  burst(window.innerWidth / 2, window.innerHeight / 2)
}
