// Music analysis helpers: tempo (onset-envelope autocorrelation) and key (chroma + Krumhansl profiles).
// Pure functions on AudioBuffer – no store access.

/** mono, decimated copy of (at most `maxSeconds` of the middle of) a buffer */
function monoDecimated(buffer: AudioBuffer, targetRate: number, maxSeconds: number) {
  const sr = buffer.sampleRate
  const factor = Math.max(1, Math.floor(sr / targetRate))
  const total = buffer.length
  const maxLen = Math.min(total, Math.floor(maxSeconds * sr))
  const start = Math.max(0, Math.floor((total - maxLen) / 2))
  const nch = buffer.numberOfChannels
  const datas = Array.from({ length: nch }, (_, c) => buffer.getChannelData(c))
  const n = Math.floor(maxLen / factor)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    const base = start + i * factor
    for (let c = 0; c < nch; c++) {
      const d = datas[c]
      for (let k = 0; k < factor; k++) s += d[base + k]
    }
    out[i] = s / (factor * nch)
  }
  return { data: out, rate: sr / factor }
}

/** Estimate tempo in BPM (60–200 range, rounded to 0.1). Returns 0 when there is no clear beat. */
export function detectBpm(buffer: AudioBuffer): number {
  const { data, rate } = monoDecimated(buffer, 11025, 90)
  if (data.length < rate * 4) return 0
  const hop = Math.round(rate / 100) // ~10 ms
  const frames = Math.floor(data.length / hop)
  // energy of the first-difference signal (emphasises transients) → log → positive flux
  const env = new Float32Array(frames)
  let prev = 0
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let i = f * hop + 1; i < (f + 1) * hop; i++) {
      const d = data[i] - data[i - 1]
      e += d * d
    }
    const l = Math.log(1 + 1000 * e)
    env[f] = Math.max(0, l - prev)
    prev = l
  }
  // remove local mean
  const w = 50
  const flat = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    let c = 0
    for (let k = Math.max(0, f - w); k < Math.min(frames, f + w); k++) {
      s += env[k]
      c++
    }
    flat[f] = Math.max(0, env[f] - s / c)
  }
  const fps = rate / hop
  const minLag = Math.floor((fps * 60) / 200)
  const maxLag = Math.ceil((fps * 60) / 60)
  const ac = new Float32Array(maxLag * 2 + 2)
  for (let lag = minLag; lag <= Math.min(ac.length - 1, maxLag * 2 + 1); lag++) {
    let s = 0
    for (let i = 0; i + lag < frames; i++) s += flat[i] * flat[i + lag]
    ac[lag] = s / (frames - lag)
  }
  let bestLag = 0
  let bestScore = 0
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (!(ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1])) continue
    const bpm = (60 * fps) / lag
    // reward multiples (beat, 2×beat) and prefer typical tempos (log-gaussian around 120)
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 1.1, 2))
    const score = (ac[lag] + 0.5 * (ac[lag * 2] || 0)) * prior
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  if (!bestLag) return 0
  // parabolic interpolation for sub-frame precision
  const a = ac[bestLag - 1]
  const b = ac[bestLag]
  const c = ac[bestLag + 1]
  const den = a - 2 * b + c
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0
  const bpm = (60 * fps) / (bestLag + Math.max(-1, Math.min(1, shift)))
  return Math.round(bpm * 10) / 10
}

// ── key detection ───────────────────────────────────────────
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

function corr(a: number[], b: number[]) {
  const n = a.length
  const ma = a.reduce((x, y) => x + y, 0) / n
  const mb = b.reduce((x, y) => x + y, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return num / Math.sqrt(da * db || 1)
}

export interface KeyResult {
  /** 0 = C … 11 = B */
  tonic: number
  mode: 'major' | 'minor'
  /** e.g. "A minor" */
  name: string
  /** correlation 0..1 – how sure we are */
  confidence: number
}

export function detectKeyInfo(buffer: AudioBuffer): KeyResult | null {
  const { data, rate } = monoDecimated(buffer, 11025, 60)
  const N = 8192
  if (data.length < N) return null
  const re = new Float32Array(N)
  const im = new Float32Array(N)
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  const chroma = new Array(12).fill(0)
  const binHz = rate / N
  const lo = Math.ceil(65 / binHz)
  const hi = Math.floor(2000 / binHz)
  const pcOfBin = new Int8Array(hi + 1).fill(-1)
  for (let b = lo; b <= hi; b++) {
    const midi = 69 + 12 * Math.log2((b * binHz) / 440)
    pcOfBin[b] = ((Math.round(midi) % 12) + 12) % 12
  }
  const hop = N / 2
  let frames = 0
  for (let s = 0; s + N <= data.length; s += hop) {
    let energy = 0
    for (let i = 0; i < N; i++) {
      re[i] = data[s + i] * win[i]
      im[i] = 0
      energy += re[i] * re[i]
    }
    if (energy < 1e-6) continue
    fft(re, im)
    for (let b = lo; b <= hi; b++) chroma[pcOfBin[b]] += Math.sqrt(Math.sqrt(re[b] * re[b] + im[b] * im[b]))
    frames++
  }
  if (!frames) return null
  let best: KeyResult | null = null
  for (let t = 0; t < 12; t++) {
    const rotMaj = MAJOR.map((_, i) => MAJOR[(i - t + 12) % 12])
    const rotMin = MINOR.map((_, i) => MINOR[(i - t + 12) % 12])
    for (const [mode, prof] of [['major', rotMaj], ['minor', rotMin]] as const) {
      const c = corr(chroma, prof)
      if (!best || c > best.confidence) best = { tonic: t, mode, name: `${NOTE_NAMES[t]} ${mode}`, confidence: c }
    }
  }
  return best
}

/** e.g. "A minor" ('' when the key can't be told, e.g. silence) */
export function detectKey(buffer: AudioBuffer): string {
  return detectKeyInfo(buffer)?.name ?? ''
}
