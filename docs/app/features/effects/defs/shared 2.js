// Helpers shared by the real-time effect definitions.
// Only native Web Audio nodes are used so every effect also works inside an
// OfflineAudioContext (export / bounce / "apply effect" rendering).
import { registerEffect,                } from '../../../core/effects/registry.js'
import { useStore } from '../../../core/store.js'

/** Extra UI metadata the core registry doesn't model. */

export const fxMeta = new Map                ()

export function defineEffect(def           , meta         = {}) {
  registerEffect(def)
  fxMeta.set(def.type, meta)
}

/** Param setter: immediate during create(), smoothed afterwards (no zipper noise). */
export function paramSetter(ctx                  ) {
  let live = false
  const set = (p            , v        , tc = 0.015) => {
    if (!isFinite(v)) return
    if (!live) {
      p.value = v
    } else {
      p.cancelScheduledValues(ctx.currentTime)
      p.setTargetAtTime(v, ctx.currentTime, tc)
    }
  }
  return { set, goLive: () => (live = true) }
}

/** Equal-power wet/dry mixer. Route your effect from `input` into `wet`. */
export function wetDry(ctx                  ) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  input.connect(dry).connect(output)
  wet.connect(output)
  return {
    input,
    output,
    dry,
    wet,
    /** mix in percent 0..100 */
    gains(mixPct        ) {
      const m = Math.min(1, Math.max(0, mixPct / 100))
      return { dry: Math.cos((m * Math.PI) / 2), wet: Math.sin((m * Math.PI) / 2) }
    },
    nodes: [input, output, dry, wet]               ,
  }
}

/** Stereo-capable gain (upmixes mono to 2 ch so splitters always see L/R). */
export function stereoGain(ctx                  ) {
  const g = ctx.createGain()
  g.channelCount = 2
  g.channelCountMode = 'explicit'
  g.channelInterpretation = 'speakers'
  return g
}

export function disconnectAll(nodes                                  ) {
  for (const n of nodes) {
    try {
      n?.disconnect()
    } catch {}
  }
}

export function stopAll(oscs                                                 ) {
  for (const o of oscs) {
    try {
      o?.stop()
    } catch {}
  }
}

/** Tempo of the project (for tempo-synced delays / LFOs). */
export const projectBpm = () => useStore.getState().project.bpm || 120

/** Call fn whenever the project tempo changes; returns unsubscribe. */
export function onBpmChange(fn                       ) {
  let last = projectBpm()
  return useStore.subscribe((s) => {
    if (s.project.bpm !== last) {
      last = s.project.bpm
      fn(last)
    }
  })
}

/** Musical note divisions (in beats) used by synced effects. */
export const DIVISIONS = [
  { label: '1/16', beats: 0.25 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8.', beats: 0.75 },
  { label: '1/4', beats: 1 },
  { label: '1/4.', beats: 1.5 },
  { label: '1/2', beats: 2 },
  { label: '1 bar', beats: 4 },
]

export const WAVES                   = ['sine', 'triangle', 'square', 'sawtooth']

/** Make a WaveShaper curve from a function on [-1, 1]. */
export function makeCurve(fn                       , size = 4096)                            {
  const c = new Float32Array(size)
  for (let i = 0; i < size; i++) c[i] = fn((i / (size - 1)) * 2 - 1)
  return c
}

/**
 * DynamicsCompressorNode secretly adds "makeup gain" ((1/fullRangeGain)^0.6, per the
 * Web Audio spec / Blink kernel). We model the static curve the same way and return that
 * gain in dB so effects can cancel it and expose an honest, explicit makeup control.
 */
export function compressorAutoMakeupDb(T        , K        , R        )         {
  const db2lin = (d        ) => Math.pow(10, d / 20)
  const lin2db = (l        ) => 20 * Math.log10(Math.max(1e-12, l))
  const linT = db2lin(T)
  const knee = (x        , k        ) => (x < linT ? x : linT + (1 - Math.exp(-k * (x - linT))) / k)
  const slopeAt = (x        , k        ) => {
    if (x < linT) return 1
    const x2 = x * 1.001
    return (lin2db(knee(x2, k)) - lin2db(knee(x, k))) / (lin2db(x2) - lin2db(x))
  }
  const slope = 1 / Math.max(1, R)
  const xk = db2lin(T + K)
  let minK = 0.1, maxK = 10000, k = 5
  for (let i = 0; i < 15; i++) {
    if (slopeAt(xk, k) < slope) maxK = k
    else minK = k
    k = Math.sqrt(minK * maxK)
  }
  const kneeDb = T + K
  const yKneeDb = lin2db(knee(xk, k))
  const sat = (x        ) => (x < xk ? knee(x, k) : db2lin(yKneeDb + slope * (lin2db(x) - kneeDb)))
  return -0.6 * lin2db(sat(1))
}
