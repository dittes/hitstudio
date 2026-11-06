// Iterative radix-2 complex FFT (in place) + small helpers.
// Tables (bit reversal + twiddles) are cached per size.

interface Plan {
  n: number
  rev: Uint32Array
  cos: Float64Array
  sin: Float64Array
}
const plans = new Map<number, Plan>()

function plan(n: number): Plan {
  let p = plans.get(n)
  if (p) return p
  if (n & (n - 1)) throw new Error('FFT size must be a power of two')
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = -Math.sin((2 * Math.PI * i) / n)
  }
  p = { n, rev, cos, sin }
  plans.set(n, p)
  return p
}

/** In-place complex FFT. `inverse` computes the unscaled inverse (divide by n yourself). */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length
  const { rev, cos, sin } = plan(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  const sgn = inverse ? -1 : 1
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]
        const wi = sgn * sin[k * step]
        const a = start + k
        const b = a + half
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

export function hann(n: number, periodic = true): Float64Array {
  const w = new Float64Array(n)
  const d = periodic ? n : n - 1
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / d)
  return w
}

export const nextPow2 = (v: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(2, v))))

/** Yield to the event loop so long jobs don't freeze the UI. */
export const yieldUI = () => new Promise<void>((r) => setTimeout(r, 0))

export type Progress = (fraction: number) => void
