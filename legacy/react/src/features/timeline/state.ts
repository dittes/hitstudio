// Timeline-local ephemeral state + geometry helpers (not part of the project / undo).
import { create } from 'zustand'
import { clamp } from '../../core/ids'
import { projectDuration, useStore } from '../../core/store'
import type { Clip } from '../../core/types'

export const HEADER_W = 220
export const RULER_H = 40
/** waveform tiles are drawn in chunks of this many CSS px */
export const TILE = 1024
export const MIN_ZOOM = 5
export const MAX_ZOOM = 2000
export const MIN_CLIP = 0.01
export const MIN_TRACK_H = 64
export const MAX_TRACK_H = 260

export interface MenuState {
  x: number
  y: number
  clipId: string
  /** timeline time under the pointer when the menu opened */
  time: number
}

export interface TLState {
  /** width of the visible lane area in px */
  viewW: number
  dropGhost: { trackId: string; at: number } | null
  menu: MenuState | null
  renaming: string | null
  /** true while any pointer drag is in progress (suppresses hover effects / autoscroll) */
  dragging: boolean
  set: (p: Partial<TLState>) => void
}

export const useTL = create<TLState>((set) => ({
  viewW: 800,
  dropGhost: null,
  menu: null,
  renaming: null,
  dragging: false,
  set: (p) => set(p),
}))

/** ids of clips that have been rendered at least once (only new clips get the pop-in animation) */
export const seenClips = new Set<string>()

/** last time the user scrolled manually – page-follow pauses briefly after that */
export const scrollActivity = { last: 0 }

export const S = () => useStore.getState()

export const rateOf = (c: Pick<Clip, 'rate'>) => c.rate || 1
export const clipLen = (c: Pick<Clip, 'duration' | 'rate'>) => c.duration / rateOf(c)

export function viewSeconds(zoom = S().ui.zoom) {
  return useTL.getState().viewW / zoom
}

export function maxScroll(zoom = S().ui.zoom) {
  const dur = projectDuration(S().project)
  return Math.max(0, dur + 30 - viewSeconds(zoom) * 0.5)
}

export function setScroll(x: number) {
  const v = clamp(x, 0, Math.max(maxScroll(), S().ui.scrollX))
  if (v !== S().ui.scrollX) S().setUI({ scrollX: v })
}

/** Zoom keeping the time under `anchorPx` (px from the lane area's left edge) fixed. */
export function zoomAround(nextZoom: number, anchorPx = useTL.getState().viewW / 2) {
  const { zoom, scrollX } = S().ui
  const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
  if (z === zoom) return
  const t = scrollX + anchorPx / zoom
  S().setUI({ zoom: z, scrollX: Math.max(0, t - anchorPx / z) })
}

export function zoomToFit() {
  const dur = projectDuration(S().project)
  const w = useTL.getState().viewW
  const target = dur > 0 ? dur * 1.04 : 30
  S().setUI({ zoom: clamp(w / target, MIN_ZOOM, MAX_ZOOM), scrollX: 0 })
}

/** Grid step in seconds (same resolution logic as core snapTime). */
export function gridStep() {
  const { ui, project } = S()
  const beat = 60 / project.bpm
  const pxPerBeat = beat * ui.zoom
  let div = 1
  if (pxPerBeat > 160) div = 4
  else if (pxPerBeat > 80) div = 2
  else if (pxPerBeat < 20) div = 0.25
  return beat / div
}

/** Times other things can magnetically snap to (clip edges, playhead, loop, markers). */
export function collectEdges(exclude: Set<string>, playhead: number): number[] {
  const p = S().project
  const out: number[] = [playhead]
  for (const c of p.clips) {
    if (exclude.has(c.id)) continue
    out.push(c.start, c.start + clipLen(c))
  }
  for (const m of p.markers) out.push(m.time)
  if (p.loop.enabled) out.push(p.loop.start, p.loop.end)
  return out
}

/**
 * Snap `t` (seconds): first magnetically to nearby edges (within 8px), else to the beat grid.
 * Respects the snap toggle; holding Shift (`bypass`) disables snapping.
 */
export function smartSnap(t: number, edges: number[], bypass = false): number {
  const { ui } = S()
  if (!ui.snap || bypass) return t
  const tol = 8 / ui.zoom
  let best = t,
    bestD = tol
  for (const e of edges) {
    const d = Math.abs(e - t)
    if (d < bestD) {
      best = e
      bestD = d
    }
  }
  if (best !== t) return best
  const step = gridStep()
  return Math.round(t / step) * step
}
