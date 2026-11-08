// Subtractive synth instruments: oscillators + filter envelope + amp ADSR.
// Chorus / delay are applied per section bus (see mix.ts) using the numbers in each preset.
import { midiToFreq } from '../theory.js'

export const INSTRUMENTS                          = {
  pluck: {
    id: 'pluck', name: 'Pluck',
    oscs: [{ type: 'sawtooth', mult: 1, detune: -6, gain: 0.5 }, { type: 'square', mult: 1, detune: 6, gain: 0.3 }],
    attack: 0.002, decay: 0.28, sustain: 0.001, release: 0.12,
    cutMult: 3, q: 2, fEnv: 6, fDecay: 0.22, gain: 0.5, chorus: 0.25, delay: { mix: 0.22, beats: 0.75 }, liveDur: 0.3,
  },
  pad: {
    id: 'pad', name: 'Soft Pad',
    oscs: [
      { type: 'sawtooth', mult: 1, detune: -11, gain: 0.3 },
      { type: 'sawtooth', mult: 1, detune: 11, gain: 0.3 },
      { type: 'triangle', mult: 1, detune: 0, gain: 0.4 },
      { type: 'sine', mult: 0.5, detune: 0, gain: 0.25 },
    ],
    attack: 0.3, decay: 0.5, sustain: 0.85, release: 0.9,
    cutMult: 2.4, q: 0.7, fEnv: 1.5, fDecay: 0.8, gain: 0.34, chorus: 0.55, delay: { mix: 0.16, beats: 1.5 }, liveDur: 1.4,
  },
  bass: {
    id: 'bass', name: 'Synth Bass', role: 'bass',
    oscs: [{ type: 'sawtooth', mult: 1, detune: 0, gain: 0.45 }, { type: 'sine', mult: 1, detune: 0, gain: 0.7 }, { type: 'square', mult: 0.5, detune: 0, gain: 0.25 }],
    attack: 0.006, decay: 0.2, sustain: 0.65, release: 0.09,
    cutMult: 3.2, q: 1.5, fEnv: 3.5, fDecay: 0.16, gain: 0.7, chorus: 0, delay: { mix: 0, beats: 1 }, liveDur: 0.4,
  },
  bell: {
    id: 'bell', name: 'Bell',
    oscs: [
      { type: 'sine', mult: 1, detune: 0, gain: 0.6 },
      { type: 'sine', mult: 2.76, detune: 0, gain: 0.25 },
      { type: 'sine', mult: 5.4, detune: 0, gain: 0.12 },
      { type: 'triangle', mult: 4.1, detune: 4, gain: 0.08 },
    ],
    attack: 0.002, decay: 1.5, sustain: 0.001, release: 0.4,
    cutMult: 14, q: 0.5, fEnv: 0, fDecay: 0.1, gain: 0.5, chorus: 0.2, delay: { mix: 0.3, beats: 0.75 }, liveDur: 0.5,
  },
  saw: {
    id: 'saw', name: 'Saw Lead',
    oscs: [
      { type: 'sawtooth', mult: 1, detune: -9, gain: 0.35 },
      { type: 'sawtooth', mult: 1, detune: 9, gain: 0.35 },
      { type: 'square', mult: 0.5, detune: 0, gain: 0.15 },
    ],
    attack: 0.01, decay: 0.25, sustain: 0.65, release: 0.18,
    cutMult: 4.5, q: 3, fEnv: 3, fDecay: 0.3, gain: 0.4, chorus: 0.35, delay: { mix: 0.25, beats: 0.75 }, liveDur: 0.45,
  },
  piano: {
    id: 'piano', name: 'Piano-ish',
    oscs: [
      { type: 'triangle', mult: 1, detune: -3, gain: 0.5 },
      { type: 'triangle', mult: 1, detune: 3, gain: 0.35 },
      { type: 'sine', mult: 2, detune: 0, gain: 0.18 },
      { type: 'sine', mult: 3, detune: 0, gain: 0.07 },
    ],
    attack: 0.004, decay: 1.1, sustain: 0.12, release: 0.35,
    cutMult: 7, q: 0.6, fEnv: 4, fDecay: 0.25, gain: 0.55, chorus: 0.12, delay: { mix: 0.06, beats: 0.5 }, liveDur: 0.8,
  },
  // ── extra instruments ──────────────────────────────────────
  rhodes: {
    id: 'rhodes', name: 'Electric Piano',
    oscs: [{ type: 'sine', mult: 1, detune: 0, gain: 0.6 }, { type: 'sine', mult: 2, detune: 2, gain: 0.18 }, { type: 'triangle', mult: 1, detune: -4, gain: 0.25 }, { type: 'sine', mult: 7, detune: 0, gain: 0.03 }],
    attack: 0.003, decay: 1.6, sustain: 0.22, release: 0.4,
    cutMult: 6, q: 0.5, fEnv: 1.5, fDecay: 0.3, gain: 0.55, chorus: 0.3, delay: { mix: 0.12, beats: 0.75 }, liveDur: 0.9,
    tremolo: { rate: 4.6, depth: 0.28 },
  },
  organ: {
    id: 'organ', name: 'Organ',
    oscs: [{ type: 'sine', mult: 0.5, detune: 0, gain: 0.35 }, { type: 'sine', mult: 1, detune: 0, gain: 0.45 }, { type: 'sine', mult: 2, detune: 0, gain: 0.3 }, { type: 'sine', mult: 3, detune: 0, gain: 0.18 }, { type: 'sine', mult: 4, detune: 0, gain: 0.12 }],
    attack: 0.008, decay: 0.1, sustain: 0.95, release: 0.08,
    cutMult: 12, q: 0.4, fEnv: 0, fDecay: 0.1, gain: 0.3, chorus: 0.45, delay: { mix: 0.05, beats: 0.5 }, liveDur: 0.5,
    vibrato: { rate: 6.4, depth: 9 },
  },
  guitar: {
    id: 'guitar', name: 'Rock Guitar',
    oscs: [{ type: 'sawtooth', mult: 1, detune: -7, gain: 0.4 }, { type: 'square', mult: 1, detune: 7, gain: 0.3 }, { type: 'sawtooth', mult: 0.5, detune: 0, gain: 0.2 }],
    attack: 0.003, decay: 0.7, sustain: 0.55, release: 0.12,
    cutMult: 2.6, q: 0.9, fEnv: 1.2, fDecay: 0.12, gain: 0.26, chorus: 0.15, delay: { mix: 0.08, beats: 0.75 }, liveDur: 0.5,
    drive: 0.85, hp: 110,
  },
  strings: {
    id: 'strings', name: 'Strings',
    oscs: [{ type: 'sawtooth', mult: 1, detune: -13, gain: 0.25 }, { type: 'sawtooth', mult: 1, detune: 13, gain: 0.25 }, { type: 'sawtooth', mult: 1, detune: -4, gain: 0.2 }, { type: 'triangle', mult: 2, detune: 5, gain: 0.12 }],
    attack: 0.32, decay: 0.6, sustain: 0.9, release: 0.75,
    cutMult: 3.2, q: 0.6, fEnv: 0.6, fDecay: 0.6, gain: 0.46, chorus: 0.55, delay: { mix: 0.12, beats: 1 }, liveDur: 1.2,
    vibrato: { rate: 5.3, depth: 7 },
  },
  marimba: {
    id: 'marimba', name: 'Marimba',
    oscs: [{ type: 'sine', mult: 1, detune: 0, gain: 0.7 }, { type: 'sine', mult: 4, detune: 0, gain: 0.16 }, { type: 'sine', mult: 9.9, detune: 0, gain: 0.05 }],
    attack: 0.001, decay: 0.42, sustain: 0.001, release: 0.2,
    cutMult: 12, q: 0.5, fEnv: 0, fDecay: 0.1, gain: 0.62, chorus: 0.1, delay: { mix: 0.14, beats: 0.75 }, liveDur: 0.4,
  },
  flute: {
    id: 'flute', name: 'Flute',
    oscs: [{ type: 'sine', mult: 1, detune: 0, gain: 0.7 }, { type: 'triangle', mult: 2, detune: 0, gain: 0.08 }],
    attack: 0.07, decay: 0.3, sustain: 0.85, release: 0.15,
    cutMult: 5, q: 0.5, fEnv: 0.3, fDecay: 0.2, gain: 0.48, chorus: 0.15, delay: { mix: 0.22, beats: 0.75 }, liveDur: 0.6,
    vibrato: { rate: 5, depth: 14, delay: 0.18 }, breath: 0.07,
  },
  brass: {
    id: 'brass', name: 'Brass',
    oscs: [{ type: 'sawtooth', mult: 1, detune: -5, gain: 0.4 }, { type: 'sawtooth', mult: 1, detune: 5, gain: 0.4 }, { type: 'square', mult: 0.5, detune: 0, gain: 0.12 }],
    attack: 0.04, decay: 0.3, sustain: 0.72, release: 0.14,
    cutMult: 2.2, q: 1.1, fEnv: 2.6, fDecay: 0.14, gain: 0.4, chorus: 0.2, delay: { mix: 0.08, beats: 0.5 }, liveDur: 0.5,
    vibrato: { rate: 5.5, depth: 6, delay: 0.25 },
  },
  supersaw: {
    id: 'supersaw', name: 'Supersaw',
    oscs: [-21, -9, -3, 3, 9, 21].map((detune) => ({ type: 'sawtooth', mult: 1, detune, gain: 0.17 })),
    attack: 0.01, decay: 0.4, sustain: 0.75, release: 0.3,
    cutMult: 5, q: 0.7, fEnv: 1.5, fDecay: 0.25, gain: 0.32, chorus: 0.5, delay: { mix: 0.25, beats: 0.75 }, liveDur: 0.6,
  },
  // ── bass sounds (role: 'bass') ─────────────────────────────
  sub808: {
    id: 'sub808', name: '808 Sub', role: 'bass',
    oscs: [{ type: 'sine', mult: 1, detune: 0, gain: 0.9 }, { type: 'triangle', mult: 2, detune: 0, gain: 0.08 }],
    attack: 0.002, decay: 1.4, sustain: 0.55, release: 0.12,
    cutMult: 6, q: 0.5, fEnv: 0, fDecay: 0.1, gain: 0.8, chorus: 0, delay: { mix: 0, beats: 1 }, liveDur: 0.6,
    drive: 0.35,
  },
  reese: {
    id: 'reese', name: 'Reese', role: 'bass',
    oscs: [{ type: 'sawtooth', mult: 1, detune: -17, gain: 0.4 }, { type: 'sawtooth', mult: 1, detune: 17, gain: 0.4 }, { type: 'sine', mult: 0.5, detune: 0, gain: 0.5 }],
    attack: 0.01, decay: 0.4, sustain: 0.9, release: 0.12,
    cutMult: 2.2, q: 1.2, fEnv: 0.8, fDecay: 0.3, gain: 0.5, chorus: 0, delay: { mix: 0, beats: 1 }, liveDur: 0.6,
    drive: 0.4,
  },
  wobble: {
    id: 'wobble', name: 'Wobble', role: 'bass',
    oscs: [{ type: 'sawtooth', mult: 1, detune: -8, gain: 0.45 }, { type: 'square', mult: 1, detune: 8, gain: 0.35 }, { type: 'sine', mult: 0.5, detune: 0, gain: 0.55 }],
    attack: 0.005, decay: 0.3, sustain: 0.95, release: 0.08,
    cutMult: 1.3, q: 7, fEnv: 0, fDecay: 0.1, gain: 0.55, chorus: 0, delay: { mix: 0, beats: 1 }, liveDur: 0.8,
    drive: 0.55, wobble: { steps: 2, depth: 4 },
  },
  picked: {
    id: 'picked', name: 'Picked Bass', role: 'bass',
    oscs: [{ type: 'sawtooth', mult: 1, detune: 0, gain: 0.35 }, { type: 'triangle', mult: 1, detune: 0, gain: 0.6 }],
    attack: 0.002, decay: 0.45, sustain: 0.4, release: 0.08,
    cutMult: 4, q: 1, fEnv: 2.2, fDecay: 0.08, gain: 0.7, chorus: 0, delay: { mix: 0, beats: 1 }, liveDur: 0.4,
    drive: 0.2,
  },
}

/** Play one synth note. `dur` = how long the key is held (seconds). */
const driveCurves = new Map()
function driveCurve(amount) {
  let c = driveCurves.get(amount)
  if (!c) {
    c = new Float32Array(2048)
    const k = 1 + amount * 14
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1
      c[i] = Math.tanh(x * k) / Math.tanh(k)
    }
    driveCurves.set(amount, c)
  }
  return c
}
const breathBufs = new WeakMap()
function breathBuf(ctx) {
  let b = breathBufs.get(ctx)
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    breathBufs.set(ctx, b)
  }
  return b
}

/** Only melodic (non-bass) instruments, for melody / chord pickers. */
export const LEAD_INSTRUMENTS = () => Object.values(INSTRUMENTS).filter((i) => i.role !== 'bass')
export const BASS_INSTRUMENTS = () => Object.values(INSTRUMENTS).filter((i) => i.role === 'bass')

/**
 * Play one synth note. `dur` = how long the key is held (seconds).
 * Optional instrument features: drive (saturation), hp (high-pass Hz), wobble (tempo-synced
 * filter LFO, needs opts.stepDur), vibrato (pitch LFO), tremolo (amp LFO), breath (noise).
 */
export function playNote(ctx, dest, inst, midi, t, dur, vel, opts = {}) {
  const f = midiToFreq(midi)
  const peak = Math.max(0.0005, vel * inst.gain)
  const end = t + dur + inst.release
  const amp = ctx.createGain()
  const filt = ctx.createBiquadFilter()
  filt.type = 'lowpass'
  filt.Q.value = inst.q
  const base = Math.min(15000, Math.max(250, f * inst.cutMult))
  const top = Math.min(18000, base * (1 + inst.fEnv))
  filt.frequency.setValueAtTime(top, t)
  if (inst.fEnv > 0) filt.frequency.exponentialRampToValueAtTime(base, t + inst.fDecay)
  // amp envelope
  const a = Math.min(inst.attack, dur)
  const g = amp.gain
  g.setValueAtTime(0.0001, t)
  g.linearRampToValueAtTime(peak, t + a)
  let lvl = peak
  if (inst.decay > 0 && dur > a) {
    const dd = Math.min(inst.decay, dur - a)
    lvl = Math.max(0.0001, peak * Math.pow(Math.max(inst.sustain, 0.001), dd / inst.decay))
    g.exponentialRampToValueAtTime(lvl, t + a + dd)
  }
  g.setValueAtTime(lvl, t + dur)
  g.exponentialRampToValueAtTime(0.0001, end)
  let chain = filt
  if (inst.drive) {
    const ws = ctx.createWaveShaper()
    ws.curve = driveCurve(inst.drive)
    ws.oversample = '2x'
    const comp = ctx.createGain()
    comp.gain.value = 1 / (1 + inst.drive * 1.2)
    chain.connect(ws).connect(comp)
    chain = comp
  }
  if (inst.hp) {
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = inst.hp
    chain.connect(hp)
    chain = hp
  }
  chain.connect(amp).connect(dest)
  const lfoStop = end + 0.05
  if (inst.wobble) {
    const stepDur = opts.stepDur || 0.125
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 1 / (stepDur * inst.wobble.steps)
    const depth = ctx.createGain()
    depth.gain.value = base * inst.wobble.depth
    filt.frequency.cancelScheduledValues(t)
    filt.frequency.setValueAtTime(base * (1 + inst.wobble.depth * 0.5), t)
    lfo.connect(depth).connect(filt.frequency)
    // start a quarter cycle early so each wobble opens on the beat (never before time 0)
    const early = (stepDur * inst.wobble.steps) / 4
    if (t - early >= 0) lfo.start(t - early)
    else {
      lfo.start(t)
      lfo.frequency.value = lfo.frequency.value // phase starts at 0 → slightly later opening, still in time
    }
    lfo.stop(lfoStop)
  }
  if (inst.tremolo) {
    const trem = ctx.createGain()
    trem.gain.value = 1 - inst.tremolo.depth / 2
    const lfo = ctx.createOscillator()
    lfo.frequency.value = inst.tremolo.rate
    const d = ctx.createGain()
    d.gain.value = inst.tremolo.depth / 2
    lfo.connect(d).connect(trem.gain)
    amp.disconnect()
    amp.connect(trem).connect(dest)
    lfo.start(t)
    lfo.stop(lfoStop)
  }
  let vib = null
  if (inst.vibrato) {
    const lfo = ctx.createOscillator()
    lfo.frequency.value = inst.vibrato.rate
    vib = ctx.createGain()
    const vd = inst.vibrato.delay ?? 0
    vib.gain.setValueAtTime(0, t)
    vib.gain.linearRampToValueAtTime(inst.vibrato.depth, t + vd + 0.15)
    lfo.connect(vib)
    lfo.start(t)
    lfo.stop(lfoStop)
  }
  if (inst.breath) {
    const n = ctx.createBufferSource()
    n.buffer = breathBuf(ctx)
    n.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = Math.min(12000, f * 2)
    bp.Q.value = 1.2
    const ng = ctx.createGain()
    ng.gain.value = inst.breath
    n.connect(bp).connect(ng).connect(filt)
    n.start(t, Math.random() * 0.5)
    n.stop(lfoStop)
  }
  for (const o of inst.oscs) {
    const osc = ctx.createOscillator()
    osc.type = o.type
    osc.frequency.value = f * o.mult
    osc.detune.value = o.detune
    if (vib) vib.connect(osc.detune)
    const og = ctx.createGain()
    og.gain.value = o.gain
    osc.connect(og).connect(filt)
    osc.start(t)
    osc.stop(end + 0.05)
  }
}
