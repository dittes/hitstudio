// Canvas waveforms:
//  • <ZoomWaves>  both decks stacked, scrolling past a fixed centre playhead,
//                 RGB frequency colouring, beat grid, cues, loops + a beat-phase
//                 meter between them (are the two songs in step?)
//  • <Overview>   full-track overview for one deck, click / drag to seek
import { useEffect, useRef } from 'react'
import { getDJ } from './engine'
import type { TrackAnalysis } from './analysis'
import type { Deck } from './deck'
import { DECK_HEX, HOT_COLORS, useDJ, type DeckIndex } from './state'

interface Theme {
  bg: string
  surface: string
  grid: string
  gridStrong: string
  text: string
  text2: string
  text3: string
  accent: [string, string]
}
function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el)
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d
  return {
    bg: v('--bg-2', '#121218'),
    surface: v('--surface', '#17171f'),
    grid: v('--grid-strong', 'rgba(255,255,255,.09)'),
    gridStrong: v('--border-strong', 'rgba(255,255,255,.14)'),
    text: v('--text', '#eee'),
    text2: v('--text-2', '#aaa'),
    text3: v('--text-3', '#666'),
    accent: [v('--accent', DECK_HEX[0]), v('--accent-2', DECK_HEX[1])],
  }
}

/** keep a canvas sized to its box (CSS px) with DPR backing store */
function useCanvasSize(ref: React.RefObject<HTMLCanvasElement | null>, onSize: (w: number, h: number) => void) {
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ro = new ResizeObserver(() => {
      const r = c.getBoundingClientRect()
      const dpr = devicePixelRatio || 1
      c.width = Math.max(1, Math.round(r.width * dpr))
      c.height = Math.max(1, Math.round(r.height * dpr))
      onSize(r.width, r.height)
    })
    ro.observe(c)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

const PHASE_H = 22

export function ZoomWaves() {
  const ref = useRef<HTMLCanvasElement>(null)
  const size = useRef({ w: 0, h: 0 })
  useCanvasSize(ref, (w, h) => (size.current = { w, h }))

  useEffect(() => {
    const c = ref.current!
    const g = c.getContext('2d')!
    let raf = 0
    let theme = readTheme(c)
    let lastTheme = performance.now()
    const dj = getDJ()
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const { w, h } = size.current
      if (!w) return
      const now = performance.now()
      if (now - lastTheme > 600) {
        theme = readTheme(c)
        lastTheme = now
      }
      const dpr = c.width / w
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const laneH = (h - PHASE_H) / 2
      const zoom = useDJ.getState().zoom
      drawLane(g, dj.decks[0], 0, 0, w, laneH, zoom, theme)
      drawPhase(g, dj.decks[0], dj.decks[1], laneH, w, PHASE_H, theme)
      drawLane(g, dj.decks[1], 1, laneH + PHASE_H, w, laneH, zoom, theme)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <canvas
      ref={ref}
      className="dj-zoom"
      onWheel={(e) => {
        const z = useDJ.getState().zoom
        useDJ.getState().set({ zoom: Math.min(32, Math.max(2, z * (e.deltaY > 0 ? 1.15 : 1 / 1.15))) })
      }}
      title="Scroll to zoom"
    />
  )
}

function drawLane(g: CanvasRenderingContext2D, deck: Deck, i: DeckIndex, y0: number, w: number, h: number, zoom: number, th: Theme) {
  const st = deck.st
  const a = deck.analysis
  const mid = y0 + h / 2
  g.save()
  g.beginPath()
  g.rect(0, y0, w, h)
  g.clip()
  if (!deck.loaded || !a) {
    g.fillStyle = th.text3
    g.font = '500 12px Inter, system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const msg = st.loading ? 'Loading…' : st.analyzing ? 'Finding the beat…' : `Deck ${i ? 'B' : 'A'} — load a song from the crate below`
    g.fillText(msg, w / 2, mid)
    g.fillStyle = th.grid
    g.fillRect(0, mid, w, 1)
    g.restore()
    return
  }
  const pos = deck.position()
  const speed = 1 + st.tempo
  // track seconds per pixel: show `zoom` real-time seconds across the width
  const pps = w / (zoom * speed)
  const cx = w / 2
  const t0 = pos - cx / pps
  // loop region
  const L = st.loop
  if (L) {
    const x0 = (L.start - t0) * pps, x1 = (L.end - t0) * pps
    g.fillStyle = hexA(st.roll !== null ? '#38bdf8' : '#4ade80', 0.16)
    g.fillRect(x0, y0, x1 - x0, h)
    g.fillStyle = hexA(st.roll !== null ? '#38bdf8' : '#4ade80', 0.8)
    g.fillRect(x0, y0, 1.5, h)
    g.fillRect(x1 - 1.5, y0, 1.5, h)
  }
  // beat grid
  if (st.bpm) {
    const bl = 60 / st.bpm
    const k0 = Math.ceil((t0 - st.firstBeat) / bl)
    const k1 = Math.floor((t0 + w / pps - st.firstBeat) / bl)
    for (let k = k0; k <= k1; k++) {
      const x = Math.round((st.firstBeat + k * bl - t0) * pps) + 0.5
      const bar = k % 4 === 0
      g.fillStyle = bar ? th.gridStrong : th.grid
      if (bar) g.fillRect(x, y0, 1, h)
      else {
        g.fillRect(x, y0, 1, 6)
        g.fillRect(x, y0 + h - 6, 1, 6)
      }
      if (bar && k >= 0 && (k / 4) % 4 === 0) {
        g.fillStyle = th.text3
        g.font = '600 9px ui-monospace, monospace'
        g.textAlign = 'left'
        g.textBaseline = 'top'
        g.fillText(String(k / 4 + 1), x + 3, y0 + 3)
      }
    }
  }
  // colored waveform
  const amp = h / 2 - 5
  const rate = a.rate
  const n = a.peak.length
  for (let x = 0; x < w; x++) {
    const ta = t0 + x / pps
    const tb = t0 + (x + 1) / pps
    let b0 = Math.floor(ta * rate)
    let b1 = Math.max(b0 + 1, Math.floor(tb * rate))
    if (b1 <= 0 || b0 >= n) continue
    b0 = Math.max(0, b0)
    b1 = Math.min(n, b1)
    let pk = 0, bi = b0
    for (let b = b0; b < b1; b++) if (a.peak[b] > pk) {
      pk = a.peak[b]
      bi = b
    }
    const hh = Math.max(0.5, pk * amp)
    g.fillStyle = a.colors[bi]
    g.fillRect(x, mid - hh, 1, hh * 2)
    // low-band core in deck accent for depth
    const lo = a.low[bi] * amp * 0.55
    if (lo > 1) {
      g.fillStyle = 'rgba(0,0,0,0.18)'
      g.fillRect(x, mid - lo, 1, lo * 2)
    }
  }
  // dim the already-played half
  g.fillStyle = hexA('#000000', 0.28)
  g.globalCompositeOperation = 'source-atop'
  g.fillRect(0, y0, cx, h)
  g.globalCompositeOperation = 'source-over'
  // cue + hot cues
  const marker = (t: number, color: string, label: string) => {
    const x = (t - t0) * pps
    if (x < -20 || x > w + 20) return
    g.fillStyle = color
    g.fillRect(x - 0.75, y0, 1.5, h)
    g.beginPath()
    g.moveTo(x, y0 + 10)
    g.lineTo(x - 5, y0)
    g.lineTo(x + 5, y0)
    g.closePath()
    g.fill()
    if (label) {
      g.font = '700 9px ui-monospace, monospace'
      g.textAlign = 'left'
      g.textBaseline = 'bottom'
      g.fillText(label, x + 4, y0 + h - 2)
    }
  }
  marker(st.cue, '#fb923c', '')
  st.hot.forEach((t, k) => t != null && marker(t, HOT_COLORS[k], String(k + 1)))
  // playhead
  const acc = th.accent[i]
  g.fillStyle = acc
  g.shadowColor = acc
  g.shadowBlur = 8
  g.fillRect(cx - 1, y0, 2, h)
  g.shadowBlur = 0
  // deck tag
  g.fillStyle = acc
  g.font = '800 11px Inter, system-ui, sans-serif'
  g.textAlign = 'left'
  g.textBaseline = 'top'
  g.fillText(i ? 'B' : 'A', 8, y0 + 16)
  g.restore()
}

function drawPhase(g: CanvasRenderingContext2D, A: Deck, B: Deck, y0: number, w: number, h: number, th: Theme) {
  g.fillStyle = th.surface
  g.fillRect(0, y0, w, h)
  const cy = y0 + h / 2
  // beat-in-bar boxes per deck (left: A, right: B)
  const boxes = (d: Deck, x0: number, color: string, label: string) => {
    const on = d.loaded && d.st.bpm > 0
    const ph = on ? d.beatPhase() : 0
    const beat = ((Math.floor(ph) % 4) + 4) % 4
    for (let k = 0; k < 4; k++) {
      g.fillStyle = on && d.isRunning && k === beat ? color : th.grid
      g.beginPath()
      g.roundRect(x0 + k * 16, cy - 4, 13, 8, 2)
      g.fill()
    }
    g.fillStyle = th.text3
    g.font = '600 9px Inter, system-ui, sans-serif'
    g.textBaseline = 'middle'
    g.textAlign = 'left'
    g.fillText(label, x0 + 68, cy + 0.5)
  }
  boxes(A, 10, th.accent[0], 'A')
  boxes(B, w - 90, th.accent[1], 'B')
  // phase offset meter in the middle
  const mw = Math.min(260, w * 0.3)
  const mx = w / 2 - mw / 2
  g.fillStyle = th.grid
  g.beginPath()
  g.roundRect(mx, cy - 3, mw, 6, 3)
  g.fill()
  g.fillStyle = th.text3
  g.fillRect(w / 2 - 0.5, cy - 7, 1, 14)
  const both = A.loaded && B.loaded && A.st.bpm > 0 && B.st.bpm > 0 && A.isRunning && B.isRunning
  g.textAlign = 'center'
  g.font = '600 9px Inter, system-ui, sans-serif'
  if (!both) {
    g.fillStyle = th.text3
    g.fillText('BEAT MATCH', w / 2 + mw / 2 + 40, cy + 0.5)
    return
  }
  let err = (((B.beatPhase() - A.beatPhase()) % 1) + 1) % 1
  if (err > 0.5) err -= 1
  const tempoDiff = Math.abs(A.effectiveBpm - B.effectiveBpm)
  const good = Math.abs(err) < 0.04 && tempoDiff < 0.1
  const col = good ? '#4ade80' : Math.abs(err) < 0.12 ? '#facc15' : '#f87171'
  const x = w / 2 + err * mw
  g.fillStyle = hexA(col, 0.35)
  g.fillRect(Math.min(x, w / 2), cy - 3, Math.abs(x - w / 2), 6)
  g.fillStyle = col
  g.beginPath()
  g.arc(x, cy, 5, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = good ? col : th.text2
  g.fillText(good ? 'IN SYNC' : tempoDiff >= 0.1 ? `Δ ${tempoDiff.toFixed(1)} BPM` : err > 0 ? 'B AHEAD' : 'A AHEAD', w / 2 + mw / 2 + 40, cy + 0.5)
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// ── overview ─────────────────────────────────────────────────
function renderOverview(a: TrackAnalysis, w: number, h: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  const g = c.getContext('2d')!
  g.scale(dpr, dpr)
  const n = a.peak.length
  const mid = h / 2
  for (let x = 0; x < w; x++) {
    const b0 = Math.floor((x / w) * n)
    const b1 = Math.max(b0 + 1, Math.floor(((x + 1) / w) * n))
    let pk = 0, lo = 0, mi = 0, hi = 0
    for (let b = b0; b < b1 && b < n; b++) {
      if (a.peak[b] > pk) pk = a.peak[b]
      lo += a.low[b]
      mi += a.mid[b]
      hi += a.high[b]
    }
    const k = b1 - b0
    const hh = Math.max(0.5, pk * (h / 2 - 2))
    const r = lo / k, gg = mi / k, bb = hi / k
    // reuse the band colour mapping via a cheap inline version
    const R = r + bb * 0.15, G = gg * 1.1 + bb * 0.25, B = bb * 1.6 + r * 0.35
    const m = Math.max(R, G, B, 1e-6)
    const q = (v: number) => Math.round(Math.min(255, 40 + (v / m) * 214))
    g.fillStyle = `rgb(${q(R)},${q(G)},${q(B)})`
    g.fillRect(x, mid - hh, 1, hh * 2)
  }
  return c
}

export function Overview({ i }: { i: DeckIndex }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const size = useRef({ w: 0, h: 0 })
  const img = useRef<{ a: TrackAnalysis | null; w: number; h: number; c: HTMLCanvasElement | null }>({ a: null, w: 0, h: 0, c: null })
  useCanvasSize(ref, (w, h) => (size.current = { w, h }))

  useEffect(() => {
    const c = ref.current!
    const g = c.getContext('2d')!
    const deck = getDJ().decks[i]
    let raf = 0
    let theme = readTheme(c)
    let tt = performance.now()
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const { w, h } = size.current
      if (!w) return
      if (performance.now() - tt > 700) {
        theme = readTheme(c)
        tt = performance.now()
      }
      const dpr = c.width / w
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const a = deck.analysis
      const st = deck.st
      if (!a || !deck.loaded) {
        g.fillStyle = theme.grid
        g.fillRect(0, h / 2, w, 1)
        return
      }
      const cache = img.current
      if (cache.a !== a || cache.w !== w || cache.h !== h) {
        img.current = { a, w, h, c: renderOverview(a, w, h, dpr) }
      }
      g.drawImage(img.current.c!, 0, 0, w, h)
      const dur = deck.duration || 1
      const x = (deck.position() / dur) * w
      // played part dimmed
      g.fillStyle = 'rgba(0,0,0,0.42)'
      g.globalCompositeOperation = 'source-atop'
      g.fillRect(0, 0, x, h)
      g.globalCompositeOperation = 'source-over'
      if (st.loop) {
        const x0 = (st.loop.start / dur) * w, x1 = (st.loop.end / dur) * w
        g.fillStyle = 'rgba(74,222,128,0.3)'
        g.fillRect(x0, 0, Math.max(2, x1 - x0), h)
      }
      // cue + hot cues
      g.fillStyle = '#fb923c'
      g.fillRect((st.cue / dur) * w - 0.5, 0, 1.5, h)
      st.hot.forEach((t, k) => {
        if (t == null) return
        const hx = (t / dur) * w
        g.fillStyle = HOT_COLORS[k]
        g.beginPath()
        g.moveTo(hx, 7)
        g.lineTo(hx - 4, 0)
        g.lineTo(hx + 4, 0)
        g.fill()
        g.fillRect(hx - 0.5, 0, 1, h)
      })
      g.fillStyle = theme.text
      g.fillRect(x - 1, 0, 2, h)
      // last 30 s warning: blink the frame
      const remain = (dur - deck.position()) / Math.max(0.01, 1 + st.tempo)
      if (st.playing && remain < 30 && Math.floor(performance.now() / 400) % 2 === 0) {
        g.strokeStyle = '#f87171'
        g.lineWidth = 2
        g.strokeRect(1, 1, w - 2, h - 2)
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [i])

  const seekAt = (e: React.PointerEvent) => {
    const deck = getDJ().decks[i]
    if (!deck.loaded) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    deck.seek(((e.clientX - r.left) / r.width) * deck.duration)
  }
  return (
    <canvas
      ref={ref}
      className="dj-overview"
      onPointerDown={(e) => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        seekAt(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && seekAt(e)}
      title="Click to jump anywhere in the song"
    />
  )
}
