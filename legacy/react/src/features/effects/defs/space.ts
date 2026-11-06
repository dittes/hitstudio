// Space: Reverb (algorithmic impulse response → ConvolverNode), Echo / Delay, Stereo width.
import { dbToGain } from '../../../core/ids'
import { DIVISIONS, defineEffect, disconnectAll, onBpmChange, paramSetter, projectBpm, stereoGain, wetDry } from './shared'

// ── Reverb ────────────────────────────────────────────────────
export const REVERB_STYLES = ['Room', 'Hall', 'Plate']

export interface IRSpec {
  size: number // 0..100
  decay: number // RT60 seconds
  damping: number // 0..100
  style: number
}

/**
 * Generate a stereo impulse response:
 *  early reflections (sparse taps, spread by room size) + a diffuse exponentially decaying
 *  noise tail whose brightness falls over time (damping = air / wall absorption).
 * Seeded noise, so live playback and offline export sound identical.
 */
export function makeImpulse(ctx: BaseAudioContext, s: IRSpec): AudioBuffer {
  const sr = ctx.sampleRate
  const decay = Math.max(0.1, s.decay)
  const len = Math.max(1, Math.round(sr * Math.min(14, decay * 1.1 + 0.05)))
  const ir = ctx.createBuffer(2, len, sr)
  const size = s.size / 100
  const plate = s.style === 2
  const hall = s.style === 1
  const damp = s.damping / 100
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    let seed = 0x9e3779b9 ^ (c * 7919) ^ Math.round(s.size * 13 + s.decay * 101)
    const rnd = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
      return ((seed >>> 0) / 4294967296) * 2 - 1
    }
    const k = -6.907755 / decay // ln(0.001)/RT60
    const buildUp = plate ? 0.002 : (0.005 + size * (hall ? 0.06 : 0.025))
    const fHi = plate ? 0.95 : 0.85
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / sr
      // brightness falls with time, faster with more damping
      const prog = Math.min(1, t / decay)
      const a = fHi * Math.pow(0.04 / fHi, prog * (0.25 + damp * 1.2) * (plate ? 0.5 : 1))
      const n = rnd()
      lp += a * (n - lp)
      const env = Math.exp(k * t) * Math.min(1, t / buildUp)
      d[i] = lp * env
    }
    if (!plate) {
      // early reflections: discrete taps within the first 10–90 ms depending on size
      const taps = hall ? 14 : 9
      const span = (0.01 + size * (hall ? 0.09 : 0.05)) * sr
      for (let j = 0; j < taps; j++) {
        const pos = Math.round((0.002 * sr) + span * Math.pow((j + 1 + rnd() * 0.5) / taps, 1.4))
        if (pos >= len) continue
        const amp = (0.9 - (0.6 * j) / taps) * (rnd() > 0 ? 1 : -1) * (1 - damp * 0.4)
        d[pos] += amp * 0.6
        if (pos + 1 < len) d[pos + 1] += amp * 0.25
      }
    }
  }
  return ir
}

defineEffect(
  {
    type: 'reverb',
    name: 'Reverb',
    icon: '🏛️',
    category: 'space',
    description: 'Puts your sound in a room, a concert hall or a cathedral – adds space and depth.',
    params: [
      { key: 'style', label: 'Space', min: 0, max: 2, default: 1, step: 1 },
      { key: 'size', label: 'Size', min: 0, max: 100, default: 55, step: 1, unit: '%', hint: 'How big the room feels' },
      { key: 'decay', label: 'Decay', min: 0.2, max: 12, default: 2.2, step: 0.05, unit: 's', curve: 'log', hint: 'How long the echo tail rings out' },
      { key: 'damping', label: 'Damping', min: 0, max: 100, default: 45, step: 1, unit: '%', hint: 'Soft walls absorb the highs – darker, warmer tail' },
      { key: 'predelay', label: 'Pre-delay', min: 0, max: 200, default: 15, step: 1, unit: 'ms', hint: 'A tiny gap before the reverb starts – keeps vocals clear' },
      { key: 'lowcut', label: 'Low cut', min: 20, max: 1000, default: 150, step: 1, unit: 'Hz', curve: 'log', hint: 'Removes boomy lows from the reverb only' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 25, step: 1, unit: '%', hint: 'How much reverb you hear' },
    ],
    presets: {
      Room: { style: 0, size: 30, decay: 0.7, damping: 55, predelay: 5, lowcut: 200, mix: 20 },
      Hall: { style: 1, size: 65, decay: 2.6, damping: 40, predelay: 20, lowcut: 150, mix: 25 },
      Cathedral: { style: 1, size: 100, decay: 7, damping: 30, predelay: 45, lowcut: 120, mix: 35 },
      Plate: { style: 2, size: 50, decay: 1.8, damping: 20, predelay: 10, lowcut: 250, mix: 22 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const mix = wetDry(ctx)
      const pre = ctx.createDelay(1)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.Q.value = 0.7
      const out = ctx.createGain()
      mix.input.connect(pre).connect(hp)
      out.connect(mix.wet)
      // two convolver slots so new impulses crossfade in without clicks
      const slots = [0, 1].map(() => {
        const conv = ctx.createConvolver()
        const g = ctx.createGain()
        g.gain.value = 0
        hp.connect(conv).connect(g).connect(out)
        return { conv, g }
      })
      let active = -1
      let irKey = ''
      let timer = 0
      const live = ctx instanceof AudioContext
      const loadIR = (q: Record<string, number>) => {
        const next = active === 0 ? 1 : 0
        const s = slots[next]
        // a fresh node is required to swap buffers on some browsers
        const conv = ctx.createConvolver()
        conv.buffer = makeImpulse(ctx, { size: q.size ?? 55, decay: q.decay ?? 2.2, damping: q.damping ?? 45, style: Math.round(q.style ?? 1) })
        try { s.conv.disconnect() } catch {}
        hp.connect(conv).connect(s.g)
        s.conv = conv
        const now = ctx.currentTime
        if (active < 0) s.g.gain.value = 1
        else {
          s.g.gain.cancelScheduledValues(now)
          s.g.gain.setTargetAtTime(1, now, 0.03)
          const old = slots[active]
          old.g.gain.cancelScheduledValues(now)
          old.g.gain.setTargetAtTime(0, now, 0.03)
        }
        active = next
      }
      const update = (q: Record<string, number>) => {
        set(pre.delayTime, (q.predelay ?? 15) / 1000, 0.03)
        set(hp.frequency, q.lowcut ?? 150)
        const g = mix.gains(q.mix ?? 25)
        set(mix.dry.gain, g.dry)
        set(mix.wet.gain, g.wet)
        const key = `${q.size}|${q.decay}|${q.damping}|${q.style}`
        if (key !== irKey) {
          irKey = key
          if (!live || active < 0) loadIR(q)
          else {
            clearTimeout(timer)
            timer = window.setTimeout(() => loadIR(q), 70)
          }
        }
      }
      update(p)
      goLive()
      return {
        input: mix.input,
        output: mix.output,
        update,
        dispose() {
          clearTimeout(timer)
          disconnectAll([...mix.nodes, pre, hp, out, ...slots.flatMap((s) => [s.conv, s.g])])
        },
      }
    },
  },
  { visual: 'reverb', icon: 'reverb', enums: { style: REVERB_STYLES }, tags: 'room hall space ambience cathedral plate verb' },
)

// ── Echo / Delay ──────────────────────────────────────────────
export function echoTime(q: Record<string, number>, bpm = projectBpm()) {
  if ((q.sync ?? 0) >= 0.5) {
    const div = DIVISIONS[Math.round(q.div ?? 3)] ?? DIVISIONS[3]
    return Math.min(4, (60 / bpm) * div.beats)
  }
  return (q.time ?? 350) / 1000
}

defineEffect(
  {
    type: 'echo',
    name: 'Echo / Delay',
    icon: '🔁',
    category: 'space',
    description: 'Repeats your sound like shouting in a canyon. Sync it to the beat for rhythmic echoes.',
    params: [
      { key: 'sync', label: 'Sync to beat', min: 0, max: 1, default: 1, step: 1, hint: 'Lock the echo to the song tempo' },
      { key: 'div', label: 'Note', min: 0, max: DIVISIONS.length - 1, default: 2, step: 1 },
      { key: 'time', label: 'Time', min: 10, max: 2000, default: 350, step: 1, unit: 'ms', curve: 'log', hint: 'Time between repeats' },
      { key: 'feedback', label: 'Repeats', min: 0, max: 95, default: 40, step: 1, unit: '%', hint: 'How many echoes you hear before they fade' },
      { key: 'tone', label: 'Tone', min: 500, max: 20000, default: 6000, step: 1, unit: 'Hz', curve: 'log', hint: 'Lower = darker, tape-like echoes' },
      { key: 'pingpong', label: 'Ping-pong', min: 0, max: 1, default: 0, step: 1, hint: 'Echoes bounce between left and right speakers' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 30, step: 1, unit: '%', hint: 'How loud the echoes are' },
    ],
    presets: {
      'Slapback': { sync: 0, time: 110, feedback: 10, tone: 7000, pingpong: 0, mix: 30 },
      'Dotted eighth': { sync: 1, div: 2, feedback: 45, tone: 5000, pingpong: 0, mix: 30 },
      'Ping-pong': { sync: 1, div: 1, feedback: 50, tone: 8000, pingpong: 1, mix: 35 },
      'Dub tape': { sync: 1, div: 3, feedback: 75, tone: 1500, pingpong: 1, mix: 40 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const mix = wetDry(ctx)
      const inp = stereoGain(ctx)
      const split = ctx.createChannelSplitter(2)
      const merge = ctx.createChannelMerger(2)
      mix.input.connect(inp).connect(split)
      const dL = ctx.createDelay(4.5), dR = ctx.createDelay(4.5)
      const tL = ctx.createBiquadFilter(), tR = ctx.createBiquadFilter()
      tL.type = tR.type = 'lowpass'
      const g = () => ctx.createGain()
      const inLL = g(), inRR = g(), inRL = g(), selfL = g(), selfR = g(), crossLR = g(), crossRL = g()
      split.connect(inLL, 0).connect(dL)
      split.connect(inRR, 1).connect(dR)
      split.connect(inRL, 1).connect(dL)
      dL.connect(tL); dR.connect(tR)
      tL.connect(selfL).connect(dL)
      tR.connect(selfR).connect(dR)
      tL.connect(crossLR).connect(dR)
      tR.connect(crossRL).connect(dL)
      dL.connect(merge, 0, 0)
      dR.connect(merge, 0, 1)
      merge.connect(mix.wet)
      let cur = p
      const update = (q: Record<string, number>) => {
        cur = q
        const t = echoTime(q)
        set(dL.delayTime, t, 0.05)
        set(dR.delayTime, t, 0.05)
        set(tL.frequency, q.tone ?? 6000)
        set(tR.frequency, q.tone ?? 6000)
        const fb = Math.min(0.95, (q.feedback ?? 40) / 100)
        const pp = (q.pingpong ?? 0) >= 0.5
        set(inLL.gain, pp ? 0.5 : 1)
        set(inRL.gain, pp ? 0.5 : 0)
        set(inRR.gain, pp ? 0 : 1)
        set(selfL.gain, pp ? 0 : fb)
        set(selfR.gain, pp ? 0 : fb)
        set(crossLR.gain, pp ? fb : 0)
        set(crossRL.gain, pp ? fb : 0)
        const m = mix.gains(q.mix ?? 30)
        set(mix.dry.gain, m.dry)
        set(mix.wet.gain, m.wet)
      }
      update(p)
      goLive()
      const unsub = onBpmChange(() => update(cur))
      return {
        input: mix.input,
        output: mix.output,
        update,
        dispose() {
          unsub()
          disconnectAll([...mix.nodes, inp, split, merge, dL, dR, tL, tR, inLL, inRR, inRL, selfL, selfR, crossLR, crossRL])
        },
      }
    },
  },
  {
    visual: 'delay',
    icon: 'echo',
    toggles: ['sync', 'pingpong'],
    enums: { div: DIVISIONS.map((d) => d.label) },
    tags: 'delay echo repeat ping pong tape dub',
    showIf: { div: (p) => (p.sync ?? 0) >= 0.5, time: (p) => (p.sync ?? 0) < 0.5 },
  },
)

// ── Stereo width ──────────────────────────────────────────────
defineEffect(
  {
    type: 'width',
    name: 'Stereo Width',
    icon: '↔️',
    category: 'space',
    description: 'Make the sound wider and more immersive, or narrow it all the way down to mono.',
    params: [
      { key: 'width', label: 'Width', min: 0, max: 200, default: 140, step: 1, unit: '%', hint: '0% = mono, 100% = untouched, 200% = extra wide' },
      { key: 'out', label: 'Output', min: -12, max: 12, default: 0, step: 0.1, unit: 'dB' },
    ],
    presets: { Mono: { width: 0 }, Wider: { width: 150 }, 'Super wide': { width: 200, out: -1.5 } },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const inp = stereoGain(ctx)
      const split = ctx.createChannelSplitter(2)
      const merge = ctx.createChannelMerger(2)
      const out = ctx.createGain()
      const ll = ctx.createGain(), lr = ctx.createGain(), rl = ctx.createGain(), rr = ctx.createGain()
      inp.connect(split)
      split.connect(ll, 0).connect(merge, 0, 0)
      split.connect(rl, 1).connect(merge, 0, 0)
      split.connect(lr, 0).connect(merge, 0, 1)
      split.connect(rr, 1).connect(merge, 0, 1)
      merge.connect(out)
      const update = (q: Record<string, number>) => {
        const w = (q.width ?? 100) / 100
        const a = (1 + w) / 2, b = (1 - w) / 2
        set(ll.gain, a); set(rr.gain, a); set(rl.gain, b); set(lr.gain, b)
        set(out.gain, dbToGain(q.out ?? 0))
      }
      update(p)
      goLive()
      return { input: inp, output: out, update, dispose: () => disconnectAll([inp, split, merge, out, ll, lr, rl, rr]) }
    },
  },
  { visual: 'width', icon: 'width', tags: 'stereo wide imager mono spread' },
)
