// Bars/beats ruler: canvas ticks (redrawn imperatively on scroll/zoom), loop band,
// markers. Top band = seek / scrub, bottom band = drag to set the loop region.
import { motion } from 'motion/react'
import { memo, useEffect, useRef, useState } from 'react'
import { getEngine } from '../../core/engine'
import { formatTime, uid } from '../../core/ids'
import { snapTime, useStore } from '../../core/store'
import type { Marker } from '../../core/types'
import { addMarker } from './commands'
import { beginDrag } from './interactions'
import { RULER_H, S, useTL } from './state'

const LOOP_H = 13

function drawRuler(cv: HTMLCanvasElement) {
  const { ui, project } = S()
  const W = cv.clientWidth,
    H = cv.clientHeight
  if (!W || !H) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  if (cv.width !== W * dpr || cv.height !== H * dpr) {
    cv.width = W * dpr
    cv.height = H * dpr
  }
  const ctx = cv.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)
  const css = getComputedStyle(cv)
  const c1 = css.getPropertyValue('--text-2').trim() || '#aaa'
  const c3 = css.getPropertyValue('--text-3').trim() || '#666'
  const cg = css.getPropertyValue('--border-strong').trim() || 'rgba(255,255,255,.14)'
  const { zoom, scrollX } = ui
  const beat = 60 / project.bpm
  const bar = beat * project.timeSig[0]
  const barPx = bar * zoom
  const beatPx = beat * zoom
  let barStep = 1
  while (barStep * barPx < 70) barStep *= 2
  const t0 = scrollX,
    t1 = scrollX + W / zoom
  const top = H - LOOP_H
  const X = (t: number) => Math.round((t - scrollX) * zoom) + 0.5

  ctx.lineWidth = 1
  // minor ticks
  ctx.strokeStyle = cg
  ctx.beginPath()
  if (beatPx >= 8) {
    const sub = beatPx >= 90 ? 4 : 1
    const step = beat / sub
    for (let i = Math.floor(t0 / step); i * step <= t1; i++) {
      const isBeat = i % sub === 0
      const x = X(i * step)
      const h = isBeat ? 7 : 4
      ctx.moveTo(x, top - h)
      ctx.lineTo(x, top)
    }
  } else {
    for (let b = Math.floor(t0 / bar); b * bar <= t1; b++) {
      if (b % barStep === 0) continue
      const x = X(b * bar)
      ctx.moveTo(x, top - 6)
      ctx.lineTo(x, top)
    }
  }
  ctx.stroke()
  // bar lines + labels
  ctx.font = '600 10.5px Inter, system-ui, sans-serif'
  ctx.textBaseline = 'top'
  ctx.strokeStyle = c3
  ctx.beginPath()
  const first = Math.floor(t0 / bar / barStep) * barStep
  for (let b = first; b * bar <= t1 + bar; b += barStep) {
    if (b < 0) continue
    const x = X(b * bar)
    ctx.moveTo(x, 4)
    ctx.lineTo(x, top)
    ctx.fillStyle = c1
    ctx.fillText(String(b + 1), x + 4, 4)
    if (barStep * barPx >= 90) {
      ctx.fillStyle = c3
      ctx.font = '500 9.5px "JetBrains Mono", ui-monospace, monospace'
      ctx.fillText(formatTime(b * bar, barPx * barStep < 160 ? false : bar < 1), x + 4, 15)
      ctx.font = '600 10.5px Inter, system-ui, sans-serif'
    }
  }
  ctx.stroke()
  // baseline
  ctx.fillStyle = cg
  ctx.fillRect(0, top, W, 1)
}

export const Ruler = memo(function Ruler() {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const zoom = useStore((s) => s.ui.zoom)
  const loop = useStore((s) => s.project.loop)
  const markers = useStore((s) => s.project.markers)
  const viewW = useTL((s) => s.viewW)
  const theme = useStore((s) => s.ui.theme)

  useEffect(() => {
    const c = cv.current
    if (!c) return
    let raf = 0
    const req = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => drawRuler(c))
    }
    req()
    const un = useStore.subscribe((s, p) => {
      if (s.ui.scrollX !== p.ui.scrollX || s.ui.zoom !== p.ui.zoom || s.project.bpm !== p.project.bpm || s.project.timeSig !== p.project.timeSig) req()
    })
    return () => {
      un()
      cancelAnimationFrame(raf)
    }
  }, [viewW, theme])

  const timeAt = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect()
    const { zoom: z, scrollX } = S().ui
    return Math.max(0, scrollX + (clientX - r.left) / z)
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const r = wrap.current!.getBoundingClientRect()
    const inLoopBand = e.clientY > r.bottom - LOOP_H - 2
    if (inLoopBand) return loopDrag(e)
    // seek / scrub
    const eng = getEngine()
    const wasPlaying = eng.isPlaying
    const seekTo = (x: number, snap: boolean) => {
      const t = timeAt(x)
      return snap ? Math.max(0, snapTime(t)) : t
    }
    eng.seek(seekTo(e.clientX, !e.shiftKey))
    // while playing, re-seeking restarts every source – throttle it
    let last = 0
    let pending: number | null = null
    beginDrag(e, {
      cursor: 'col-resize',
      threshold: 1,
      onMove(ev) {
        const t = seekTo(ev.clientX, false)
        const now = performance.now()
        if (!wasPlaying || now - last > 90) {
          last = now
          pending = null
          eng.seek(t)
        } else pending = t
      },
      onEnd() {
        if (pending !== null) eng.seek(pending)
      },
    })
  }

  const loopDrag = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX)
    const L = S().project.loop
    const edgeTol = 6 / S().ui.zoom
    let mode: 'new' | 'start' | 'end' | 'move' = 'new'
    if (Math.abs(t - L.start) < edgeTol) mode = 'start'
    else if (Math.abs(t - L.end) < edgeTol) mode = 'end'
    else if (t > L.start && t < L.end) mode = 'move'
    const key = uid('loop')
    const t0 = snapTime(t)
    const orig = { ...L }
    beginDrag(e, {
      cursor: mode === 'move' ? 'grabbing' : 'ew-resize',
      threshold: 2,
      onMove(ev) {
        const tt = Math.max(0, ev.shiftKey ? timeAt(ev.clientX) : snapTime(timeAt(ev.clientX)))
        S().mutate(
          'Set loop',
          (p) => {
            const l = p.loop
            if (mode === 'new') {
              l.start = Math.min(t0, tt)
              l.end = Math.max(t0, tt)
            } else if (mode === 'start') {
              l.start = Math.min(tt, l.end - 0.05)
            } else if (mode === 'end') {
              l.end = Math.max(tt, l.start + 0.05)
            } else {
              const d = Math.max(-orig.start, tt - t0)
              l.start = orig.start + d
              l.end = orig.end + d
            }
            l.enabled = l.end - l.start > 0.02
          },
          { coalesce: key },
        )
      },
      onEnd(moved) {
        if (!moved && mode === 'move') S().mutate(orig.enabled ? 'Loop off' : 'Loop on', (p) => void (p.loop.enabled = !p.loop.enabled))
      },
    })
  }

  return (
    <div
      ref={wrap}
      className="tl-ruler"
      style={{ height: RULER_H }}
      onPointerDown={onDown}
      onDoubleClick={(e) => {
        const r = wrap.current!.getBoundingClientRect()
        if (e.clientY > r.bottom - LOOP_H - 2) return
        addMarker(snapTime(timeAt(e.clientX)))
      }}
    >
      <canvas ref={cv} className="tl-ruler-canvas" />
      <div className="tl-ruler-inner">
        <div
          className={`tl-loop${loop.enabled ? ' on' : ''}`}
          style={{ left: loop.start * zoom, width: Math.max(2, (loop.end - loop.start) * zoom), height: LOOP_H }}
          title={loop.enabled ? 'Loop on – click to turn off, drag to move' : 'Loop off – click to turn on'}
        >
          <span className="tl-loop-edge l" />
          <span className="tl-loop-edge r" />
        </div>
        {loop.enabled && <div className="tl-loop-shade" style={{ left: loop.start * zoom, width: (loop.end - loop.start) * zoom }} />}
        {markers.map((m) => (
          <MarkerFlag key={m.id} m={m} zoom={zoom} />
        ))}
      </div>
    </div>
  )
})

function MarkerFlag({ m, zoom }: { m: Marker; zoom: number }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(m.label)
  const commit = () => {
    setEdit(false)
    if (v.trim() && v !== m.label)
      S().mutate('Rename marker', (p) => {
        const mk = p.markers.find((x) => x.id === m.id)
        if (mk) mk.label = v.trim()
      })
  }
  return (
    <motion.div
      className="tl-marker"
      style={{ left: m.time * zoom, ['--c' as string]: m.color ?? 'var(--accent)' }}
      initial={{ y: -10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      title="Click to jump · drag to move · double-click to rename · right-click to delete"
      onPointerDown={(e) => {
        if (e.button !== 0 || edit) return
        e.stopPropagation()
        const t0 = m.time
        const key = uid('mk')
        const z = S().ui.zoom
        beginDrag(e, {
          cursor: 'grabbing',
          onMove(ev, dx) {
            const t = Math.max(0, ev.shiftKey ? t0 + dx / z : snapTime(t0 + dx / z))
            S().mutate(
              'Move marker',
              (p) => {
                const mk = p.markers.find((x) => x.id === m.id)
                if (mk) mk.time = t
              },
              { coalesce: key },
            )
          },
          onEnd(moved) {
            if (moved) S().mutate('Move marker', (p) => void p.markers.sort((a, b) => a.time - b.time), { coalesce: key })
            else getEngine().seek(m.time)
          },
        })
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setV(m.label)
        setEdit(true)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        S().mutate('Delete marker', (p) => void (p.markers = p.markers.filter((x) => x.id !== m.id)))
      }}
    >
      <span className="tl-marker-pin" />
      {edit ? (
        <input
          className="tl-marker-input"
          autoFocus
          value={v}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEdit(false)
          }}
        />
      ) : (
        <span className="tl-marker-label">{m.label}</span>
      )}
    </motion.div>
  )
}
