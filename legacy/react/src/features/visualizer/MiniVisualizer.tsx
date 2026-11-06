import { useEffect, useRef } from 'react'
import { useStore } from '../../core/store'
import { NB, sampleAnalysis } from './analysis'
import './visualizer.css'

const COLS = ['#a78bfa', '#f472b6', '#fb923c', '#38bdf8']
const BARS = 44

export function MiniVisualizer() {
  const wrap = useRef<HTMLButtonElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = cv.current!
    const el = wrap.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let w = 0, h = 0, dpr = 1
    let grad: CanvasGradient | null = null
    let raf = 0
    let last = 0
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      const r = el.getBoundingClientRect()
      w = Math.max(10, r.width); h = Math.max(10, r.height)
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      grad = ctx.createLinearGradient(0, 0, w, 0)
      COLS.forEach((c, i) => grad!.addColorStop(i / (COLS.length - 1), c))
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    const heights = new Float32Array(BARS)

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden || el.clientWidth === 0 || now - last < 14) return
      last = now
      const a = sampleAnalysis()
      ctx.clearRect(0, 0, w, h)
      const mid = h / 2
      const pad = Math.min(14, w * 0.12)
      const span = w - pad * 2
      const bw = span / BARS
      ctx.fillStyle = grad!
      ctx.globalAlpha = 0.95
      for (let i = 0; i < BARS; i++) {
        // mirrored: low frequencies in the centre, highs at both ends
        const k = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2)
        const bi = Math.min(NB - 1, Math.floor(Math.pow(k, 0.9) * (NB * 0.78)))
        const v = a.bands[bi]
        heights[i] += (v - heights[i]) * 0.6
        const bh = Math.max(2, heights[i] * (h - 8) * (1 - 0.35 * k))
        const x = pad + i * bw + bw * 0.18
        const bwid = bw * 0.64
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, mid - bh / 2, bwid, bh, Math.max(0, Math.min(bwid / 2, 3)))
        else ctx.rect(x, mid - bh / 2, bwid, bh)
        ctx.fill()
      }
      // thin waveform on top
      ctx.globalAlpha = 0.5 + a.energy * 0.4
      ctx.lineWidth = 1.2
      ctx.strokeStyle = '#ffffff'
      ctx.beginPath()
      const step = 4
      for (let i = 0; i < 512; i += step) {
        const x = pad + (i / 511) * span
        const y = mid + a.wave[i] * (h * 0.28)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
      el.style.transform = `scale(${(1 + a.kick * 0.035).toFixed(4)})`
      el.style.setProperty('--vz-glow', (0.08 + a.energy * 0.5).toFixed(3))
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return (
    <button ref={wrap} className="vz-mini" title="Open the visualizer" aria-label="Open the visualizer" onClick={() => useStore.getState().setMode('visualize')}>
      <canvas ref={cv} />
    </button>
  )
}
