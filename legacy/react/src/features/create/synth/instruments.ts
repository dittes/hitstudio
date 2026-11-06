// Subtractive synth instruments: oscillators + filter envelope + amp ADSR.
// Chorus / delay are applied per section bus (see mix.ts) using the numbers in each preset.
import { midiToFreq } from '../theory'
import type { InstId } from '../types'

export interface InstDef {
  id: InstId
  name: string
  oscs: { type: OscillatorType; mult: number; detune: number; gain: number }[]
  attack: number
  decay: number
  sustain: number
  release: number
  /** filter cutoff as a multiple of the note frequency */
  cutMult: number
  q: number
  /** extra filter sweep on attack (multiplier added to cutoff) */
  fEnv: number
  fDecay: number
  gain: number
  chorus: number
  delay: { mix: number; beats: number }
  /** length (s) of a note played live from keys / pads */
  liveDur: number
}

export const INSTRUMENTS: Record<InstId, InstDef> = {
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
    id: 'bass', name: 'Bass',
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
}

/** Play one synth note. `dur` = how long the key is held (seconds). */
export function playNote(ctx: BaseAudioContext, dest: AudioNode, inst: InstDef, midi: number, t: number, dur: number, vel: number) {
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
  filt.connect(amp).connect(dest)
  for (const o of inst.oscs) {
    const osc = ctx.createOscillator()
    osc.type = o.type
    osc.frequency.value = f * o.mult
    osc.detune.value = o.detune
    const og = ctx.createGain()
    og.gain.value = o.gain
    osc.connect(og).connect(filt)
    osc.start(t)
    osc.stop(end + 0.05)
  }
}
