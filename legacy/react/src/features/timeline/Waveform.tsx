// Tiled waveform canvas. Each tile is at most TILE px wide and only redraws when its
// inputs change, so huge clips at high zoom stay cheap.
import { memo, useEffect, useRef, useSyncExternalStore } from 'react'
import { buffers, type BufferEntry } from '../../core/buffers'
import { peaksForView } from '../../core/peaks'

export function useBufferEntry(id: string): BufferEntry | undefined {
  return useSyncExternalStore(
    buffers.subscribe as (fn: () => void) => () => void,
    () => buffers.get(id),
  )
}

interface TileProps {
  entry: BufferEntry
  /** tile x offset inside the clip (css px) */
  x: number
  width: number
  height: number
  zoom: number
  offset: number
  rate: number
  gain: number
  color: string
}

/** min/max per pixel column straight from samples (used when zoomed in very far). */
function rawColumns(entry: BufferEntry, startSec: number, pxPerSec: number, cols: number): Float32Array {
  const buf = entry.buffer
  const sr = buf.sampleRate
  const chans = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i))
  const out = new Float32Array(cols * 2)
  const spp = sr / pxPerSec
  for (let x = 0; x < cols; x++) {
    const s0 = Math.floor((startSec + x / pxPerSec) * sr)
    const s1 = Math.max(s0 + 1, Math.floor(s0 + spp))
    let mn = 1,
      mx = -1
    if (s0 >= 0 && s0 < buf.length) {
      const e = Math.min(buf.length, s1 + 1)
      for (const d of chans)
        for (let i = s0; i < e; i++) {
          const v = d[i]
          if (v < mn) mn = v
          if (v > mx) mx = v
        }
    }
    if (mn > mx) mn = mx = 0
    out[x * 2] = mn
    out[x * 2 + 1] = mx
  }
  return out
}

export const WaveTile = memo(function WaveTile({ entry, x, width, height, zoom, offset, rate, gain, color }: TileProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = Math.max(1, Math.ceil(width))
    const H = Math.max(1, Math.floor(height))
    cv.width = W * dpr
    cv.height = H * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const pxPerSec = zoom / rate // px per buffer-second
    const startSec = offset + (x / zoom) * rate
    const samplesPerPx = entry.peaks.sampleRate / pxPerSec
    const cols = samplesPerPx < 128 ? rawColumns(entry, startSec, pxPerSec, W) : peaksForView(entry.peaks, startSec, pxPerSec, W)
    const mid = H / 2
    const amp = mid * 0.94 * gain
    // zero line
    ctx.fillStyle = color
    ctx.globalAlpha = 0.35
    ctx.fillRect(0, Math.round(mid), W, 1)
    ctx.globalAlpha = 0.92
    ctx.beginPath()
    for (let i = 0; i < W; i++) {
      const mn = cols[i * 2],
        mx = cols[i * 2 + 1]
      let y0 = mid - mx * amp,
        y1 = mid - mn * amp
      if (y0 < 0) y0 = 0
      if (y1 > H) y1 = H
      const h = Math.max(1, y1 - y0)
      ctx.rect(i, y0, 1, h)
    }
    ctx.fill()
    ctx.globalAlpha = 1
  }, [entry, x, width, height, zoom, offset, rate, gain, color])
  return <canvas ref={ref} className="tl-wave-tile" style={{ left: x, width: Math.ceil(width), height }} />
})
