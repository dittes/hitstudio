// Shared audio analysis for every visualizer (mini + full). One singleton, deduped per frame.
import { getEngine } from '../../core/engine'

export const NB = 64 // log-scaled bands
export const NW = 512 // waveform samples

export interface Analysis {
  /** log-spaced spectrum bands, 0..1, smoothed (fast attack / slow release) */
  bands: Float32Array
  /** oscilloscope-stabilised waveform, -1..1 */
  wave: Float32Array
  rms: number
  bass: number
  mid: number
  treble: number
  energy: number
  /** 1 on a detected kick/onset, decays quickly */
  kick: number
  kickCount: number
  /** increments when a big "drop" (sudden energy surge) is detected */
  dropCount: number
  /** slowly drifting hue 0..1 */
  hue: number
  /** 0..1 how much synthetic idle motion is blended in */
  idle: number
  /** true when the master bus is (really) silent */
  silent: boolean
  time: number
}

export function makeAnalysis(): Analysis {
  return {
    bands: new Float32Array(NB), wave: new Float32Array(NW),
    rms: 0, bass: 0, mid: 0, treble: 0, energy: 0, kick: 0, kickCount: 0, dropCount: 0,
    hue: 0.72, idle: 1, silent: true, time: 0,
  }
}

/** Copy `src` into `dst` multiplying reactivity by `gain` (sensitivity). */
export function scaleAnalysis(src: Analysis, dst: Analysis, gain: number) {
  for (let i = 0; i < NB; i++) dst.bands[i] = Math.min(1.25, src.bands[i] * gain)
  for (let i = 0; i < NW; i++) dst.wave[i] = src.wave[i] * Math.min(gain, 1.6)
  dst.rms = src.rms * gain
  dst.bass = Math.min(1.3, src.bass * gain)
  dst.mid = Math.min(1.3, src.mid * gain)
  dst.treble = Math.min(1.3, src.treble * gain)
  dst.energy = Math.min(1.3, src.energy * gain)
  dst.kick = src.kick
  dst.kickCount = src.kickCount
  dst.dropCount = src.dropCount
  dst.hue = src.hue
  dst.idle = src.idle
  dst.silent = src.silent
  dst.time = src.time
}

const A = makeAnalysis()
let freq: Uint8Array<ArrayBuffer> | null = null
let td: Float32Array<ArrayBuffer> | null = null
let ranges: Uint16Array | null = null // lo,hi per band
let rangeKey = ''
let lastT = 0
let silentFor = 0
let peakEnv = 0.3
const prevRaw = new Float32Array(NB)
const fluxHist = new Float32Array(43)
let fluxIdx = 0
let lastKickT = -1
let slowE = 0
let fastE = 0
let lastDropT = -100
let tAcc = 0

const BASS_END = 14
const MID_END = 42

function buildRanges(sr: number, bins: number) {
  ranges = new Uint16Array(NB * 2)
  const hz = sr / 2 / bins
  const fmax = Math.min(16000, sr / 2 - 100)
  const f = (i: number) => 40 * Math.pow(fmax / 40, i / NB)
  for (let i = 0; i < NB; i++) {
    const lo = Math.max(1, Math.floor(f(i) / hz))
    const hi = Math.max(lo + 1, Math.ceil(f(i + 1) / hz))
    ranges[i * 2] = lo
    ranges[i * 2 + 1] = Math.min(bins, hi)
  }
}

/** Sample the master analyser. Safe to call from several rAF loops: work happens once per ~frame. */
export function sampleAnalysis(): Analysis {
  const now = performance.now() / 1000
  if (lastT && now - lastT < 0.004) return A
  const dt = lastT ? Math.min(0.1, now - lastT) : 1 / 60
  lastT = now
  tAcc += dt
  A.time = tAcc

  let an: AnalyserNode | null = null
  try {
    an = getEngine().masterAnalyser
  } catch {
    an = null
  }
  const raw = new Float32Array(NB)
  let rms = 0
  let hasWave = false
  if (an) {
    if (!freq || freq.length !== an.frequencyBinCount) freq = new Uint8Array(an.frequencyBinCount)
    if (!td || td.length !== an.fftSize) td = new Float32Array(an.fftSize)
    const key = `${an.context.sampleRate}:${an.frequencyBinCount}`
    if (key !== rangeKey || !ranges) {
      buildRanges(an.context.sampleRate, an.frequencyBinCount)
      rangeKey = key
    }
    an.getByteFrequencyData(freq)
    an.getFloatTimeDomainData(td)
    for (let i = 0; i < NB; i++) {
      const lo = ranges![i * 2]
      const hi = ranges![i * 2 + 1]
      let sum = 0
      let mx = 0
      for (let k = lo; k < hi; k++) {
        const v = freq[k]
        sum += v
        if (v > mx) mx = v
      }
      let v = (sum / (hi - lo) * 0.5 + mx * 0.5) / 255
      v = Math.pow(v, 1.7) * (0.9 + 0.7 * (i / NB))
      raw[i] = v > 1 ? 1 : v
    }
    let s2 = 0
    for (let i = 0; i < td.length; i += 4) s2 += td[i] * td[i]
    rms = Math.sqrt(s2 / (td.length / 4))
    hasWave = true
  }

  // silence tracking
  if (rms < 0.0012) silentFor += dt
  else silentFor = 0
  A.silent = silentFor > 0.4
  A.rms += (rms - A.rms) * (1 - Math.exp(-dt * 12))
  A.idle += ((A.silent ? 1 : 0) - A.idle) * (1 - Math.exp(-dt * (A.silent ? 1.5 : 5)))

  // idle "breathing" synth spectrum
  const t = tAcc
  const atk = 1 - Math.exp(-dt * 40)
  const rel = 1 - Math.exp(-dt * 7)
  for (let i = 0; i < NB; i++) {
    const x = i / NB
    const synth = (0.2 + 0.11 * Math.sin(t * 0.9 + i * 0.22) + 0.07 * Math.sin(t * 1.7 - i * 0.5)) * (1 - x * 0.55) * (0.8 + 0.2 * Math.sin(t * 0.4))
    const target = Math.max(raw[i], synth * A.idle)
    const cur = A.bands[i]
    A.bands[i] = cur + (target - cur) * (target > cur ? atk : rel)
  }

  // band group energies
  let b = 0, m = 0, tr = 0
  for (let i = 0; i < NB; i++) {
    const v = A.bands[i]
    if (i < BASS_END) b += v
    else if (i < MID_END) m += v
    else tr += v
  }
  b /= BASS_END; m /= MID_END - BASS_END; tr /= NB - MID_END
  const ga = 1 - Math.exp(-dt * 18)
  const gr = 1 - Math.exp(-dt * 5)
  A.bass += (b - A.bass) * (b > A.bass ? ga : gr)
  A.mid += (m - A.mid) * (m > A.mid ? ga : gr)
  A.treble += (tr - A.treble) * (tr > A.treble ? ga : gr)
  const e = A.bass * 0.5 + A.mid * 0.32 + A.treble * 0.18
  A.energy += (e - A.energy) * (e > A.energy ? ga : gr)

  // spectral flux onset detection (low band region), adaptive threshold
  let flux = 0
  for (let i = 0; i < 22; i++) {
    const d = raw[i] - prevRaw[i]
    if (d > 0) flux += d
    prevRaw[i] = raw[i]
  }
  let mean = 0
  for (let i = 0; i < fluxHist.length; i++) mean += fluxHist[i]
  mean /= fluxHist.length
  let varr = 0
  for (let i = 0; i < fluxHist.length; i++) varr += (fluxHist[i] - mean) ** 2
  const std = Math.sqrt(varr / fluxHist.length)
  fluxHist[fluxIdx++ % fluxHist.length] = flux
  const thr = mean * 1.25 + std * 1.4 + 0.35
  if (hasWave && !A.silent && flux > thr && t - lastKickT > 0.16 && A.bass > 0.12) {
    A.kick = 1
    A.kickCount++
    lastKickT = t
  }
  A.kick *= Math.exp(-dt * 7)

  // drop detection: fast energy vs slow baseline
  fastE += (e - fastE) * (1 - Math.exp(-dt * 6))
  slowE += (e - slowE) * (1 - Math.exp(-dt * 0.25))
  if (!A.silent && fastE > slowE * 1.55 + 0.06 && slowE > 0.04 && t - lastDropT > 10) {
    A.dropCount++
    lastDropT = t
  }

  // hue drift
  A.hue = (A.hue + dt * (0.012 + A.energy * 0.05)) % 1

  // oscilloscope waveform: align to a rising zero crossing, then decimate
  const w = A.wave
  if (hasWave && td) {
    let start = 0
    const lim = Math.min(2048, td.length - 2100)
    for (let i = 0; i < lim; i++) {
      if (td[i] <= 0 && td[i + 1] > 0) { start = i; break }
    }
    let pk = 0
    for (let i = 0; i < NW; i++) {
      const v = td[start + i * 4] || 0
      const av = v < 0 ? -v : v
      if (av > pk) pk = av
      w[i] = v
    }
    peakEnv = Math.max(pk, peakEnv - dt * 0.4, 0.25)
    const g = 0.9 / peakEnv
    const idle = A.idle
    for (let i = 0; i < NW; i++) {
      const x = i / NW
      const synth = 0.3 * Math.sin(x * 18 + t * 1.3) * Math.sin(x * 3 + t * 0.4) + 0.12 * Math.sin(x * 44 - t * 2.1)
      w[i] = w[i] * g * (1 - idle) + synth * idle
    }
  }
  return A
}
