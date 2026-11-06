// Multi-resolution peak pyramid (like Audacity's "summary" blocks).
// Level 0 = 256 samples per bucket, each level doubles.

const BASE = 256

export function computePeaks(buffer             )        {
  const ch = buffer.numberOfChannels
  const len = buffer.length
  const chans = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i))
  const n0 = Math.ceil(len / BASE)
  const l0 = new Float32Array(n0 * 2)
  for (let b = 0; b < n0; b++) {
    let mn = 1, mx = -1
    const s = b * BASE, e = Math.min(len, s + BASE)
    for (let c = 0; c < ch; c++) {
      const d = chans[c]
      for (let i = s; i < e; i++) {
        const v = d[i]
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
    }
    if (mn > mx) mn = mx = 0
    l0[b * 2] = mn
    l0[b * 2 + 1] = mx
  }
  const levels              = [{ samplesPerBucket: BASE, data: l0 }]
  let prev = l0
  let spb = BASE
  while (prev.length > 4) {
    const n = Math.ceil(prev.length / 4)
    const next = new Float32Array(n * 2)
    for (let b = 0; b < n; b++) {
      const a = b * 4
      const mn = Math.min(prev[a], prev[a + 2] ?? prev[a])
      const mx = Math.max(prev[a + 1], prev[a + 3] ?? prev[a + 1])
      next[b * 2] = mn
      next[b * 2 + 1] = mx
    }
    spb *= 2
    levels.push({ samplesPerBucket: spb, data: next })
    prev = next
  }
  return { sampleRate: buffer.sampleRate, length: len, levels }
}

/**
 * Get min/max for `columns` pixel columns covering [startSec, startSec + columns/pxPerSec).
 * Returns interleaved Float32Array [min,max,...] of length columns*2.
 */
export function peaksForView(peaks       , startSec        , pxPerSec        , columns        )               {
  const out = new Float32Array(columns * 2)
  const samplesPerPx = peaks.sampleRate / pxPerSec
  let level = peaks.levels[0]
  for (const l of peaks.levels) if (l.samplesPerBucket <= samplesPerPx) level = l
  const spb = level.samplesPerBucket
  const nb = level.data.length / 2
  for (let x = 0; x < columns; x++) {
    const s0 = (startSec + x / pxPerSec) * peaks.sampleRate
    const s1 = s0 + samplesPerPx
    let b0 = Math.floor(s0 / spb), b1 = Math.max(b0 + 1, Math.ceil(s1 / spb))
    if (b0 >= nb || s1 <= 0) { out[x * 2] = 0; out[x * 2 + 1] = 0; continue }
    b0 = Math.max(0, b0); b1 = Math.min(nb, b1)
    let mn = 1, mx = -1
    for (let b = b0; b < b1; b++) {
      const a = level.data[b * 2], c = level.data[b * 2 + 1]
      if (a < mn) mn = a
      if (c > mx) mx = c
    }
    if (mn > mx) mn = mx = 0
    out[x * 2] = mn
    out[x * 2 + 1] = mx
  }
  return out
}
