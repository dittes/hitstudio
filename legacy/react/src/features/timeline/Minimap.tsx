// Overview bar under the timeline: every clip in miniature + a draggable viewport.
import { useEffect, useRef } from 'react'
import { useStore } from '../../core/store'
import { projectDuration } from '../../core/store'
import { beginDrag } from './interactions'
import { clipLen, S, scrollActivity, setScroll, useTL } from './state'

export function Minimap() {
  const cv = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const clips = useStore((s) => s.project.clips)
  const tracks = useStore((s) => s.project.tracks)
  const zoom = useStore((s) => s.ui.zoom)
  const scrollX = useStore((s) => s.ui.scrollX)
  const theme = useStore((s) => s.ui.theme)
  const viewW = useTL((s) => s.viewW)
  const viewSec = viewW / zoom
  const dur = useStore((s) => projectDuration(s.project))
  // span grows to include the viewport; quantize so scrolling doesn't redraw every frame
  const span = Math.max(dur * 1.05 + 2, Math.ceil((scrollX + viewSec) / 10) * 10, 10)

  useEffect(() => {
    const c = cv.current
    if (!c) return
    const W = c.clientWidth,
      H = c.clientHeight
    if (!W || !H) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = W * dpr
    c.height = H * dpr
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const n = Math.max(1, tracks.length)
    const pad = 4
    const rowH = Math.min(8, (H - pad * 2) / n)
    const y0 = (H - rowH * n) / 2
    const idx = new Map(tracks.map((t, i) => [t.id, i]))
    for (const cl of clips) {
      const i = idx.get(cl.trackId)
      if (i === undefined) continue
      const t = tracks[i]
      ctx.fillStyle = cl.color ?? t.color
      ctx.globalAlpha = t.mute ? 0.3 : 0.85
      const x = (cl.start / span) * W
      const w = Math.max(1.5, (clipLen(cl) / span) * W)
      ctx.beginPath()
      ctx.roundRect(x, y0 + i * rowH + 0.5, w, Math.max(1, rowH - 1.5), Math.min(2, rowH / 2))
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }, [clips, tracks, span, viewW, theme])

  const vx = (scrollX / span) * 100
  const vw = Math.min(100, (viewSec / span) * 100)

  return (
    <div
      ref={wrap}
      className="tl-minimap"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const r = wrap.current!.getBoundingClientRect()
        const t = ((e.clientX - r.left) / r.width) * span
        scrollActivity.last = performance.now()
        setScroll(t - viewSec / 2)
        const s0 = S().ui.scrollX
        beginDrag(e, {
          threshold: 0,
          cursor: 'grabbing',
          onMove(_ev, dx) {
            scrollActivity.last = performance.now()
            setScroll(s0 + (dx / r.width) * span)
          },
        })
      }}
    >
      <canvas ref={cv} className="tl-minimap-canvas" />
      <div className="tl-minimap-view" style={{ left: `${vx}%`, width: `${Math.max(1.5, vw)}%` }} />
    </div>
  )
}
