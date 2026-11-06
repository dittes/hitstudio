// Pointer-drag logic for clips, lanes and the ruler. Each drag = one undo step
// (mutations share a unique coalesce key).

import { buffers } from '../../core/buffers.js'
import { getEngine } from '../../core/engine.js'
import { clamp, dbToGain, gainToDb, uid } from '../../core/ids.js'
import { snapTime } from '../../core/store.js'

import { plainClip } from './ops.js'
import { clipLen, collectEdges, MIN_CLIP, rateOf, S, smartSnap, useTL } from './state.js'

const DRAG_THRESHOLD = 3

/** Generic window-level pointer drag with a small movement threshold. */
export function beginDrag(e                                   , o          ) {
  const x0 = e.clientX,
    y0 = e.clientY
  const thr = o.threshold ?? DRAG_THRESHOLD
  let moved = false
  const prevCursor = document.body.style.cursor
  const move = (ev              ) => {
    const dx = ev.clientX - x0,
      dy = ev.clientY - y0
    if (!moved) {
      if (Math.hypot(dx, dy) < thr) return
      moved = true
      useTL.getState().set({ dragging: true })
      if (o.cursor) document.body.style.cursor = o.cursor
    }
    o.onMove(ev, dx, dy)
  }
  const up = (ev              ) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    document.body.style.cursor = prevCursor
    if (moved) useTL.getState().set({ dragging: false })
    o.onEnd?.(moved, ev)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

/** Lane index under a screen point (lanes carry data-lane-index). */
function laneIndexAt(x        , y        )                {
  const el = document.elementFromPoint(x, y)
  const lane = el?.closest             ('[data-lane-index]')
  if (!lane) return null
  return Number(lane.dataset.laneIndex)
}

// ── move (and Alt-duplicate) ────────────────────────────────
export function startClipMove(e                    , clip      ) {
  const s = S()
  const sel = s.selection.clipIds
  const wasSelected = sel.includes(clip.id)
  if (e.shiftKey) {
    if (wasSelected) {
      s.select({ clipIds: sel.filter((id) => id !== clip.id) })
      return
    }
    s.select({ clipIds: [...sel, clip.id], range: null })
  } else if (!wasSelected) {
    s.select({ clipIds: [clip.id], trackIds: [clip.trackId], range: null })
  }
  const ids = S().selection.clipIds.slice()
  const project = s.project
  const order = project.tracks.map((t) => t.id)
  const origs = new Map                                   ()
  for (const c of project.clips) if (ids.includes(c.id)) origs.set(c.id, { start: c.start, ti: order.indexOf(c.trackId) })
  const minStart = Math.min(...[...origs.values()].map((o) => o.start))
  const tis = [...origs.values()].map((o) => o.ti)
  const minTi = Math.min(...tis),
    maxTi = Math.max(...tis)
  const primaryTi = order.indexOf(clip.trackId)
  const len = clipLen(clip)
  const edges = collectEdges(new Set(ids), getEngine().position)
  const zoom = s.ui.zoom
  const key = uid('move')
  const dup = e.altKey
  let copies                     = null
  let tDelta = 0

  beginDrag(e, {
    cursor: dup ? 'copy' : 'grabbing',
    onMove(ev, dx) {
      let ns = clip.start + dx / zoom
      // snap start or end – whichever is closer to a snap target
      const a = smartSnap(ns, edges, ev.shiftKey)
      const b = smartSnap(ns + len, edges, ev.shiftKey) - len
      ns = Math.abs(a - ns) <= Math.abs(b - ns) ? a : b
      const dt = Math.max(ns - clip.start, -minStart)
      const li = laneIndexAt(ev.clientX, ev.clientY)
      if (li !== null) tDelta = clamp(li - primaryTi, -minTi, order.length - 1 - maxTi)
      const firstCopy = dup && !copies
      S().mutate(
        dup ? 'Duplicate clip' : 'Move clip',
        (p) => {
          if (dup && !copies) {
            copies = new Map()
            for (const id of ids) {
              const c = p.clips.find((x) => x.id === id)
              if (!c) continue
              const nc = { ...plainClip(c), id: uid('clp') }
              p.clips.push(nc)
              copies.set(id, nc.id)
            }
          }
          for (const id of ids) {
            const o = origs.get(id)
            if (!o) continue
            const tid = copies?.get(id) ?? id
            const c = p.clips.find((x) => x.id === tid)
            if (!c) continue
            c.start = Math.max(0, o.start + dt)
            c.trackId = order[o.ti + tDelta] ?? c.trackId
          }
        },
        { coalesce: key },
      )
      if (firstCopy && copies) S().select({ clipIds: [...(copies               ).values()] })
    },
    onEnd(moved) {
      if (!moved && !e.shiftKey && wasSelected && ids.length > 1) {
        S().select({ clipIds: [clip.id], trackIds: [clip.trackId] })
      }
    },
  })
}

// ── trim edges ──────────────────────────────────────────────
export function startTrim(e                    , clip      , side           ) {
  e.stopPropagation()
  const s = S()
  if (!s.selection.clipIds.includes(clip.id)) s.select({ clipIds: [clip.id], trackIds: [clip.trackId], range: null })
  const r = rateOf(clip)
  const entry = buffers.get(clip.bufferId)
  const bufLen = entry ? entry.buffer.duration : clip.offset + clip.duration
  const end = clip.start + clipLen(clip)
  const zoom = s.ui.zoom
  const edges = collectEdges(new Set([clip.id]), getEngine().position)
  const key = uid('trim')
  beginDrag(e, {
    cursor: 'ew-resize',
    threshold: 1,
    onMove(ev, dx) {
      const base = side === 'l' ? clip.start : end
      let t = smartSnap(base + dx / zoom, edges, ev.shiftKey)
      S().mutate(
        'Trim clip',
        (p) => {
          const c = p.clips.find((x) => x.id === clip.id)
          if (!c) return
          if (side === 'l') {
            t = clamp(t, Math.max(0, clip.start - clip.offset / r), end - MIN_CLIP)
            c.start = t
            c.offset = clip.offset + (t - clip.start) * r
            c.duration = (end - t) * r
          } else {
            t = clamp(t, clip.start + MIN_CLIP, clip.start + (bufLen - clip.offset) / r)
            c.duration = (t - clip.start) * r
          }
          const L = c.duration / r
          c.fadeIn = Math.min(c.fadeIn, L)
          c.fadeOut = Math.min(c.fadeOut, L - c.fadeIn)
        },
        { coalesce: key },
      )
    },
  })
}

// ── fades ───────────────────────────────────────────────────
export function startFade(e                    , clip      , side              , clipEl             ) {
  e.stopPropagation()
  const rect = clipEl.getBoundingClientRect()
  const zoom = S().ui.zoom
  const L = clipLen(clip)
  const key = uid('fade')
  beginDrag(e, {
    cursor: 'ew-resize',
    threshold: 0,
    onMove(ev) {
      const px = side === 'in' ? ev.clientX - rect.left : rect.right - ev.clientX
      let v = clamp(px / zoom, 0, L)
      if (v < 4 / zoom) v = 0
      S().mutate(
        side === 'in' ? 'Fade in' : 'Fade out',
        (p) => {
          const c = p.clips.find((x) => x.id === clip.id)
          if (!c) return
          if (side === 'in') c.fadeIn = Math.min(v, L - c.fadeOut)
          else c.fadeOut = Math.min(v, L - c.fadeIn)
        },
        { coalesce: key },
      )
    },
  })
}

// ── clip gain line ──────────────────────────────────────────
export function startGain(e                    , clip      ) {
  e.stopPropagation()
  const db0 = clip.gain > 0 ? gainToDb(clip.gain) : -40
  const key = uid('gain')
  beginDrag(e, {
    cursor: 'ns-resize',
    threshold: 0,
    onMove(ev, _dx, dy) {
      const db = clamp(db0 - dy * (ev.shiftKey ? 0.05 : 0.25), -40, 12)
      const g = db <= -40 ? 0 : dbToGain(Math.round(db * 10) / 10)
      S().mutate(
        'Clip volume',
        (p) => {
          const c = p.clips.find((x) => x.id === clip.id)
          if (c) c.gain = g
        },
        { coalesce: key },
      )
    },
  })
}

// ── empty-lane drag: time-range selection / click to seek ──
export function startRangeSelect(e                    , laneEl             , trackId    ) {
  const s = S()
  const rect = laneEl.getBoundingClientRect()
  const { zoom, scrollX } = s.ui
  const order = s.project.tracks.map((t) => t.id)
  const ti0 = order.indexOf(trackId)
  const t0raw = scrollX + (e.clientX - rect.left) / zoom
  const t0 = Math.max(0, snapTime(t0raw))
  const extend = e.shiftKey && s.selection.range
  beginDrag(e, {
    cursor: 'text',
    onMove(ev) {
      const t1 = Math.max(0, snapTime(scrollX + (ev.clientX - rect.left) / zoom))
      const li = laneIndexAt(ev.clientX, ev.clientY) ?? ti0
      const [a, b] = [Math.min(ti0, li), Math.max(ti0, li)]
      const start = extend ? Math.min(extend.start, t1) : Math.min(t0, t1)
      const end = extend ? Math.max(extend.end, t1) : Math.max(t0, t1)
      S().select({ clipIds: [], trackIds: order.slice(a, b + 1), range: { start, end } })
    },
    onEnd(moved) {
      if (moved) return
      S().select({ clipIds: [], trackIds: [trackId], range: null })
      getEngine().seek(Math.max(0, t0raw))
    },
  })
}
