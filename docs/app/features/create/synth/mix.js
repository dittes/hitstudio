// Section buses (tone filter, volume, chorus + delay sends) and the per-step scheduler.
// Used by BOTH the live sequencer (AudioContext) and the offline bounce (OfflineAudioContext).
import { ARP_ORDER, BASS_PATTERNS, OFFBEAT_STEPS, STAB_STEPS } from '../patterns.js'
import { chordFor, rowMidi } from '../theory.js'

import { KITS, LANES, triggerDrum } from './drums.js'
import { INSTRUMENTS, playNote } from './instruments.js'

export function createBus(ctx                  , dest           )      {
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
  return { input, tone, vol, dSend, delay, cSend }
}

export function createBuses(ctx                  , dest           , only            )        {
  const b        = {}
  for (const s of ['drums', 'melody', 'chords', 'bass']             ) if (!only || only.includes(s)) b[s] = createBus(ctx, dest)
  return b
}

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

/** Schedule everything that happens on loop step `step` at ctx time `time` (already swung). */
export function scheduleStep(ctx                  , buses       , d            , dm      , step        , time        ) {
  const { barSteps, stepDur } = dm
  // drums
  if (buses.drums) {
    const ds = step % dm.drumLen
    const kit = KITS[d.drums.kit] ?? KITS["808"]
    for (const l of LANES) {
      const v = d.drums.grid[l.id][ds]
      if (v > 0 && !d.drums.mute[l.id]) triggerDrum(ctx, buses.drums.input, l.id, kit, time, v * d.drums.vol[l.id])
    }
  }
  // melody
  if (buses.melody) {
    const ms = step % dm.melodyLen
    const inst = (INSTRUMENTS[d.melody.inst] ?? INSTRUMENTS.pluck)
    for (const n of d.melody.notes) {
      if (n.step === ms) playNote(ctx, buses.melody.input, inst, rowMidi(d.key, d.scale, d.octave, n.row), time, n.len * stepDur, 0.85, { stepDur })
    }
  }
  const slot = Math.floor(step / barSteps) % 4
  const sb = step % barSteps
  // chords
  if (buses.chords) {
    const chord = chordFor(d.key, d.scale, d.chords.prog[slot] ?? 0)
    const inst = (INSTRUMENTS[d.chords.inst] ?? INSTRUMENTS.pad)
    const out = buses.chords.input
    if (d.chords.style === 'pad') {
      if (sb === 0) chord.midi.forEach((m, i) => playNote(ctx, out, inst, m, time + i * 0.006, barSteps * stepDur * 0.98, 0.7))
    } else if (d.chords.style === 'arp') {
      if (sb % 2 === 0) {
        const m = chord.midi[ARP_ORDER[(sb / 2) % ARP_ORDER.length]]
        playNote(ctx, out, inst, m + 12, time, stepDur * 1.7, 0.75)
      }
    } else if (d.chords.style === 'power') {
      // rock: root + fifth + octave, chugging 8ths with accents on the beat
      if (sb % 2 === 0) {
        const r = chord.rootMidi - 12
        const v = sb % 8 === 0 ? 0.85 : 0.6
        ;[r, r + 7, r + 12].forEach((m) => playNote(ctx, out, inst, m, time, stepDur * (sb % 8 === 6 ? 2.2 : 1.5), v))
      }
    } else if (d.chords.style === 'offbeat') {
      if (OFFBEAT_STEPS.includes(sb)) chord.midi.forEach((m, i) => playNote(ctx, out, inst, m + 12, time + i * 0.003, stepDur * 1.2, 0.62))
    } else if (STAB_STEPS.includes(sb)) {
      chord.midi.forEach((m, i) => playNote(ctx, out, inst, m, time + i * 0.004, stepDur * 1.6, 0.7))
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
    if (hit) playNote(ctx, buses.bass.input, INSTRUMENTS[d.bass.inst] ?? INSTRUMENTS.bass, chord.bassMidi + hit[2] * 12 + (hit[3] ?? 0), time, hit[1] * stepDur * 0.9, 0.9, { stepDur })
  }
}

export const swingOffset = (step        , stepDur        , swing        ) => (step % 2 === 1 ? swing * stepDur * 0.6 : 0)
