// Time / pitch tools:
//  • resample()   – windowed-sinc resampler (Change Speed: tape style, pitch follows)
//  • wsola()      – Waveform-Similarity Overlap-Add time stretch (Change Tempo, pitch kept)
//  • pitchShift() – WSOLA stretch by the pitch ratio, then resample back (tempo kept)
//  • paulstretch()– Paul Nasca's extreme stretch (random phases per FFT frame)
import { audioLength, monoMix, type Audio } from './audio'
import { fft, nextPow2, yieldUI, type Progress } from './fft'

const SINC_HALF = 16

/** Change length by `ratio` (>1 = faster/shorter). Anti-aliased when speeding up. */
export async function resample(a: Audio, ratio: number, onProgress?: Progress): Promise<Audio> {
  const n = audioLength(a)
  const outLen = Math.max(1, Math.floor(n / ratio))
  const cutoff = Math.min(1, 1 / ratio) * 0.95
  const half = Math.ceil(SINC_HALF / Math.min(1, cutoff))
  // tabulated windowed-sinc kernel (OVER sub-steps per sample) – avoids trig per tap
  const OVER = 256
  const tab = new Float32Array((half + 1) * OVER + 2)
  for (let j = 0; j < tab.length; j++) {
    const x = j / OVER
    const arg = x * cutoff
    const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg)
    tab[j] = x > half + 1 ? 0 : sinc * (0.5 + 0.5 * Math.cos((Math.PI * x) / (half + 1)))
  }
  const kern = (x: number) => {
    const p = Math.abs(x) * OVER
    const j = p | 0
    const f = p - j
    return tab[j] + (tab[j + 1] - tab[j]) * f
  }
  const ch: Float32Array[] = []
  const total = a.ch.length * outLen
  let done = 0
  for (const d of a.ch) {
    const o = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio
      const ip = Math.floor(pos)
      const frac = pos - ip
      let s = 0, wsum = 0
      for (let k = -half + 1; k <= half; k++) {
        const w = kern(k - frac)
        wsum += w
        const idx = ip + k
        if (idx >= 0 && idx < n) s += d[idx] * w
      }
      o[i] = wsum ? s / wsum : 0
      if ((i & 65535) === 0) {
        onProgress?.((done + i) / total)
        await yieldUI()
      }
    }
    done += outLen
    ch.push(o)
  }
  return { sr: a.sr, ch }
}

/**
 * WSOLA time stretch. `stretch` > 1 makes audio LONGER (slower), pitch unchanged.
 * Alignment is searched on a decimated mono mix and applied to all channels,
 * so stereo images stay locked.
 */
export async function wsola(a: Audio, stretch: number, onProgress?: Progress): Promise<Audio> {
  const n = audioLength(a)
  const sr = a.sr
  let N = Math.round(sr * 0.04)
  N += N % 2
  const Hs = N / 2 // synthesis hop
  const Ha = Hs / stretch // analysis hop
  const tol = Math.round(sr * 0.012)
  const outLen = Math.max(1, Math.round(n * stretch))
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
  const mono = monoMix(a)
  const D = 4 // decimation for the coarse search
  const dec = new Float32Array(Math.ceil(n / D))
  for (let i = 0; i < dec.length; i++) dec[i] = mono[i * D] ?? 0
  const out = a.ch.map(() => new Float32Array(outLen + N))
  const norm = new Float32Array(outLen + N)
  const frames = Math.ceil(outLen / Hs) + 1
  let prevPos = 0 // where the last frame was taken from (input samples)
  const at = (arr: Float32Array, i: number) => (i >= 0 && i < arr.length ? arr[i] : 0)
  for (let f = 0; f < frames; f++) {
    const outPos = f * Hs
    const nominal = Math.round(f * Ha)
    let best = nominal
    if (f > 0) {
      // natural continuation of the previous frame: prevPos + Hs
      const cont = prevPos + Hs
      // coarse search on decimated signal
      let bestScore = -Infinity
      const L = Math.floor(N / D)
      for (let delta = -tol; delta <= tol; delta += D) {
        const cand = nominal + delta
        if (cand < 0 || cand + N > n + N) continue
        let s = 0
        const c0 = Math.floor(cand / D), t0 = Math.floor(cont / D)
        for (let k = 0; k < L; k += 2) s += at(dec, c0 + k) * at(dec, t0 + k)
        if (s > bestScore) {
          bestScore = s
          best = cand
        }
      }
      // refine at full resolution
      const coarse = best
      bestScore = -Infinity
      for (let delta = -D; delta <= D; delta++) {
        const cand = coarse + delta
        if (cand < 0) continue
        let s = 0
        for (let k = 0; k < N; k += 2) s += at(mono, cand + k) * at(mono, cont + k)
        if (s > bestScore) {
          bestScore = s
          best = cand
        }
      }
    }
    best = Math.max(0, best)
    prevPos = best
    for (let c = 0; c < a.ch.length; c++) {
      const d = a.ch[c], o = out[c]
      for (let k = 0; k < N; k++) {
        const idx = best + k
        if (idx < n) o[outPos + k] += d[idx] * win[k]
      }
    }
    for (let k = 0; k < N; k++) norm[outPos + k] += win[k]
    if ((f & 63) === 0) {
      onProgress?.(f / frames)
      await yieldUI()
    }
  }
  const ch = out.map((o) => {
    const r = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? o[i] / norm[i] : o[i]
    return r
  })
  return { sr, ch }
}

/** Shift pitch by `semitones` keeping the length (WSOLA + resample). */
export async function pitchShift(a: Audio, semitones: number, onProgress?: Progress): Promise<Audio> {
  const ratio = Math.pow(2, semitones / 12)
  if (Math.abs(ratio - 1) < 1e-4) return a
  const stretched = await wsola(a, ratio, (p) => onProgress?.(p * 0.6))
  const res = await resample(stretched, ratio, (p) => onProgress?.(0.6 + p * 0.4))
  // fix rounding so length matches exactly
  const n = audioLength(a)
  return { sr: a.sr, ch: res.ch.map((d) => (d.length === n ? d : fit(d, n))) }
}

function fit(d: Float32Array, n: number) {
  const o = new Float32Array(n)
  o.set(d.subarray(0, Math.min(n, d.length)))
  return o
}

/**
 * Paulstretch: for every output hop take a window of input, randomise all phases
 * (keeping magnitudes) and overlap-add. Produces dreamy, smeared ambient textures.
 */
export async function paulstretch(a: Audio, stretch: number, windowSec: number, onProgress?: Progress, maxOutSec = 900): Promise<Audio> {
  const n = audioLength(a)
  const sr = a.sr
  const W = nextPow2(Math.max(256, Math.round(windowSec * sr)))
  const half = W / 2
  const win = new Float64Array(W)
  for (let i = 0; i < W; i++) {
    const x = (2 * i) / (W - 1) - 1
    win[i] = Math.pow(1 - x * x, 1.25)
  }
  const outLen = Math.min(Math.round(n * stretch) + W, Math.round(maxOutSec * sr))
  const inHop = half / stretch
  const out = a.ch.map(() => new Float32Array(outLen))
  const re = new Float64Array(W), im = new Float64Array(W)
  const frames = Math.floor((outLen - W) / half) + 1
  // seeded RNG so stereo channels get identical phase sets (keeps image stable)
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const phases = new Float64Array(half + 1)
  for (let f = 0; f < frames; f++) {
    const inPos = Math.floor(f * inHop)
    for (let k = 0; k <= half; k++) phases[k] = rnd() * 2 * Math.PI
    for (let c = 0; c < a.ch.length; c++) {
      const d = a.ch[c]
      for (let i = 0; i < W; i++) {
        const idx = inPos + i
        re[i] = idx < n ? d[idx] * win[i] : 0
        im[i] = 0
      }
      fft(re, im)
      for (let k = 0; k <= half; k++) {
        const mag = Math.hypot(re[k], im[k])
        re[k] = mag * Math.cos(phases[k])
        im[k] = mag * Math.sin(phases[k])
        if (k > 0 && k < half) {
          re[W - k] = re[k]
          im[W - k] = -im[k]
        }
      }
      im[0] = 0
      im[half] = 0
      fft(re, im, true)
      const o = out[c]
      const op = f * half
      for (let i = 0; i < W; i++) if (op + i < outLen) o[op + i] += (re[i] / W) * win[i]
    }
    if ((f & 7) === 0) {
      onProgress?.(f / frames)
      await yieldUI()
    }
  }
  // gentle fade in/out + normalise level to roughly match the input peak
  let inPk = 0
  for (const d of a.ch) for (let i = 0; i < n; i++) inPk = Math.max(inPk, Math.abs(d[i]))
  let outPk = 0
  for (const o of out) for (let i = 0; i < outLen; i++) outPk = Math.max(outPk, Math.abs(o[i]))
  const g = outPk > 0 ? (inPk * 0.9) / outPk : 1
  const fadeN = Math.min(Math.round(sr * 0.05), outLen >> 2)
  for (const o of out) {
    for (let i = 0; i < outLen; i++) o[i] *= g
    for (let i = 0; i < fadeN; i++) {
      o[i] *= i / fadeN
      o[outLen - 1 - i] *= i / fadeN
    }
  }
  return { sr, ch: out }
}
