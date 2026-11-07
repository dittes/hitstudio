// Quick stem separation, entirely on your device and without any model download.
//
// How it works (classic signal processing, not AI):
//   1. Harmonic / percussive separation: on the spectrogram, sustained sounds are smooth along TIME and
//      drum hits are smooth along FREQUENCY. Median filters in both directions give soft masks.
//   2. The harmonic part is split by frequency and stereo position:
//        bass   = harmonic energy below ~200 Hz
//        vocals = harmonic energy in the vocal range that sits in the CENTRE of the stereo image
//        other  = the rest (guitars, keys, pads, wide stereo sounds, air)
//   3. The four soft masks always add up to exactly 1, so drums + bass + vocals + other rebuilds the original.
//
// It is a fast "karaoke-grade" split. It will not match a trained neural network on dense mixes, and it
// cannot pull a lead vocal out from a centre-panned bass or kick. Pure functions, no DOM: usable in a Worker.

export const STEM_NAMES = ['drums', 'bass', 'vocals', 'other']
export const MAX_SECONDS = 420

const N = 2048
const HOP = N / 2
const BINS = N / 2 + 1
const TIME_KERNEL = 13 // frames (≈ 0.3 s at 44.1 kHz)
const FREQ_KERNEL = 13 // bins (≈ 280 Hz at 44.1 kHz)

// ── FFT (iterative radix-2, tables cached) ──────────────────
const cosT = new Float64Array(N / 2)
const sinT = new Float64Array(N / 2)
for (let i = 0; i < N / 2; i++) {
  cosT[i] = Math.cos((2 * Math.PI * i) / N)
  sinT[i] = -Math.sin((2 * Math.PI * i) / N)
}
const rev = new Uint16Array(N)
for (let i = 0; i < N; i++) {
  let r = 0
  for (let b = 0, x = i; b < Math.log2(N); b++, x >>= 1) r = (r << 1) | (x & 1)
  rev[i] = r
}
function fft(re, im) {
  for (let i = 0; i < N; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1
    const step = N / size
    for (let start = 0; start < N; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const a = start + k
        const b = a + half
        const wr = cosT[t]
        const wi = sinT[t]
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}
/** inverse FFT by swapping real and imaginary parts around a forward FFT (result is scaled by 1/N) */
function ifft(re, im) {
  fft(im, re)
  const s = 1 / N
  for (let i = 0; i < N; i++) {
    re[i] *= s
    im[i] *= s
  }
}

// √Hann window: analysis × synthesis sums to exactly 1 at 50 % overlap
const win = new Float64Array(N)
for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** median of the first n numbers of a scratch array (insertion sort: n is small) */
function median(buf, n) {
  for (let i = 1; i < n; i++) {
    const v = buf[i]
    let j = i - 1
    while (j >= 0 && buf[j] > v) {
      buf[j + 1] = buf[j]
      j--
    }
    buf[j + 1] = v
  }
  return buf[n >> 1]
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * @param {Float32Array} left
 * @param {Float32Array} right  (pass the same array for mono)
 * @param {number} sampleRate
 * @param {{ onProgress?: (p:number)=>void, shouldCancel?: ()=>boolean }} opts
 * @returns {Promise<Record<'drums'|'bass'|'vocals'|'other', [Float32Array, Float32Array]> | null>} null when cancelled
 */
export async function separateStems(left, right, sampleRate, { onProgress = () => {}, shouldCancel = () => false } = {}) {
  const len = left.length
  const frames = Math.ceil((len + N) / HOP) + 1
  const padLen = (frames + 1) * HOP
  const xL = new Float32Array(padLen)
  const xR = new Float32Array(padLen)
  xL.set(left, HOP)
  xR.set(right, HOP)

  const zr = new Float64Array(N)
  const zi = new Float64Array(N)

  // unpack one packed FFT (L + jR) into two half-spectra
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

  // ── pass 1: magnitude of the mid (L+R) spectrogram ──
  const mag = new Float32Array(frames * BINS)
  for (let f = 0; f < frames; f++) {
    analyse(f)
    const base = f * BINS
    for (let k = 0; k < BINS; k++) {
      const r = (XLr[k] + XRr[k]) * 0.5
      const i = (XLi[k] + XRi[k]) * 0.5
      mag[base + k] = Math.sqrt(r * r + i * i)
    }
    if (f % 96 === 0) {
      onProgress((f / frames) * 0.2)
      await tick()
      if (shouldCancel()) return null
    }
  }

  // ── per-bin frequency weights ──
  const hz = (k) => (k * sampleRate) / N
  const bassW = new Float32Array(BINS)
  const vocalBand = new Float32Array(BINS)
  for (let k = 0; k < BINS; k++) {
    const f = hz(k)
    bassW[k] = 1 - smooth(110, 260, f)
    vocalBand[k] = smooth(140, 320, f) * (1 - smooth(6500, 11000, f))
  }

  // ── pass 2: masks, then rebuild each stem ──
  const outputs = STEM_NAMES.map(() => [new Float32Array(padLen), new Float32Array(padLen)])
  const bufT = new Float32Array(TIME_KERNEL)
  const bufF = new Float32Array(FREQ_KERNEL)
  const maskD = new Float32Array(BINS)
  const maskB = new Float32Array(BINS)
  const maskV = new Float32Array(BINS)
  const halfT = TIME_KERNEL >> 1
  const halfF = FREQ_KERNEL >> 1
  const eps = 1e-9
  for (let f = 0; f < frames; f++) {
    analyse(f)
    const base = f * BINS
    for (let k = 0; k < BINS; k++) {
      // harmonic: median along time. percussive: median along frequency
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
      const P = median(bufF, m)
      const h2 = H * H
      const p2 = P * P
      const mh = h2 / (h2 + p2 + eps) // harmonic share of this bin
      const l = Math.hypot(XLr[k], XLi[k])
      const r = Math.hypot(XRr[k], XRi[k])
      const centre = (2 * Math.min(l, r)) / (l + r + eps) // 1 when centred, 0 when hard-panned
      const centreSharp = centre * centre
      maskD[k] = 1 - mh
      maskB[k] = mh * bassW[k]
      maskV[k] = mh * (1 - bassW[k]) * vocalBand[k] * centreSharp
    }
    const o = f * HOP
    for (let s = 0; s < 4; s++) {
      // rebuild this stem's full spectrum (Hermitian symmetric) packed as L + jR
      for (let k = 0; k < BINS; k++) {
        const g = s === 0 ? maskD[k] : s === 1 ? maskB[k] : s === 2 ? maskV[k] : 1 - maskD[k] - maskB[k] - maskV[k]
        const lr = XLr[k] * g
        const li = XLi[k] * g
        const rr = XRr[k] * g
        const ri = XRi[k] * g
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
      onProgress(0.2 + (f / frames) * 0.8)
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
