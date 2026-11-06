// Loop player: lookahead scheduler on the shared engine AudioContext, output → externalInput.
import { create } from '../../lib/state.js'
import { getEngine } from '../../core/engine.js'
import { useStore } from '../../core/store.js'
import { useCreate } from './state.js'
import { KITS, triggerDrum } from './synth/drums.js'
import { INSTRUMENTS, playNote } from './synth/instruments.js'
import { configureAll, createBuses, dims, scheduleStep, swingOffset,            } from './synth/mix.js'
import { chordFor, rowMidi } from './theory.js'
import { BASS_PATTERNS } from './patterns.js'

export const usePlaying = create                      (() => ({ playing: false }))

let buses               = null
let ctxRef                      = null
function ensure() {
  const e = getEngine()
  if (!buses || ctxRef !== e.ctx) {
    ctxRef = e.ctx
    buses = createBuses(e.ctx, e.externalInput)
  }
  return { e, ctx: e.ctx, buses }
}

export function syncBuses() {
  if (!buses || !ctxRef) return
  configureAll(buses, ctxRef, useCreate.getState(), useStore.getState().project.bpm)
}
useCreate.subscribe(syncBuses)

// ── transport ────────────────────────────────────────────────
const LOOKAHEAD = 0.14
let timer = 0
let raf = 0
let nextT = 0
let counter = 0
const queue                                   = []
const listeners = new Set                            ()
let lastStep = -1

export function subscribeStep(fn                            ) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const currentStep = () => lastStep

function pump() {
  const { ctx, buses: b } = ensure()
  const d = useCreate.getState()
  const bpm = useStore.getState().project.bpm
  const dm = dims(useStore.getState().project.timeSig, d.drums.long, bpm)
  syncBuses()
  while (nextT < ctx.currentTime + LOOKAHEAD) {
    const loop = counter % dm.loopLen
    const t = nextT + swingOffset(loop, dm.stepDur, d.drums.swing)
    scheduleStep(ctx, b, d, dm, loop, t)
    queue.push({ loop, time: t })
    nextT += dm.stepDur
    counter++
  }
}

function poll() {
  const ctx = ctxRef
  if (ctx) {
    const now = ctx.currentTime - ((ctx.outputLatency || 0) + (ctx.baseLatency || 0))
    while (queue.length && queue[0].time <= now) {
      lastStep = queue.shift() .loop
      listeners.forEach((l) => l(lastStep))
    }
  }
  raf = requestAnimationFrame(poll)
}

export async function startSeq() {
  if (usePlaying.getState().playing) return
  const { e, ctx } = ensure()
  await e.resume()
  counter = 0
  queue.length = 0
  nextT = ctx.currentTime + 0.08
  usePlaying.setState({ playing: true })
  pump()
  timer = window.setInterval(pump, 25)
  raf = requestAnimationFrame(poll)
}

export function stopSeq() {
  if (!usePlaying.getState().playing) return
  clearInterval(timer)
  cancelAnimationFrame(raf)
  queue.length = 0
  lastStep = -1
  usePlaying.setState({ playing: false })
  listeners.forEach((l) => l(-1))
}

export function toggleSeq() {
  if (usePlaying.getState().playing) stopSeq()
  else void startSeq()
}

// ── live previews (pads, keys) ───────────────────────────────
export function previewDrum(lane          , vel = 0.9) {
  const { e, ctx, buses: b } = ensure()
  void e.resume()
  syncBuses()
  const d = useCreate.getState()
  triggerDrum(ctx, b.drums .input, lane, (KITS[d.drums.kit] ?? KITS["808"]), ctx.currentTime + 0.005, vel * d.drums.vol[lane])
}

export function previewMelodyRow(row        , dur         ) {
  const { e, ctx, buses: b } = ensure()
  void e.resume()
  syncBuses()
  const d = useCreate.getState()
  const inst = (INSTRUMENTS[d.melody.inst] ?? INSTRUMENTS.pluck)
  playNote(ctx, b.melody .input, inst, rowMidi(d.key, d.scale, d.octave, row), ctx.currentTime + 0.005, dur ?? inst.liveDur, 0.85)
}

export function previewChord(padIndex        , instId         ) {
  const { e, ctx, buses: b } = ensure()
  void e.resume()
  syncBuses()
  const d = useCreate.getState()
  const inst = INSTRUMENTS[instId ?? d.chords.inst]
  const chord = chordFor(d.key, d.scale, padIndex)
  chord.midi.forEach((m, i) => playNote(ctx, b.chords .input, inst, m, ctx.currentTime + 0.005 + i * 0.012, Math.max(inst.liveDur, 0.9), 0.7))
}

/** Play one bar of the bass part: the chosen bass line on that bar's chord root. */
export function previewBass(bar        ) {
  const { e, ctx, buses: b } = ensure()
  void e.resume()
  syncBuses()
  const d = useCreate.getState()
  if (!b.bass || !d.bass.on) return
  const p = useStore.getState().project
  const dm = dims(p.timeSig, d.drums.long, p.bpm)
  const chord = chordFor(d.key, d.scale, d.chords.prog[bar] ?? 0)
  const pat = BASS_PATTERNS[d.bass.pattern] ?? BASS_PATTERNS.root8
  let hits = pat.hits
  if (pat.followKick) {
    const kick = d.drums.grid.kick
    const found = []
    for (let s = 0; s < dm.barSteps; s++) {
      if (!(kick[s % dm.drumLen] > 0)) continue
      let len = 1
      while (len < 8 && s + len < dm.barSteps && !(kick[(s + len) % dm.drumLen] > 0)) len++
      found.push([s, len, 0])
    }
    hits = found
  }
  const inst = INSTRUMENTS[d.bass.inst] ?? INSTRUMENTS.bass
  const t0 = ctx.currentTime + 0.01
  for (const h of hits) playNote(ctx, b.bass.input, inst, chord.bassMidi + h[2] * 12 + (h[3] ?? 0), t0 + h[0] * dm.stepDur, h[1] * dm.stepDur * 0.9, 0.9, { stepDur: dm.stepDur })
}

export function sectionActive(s         ) {
  return !useCreate.getState().sections[s].mute
}
