// Stem separation that runs entirely on your device: no model download, no server.
//
// This is signal processing, not a neural network, but it combines the strongest classic ideas:
//   1. REPEATING-PATTERN MODEL (REPET). Music is built from loops: drums, bass, chords and keys come back every
//      bar, a lead vocal does not. We estimate the loop length, build a "typical repeat" spectrogram with a median
//      over the repeats, and whatever is NOT explained by the loop is the foreground (voice, solos).
//   2. HARMONIC / PERCUSSIVE SEPARATION. Sustained sounds are smooth along time, hits are smooth along frequency.
//      Used to split the backing track into drums, bass and the rest.
//   3. STEREO + RANGE. The voice is taken from the centre (mid) signal, in the vocal frequency range, so wide
//      guitars, pads and reverb stay in the backing track instead of being scraped away.
//   4. Soft masks, smoothed over time and frequency, that always add up to exactly 1 → drums + bass + vocals + other
//      rebuilds the original.
// It is clearly better than a plain filter split, but it is not a trained model: on dense or heavily reverbed mixes
// you will still hear some bleed. Pure functions, no DOM, so it can run in a Worker.

export const STEM_NAMES = ['drums', 'bass', 'vocals', 'other']
export const MAX_SECONDS = 420

const N = 2048
const HOP = N / 2
const BINS = N / 2 + 1
const TIME_KERNEL = 13 // frames
const FREQ_KERNEL = 13 // bins

// ── FFT (iterative radix-2), one cached plan per size ──────
const plans = new Map()
function plan(size) {
  let p = plans.get(size)
  if (p) return p
  const cos = new Float64Array(size / 2)
  const sin = new Float64Array(size / 2)
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size)
    sin[i] = -Math.sin((2 * Math.PI * i) / size)
  }
  const bits = Math.log2(size)
  const rev = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    let r = 0
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1)
    rev[i] = r
  }
  p = { size, cos, sin, rev }
  plans.set(size, p)
  return p
}
function fftWith(p, re, im) {
  const { size, cos, sin, rev } = p
  for (let i = 0; i < size; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const half = len >> 1
    const step = size / len
    for (let start = 0; start < size; start += len) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const a = start + k
        const b = a + half
        const xr = re[b] * cos[t] - im[b] * sin[t]
        const xi = re[b] * sin[t] + im[b] * cos[t]
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}
const mainPlan = plan(N)
const fft = (re, im) => fftWith(mainPlan, re, im)
/** inverse FFT by swapping real and imaginary parts around a forward FFT (scaled by 1/N) */
function ifft(re, im) {
  fftWith(mainPlan, im, re)
  const s = 1 / N
  for (let i = 0; i < N; i++) {
    re[i] *= s
    im[i] *= s
  }
}

// √Hann: analysis × synthesis sums to exactly 1 at 50 % overlap
const win = new Float64Array(N)
for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** q-quantile (0.5 = median) of the first n numbers of a scratch array (insertion sort: n is small) */
function median(buf, n, q = 0.5) {
  for (let i = 1; i < n; i++) {
    const v = buf[i]
    let j = i - 1
    while (j >= 0 && buf[j] > v) {
      buf[j + 1] = buf[j]
      j--
    }
    buf[j + 1] = v
  }
  return buf[Math.min(n - 1, Math.floor(n * q))]
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Loop length in frames, found from the autocorrelation of band envelopes ("beat spectrum").
 * Returns { period (fractional frames), confidence 0..1 } or null.
 */
function findLoop(env, frames, frameSec) {
  const bands = env.length
  const size = 1 << Math.ceil(Math.log2(frames * 2))
  const p = plan(size)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  const ac = new Float64Array(frames)
  for (let b = 0; b < bands; b++) {
    const e = env[b]
    let mean = 0
    for (let f = 0; f < frames; f++) mean += e[f]
    mean /= frames
    re.fill(0)
    im.fill(0)
    let norm = 0
    for (let f = 0; f < frames; f++) {
      re[f] = e[f] - mean
      norm += re[f] * re[f]
    }
    if (norm < 1e-12) continue
    fftWith(p, re, im)
    for (let i = 0; i < size; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i]
      im[i] = 0
    }
    fftWith(p, im, re) // inverse FFT by swapping the arrays; the real part ends up in `re`
    for (let l = 0; l < frames; l++) ac[l] += re[l] / size / norm
  }
  for (let l = frames - 1; l >= 0; l--) ac[l] /= Math.max(1e-9, ac[0])
  const minLag = Math.max(8, Math.ceil(0.8 / frameSec))
  const maxLag = Math.min(Math.floor(frames / 3), Math.floor(13 / frameSec))
  if (maxLag <= minLag + 2) return null
  let best = -1
  let bestScore = -1
  const scoreAt = new Float64Array(maxLag + 2)
  for (let lag = minLag; lag <= maxLag; lag++) {
    // a true loop also repeats at 2x, 3x, 4x ... its length (up to ~ 40 s), so average over all those multiples
    let s = 0
    let c = 0
    for (let m = 1; m <= 12; m++) {
      const L = lag * m
      if (L >= frames || L * frameSec > 40) break
      s += ac[L]
      c++
    }
    if (c < 2) continue
    s /= c
    // prefer a local peak; between equally good candidates, the shorter one
    if (ac[lag] < ac[lag - 1] || ac[lag] < ac[lag + 1]) s *= 0.6
    s *= 1 - 0.004 * (lag / maxLag)
    scoreAt[lag] = s
    if (s > bestScore) {
      bestScore = s
      best = lag
    }
  }
  if (best < 0) return null
  // parabolic refinement of the peak position
  const a = ac[best - 1]
  const b = ac[best]
  const c = ac[best + 1]
  const denom = a - 2 * b + c
  const frac = denom < -1e-9 ? (0.5 * (a - c)) / denom : 0
  const period = best + Math.max(-0.5, Math.min(0.5, frac))
  // the rhythm section (drums) repeats faster than the whole arrangement: find a shorter divisor of the loop (a bar or so)
  let drumPeriod = period
  for (const m of [8, 6, 4, 3, 2]) {
    const lag = Math.round(best / m)
    if (lag * frameSec < 1.6 || lag < minLag || lag > maxLag) continue
    if (Math.abs(lag * m - best) > 1.5 * m * 0.5) continue
    let top = 0
    for (let d = -1; d <= 1; d++) top = Math.max(top, scoreAt[lag + d] || 0)
    if (top >= 0.5 * bestScore) {
      drumPeriod = best / m
      break
    }
  }
  return { period, drumPeriod, confidence: Math.max(0, Math.min(1, bestScore)) }
}

/**
 * @param {Float32Array} left
 * @param {Float32Array} right  (pass the same array for mono)
 * @param {number} sampleRate
 * @param {{ onProgress?: (p:number)=>void, shouldCancel?: ()=>boolean, params?: object }} opts
 * @returns {Promise<Record<'drums'|'bass'|'vocals'|'other', [Float32Array, Float32Array]> | null>} null when cancelled
 */
export async function separateStems(left, right, sampleRate, { onProgress = () => {}, shouldCancel = () => false, params = {} } = {}) {
  const P = { longSec: 0.55, steadyW: 0.5, repQuantile: 0.35, drumRep: 0.35, sharpen: 1.6, centrePow: 2, vocalLow: 150, vocalHigh: 7000, ...params }
  const len = left.length
  const frames = Math.ceil((len + N) / HOP) + 1
  const padLen = (frames + 1) * HOP
  const xL = new Float32Array(padLen)
  const xR = new Float32Array(padLen)
  xL.set(left, HOP)
  xR.set(right, HOP)

  const zr = new Float64Array(N)
  const zi = new Float64Array(N)
  const XLr = new Float64Array(BINS)
  const XLi = new Float64Array(BINS)
  const XRr = new Float64Array(BINS)
  const XRi = new Float64Array(BINS)
  const analyse = (f) => {
    const o = f * HOP
    for (let i = 0; i < N; i++) {
      zr[i] = xL[o + i] * win[i]
      zi[i] = xR[o + i] * win[i]
    }
    fft(zr, zi)
    for (let k = 0; k < BINS; k++) {
      const m = (N - k) % N
      XLr[k] = (zr[k] + zr[m]) * 0.5
      XLi[k] = (zi[k] - zi[m]) * 0.5
      XRr[k] = (zi[k] + zi[m]) * 0.5
      XRi[k] = -(zr[k] - zr[m]) * 0.5
    }
  }

  const hz = (k) => (k * sampleRate) / N
  const frameSec = HOP / sampleRate

  // band layout for the loop finder: 36 log-spaced bands
  const NB = 36
  const bandOf = new Int16Array(BINS).fill(-1)
  for (let k = 1; k < BINS; k++) {
    const f = hz(k)
    if (f < 60 || f > 12000) continue
    bandOf[k] = Math.min(NB - 1, Math.floor((Math.log(f / 60) / Math.log(12000 / 60)) * NB))
  }
  const env = Array.from({ length: NB }, () => new Float32Array(frames))

  // ── pass 1: mid magnitude spectrogram, centredness, band envelopes ──
  const mag = new Float32Array(frames * BINS)
  const centre = new Uint8Array(frames * BINS)
  for (let f = 0; f < frames; f++) {
    analyse(f)
    const base = f * BINS
    for (let k = 0; k < BINS; k++) {
      const r = (XLr[k] + XRr[k]) * 0.5
      const i = (XLi[k] + XRi[k]) * 0.5
      const m = Math.sqrt(r * r + i * i)
      mag[base + k] = m
      const l = Math.hypot(XLr[k], XLi[k])
      const rr = Math.hypot(XRr[k], XRi[k])
      centre[base + k] = Math.round((255 * 2 * Math.min(l, rr)) / (l + rr + 1e-9))
      const b = bandOf[k]
      if (b >= 0) env[b][f] += m * m
    }
    for (let b = 0; b < NB; b++) env[b][f] = Math.sqrt(env[b][f])
    if (f % 96 === 0) {
      onProgress((f / frames) * 0.15)
      await tick()
      if (shouldCancel()) return null
    }
  }

  // ── the loop: how long is one repeat? ──
  const loop = P.noLoop ? null : findLoop(env, frames, frameSec)
  const repeatConf = loop ? Math.min(1, Math.max(0, (loop.confidence - 0.12) / 0.35)) : 0
  const repOffsets = []
  const drumOffsets = []
  if (loop && repeatConf > 0) {
    for (let m = -6; m <= 6; m++) repOffsets.push(m * loop.period)
    for (let m = -8; m <= 8; m++) drumOffsets.push(m * loop.drumPeriod)
  }
  params.debug?.({ loop, repeatConf, frameSec })
  onProgress(0.18)

  // ── frequency weights ──
  const bassW = new Float32Array(BINS)
  const vocalBand = new Float32Array(BINS)
  for (let k = 0; k < BINS; k++) {
    const f = hz(k)
    bassW[k] = 1 - smooth(110, 260, f)
    vocalBand[k] = smooth(P.vocalLow * 0.9, P.vocalLow * 2.1, f) * (1 - smooth(P.vocalHigh, P.vocalHigh * 1.6, f))
  }

  // ── pass 2: masks (stored as bytes), then smoothing ──
  const mhB = new Uint8Array(frames * BINS) // share of the backing track that is drums
  const voB = new Uint8Array(frames * BINS) // vocal mask on the mid signal
  const bufT = new Float32Array(TIME_KERNEL)
  const bufF = new Float32Array(FREQ_KERNEL)
  const bufR = new Float32Array(repOffsets.length || 1)
  const bufD = new Float32Array(drumOffsets.length || 1)
  // long time-median: sustained, steady notes (pads, organ, held guitar) are explained by it; a voice moves too fast
  const longK = Math.min(41, Math.max(9, 2 * Math.round(P.longSec / frameSec / 2) + 1))
  const bufL = new Float32Array(longK)
  const halfL = longK >> 1
  const halfT = TIME_KERNEL >> 1
  const halfF = FREQ_KERNEL >> 1
  const eps = 1e-9
  for (let f = 0; f < frames; f++) {
    const base = f * BINS
    // frames at multiples of the loop length (the same place in earlier / later repeats)
    let repFrames = []
    if (repOffsets.length) {
      for (const off of repOffsets) {
        const t = Math.round(f + off)
        if (t >= 0 && t < frames) repFrames.push(t)
      }
      if (repFrames.length < 3) repFrames = []
    }
    let drumFrames = []
    if (drumOffsets.length) {
      for (const off of drumOffsets) {
        const t = Math.round(f + off)
        if (t >= 0 && t < frames) drumFrames.push(t)
      }
      if (drumFrames.length < 3) drumFrames = []
    }
    for (let k = 0; k < BINS; k++) {
      let n = 0
      for (let t = f - halfT; t <= f + halfT; t++) {
        if (t < 0 || t >= frames) continue
        bufT[n++] = mag[t * BINS + k]
      }
      const H = median(bufT, n)
      let m = 0
      for (let b = k - halfF; b <= k + halfF; b++) {
        if (b < 0 || b >= BINS) continue
        bufF[m++] = mag[base + b]
      }
      const Pm = median(bufF, m)
      const h2 = H * H
      const p2 = Pm * Pm
      const mh = h2 / (h2 + p2 + eps)
      // drums: percussive, and (when there is a loop) repeating with the rhythm section's period
      let drumShare = 1 - mh
      if (drumFrames.length) {
        for (let i = 0; i < drumFrames.length; i++) bufD[i] = mag[drumFrames[i] * BINS + k]
        const dm = Math.min(median(bufD, drumFrames.length, P.repQuantile), mag[base + k])
        const repD = mag[base + k] > eps ? dm / mag[base + k] : 1
        drumShare = (1 - mh) * (P.drumRep + (1 - P.drumRep) * repD)
      }
      mhB[base + k] = Math.round(drumShare * 255)

      // how much of this bin is explained by the repeating loop?
      const cur = mag[base + k]
      let fg = 1 - mh // without a loop, fall back on "not harmonic" being unlikely vocal...
      let harmonicVoice = mh
      let steady = 0
      if (vocalBand[k] > 0) {
        let q = 0
        for (let t = f - halfL; t <= f + halfL; t++) {
          if (t < 0 || t >= frames) continue
          bufL[q++] = mag[t * BINS + k]
        }
        const HL = median(bufL, q)
        steady = cur > eps ? Math.min(1, HL / cur) : 0
        // without a loop to lean on, "voice" is whatever is neither steady nor percussive
        if (!repFrames.length) harmonicVoice = (1 - steady * P.steadyW) * mh
      }
      if (vocalBand[k] === 0) harmonicVoice = 0 // outside the vocal range nothing is taken as voice: skip the expensive part
      else if (repFrames.length) {
        for (let i = 0; i < repFrames.length; i++) bufR[i] = mag[repFrames[i] * BINS + k]
        const model = Math.min(median(bufR, repFrames.length, P.repQuantile), cur)
        const repShare = cur > eps ? model / cur : 1
        fg = 1 - repShare // what the loop does not explain
        harmonicVoice = repeatConf * fg * (1 - steady * P.steadyW) + (1 - repeatConf) * (1 - steady * P.steadyW) * mh
      }
      void fg
      const c = centre[base + k] / 255
      let v = vocalBand[k] * Math.pow(c, P.centrePow) * harmonicVoice
      // contrast: Wiener-style sharpening of the soft mask
      const vp = Math.pow(v, P.sharpen)
      v = vp / (vp + Math.pow(1 - v, P.sharpen) + eps)
      voB[base + k] = Math.round(v * 255)
    }
    if (f % 48 === 0) {
      onProgress(0.18 + (f / frames) * 0.42)
      await tick()
      if (shouldCancel()) return null
    }
  }

  // smooth the vocal mask a little over time and frequency (3x3), which removes "musical noise"
  const vo = new Float32Array(frames * BINS)
  for (let f = 0; f < frames; f++) {
    const f0 = Math.max(0, f - 1)
    const f1 = Math.min(frames - 1, f + 1)
    for (let k = 0; k < BINS; k++) {
      const k0 = Math.max(0, k - 1)
      const k1 = Math.min(BINS - 1, k + 1)
      let sum = 0
      let wsum = 0
      for (let t = f0; t <= f1; t++) {
        for (let b = k0; b <= k1; b++) {
          const w = (t === f ? 2 : 1) * (b === k ? 2 : 1)
          sum += w * voB[t * BINS + b]
          wsum += w
        }
      }
      vo[f * BINS + k] = sum / wsum / 255
    }
    if (f % 200 === 0) {
      await tick()
      if (shouldCancel()) return null
    }
  }
  onProgress(0.64)

  // ── pass 3: synthesis ──
  const outputs = STEM_NAMES.map(() => [new Float32Array(padLen), new Float32Array(padLen)])
  for (let f = 0; f < frames; f++) {
    analyse(f)
    const base = f * BINS
    const o = f * HOP
    for (let s = 0; s < 4; s++) {
      for (let k = 0; k < BINS; k++) {
        const v = vo[base + k]
        const mh = mhB[base + k] / 255 // drum share
        // the voice is taken from the middle: V = v · (L+R)/2, the same in both channels
        const Vr = v * (XLr[k] + XRr[k]) * 0.5
        const Vi = v * (XLi[k] + XRi[k]) * 0.5
        let lr
        let li
        let rr
        let ri
        if (s === 2) {
          lr = Vr
          li = Vi
          rr = Vr
          ri = Vi
        } else {
          // everything that is left after taking the voice, shared out between drums, bass and other
          const g = s === 0 ? mh : s === 1 ? (1 - mh) * bassW[k] : (1 - mh) * (1 - bassW[k])
          lr = (XLr[k] - Vr) * g
          li = (XLi[k] - Vi) * g
          rr = (XRr[k] - Vr) * g
          ri = (XRi[k] - Vi) * g
        }
        zr[k] = lr - ri
        zi[k] = li + rr
        if (k > 0 && k < N / 2) {
          const m = N - k
          zr[m] = lr + ri
          zi[m] = -li + rr
        }
      }
      ifft(zr, zi)
      const [oL, oR] = outputs[s]
      for (let i = 0; i < N; i++) {
        oL[o + i] += zr[i] * win[i]
        oR[o + i] += zi[i] * win[i]
      }
    }
    if (f % 48 === 0) {
      onProgress(0.64 + (f / frames) * 0.36)
      await tick()
      if (shouldCancel()) return null
    }
  }
  onProgress(1)
  const result = {}
  STEM_NAMES.forEach((name, i) => {
    result[name] = [outputs[i][0].slice(HOP, HOP + len), outputs[i][1].slice(HOP, HOP + len)]
  })
  return result
}
