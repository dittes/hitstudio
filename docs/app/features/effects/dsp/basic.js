// Simple sample-level processes: gain, normalize, reverse, invert, mono, fades,
// truncate silence (Audacity TruncSilence), click removal (Audacity ClickRemoval idea),
// and a look-ahead peak limiter used by loudness normalisation.
import { audioLength, peakOf, undb,            } from './audio.js'

export function amplify(a       , gainDb        )        {
  const g = undb(gainDb)
  return { sr: a.sr, ch: a.ch.map((d) => d.map((v) => v * g)) }
}

export function removeDC(a       )        {
  return {
    sr: a.sr,
    ch: a.ch.map((d) => {
      let s = 0
      for (let i = 0; i < d.length; i++) s += d[i]
      const m = d.length ? s / d.length : 0
      return d.map((v) => v - m)
    }),
  }
}

/** Normalize peak to `targetDb` (dBFS). Optional DC removal, optional per-channel. */
export function normalize(a       , targetDb        , dc = true, independent = false)        {
  const src = dc ? removeDC(a) : a
  const target = undb(targetDb)
  if (independent) {
    return {
      sr: a.sr,
      ch: src.ch.map((d) => {
        let pk = 0
        for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]))
        const g = pk > 0 ? target / pk : 1
        return d.map((v) => v * g)
      }),
    }
  }
  const pk = peakOf(src)
  const g = pk > 0 ? target / pk : 1
  return { sr: a.sr, ch: src.ch.map((d) => d.map((v) => v * g)) }
}

export const reverse = (a       )        => ({ sr: a.sr, ch: a.ch.map((d) => d.slice().reverse()) })
export const invert = (a       )        => ({ sr: a.sr, ch: a.ch.map((d) => d.map((v) => -v)) })

export function toMono(a       )        {
  const n = audioLength(a)
  const m = new Float32Array(n)
  for (const d of a.ch) for (let i = 0; i < n; i++) m[i] += d[i] / a.ch.length
  return { sr: a.sr, ch: [m] }
}

                                      // linear, smooth (S), fast (log-ish), slow (exp)
export const FADE_SHAPES = ['Straight', 'Smooth', 'Fast start', 'Slow start']

function fadeCurve(x        , shape        ) {
  switch (shape) {
    case 1: return 0.5 - 0.5 * Math.cos(Math.PI * x) // S-curve
    case 2: return Math.sin((x * Math.PI) / 2) // equal-power, rises fast
    case 3: return x * x * x // exponential-feeling, rises slow
    default: return x
  }
}

/** Fade in (or out) over the first (last) `len` seconds; len <= 0 means the whole audio. */
export function fade(a       , dir              , shape        , lenSec = 0)        {
  const n = audioLength(a)
  const L = lenSec > 0 ? Math.min(n, Math.round(lenSec * a.sr)) : n
  return {
    sr: a.sr,
    ch: a.ch.map((d) => {
      const o = new Float32Array(d)
      for (let i = 0; i < L; i++) {
        const x = i / Math.max(1, L - 1)
        if (dir === 'in') o[i] *= fadeCurve(x, shape)
        else o[n - L + i] *= fadeCurve(1 - x, shape)
      }
      return o
    }),
  }
}

/**
 * Truncate silence: find runs quieter than `thresholdDb` that last at least `minSec`,
 * and shorten each to `keepSec` (with a short crossfade so joins never click).
 */
export function truncateSilence(a       , thresholdDb        , minSec        , keepSec        )                                    {
  const n = audioLength(a)
  const thr = undb(thresholdDb)
  const blk = Math.max(16, Math.round(a.sr * 0.005)) // 5 ms analysis blocks
  const nb = Math.ceil(n / blk)
  const quiet = new Uint8Array(nb)
  for (let b = 0; b < nb; b++) {
    let pk = 0
    const e = Math.min(n, (b + 1) * blk)
    for (const d of a.ch) for (let i = b * blk; i < e; i++) pk = Math.max(pk, Math.abs(d[i]))
    quiet[b] = pk < thr ? 1 : 0
  }
  // collect cut regions [s, e) in samples
  const cuts                     = []
  const minB = Math.ceil((minSec * a.sr) / blk)
  const keep = Math.round(keepSec * a.sr)
  let b = 0
  while (b < nb) {
    if (!quiet[b]) { b++; continue }
    let e = b
    while (e < nb && quiet[e]) e++
    if (e - b >= minB) {
      const s0 = b * blk, e0 = Math.min(n, e * blk)
      const remove = e0 - s0 - keep
      if (remove > 0) {
        const s = s0 + Math.floor(keep / 2)
        cuts.push([s, s + remove])
      }
    }
    b = e
  }
  if (!cuts.length) return { audio: a, removed: 0 }
  const removed = cuts.reduce((t, [s, e]) => t + e - s, 0)
  const xf = Math.min(Math.round(a.sr * 0.004), Math.floor(keep / 2))
  const outLen = n - removed
  const ch = a.ch.map((d) => {
    const o = new Float32Array(outLen)
    let w = 0, r = 0
    for (const [s, e] of cuts) {
      o.set(d.subarray(r, s), w)
      w += s - r
      // crossfade the material just before the cut with what follows it
      for (let i = 0; i < xf && w - xf + i >= 0 && e + i < n; i++) {
        const t = (i + 1) / (xf + 1)
        const idx = w - xf + i
        o[idx] = o[idx] * (1 - t) + d[e - xf + i] * t
      }
      r = e
    }
    o.set(d.subarray(r), w)
    return o
  })
  return { audio: { sr: a.sr, ch }, removed: removed / a.sr }
}

/**
 * Click / pop removal. A click is a short burst whose "spikiness" (second difference)
 * is far above the local average. Marked spans are re-drawn with a smooth cubic
 * bridge between the good samples on each side.
 */
export function removeClicks(a       , sensitivity        , maxWidthMs        )                                  {
  const n = audioLength(a)
  const maxW = Math.max(2, Math.round((maxWidthMs / 1000) * a.sr))
  const win = Math.round(a.sr * 0.01)
  const thrK = 4 + (100 - sensitivity) / 6 // sensitivity 0..100 → 20.6 .. 4
  let count = 0
  const ch = a.ch.map((src) => {
    const d = new Float32Array(src)
    const hp = new Float32Array(n)
    for (let i = 1; i < n - 1; i++) hp[i] = d[i] - 0.5 * (d[i - 1] + d[i + 1])
    // running mean of |hp|
    const cs = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + Math.abs(hp[i])
    let i = win
    while (i < n - win) {
      const mean = (cs[i + win] - cs[i - win]) / (2 * win) + 1e-6
      if (Math.abs(hp[i]) > thrK * mean && Math.abs(hp[i]) > 0.003) {
        // find extent
        let s = i, e = i
        let gap = 0
        while (e < n - 2 && e - s < maxW * 2 && gap < 3) {
          e++
          if (Math.abs(hp[e]) > thrK * 0.5 * mean) gap = 0
          else gap++
        }
        e -= gap
        if (e - s <= maxW) {
          s = Math.max(2, s - 2)
          e = Math.min(n - 3, e + 2)
          // cubic Hermite bridge from s-1 to e+1 using slopes at the edges
          const y0 = d[s - 1], y1 = d[e + 1]
          const m0 = d[s - 1] - d[s - 2], m1 = d[e + 2] - d[e + 1]
          const L = e - s + 2
          for (let k = 1; k < L; k++) {
            const t = k / L
            const t2 = t * t, t3 = t2 * t
            d[s - 1 + k] = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 * L + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1 * L
          }
          count++
          i = e + win / 4
          continue
        }
        i = e + 1
        continue
      }
      i++
    }
    return d
  })
  return { audio: { sr: a.sr, ch }, count: Math.round(count / a.ch.length) }
}

/** Look-ahead brick-wall-ish peak limiter (gain computed on max of channels). */
export function limitPeaks(a       , ceilingDb        , releaseMs = 80)        {
  const n = audioLength(a)
  const ceil = undb(ceilingDb)
  const look = Math.max(1, Math.round(a.sr * 0.003))
  // required gain per sample
  const need = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let pk = 0
    for (const d of a.ch) pk = Math.max(pk, Math.abs(d[i]))
    need[i] = pk > ceil ? ceil / pk : 1
  }
  // min over look-ahead window (simple sliding min via backward sweep with ramp)
  const g = new Float32Array(n)
  let cur = 1
  const rel = Math.exp(-1 / ((releaseMs / 1000) * a.sr))
  // backward pass: ramp down ahead of peaks
  const ahead = new Float32Array(n)
  let m = 1
  for (let i = n - 1; i >= 0; i--) {
    m = Math.min(need[i], m + (1 - m) / look)
    ahead[i] = m
  }
  for (let i = 0; i < n; i++) {
    const t = ahead[i]
    cur = t < cur ? t : t - (t - cur) * rel
    g[i] = Math.min(cur, need[i])
  }
  return { sr: a.sr, ch: a.ch.map((d) => d.map((v, i) => v * g[i])) }
}
