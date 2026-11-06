// DJ track analysis: BPM + first-beat detection and a 3-band "colored"
// waveform (low / mid / high energy per bucket, like Rekordbox / Serato).
//
// Pure number crunching on Float32Arrays (no Web Audio needed), so it can be
// unit-tested in Node. `analyzeBuffer()` caches by AudioBuffer.

export interface TrackAnalysis {
  bpm: number
  /** time (s) of the first beat on the grid, 0 ≤ firstBeat < 60/bpm */
  firstBeat: number
  /** 0..1 how sure we are (peakiness of the phase histogram) */
  confidence: number
  /** waveform buckets per second */
  rate: number
  /** per bucket: peak |x|, and RMS of the low/mid/high bands (normalised 0..1) */
  peak: Float32Array
  low: Float32Array
  mid: Float32Array
  high: Float32Array
  /** precomputed CSS colour per bucket (r,g,b mapped from low/mid/high) */
  colors: string[]
  duration: number
}

export const WAVE_RATE = 150 // buckets / second

/** One-pole low-pass coefficient for cutoff fc. */
const opc = (fc: number, sr: number) => 1 - Math.exp((-2 * Math.PI * fc) / sr)

export function analyzeSamples(channels: Float32Array[], sr: number): TrackAnalysis {
  const len = channels[0]?.length ?? 0
  const nch = channels.length
  const hop = Math.max(1, Math.round(sr / WAVE_RATE))
  const rate = sr / hop
  const nb = Math.max(1, Math.ceil(len / hop))
  const peak = new Float32Array(nb)
  const low = new Float32Array(nb)
  const mid = new Float32Array(nb)
  const high = new Float32Array(nb)

  // cascaded one-pole filters: 2× LP @ 200 Hz for lows, 2× LP @ 2.2 kHz for low+mid
  const aL = opc(200, sr)
  const aH = opc(2200, sr)
  let l1 = 0, l2 = 0, h1 = 0, h2 = 0
  for (let b = 0; b < nb; b++) {
    const s = b * hop
    const e = Math.min(len, s + hop)
    let pk = 0, sl = 0, sm = 0, sh = 0
    for (let i = s; i < e; i++) {
      let x = 0
      for (let c = 0; c < nch; c++) x += channels[c][i]
      x /= nch
      const ax = x < 0 ? -x : x
      if (ax > pk) pk = ax
      l1 += aL * (x - l1)
      l2 += aL * (l1 - l2)
      h1 += aH * (x - h1)
      h2 += aH * (h1 - h2)
      const lo = l2
      const mi = h2 - l2
      const hi = x - h2
      sl += lo * lo
      sm += mi * mi
      sh += hi * hi
    }
    const n = Math.max(1, e - s)
    peak[b] = pk
    low[b] = Math.sqrt(sl / n)
    mid[b] = Math.sqrt(sm / n)
    high[b] = Math.sqrt(sh / n)
  }

  const { bpm, firstBeat, confidence } = detectTempo(low, mid, high, rate)

  // normalise bands for display
  const norm = (a: Float32Array) => {
    let mx = 1e-9
    for (let i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i]
    for (let i = 0; i < a.length; i++) a[i] /= mx
  }
  let pmx = 1e-9
  for (let i = 0; i < nb; i++) if (peak[i] > pmx) pmx = peak[i]
  for (let i = 0; i < nb; i++) peak[i] = Math.min(1, peak[i] / pmx)
  norm(low)
  norm(mid)
  norm(high)

  const colors = new Array<string>(nb)
  for (let i = 0; i < nb; i++) colors[i] = bandColor(low[i], mid[i], high[i])

  return { bpm, firstBeat, confidence, rate, peak, low, mid, high, colors, duration: len / sr }
}

/** Rekordbox "RGB" style: bass → red/magenta, mids → green, highs → blue/white. */
export function bandColor(lo: number, mi: number, hi: number): string {
  // perceptual weighting so highs show up
  const r = lo * 1.0 + hi * 0.15
  const g = mi * 1.1 + hi * 0.25
  const b = hi * 1.6 + lo * 0.35
  const m = Math.max(r, g, b, 1e-6)
  const k = 255 / m
  const q = (v: number) => Math.round(Math.min(255, 40 + v * k * 0.84)) // keep it bright
  return `rgb(${q(r)},${q(g)},${q(b)})`
}

/**
 * Onset-strength autocorrelation tempo estimate (70–180 BPM), then a fine
 * search over BPM + phase using a phase histogram of the onset envelope.
 */
export function detectTempo(low: Float32Array, mid: Float32Array, high: Float32Array, fr: number) {
  const n = low.length
  if (n < fr * 2) return { bpm: 120, firstBeat: 0, confidence: 0 }
  // onset envelope: half-wave rectified log-energy flux per band
  const C = 1000
  const onset = new Float32Array(n)
  let pl = Math.log1p(C * low[0]), pm = Math.log1p(C * mid[0]), ph = Math.log1p(C * high[0])
  for (let i = 1; i < n; i++) {
    const ll = Math.log1p(C * low[i]), lm = Math.log1p(C * mid[i]), lh = Math.log1p(C * high[i])
    onset[i] = Math.max(0, ll - pl) * 1.0 + Math.max(0, lm - pm) * 0.5 + Math.max(0, lh - ph) * 0.4
    pl = ll; pm = lm; ph = lh
  }
  // subtract local mean (~0.4 s) → keeps only sharp onsets
  const w = Math.max(1, Math.round(fr * 0.2))
  const env = new Float32Array(n)
  let acc = 0
  const pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + onset[i]
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1)
    const mean = (pre[b] - pre[a]) / (b - a)
    env[i] = Math.max(0, onset[i] - mean)
    acc += env[i]
  }
  if (acc <= 1e-9) return { bpm: 120, firstBeat: 0, confidence: 0 }

  // autocorrelation over the plausible lag range (use up to ~150 s)
  const N = Math.min(n, Math.round(fr * 150))
  const lagMin = Math.floor((fr * 60) / 180)
  const lagMax = Math.ceil((fr * 60) / 70)
  const ac = new Float32Array(lagMax * 4 + 2)
  const acAt = (lag: number) => {
    if (ac[lag] !== 0) return ac[lag]
    let s = 0
    for (let i = lag; i < N; i++) s += env[i] * env[i - lag]
    ac[lag] = s / (N - lag) + 1e-12
    return ac[lag]
  }
  let best = lagMin, bestScore = -1
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = (60 * fr) / lag
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 122) / 0.8, 2))
    const sc = (acAt(lag) + 0.5 * acAt(lag * 2) + 0.25 * acAt(lag * 4) + 0.25 * acAt(Math.max(1, Math.round(lag / 2)))) * (0.6 + 0.4 * prior)
    if (sc > bestScore) {
      bestScore = sc
      best = lag
    }
  }
  const coarse = (60 * fr) / best

  // fine search: BPM ± 4% in 0.01 steps, scored by the peak of a phase histogram
  const BINS = 96
  const hist = new Float32Array(BINS)
  let fineBpm = coarse, fineScore = -1, fineBin = 0, fineConf = 0
  const lo = coarse * 0.96, hi = coarse * 1.04
  // only bins with energy matter: collect onset frames above a small threshold
  const idx: number[] = []
  const val: number[] = []
  let mx = 0
  for (let i = 0; i < N; i++) if (env[i] > mx) mx = env[i]
  for (let i = 0; i < N; i++) if (env[i] > mx * 0.05) {
    idx.push(i)
    val.push(env[i])
  }
  const scan = (from: number, to: number, step: number) => {
    for (let bpm = from; bpm <= to; bpm += step) {
      const period = (60 * fr) / bpm // frames per beat
      hist.fill(0)
      for (let k = 0; k < idx.length; k++) {
        const ph = (idx[k] / period) % 1
        hist[Math.floor(ph * BINS) % BINS] += val[k]
      }
      let bb = 0, bs = -1, tot = 0
      for (let b = 0; b < BINS; b++) {
        tot += hist[b]
        const s = hist[b] + 0.6 * (hist[(b + 1) % BINS] + hist[(b + BINS - 1) % BINS])
        if (s > bs) {
          bs = s
          bb = b
        }
      }
      if (bs > fineScore) {
        fineScore = bs
        fineBpm = bpm
        fineBin = bb
        fineConf = tot > 0 ? bs / tot : 0
      }
    }
  }
  scan(lo, hi, 0.05)
  const c = fineBpm
  scan(c - 0.06, c + 0.06, 0.01)
  // snap to "nice" tempos when very close (most produced music is on integer BPM)
  let bpm = fineBpm
  if (Math.abs(bpm - Math.round(bpm)) < 0.07) bpm = Math.round(bpm)
  else if (Math.abs(bpm * 2 - Math.round(bpm * 2)) < 0.06) bpm = Math.round(bpm * 2) / 2
  else bpm = Math.round(bpm * 100) / 100

  // refine phase for the snapped bpm
  const period = (60 * fr) / bpm
  hist.fill(0)
  for (let k = 0; k < idx.length; k++) hist[Math.floor(((idx[k] / period) % 1) * BINS) % BINS] += val[k]
  let bb = fineBin, bs = -1
  for (let b = 0; b < BINS; b++) {
    const s = hist[b] + 0.6 * (hist[(b + 1) % BINS] + hist[(b + BINS - 1) % BINS])
    if (s > bs) {
      bs = s
      bb = b
    }
  }
  // centroid of the 3 bins around the peak for sub-bin precision
  const h0 = hist[(bb + BINS - 1) % BINS], h1 = hist[bb], h2 = hist[(bb + 1) % BINS]
  const off = (h2 - h0) / Math.max(1e-9, h0 + h1 + h2)
  const phase = (((bb + 0.5 + off) / BINS) % 1 + 1) % 1
  const beatSec = 60 / bpm
  let firstBeat = phase * beatSec
  firstBeat = ((firstBeat % beatSec) + beatSec) % beatSec
  if (beatSec - firstBeat < 0.012) firstBeat = 0
  return { bpm, firstBeat, confidence: Math.min(1, fineConf * 4) }
}

// ── AudioBuffer front-end with cache ────────────────────────
const cache = new WeakMap<AudioBuffer, Promise<TrackAnalysis>>()

export function analyzeBuffer(buf: AudioBuffer): Promise<TrackAnalysis> {
  let p = cache.get(buf)
  if (!p) {
    p = new Promise<TrackAnalysis>((res) => {
      // yield so the UI can show "analysing…" first
      setTimeout(() => {
        const ch: Float32Array[] = []
        for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(buf.getChannelData(c))
        res(analyzeSamples(ch, buf.sampleRate))
      }, 16)
    })
    cache.set(buf, p)
  }
  return p
}

const done = new WeakMap<AudioBuffer, TrackAnalysis>()
/** Synchronous lookup of a finished analysis (or undefined). */
export function cachedAnalysis(buf: AudioBuffer): TrackAnalysis | undefined {
  return done.get(buf)
}
export async function analyze(buf: AudioBuffer): Promise<TrackAnalysis> {
  const a = await analyzeBuffer(buf)
  done.set(buf, a)
  return a
}
