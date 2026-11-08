// Section buses (tone filter, volume, chorus + delay sends) and the per-step scheduler.
// Used by BOTH the live sequencer (AudioContext) and the offline bounce (OfflineAudioContext).
import { ARP_ORDER, BASS_PATTERNS, OFFBEAT_STEPS, STAB_STEPS } from '../patterns.js'
import { chordFor, rowMidi, voiceChords } from '../theory.js'

import { KITS, LANES, triggerDrum } from './drums.js'
import { INSTRUMENTS, playNote } from './instruments.js'

export function createBus(ctx                  , dest           , reverbIn = null)      {
  const input = ctx.createGain()
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.Q.value = 0.6
  const vol = ctx.createGain()
  input.connect(tone).connect(vol).connect(dest)
  // echo
  const dSend = ctx.createGain()
  dSend.gain.value = 0
  const delay = ctx.createDelay(2)
  delay.delayTime.value = 0.375
  const fb = ctx.createGain()
  fb.gain.value = 0.38
  const dLp = ctx.createBiquadFilter()
  dLp.type = 'lowpass'
  dLp.frequency.value = 3800
  tone.connect(dSend).connect(delay).connect(dLp).connect(vol)
  dLp.connect(fb).connect(delay)
  // chorus
  const cSend = ctx.createGain()
  cSend.gain.value = 0
  const cDelay = ctx.createDelay(0.1)
  cDelay.delayTime.value = 0.02
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.8
  const lfoG = ctx.createGain()
  lfoG.gain.value = 0.004
  lfo.connect(lfoG).connect(cDelay.delayTime)
  lfo.start()
  tone.connect(cSend).connect(cDelay).connect(vol)
  // room / hall send (shared reverb)
  const rSend = ctx.createGain()
  rSend.gain.value = 0
  if (reverbIn) tone.connect(rSend).connect(reverbIn)
  return { input, tone, vol, dSend, delay, cSend, rSend }
}

/** Deterministic stereo impulse response: a short pre-delay, a few early reflections and a dark, smooth tail. */
function makeImpulse(ctx                  , seconds = 2.3) {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * seconds)
  const buf = ctx.createBuffer(2, len, sr)
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c)
    let seed = 0x1234567 + c * 7919
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296 * 2 - 1
    }
    let lp = 0
    const tau = seconds / 4.2
    for (let i = 0; i < len; i++) {
      const t = i / sr
      if (t < 0.012) continue // pre-delay
      const env = (1 - Math.exp(-(t - 0.012) / 0.006)) * Math.exp(-(t - 0.012) / tau)
      const damp = 0.62 * Math.exp(-t / 0.55) + 0.05 // highs die away faster than lows
      lp += damp * (rand() - lp)
      data[i] = lp * env
    }
    for (const [ms, g] of [[11, 0.5], [19, 0.38], [29, 0.3], [41, 0.22]]) data[Math.floor(sr * (ms + c * 2.3) / 1000)] += g * (c ? -1 : 1)
  }
  return buf
}

/** Output stage shared by the live loop and the offline bounce: reverb, gentle glue compression, headroom, then a fast limiter. */
export function createOutputStage(ctx                  , dest           )           {
  const sum = ctx.createGain()
  const glue = ctx.createDynamicsCompressor()
  glue.threshold.value = -20
  glue.knee.value = 12
  glue.ratio.value = 1.8
  glue.attack.value = 0.02
  glue.release.value = 0.18
  const trim = ctx.createGain()
  trim.gain.value = 0.56
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 2
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.09
  sum.connect(glue).connect(trim).connect(limiter).connect(dest)
  const reverb = ctx.createConvolver()
  reverb.buffer = makeImpulse(ctx)
  const wet = ctx.createGain()
  wet.gain.value = 0.9
  reverb.connect(wet).connect(sum)
  return { input: sum, reverbIn: reverb }
}

export function createBuses(ctx                  , dest           , only            )        {
  const b        = {}
  const out = createOutputStage(ctx, dest)
  for (const s of ['drums', 'melody', 'chords', 'bass']             ) if (!only || only.includes(s)) b[s] = createBus(ctx, out.input, out.reverbIn)
  return b
}

/** how much of each part goes to the shared reverb (before the per-instrument and per-idea "space") */
const SPACE_SEND = { drums: 0.05, melody: 0.2, chords: 0.28, bass: 0 }

export function configureAll(buses       , ctx                  , d            , bpm        , ignoreMute = false) {
  const now = ctx.currentTime
  for (const s of Object.keys(buses)             ) {
    const bus = buses[s]
    const cfg = d.sections[s]
    const inst = s === 'melody' ? (INSTRUMENTS[d.melody.inst] ?? INSTRUMENTS.pluck) : s === 'chords' ? (INSTRUMENTS[d.chords.inst] ?? INSTRUMENTS.pad) : null
    bus.vol.gain.setTargetAtTime(!ignoreMute && cfg.mute ? 0 : cfg.vol, now, 0.02)
    bus.tone.frequency.setTargetAtTime(300 * Math.pow(60, cfg.tone), now, 0.02)
    bus.dSend.gain.setTargetAtTime(inst ? inst.delay.mix : 0, now, 0.02)
    bus.delay.delayTime.setTargetAtTime(Math.min(1.9, (60 / bpm) * (inst ? inst.delay.beats : 0.75)), now, 0.05)
    bus.cSend.gain.setTargetAtTime(inst ? inst.chorus : 0, now, 0.02)
    bus.rSend.gain.setTargetAtTime(Math.min(0.9, SPACE_SEND[s] * (inst?.reverb ?? 1) * (d.space ?? 1)), now, 0.05)
  }
}

export function dims(ts                  , long         , bpm        )       {
  const stepsPerBeat = Math.max(1, 16 / ts[1])
  const barSteps = Math.max(4, Math.round(ts[0] * stepsPerBeat))
  return {
    barSteps,
    drumLen: barSteps * (long ? 2 : 1),
    melodyLen: barSteps * 2,
    loopLen: barSteps * 4,
    stepsPerBeat,
    stepDur: 60 / bpm / stepsPerBeat,
  }
}

/** deterministic 0..1 noise from two integers, so a loop always "plays the same" live, bounced and exported */
const hr = (a        , b        ) => {
  let x = Math.imul((a * 374761393) ^ (b * 668265263), 1274126177)
  x ^= x >>> 13
  x = Math.imul(x, 1103515245)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}
const HUMAN = 1

/** Schedule everything that happens on loop step `step` at ctx time `time` (already swung). */
export function scheduleStep(ctx                  , buses       , d            , dm      , step        , time        ) {
  const { barSteps, stepDur } = dm
  const human = (d.humanize ?? HUMAN)
  // drums: tiny timing and velocity differences, none on the kick so the groove stays tight
  if (buses.drums) {
    const ds = step % dm.drumLen
    const kit = KITS[d.drums.kit] ?? KITS["808"]
    LANES.forEach((l, li) => {
      const v = d.drums.grid[l.id][ds]
      if (!(v > 0) || d.drums.mute[l.id]) return
      const vel = v * d.drums.vol[l.id] * (1 + (hr(step, li + 11) - 0.5) * 0.16 * human)
      const dt = l.id === 'kick' ? 0 : (hr(step, li + 31) - 0.5) * 0.007 * human
      triggerDrum(ctx, buses.drums.input, l.id, kit, time + dt, Math.min(1, vel))
    })
  }
  // melody: beats are a little stronger than off-beats, with a touch of looseness
  if (buses.melody) {
    const ms = step % dm.melodyLen
    const inst = (INSTRUMENTS[d.melody.inst] ?? INSTRUMENTS.pluck)
    for (const n of d.melody.notes) {
      if (n.step !== ms) continue
      const pos = ms % barSteps
      const accent = pos % 4 === 0 ? 0.92 : pos % 2 === 0 ? 0.82 : 0.74
      const vel = Math.min(1, accent * (1 + (hr(ms, n.row + 51) - 0.5) * 0.14 * human))
      playNote(ctx, buses.melody.input, inst, rowMidi(d.key, d.scale, d.octave, n.row), time + (hr(ms, n.row + 71) - 0.5) * 0.008 * human, n.len * stepDur, vel, { stepDur })
    }
  }
  const slot = Math.floor(step / barSteps) % 4
  const sb = step % barSteps
  // chords: voice-led, so the top line glides from chord to chord
  if (buses.chords) {
    const chord = voiceChords(d.key, d.scale, d.chords.prog, d.chords.ext ?? 'triad')[slot]
    const inst = (INSTRUMENTS[d.chords.inst] ?? INSTRUMENTS.pad)
    const out = buses.chords.input
    const lift = (i        ) => 1 + (hr(step, i + 91) - 0.5) * 0.12 * human
    if (d.chords.style === 'pad') {
      if (sb === 0) chord.midi.forEach((m, i) => playNote(ctx, out, inst, m, time + i * 0.007, barSteps * stepDur * 0.98, 0.7 * lift(i)))
    } else if (d.chords.style === 'arp') {
      if (sb % 2 === 0) {
        const m = chord.midi[ARP_ORDER[(sb / 2) % ARP_ORDER.length] % chord.midi.length]
        playNote(ctx, out, inst, m + 12, time + (hr(step, 5) - 0.5) * 0.005 * human, stepDur * 1.7, (sb % 8 === 0 ? 0.82 : 0.7) * lift(0))
      }
    } else if (d.chords.style === 'power') {
      // rock: root + fifth + octave, chugging 8ths with accents on the beat
      if (sb % 2 === 0) {
        const r = chord.rootMidi - 12
        const v = sb % 8 === 0 ? 0.85 : 0.6
        ;[r, r + 7, r + 12].forEach((m, i) => playNote(ctx, out, inst, m, time, stepDur * (sb % 8 === 6 ? 2.2 : 1.5), v * lift(i)))
      }
    } else if (d.chords.style === 'offbeat') {
      if (OFFBEAT_STEPS.includes(sb)) chord.midi.forEach((m, i) => playNote(ctx, out, inst, m + 12, time + i * 0.003, stepDur * 1.2, 0.62 * lift(i)))
    } else if (STAB_STEPS.includes(sb)) {
      chord.midi.forEach((m, i) => playNote(ctx, out, inst, m, time + i * 0.004, stepDur * 1.6, (sb === 0 ? 0.76 : 0.66) * lift(i)))
    }
  }
  // bass follows the chords
  if (buses.bass && d.bass.on) {
    const chord = chordFor(d.key, d.scale, d.chords.prog[slot] ?? 0)
    const pat = BASS_PATTERNS[d.bass.pattern] ?? BASS_PATTERNS.root8
    let hit = pat.hits.find((h) => h[0] === sb)
    if (pat.followKick) {
      // bass locks to the kick drum: every kick = a bass note that lasts until the next kick
      const kick = d.drums.grid.kick
      const ds = step % dm.drumLen
      if (kick[ds] > 0) {
        let len = 1
        while (len < 8 && sb + len < barSteps && !(kick[(ds + len) % dm.drumLen] > 0)) len++
        hit = [sb, len, 0]
      } else hit = undefined
    }
    if (hit) playNote(ctx, buses.bass.input, INSTRUMENTS[d.bass.inst] ?? INSTRUMENTS.bass, chord.bassMidi + hit[2] * 12 + (hit[3] ?? 0), time, hit[1] * stepDur * 0.9, (sb === 0 ? 0.95 : 0.86) * (1 + (hr(step, 3) - 0.5) * 0.1 * human), { stepDur })
  }
}

export const swingOffset = (step        , stepDur        , swing        ) => (step % 2 === 1 ? swing * stepDur * 0.6 : 0)
