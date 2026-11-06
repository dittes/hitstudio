// Plain-array audio used by the destructive processes. Every process takes and
// returns an `Audio` (copies, never touching the source AudioBuffer).
import { buffers } from '../../../core/buffers'

export interface Audio {
  ch: Float32Array[]
  sr: number
}

export function fromBuffer(b: AudioBuffer): Audio {
  const ch: Float32Array[] = []
  for (let c = 0; c < b.numberOfChannels; c++) ch.push(new Float32Array(b.getChannelData(c)))
  return { ch, sr: b.sampleRate }
}

export function toBuffer(a: Audio): AudioBuffer {
  const len = Math.max(1, a.ch[0]?.length ?? 1)
  const out = buffers.create(a.ch.length, len, a.sr)
  a.ch.forEach((d, c) => {
    if (d.length) out.copyToChannel(d as Float32Array<ArrayBuffer>, c)
  })
  return out
}

export const audioLength = (a: Audio) => a.ch[0]?.length ?? 0

export function peakOf(a: Audio): number {
  let pk = 0
  for (const d of a.ch) for (let i = 0; i < d.length; i++) {
    const v = Math.abs(d[i])
    if (v > pk) pk = v
  }
  return pk
}

/** Mono mix (average of channels) – used for analysis. */
export function monoMix(a: Audio): Float32Array {
  const n = audioLength(a)
  if (a.ch.length === 1) return a.ch[0]
  const m = new Float32Array(n)
  for (const d of a.ch) for (let i = 0; i < n; i++) m[i] += d[i]
  const k = 1 / a.ch.length
  for (let i = 0; i < n; i++) m[i] *= k
  return m
}

export const db = (g: number) => (g <= 1e-12 ? -240 : 20 * Math.log10(g))
export const undb = (d: number) => Math.pow(10, d / 20)
