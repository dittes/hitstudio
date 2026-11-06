// Spectral-gating noise reduction, modelled on Audacity's NoiseReduction:
//  1. learn a noise profile = mean power per frequency bin over "noise" frames
//     (either supplied, or the quietest ~15 % of frames of the selection itself)
//  2. STFT (Hann, 2048 / hop 512). Bins whose power exceeds profile × sensitivity
//     keep full gain, others are attenuated by `reductionDb`.
//  3. Gains are smoothed in time (fast attack look-ahead, slower release) and
//     across neighbouring frequency bins, then the signal is resynthesised (OLA).
import { audioLength, monoMix, type Audio } from './audio'
import { fft, hann, yieldUI, type Progress } from './fft'

const N = 2048
const HOP = N / 4

export interface NoiseProfile {
  power: Float64Array // per bin, length N/2+1
  sr: number
}

/** Learn the noise profile from the quietest frames of `a` (or all of it if `useAll`). */
export function learnNoise(a: Audio, useAll = false): NoiseProfile {
  const mono = monoMix(a)
  const n = mono.length
  const win = hann(N)
  const re = new Float64Array(N), im = new Float64Array(N)
  const frames: { e: number; pos: number }[] = []
  for (let pos = 0; pos + N <= Math.max(n, N); pos += HOP) {
    let e = 0
    for (let i = 0; i < N; i++) {
      const v = mono[pos + i] ?? 0
      e += v * v
    }
    frames.push({ e, pos })
  }
  let pick = frames
  if (!useAll) {
    const sorted = [...frames].sort((x, y) => x.e - y.e)
    const k = Math.max(4, Math.round(frames.length * 0.15))
    pick = sorted.slice(0, Math.min(k, sorted.length))
  }
  const power = new Float64Array(N / 2 + 1)
  for (const { pos } of pick) {
    for (let i = 0; i < N; i++) {
      re[i] = (mono[pos + i] ?? 0) * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k <= N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k]
  }
  for (let k = 0; k <= N / 2; k++) power[k] /= Math.max(1, pick.length)
  return { power, sr: a.sr }
}

export interface NoiseOpts {
  reductionDb: number // 0..40 how much to turn the noise down
  sensitivity: number // dB above the noise floor that counts as "real sound" (0..24)
  smoothing: number // frequency smoothing in bins (0..12)
}

export async function reduceNoise(a: Audio, profile: NoiseProfile, o: NoiseOpts, onProgress?: Progress): Promise<Audio> {
  const n = audioLength(a)
  const bins = N / 2 + 1
  const win = hann(N)
  // Hann^2 OLA at 75 % overlap sums to 1.5
  const olaNorm = 1 / 1.5
  const floor = Math.pow(10, -o.reductionDb / 20)
  const thr = profile.power.map((p) => p * Math.pow(10, o.sensitivity / 10))
  const hopSec = HOP / a.sr
  const attackFrames = Math.max(1, Math.round(0.02 / hopSec))
  const attackStep = Math.pow(1 / floor, 1 / attackFrames) // multiplicative ramp per frame
  const releaseStep = Math.pow(1 / floor, hopSec / 0.12)
  const ch: Float32Array[] = []
  const totalFrames = Math.ceil((n + N) / HOP) * a.ch.length
  let doneFrames = 0
  for (const d of a.ch) {
    const out = new Float32Array(n + 2 * N)
    // queue of pending frames (spectrum + gains) for look-ahead attack smoothing
    const queue: { re: Float64Array; im: Float64Array; g: Float32Array; pos: number }[] = []
    let prevG: Float32Array = new Float32Array(bins).fill(1)
    const smooth = new Float32Array(bins)
    const flush = (fr: (typeof queue)[number]) => {
      // release: gain may not fall faster than releaseStep per frame
      const g = fr.g
      for (let k = 0; k < bins; k++) g[k] = Math.max(g[k], prevG[k] / releaseStep)
      prevG = g
      // frequency smoothing (geometric mean over ±smoothing bins)
      const s = Math.round(o.smoothing)
      if (s > 0) {
        for (let k = 0; k < bins; k++) {
          let acc = 0, cnt = 0
          for (let j = Math.max(0, k - s); j <= Math.min(bins - 1, k + s); j++) {
            acc += Math.log(g[j])
            cnt++
          }
          smooth[k] = Math.exp(acc / cnt)
        }
      } else smooth.set(g)
      const { re, im } = fr
      for (let k = 0; k < bins; k++) {
        re[k] *= smooth[k]
        im[k] *= smooth[k]
        if (k > 0 && k < N / 2) {
          re[N - k] = re[k]
          im[N - k] = -im[k]
        }
      }
      fft(re, im, true)
      for (let i = 0; i < N; i++) out[fr.pos + i] += (re[i] / N) * win[i] * olaNorm
    }
    for (let pos = -N + HOP; pos < n; pos += HOP) {
      const re = new Float64Array(N), im = new Float64Array(N)
      for (let i = 0; i < N; i++) {
        const idx = pos + i
        re[i] = idx >= 0 && idx < n ? d[idx] * win[i] : 0
      }
      fft(re, im)
      const g = new Float32Array(bins)
      for (let k = 0; k < bins; k++) {
        const p = re[k] * re[k] + im[k] * im[k]
        g[k] = p > thr[k] ? 1 : floor
      }
      // attack look-ahead: earlier queued frames open up ahead of this onset
      let next: Float32Array = g
      for (let q = queue.length - 1; q >= 0; q--) {
        const gq = queue[q].g
        for (let k = 0; k < bins; k++) gq[k] = Math.max(gq[k], next[k] / attackStep)
        next = gq
      }
      queue.push({ re, im, g, pos: pos + N })
      if (queue.length > attackFrames) flush(queue.shift()!)
      doneFrames++
      if ((doneFrames & 63) === 0) {
        onProgress?.(doneFrames / totalFrames)
        await yieldUI()
      }
    }
    while (queue.length) flush(queue.shift()!)
    ch.push(out.slice(N, N + n))
  }
  return { sr: a.sr, ch }
}
