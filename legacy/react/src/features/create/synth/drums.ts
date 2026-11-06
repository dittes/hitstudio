// Drum synthesis (808 / 909 style). Every function takes a BaseAudioContext, a destination
// and a start time, so the exact same code drives live playback and offline bounce.
import type { DrumLane, KitId } from '../types'

export const LANES: { id: DrumLane; label: string; color: string }[] = [
  { id: 'kick', label: 'Kick', color: '#fb923c' },
  { id: 'snare', label: 'Snare', color: '#f472b6' },
  { id: 'clap', label: 'Clap', color: '#a78bfa' },
  { id: 'chat', label: 'Hi-hat', color: '#facc15' },
  { id: 'ohat', label: 'Open hat', color: '#4ade80' },
  { id: 'tom', label: 'Tom', color: '#38bdf8' },
  { id: 'rim', label: 'Rim', color: '#2dd4bf' },
  { id: 'perc', label: 'Perc', color: '#818cf8' },
]

export interface KitDef {
  id: KitId
  name: string
  blurb: string
  kick: { f0: number; f1: number; pd: number; dec: number; click: number; drive: number }
  snare: { tone: number; dec: number; noise: number; snap: number }
  clap: { freq: number; dec: number }
  hat: { hp: number; dec: number; odec: number; metal: number }
  tom: { f: number; dec: number }
  rim: { f: number }
  perc: { f: number; dec: number }
  /** master lowpass per hit (Hz); >= 19000 = bypass */
  lp: number
  gain: number
}

export const KITS: Record<KitId, KitDef> = {
  '808': {
    id: '808', name: '808', blurb: 'Classic boom',
    kick: { f0: 165, f1: 46, pd: 0.09, dec: 0.75, click: 0.25, drive: 0 },
    snare: { tone: 185, dec: 0.2, noise: 0.85, snap: 0.5 },
    clap: { freq: 1250, dec: 0.2 },
    hat: { hp: 7500, dec: 0.045, odec: 0.35, metal: 0.5 },
    tom: { f: 120, dec: 0.4 },
    rim: { f: 1700 },
    perc: { f: 540, dec: 0.18 },
    lp: 20000, gain: 1,
  },
  lofi: {
    id: 'lofi', name: 'Lo-fi', blurb: 'Dusty & warm',
    kick: { f0: 125, f1: 50, pd: 0.07, dec: 0.38, click: 0.08, drive: 0.4 },
    snare: { tone: 165, dec: 0.17, noise: 0.65, snap: 0.2 },
    clap: { freq: 950, dec: 0.17 },
    hat: { hp: 5200, dec: 0.05, odec: 0.22, metal: 0.2 },
    tom: { f: 105, dec: 0.3 },
    rim: { f: 1300 },
    perc: { f: 420, dec: 0.16 },
    lp: 5200, gain: 0.95,
  },
  house: {
    id: 'house', name: 'House', blurb: 'Punchy 909',
    kick: { f0: 215, f1: 52, pd: 0.05, dec: 0.45, click: 0.6, drive: 0.5 },
    snare: { tone: 225, dec: 0.22, noise: 1, snap: 0.8 },
    clap: { freq: 1500, dec: 0.24 },
    hat: { hp: 8800, dec: 0.04, odec: 0.3, metal: 0.65 },
    tom: { f: 150, dec: 0.3 },
    rim: { f: 1900 },
    perc: { f: 680, dec: 0.14 },
    lp: 20000, gain: 1,
  },
  trap: {
    id: 'trap', name: 'Trap', blurb: 'Deep sub & crisp hats',
    kick: { f0: 130, f1: 36, pd: 0.12, dec: 1.15, click: 0.12, drive: 0.7 },
    snare: { tone: 205, dec: 0.13, noise: 0.9, snap: 1 },
    clap: { freq: 1700, dec: 0.15 },
    hat: { hp: 9500, dec: 0.03, odec: 0.2, metal: 0.4 },
    tom: { f: 95, dec: 0.5 },
    rim: { f: 2100 },
    perc: { f: 760, dec: 0.12 },
    lp: 20000, gain: 0.95,
  },
}

// ── helpers ──────────────────────────────────────────────────
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()
function noiseBuf(ctx: BaseAudioContext) {
  let b = noiseCache.get(ctx)
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseCache.set(ctx, b)
  }
  return b
}
function noiseSrc(ctx: BaseAudioContext, t: number, dur: number) {
  const s = ctx.createBufferSource()
  s.buffer = noiseBuf(ctx)
  s.loop = true
  s.start(t, Math.random() * 1.5)
  s.stop(t + dur)
  return s
}
function env(p: AudioParam, t: number, peak: number, dec: number, atk = 0.001) {
  p.setValueAtTime(0.0001, t)
  p.linearRampToValueAtTime(Math.max(peak, 0.0002), t + atk)
  p.exponentialRampToValueAtTime(0.0001, t + atk + dec)
}
const curves = new Map<number, Float32Array<ArrayBuffer>>()
function driveCurve(amount: number) {
  let c = curves.get(amount)
  if (!c) {
    c = new Float32Array(1024)
    const k = 1 + amount * 8
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1
      c[i] = Math.tanh(x * k) / Math.tanh(k)
    }
    curves.set(amount, c)
  }
  return c
}
const chokes = new WeakMap<BaseAudioContext, GainNode>()

function hitOut(ctx: BaseAudioContext, dest: AudioNode, kit: KitDef, gain: number): GainNode {
  const g = ctx.createGain()
  g.gain.value = gain * kit.gain
  if (kit.lp < 19000) {
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = kit.lp
    g.connect(f).connect(dest)
  } else g.connect(dest)
  return g
}

function osc(ctx: BaseAudioContext, type: OscillatorType, f: number, t: number, dur: number) {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f, t)
  o.start(t)
  o.stop(t + dur)
  return o
}

// ── voices ───────────────────────────────────────────────────
function kick(ctx: BaseAudioContext, out: AudioNode, k: KitDef, t: number) {
  const c = k.kick
  const o = osc(ctx, 'sine', c.f0, t, c.dec + 0.05)
  o.frequency.exponentialRampToValueAtTime(c.f1, t + c.pd)
  const g = ctx.createGain()
  env(g.gain, t, 1, c.dec, 0.002)
  o.connect(g)
  if (c.drive > 0) {
    const sh = ctx.createWaveShaper()
    sh.curve = driveCurve(c.drive)
    g.connect(sh).connect(out)
  } else g.connect(out)
  if (c.click > 0) {
    const n = noiseSrc(ctx, t, 0.02)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 3200
    const cg = ctx.createGain()
    env(cg.gain, t, c.click * 0.6, 0.012)
    n.connect(bp).connect(cg).connect(out)
    const co = osc(ctx, 'triangle', 1400, t, 0.02)
    const cg2 = ctx.createGain()
    env(cg2.gain, t, c.click * 0.3, 0.01)
    co.connect(cg2).connect(out)
  }
}

function snare(ctx: BaseAudioContext, out: AudioNode, k: KitDef, t: number) {
  const c = k.snare
  for (const [f, gn] of [[c.tone, 0.55], [c.tone * 1.62, 0.3]] as const) {
    const o = osc(ctx, 'triangle', f, t, c.dec + 0.05)
    o.frequency.exponentialRampToValueAtTime(f * 0.78, t + 0.08)
    const g = ctx.createGain()
    env(g.gain, t, gn, c.dec * 0.6)
    o.connect(g).connect(out)
  }
  const n = noiseSrc(ctx, t, c.dec + 0.05)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 1400 + c.snap * 900
  const ng = ctx.createGain()
  env(ng.gain, t, c.noise * 0.75, c.dec)
  n.connect(hp).connect(ng).connect(out)
}

function clap(ctx: BaseAudioContext, out: AudioNode, k: KitDef, t: number) {
  const c = k.clap
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = c.freq
  bp.Q.value = 1.1
  bp.connect(out)
  const offsets = [0, 0.011, 0.023, 0.036]
  offsets.forEach((o, i) => {
    const last = i === offsets.length - 1
    const n = noiseSrc(ctx, t + o, last ? c.dec + 0.05 : 0.03)
    const g = ctx.createGain()
    env(g.gain, t + o, last ? 0.9 : 0.6, last ? c.dec : 0.012, 0.0005)
    n.connect(g).connect(bp)
  })
}

const METAL = [1, 1.4471, 1.617, 1.9265, 2.5028, 2.6637]
function hat(ctx: BaseAudioContext, out: AudioNode, k: KitDef, t: number, open: boolean) {
  const c = k.hat
  const dec = open ? c.odec : c.dec
  let dest: AudioNode = out
  if (open) {
    const choke = ctx.createGain()
    choke.connect(out)
    chokes.set(ctx, choke)
    dest = choke
  } else {
    const ch = chokes.get(ctx)
    if (ch) ch.gain.setTargetAtTime(0, t, 0.004)
  }
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = c.hp
  const g = ctx.createGain()
  env(g.gain, t, 0.55, dec, 0.0008)
  hp.connect(g).connect(dest)
  const n = noiseSrc(ctx, t, dec + 0.05)
  const ng = ctx.createGain()
  ng.gain.value = 1 - c.metal * 0.5
  n.connect(ng).connect(hp)
  if (c.metal > 0.05) {
    const mg = ctx.createGain()
    mg.gain.value = c.metal * 0.1
    mg.connect(hp)
    for (const r of METAL) osc(ctx, 'square', 330 * r, t, dec + 0.05).connect(mg)
  }
}

function tom(ctx: BaseAudioContext, out: AudioNode, k: KitDef, t: number) {
  const c = k.tom
  const o = osc(ctx, 'sine', c.f * 1.5, t, c.dec + 0.05)
  o.frequency.exponentialRampToValueAtTime(c.f, t + 0.1)
  const g = ctx.createGain()
  env(g.gain, t, 0.9, c.dec, 0.002)
  o.connect(g).connect(out)
  const n = noiseSrc(ctx, t, 0.03)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1800
  const ng = ctx.createGain()
  env(ng.gain, t, 0.15, 0.02)
  n.connect(bp).connect(ng).connect(out)
}

function rim(ctx: BaseAudioContext, out: AudioNode, k: KitDef, t: number) {
  for (const [f, gn] of [[k.rim.f, 0.5], [k.rim.f * 0.29, 0.5]] as const) {
    const o = osc(ctx, 'triangle', f, t, 0.06)
    const g = ctx.createGain()
    env(g.gain, t, gn, 0.03, 0.0005)
    o.connect(g).connect(out)
  }
  const n = noiseSrc(ctx, t, 0.04)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3000
  const ng = ctx.createGain()
  env(ng.gain, t, 0.35, 0.025, 0.0005)
  n.connect(bp).connect(ng).connect(out)
}

function perc(ctx: BaseAudioContext, out: AudioNode, k: KitDef, t: number) {
  const c = k.perc
  // cowbell-ish: two detuned squares through a bandpass
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = c.f * 1.6
  bp.Q.value = 2.5
  const g = ctx.createGain()
  env(g.gain, t, 0.6, c.dec, 0.001)
  bp.connect(g).connect(out)
  osc(ctx, 'square', c.f, t, c.dec + 0.05).connect(bp)
  osc(ctx, 'square', c.f * 1.505, t, c.dec + 0.05).connect(bp)
}

/** Play one drum hit at ctx time `t`. `vel` 0..1. */
export function triggerDrum(ctx: BaseAudioContext, dest: AudioNode, lane: DrumLane, kit: KitDef, t: number, vel: number) {
  const out = hitOut(ctx, dest, kit, Math.max(0.02, vel))
  switch (lane) {
    case 'kick': return kick(ctx, out, kit, t)
    case 'snare': return snare(ctx, out, kit, t)
    case 'clap': return clap(ctx, out, kit, t)
    case 'chat': return hat(ctx, out, kit, t, false)
    case 'ohat': return hat(ctx, out, kit, t, true)
    case 'tom': return tom(ctx, out, kit, t)
    case 'rim': return rim(ctx, out, kit, t)
    case 'perc': return perc(ctx, out, kit, t)
  }
}
