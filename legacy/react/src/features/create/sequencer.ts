// Loop player: lookahead scheduler on the shared engine AudioContext, output → externalInput.
import { create } from 'zustand'
import { getEngine } from '../../core/engine'
import { useStore } from '../../core/store'
import { useCreate } from './state'
import { KITS, triggerDrum } from './synth/drums'
import { INSTRUMENTS, playNote } from './synth/instruments'
import { configureAll, createBuses, dims, scheduleStep, swingOffset, type Buses } from './synth/mix'
import { chordFor, rowMidi } from './theory'
import type { DrumLane, InstId, Section } from './types'

export const usePlaying = create<{ playing: boolean }>(() => ({ playing: false }))

let buses: Buses | null = null
let ctxRef: AudioContext | null = null
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
const queue: { loop: number; time: number }[] = []
const listeners = new Set<(loopStep: number) => void>()
let lastStep = -1

export function subscribeStep(fn: (loopStep: number) => void) {
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
      lastStep = queue.shift()!.loop
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
export function previewDrum(lane: DrumLane, vel = 0.9) {
  const { e, ctx, buses: b } = ensure()
  void e.resume()
  syncBuses()
  const d = useCreate.getState()
  triggerDrum(ctx, b.drums!.input, lane, KITS[d.drums.kit], ctx.currentTime + 0.005, vel * d.drums.vol[lane])
}

export function previewMelodyRow(row: number, dur?: number) {
  const { e, ctx, buses: b } = ensure()
  void e.resume()
  syncBuses()
  const d = useCreate.getState()
  const inst = INSTRUMENTS[d.melody.inst]
  playNote(ctx, b.melody!.input, inst, rowMidi(d.key, d.scale, d.octave, row), ctx.currentTime + 0.005, dur ?? inst.liveDur, 0.85)
}

export function previewChord(padIndex: number, instId?: InstId) {
  const { e, ctx, buses: b } = ensure()
  void e.resume()
  syncBuses()
  const d = useCreate.getState()
  const inst = INSTRUMENTS[instId ?? d.chords.inst]
  const chord = chordFor(d.key, d.scale, padIndex)
  chord.midi.forEach((m, i) => playNote(ctx, b.chords!.input, inst, m, ctx.currentTime + 0.005 + i * 0.012, Math.max(inst.liveDur, 0.9), 0.7))
}

export function sectionActive(s: Section) {
  return !useCreate.getState().sections[s].mute
}
