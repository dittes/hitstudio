// ITU-R BS.1770-4 integrated loudness (LUFS) with K-weighting + gating.
// Coefficients for any sample rate (same derivation as libebur128).
import { audioLength, type Audio } from './audio'

function biquad(x: Float32Array, b: number[], a: number[]): Float64Array {
  const y = new Float64Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    y[i] = y0
  }
  return y
}

function kWeight(d: Float32Array, sr: number): Float64Array {
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / sr)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const pb = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0]
  const pa = [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / sr)
  a0 = 1 + K / Q + K * K
  const rb = [1, -2, 1]
  const ra = [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  const s1 = biquad(d, pb, pa)
  const f32 = new Float32Array(s1.length)
  for (let i = 0; i < s1.length; i++) f32[i] = s1[i]
  return biquad(f32, rb, ra)
}

/** Integrated loudness in LUFS (‑Infinity for silence). */
export function integratedLoudness(a: Audio): number {
  const n = audioLength(a)
  const sr = a.sr
  const blk = Math.round(0.4 * sr)
  const hop = Math.round(0.1 * sr)
  const weighted = a.ch.slice(0, 2).map((d) => kWeight(d, sr))
  // cumulative sums of squares per channel
  const powers: number[] = []
  if (n < blk) {
    let z = 0
    for (const w of weighted) {
      let s = 0
      for (let i = 0; i < n; i++) s += w[i] * w[i]
      z += n ? s / n : 0
    }
    return z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity
  }
  const cums = weighted.map((w) => {
    const c = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) c[i + 1] = c[i] + w[i] * w[i]
    return c
  })
  for (let s = 0; s + blk <= n; s += hop) {
    let z = 0
    for (const c of cums) z += (c[s + blk] - c[s]) / blk
    powers.push(z)
  }
  const lk = (z: number) => -0.691 + 10 * Math.log10(z)
  const abs = powers.filter((z) => z > 0 && lk(z) > -70)
  if (!abs.length) return -Infinity
  const mean = (arr: number[]) => arr.reduce((t, v) => t + v, 0) / arr.length
  const relThr = lk(mean(abs)) - 10
  const rel = abs.filter((z) => lk(z) > relThr)
  return lk(mean(rel.length ? rel : abs))
}
