// Loudness measurement (ITU-R BS.1770 / EBU R128 style), gain matching,
// a look-ahead "true-peak-ish" limiter, fades and channel/sample-rate helpers.
import type { PCM } from './types'

interface Bq {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

function kWeighting(fs: number): Bq[] {
  // stage 1: high shelf (+4 dB @ ~1.7 kHz), stage 2: RLB high-pass (~38 Hz)
  const shelf = (() => {
    const G = 3.999843853973347
    const Q = 0.7071752369554196
    const fc = 1681.9744509555319
    const K = Math.tan((Math.PI * fc) / fs)
    const Vh = Math.pow(10, G / 20)
    const Vb = Math.pow(Vh, 0.4996667741545416)
    const a0 = 1 + K / Q + K * K
    return {
      b0: (Vh + (Vb * K) / Q + K * K) / a0,
      b1: (2 * (K * K - Vh)) / a0,
      b2: (Vh - (Vb * K) / Q + K * K) / a0,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    }
  })()
  const hp = (() => {
    const Q = 0.5003270373238773
    const fc = 38.13547087602444
    const K = Math.tan((Math.PI * fc) / fs)
    const a0 = 1 + K / Q + K * K
    return { b0: 1 / a0, b1: -2 / a0, b2: 1 / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 }
  })()
  return [shelf, hp]
}

function filterSquares(x: Float32Array, fs: number): Float64Array {
  const out = new Float64Array(x.length)
  const [s1, s2] = kWeighting(fs)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  let u1 = 0, u2 = 0, v1 = 0, v2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const y = s1.b0 * xi + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2
    x2 = x1; x1 = xi; y2 = y1; y1 = y
    const z = s2.b0 * y + s2.b1 * u1 + s2.b2 * u2 - s2.a1 * v1 - s2.a2 * v2
    u2 = u1; u1 = y; v2 = v1; v1 = z
    out[i] = z * z
  }
  return out
}

/** Integrated loudness in LUFS (gated). Returns -Infinity for silence. */
export function measureLufs(pcm: PCM): number {
  const fs = pcm.sampleRate
  const sq = pcm.channels.map((c) => filterSquares(c, fs))
  const win = Math.round(0.4 * fs)
  const hop = Math.round(0.1 * fs)
  const n = pcm.channels[0].length
  if (n < win) {
    // very short: single block
    let s = 0
    for (const q of sq) {
      let a = 0
      for (let i = 0; i < n; i++) a += q[i]
      s += a / Math.max(1, n)
    }
    return s > 0 ? -0.691 + 10 * Math.log10(s) : -Infinity
  }
  // prefix sums for fast block means
  const pre = sq.map((q) => {
    const p = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + q[i]
    return p
  })
  const blocks: number[] = []
  for (let s = 0; s + win <= n; s += hop) {
    let z = 0
    for (const p of pre) z += (p[s + win] - p[s]) / win
    blocks.push(z)
  }
  const lk = (z: number) => -0.691 + 10 * Math.log10(z)
  const abs = blocks.filter((z) => z > 0 && lk(z) > -70)
  if (!abs.length) return -Infinity
  const mean1 = abs.reduce((a, b) => a + b, 0) / abs.length
  const rel = lk(mean1) - 10
  const gated = abs.filter((z) => lk(z) > rel)
  if (!gated.length) return -Infinity
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length)
}

/** Approximate true peak (linear) using 4-point cubic interpolation between samples. */
export function truePeak(pcm: PCM): number {
  let peak = 0
  for (const c of pcm.channels) {
    const n = c.length
    for (let i = 0; i < n; i++) {
      const a = Math.abs(c[i])
      if (a > peak) peak = a
      if (i > 0 && i < n - 2) {
        const mid = Math.abs((-c[i - 1] + 9 * c[i] + 9 * c[i + 1] - c[i + 2]) / 16)
        if (mid > peak) peak = mid
      }
    }
  }
  return peak
}

export function applyGain(pcm: PCM, gain: number) {
  if (gain === 1) return
  for (const c of pcm.channels) for (let i = 0; i < c.length; i++) c[i] *= gain
}

/**
 * Look-ahead limiter with a linked gain curve. Keeps inter-sample peaks under `ceilingDb`.
 * Attack = look-ahead window, release ~80 ms.
 */
export function limit(pcm: PCM, ceilingDb = -1, lookaheadMs = 2, releaseMs = 80) {
  const ceil = Math.pow(10, ceilingDb / 20)
  const n = pcm.channels[0].length
  const sr = pcm.sampleRate
  const need = new Float32Array(n).fill(1)
  let any = false
  for (let i = 0; i < n; i++) {
    let p = 0
    for (const c of pcm.channels) {
      const a = Math.abs(c[i])
      if (a > p) p = a
      if (i > 0 && i < n - 2) {
        const m = Math.abs((-c[i - 1] + 9 * c[i] + 9 * c[i + 1] - c[i + 2]) / 16)
        if (m > p) p = m
      }
    }
    if (p > ceil) {
      need[i] = ceil / p
      any = true
    }
  }
  if (!any) return
  const W = Math.max(2, Math.round((lookaheadMs / 1000) * sr))
  // forward-looking minimum over need[i .. i+W-1]
  const minLook = new Float32Array(n)
  const dq = new Int32Array(n)
  let head = 0
  let tail = 0
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--
    dq[tail++] = i
    while (dq[head] >= i + W) head++
    minLook[i] = need[dq[head]]
  }
  // causal moving average (ramps the gain down before the peak), then a slow release
  const rel = 1 - Math.exp(-1 / ((releaseMs / 1000) * sr))
  const gain = new Float32Array(n)
  let acc = W * minLook[0]
  let prev = 1
  for (let i = 0; i < n; i++) {
    acc += minLook[i] - minLook[Math.max(0, i - W)]
    const avg = acc / W
    prev = avg < prev ? avg : prev + (avg - prev) * rel
    gain[i] = prev < avg ? prev : avg
  }
  for (const c of pcm.channels) {
    for (let i = 0; i < n; i++) {
      let v = c[i] * gain[i]
      if (v > 1) v = 1
      else if (v < -1) v = -1
      c[i] = v
    }
  }
}

export type LoudnessPreset = 'off' | 'streaming' | 'podcast' | 'loud'
export const LOUDNESS_TARGET: Record<LoudnessPreset, number | null> = {
  off: null,
  streaming: -14,
  podcast: -16,
  loud: -9,
}

/** Match loudness to the preset (then limit to -1 dBTP-ish). Mutates pcm. Returns the gain in dB applied. */
export function applyLoudness(pcm: PCM, preset: LoudnessPreset): number {
  const target = LOUDNESS_TARGET[preset]
  if (target === null) return 0
  const lufs = measureLufs(pcm)
  if (!isFinite(lufs)) return 0
  const db = Math.max(-30, Math.min(30, target - lufs))
  applyGain(pcm, Math.pow(10, db / 20))
  limit(pcm, -1)
  return db
}

/** Smooth (cosine) fade-out over the last `seconds`. */
export function fadeOut(pcm: PCM, seconds: number) {
  const n = pcm.channels[0].length
  const len = Math.min(n, Math.round(seconds * pcm.sampleRate))
  if (len < 2) return
  for (const c of pcm.channels) {
    for (let i = 0; i < len; i++) {
      const g = 0.5 + 0.5 * Math.cos((Math.PI * i) / (len - 1)) // 1 → 0
      c[n - len + i] *= g
    }
  }
}

/** Tiny anti-click ramps at both ends. */
export function edgeFade(pcm: PCM, ms = 4) {
  const n = pcm.channels[0].length
  const len = Math.min(Math.floor(n / 2), Math.round((ms / 1000) * pcm.sampleRate))
  for (const c of pcm.channels) {
    for (let i = 0; i < len; i++) {
      const g = i / len
      c[i] *= g
      c[n - 1 - i] *= g
    }
  }
}

export function toMono(pcm: PCM): PCM {
  if (pcm.channels.length === 1) return pcm
  const n = pcm.channels[0].length
  const out = new Float32Array(n)
  const k = 1 / pcm.channels.length
  for (const c of pcm.channels) for (let i = 0; i < n; i++) out[i] += c[i] * k
  return { channels: [out], sampleRate: pcm.sampleRate }
}

export function audioBufferToPcm(b: AudioBuffer): PCM {
  const channels: Float32Array[] = []
  for (let c = 0; c < b.numberOfChannels; c++) channels.push(new Float32Array(b.getChannelData(c)))
  return { channels, sampleRate: b.sampleRate }
}
