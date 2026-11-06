// Non-destructive clip editing operations. All functions operate on an immer draft
// of the project and are meant to be called inside `mutate(label, p => …)`.
import type { Draft } from 'immer'
import { uid } from '../../core/ids'
import { makeTrack } from '../../core/store'
import type { Clip, ID, Project } from '../../core/types'
import { clipLen, MIN_CLIP, rateOf } from './state'

type P = Draft<Project>
const EPS = 0.0005

export function plainClip(c: Clip | Draft<Clip>): Clip {
  return { ...(c as Clip) }
}

/** Split one clip at timeline time t. Returns the id of the new right-hand clip, or null. */
export function splitClipAt(p: P, clipId: ID, t: number): ID | null {
  const c = p.clips.find((x) => x.id === clipId)
  if (!c) return null
  const end = c.start + clipLen(c)
  if (t <= c.start + MIN_CLIP / 2 || t >= end - MIN_CLIP / 2) return null
  const r = rateOf(c)
  const leftBuf = (t - c.start) * r
  const right: Clip = {
    ...plainClip(c),
    id: uid('clp'),
    start: t,
    offset: c.offset + leftBuf,
    duration: c.duration - leftBuf,
    fadeIn: 0,
    fadeOut: Math.min(c.fadeOut, end - t),
  }
  c.duration = leftBuf
  c.fadeOut = 0
  c.fadeIn = Math.min(c.fadeIn, t - c.start)
  p.clips.splice(p.clips.indexOf(c) + 1, 0, right)
  return right.id
}

/**
 * Split clips on `trackIds` at the range edges and return the ids of all clips that
 * now lie fully inside [start, end].
 */
export function isolateRange(p: P, trackIds: ID[], start: number, end: number): ID[] {
  const tracks = new Set(trackIds)
  const touched = p.clips.filter((c) => tracks.has(c.trackId) && c.start < end - EPS && c.start + clipLen(c) > start + EPS).map((c) => c.id)
  const inside: ID[] = []
  for (const id of touched) {
    let mid = id
    const c = p.clips.find((x) => x.id === id)!
    if (c.start < start - EPS) mid = splitClipAt(p, id, start) ?? id
    const m = p.clips.find((x) => x.id === mid)!
    if (m.start + clipLen(m) > end + EPS) splitClipAt(p, mid, end)
    inside.push(mid)
  }
  return inside
}

export function removeClips(p: P, ids: Iterable<ID>) {
  const set = new Set(ids)
  p.clips = p.clips.filter((c) => !set.has(c.id))
}

/** Remove the audio in [start, end] on the given tracks (no ripple). */
export function removeRange(p: P, trackIds: ID[], start: number, end: number) {
  removeClips(p, isolateRange(p, trackIds, start, end))
}

/** Keep only the audio inside [start, end] on the given tracks. */
export function trimToRange(p: P, trackIds: ID[], start: number, end: number) {
  const inside = new Set(isolateRange(p, trackIds, start, end))
  const tracks = new Set(trackIds)
  p.clips = p.clips.filter((c) => !tracks.has(c.trackId) || inside.has(c.id))
}

/** Silence [start, end] on the given tracks: the piece stays but its gain becomes 0. */
export function silenceRange(p: P, trackIds: ID[], start: number, end: number) {
  for (const id of isolateRange(p, trackIds, start, end)) {
    const c = p.clips.find((x) => x.id === id)
    if (c) {
      c.gain = 0
      c.fadeIn = 0
      c.fadeOut = 0
    }
  }
}

/** A plain copy of the part of `c` that lies inside [start, end] (or null). */
export function cropClip(c: Clip, start: number, end: number): Clip | null {
  const len = clipLen(c)
  const s = Math.max(start, c.start)
  const e = Math.min(end, c.start + len)
  if (e - s < MIN_CLIP) return null
  const r = rateOf(c)
  return {
    ...c,
    start: s,
    offset: c.offset + (s - c.start) * r,
    duration: (e - s) * r,
    fadeIn: s > c.start ? 0 : Math.min(c.fadeIn, e - s),
    fadeOut: e < c.start + len ? 0 : Math.min(c.fadeOut, e - s),
  }
}

// ── clipboard ───────────────────────────────────────────────
export interface ClipboardItem {
  clip: Clip
  /** start relative to the earliest copied clip */
  rel: number
  /** track index relative to the top-most copied track */
  trackDelta: number
}
let clipboard: ClipboardItem[] = []
export const getClipboard = () => clipboard

export function setClipboard(clips: Clip[], trackOrder: ID[]) {
  if (!clips.length) {
    clipboard = []
    return
  }
  const minStart = Math.min(...clips.map((c) => c.start))
  const minTrack = Math.min(...clips.map((c) => Math.max(0, trackOrder.indexOf(c.trackId))))
  clipboard = clips.map((c) => ({
    clip: { ...c },
    rel: c.start - minStart,
    trackDelta: Math.max(0, trackOrder.indexOf(c.trackId)) - minTrack,
  }))
}

/** Paste the clipboard at `at` starting on track index `trackIndex`. Returns new clip ids. */
export function pasteClipboard(p: P, at: number, trackIndex: number): ID[] {
  const ids: ID[] = []
  for (const item of clipboard) {
    const ti = trackIndex + item.trackDelta
    while (p.tracks.length <= ti) p.tracks.push(makeTrack(p as Project))
    const nc: Clip = { ...item.clip, id: uid('clp'), trackId: p.tracks[ti].id, start: Math.max(0, at + item.rel) }
    p.clips.push(nc)
    ids.push(nc.id)
  }
  return ids
}

/** Duplicate clips right after the end of the group. Returns new ids. */
export function duplicateClips(p: P, ids: ID[]): ID[] {
  const src = p.clips.filter((c) => ids.includes(c.id))
  if (!src.length) return []
  const minStart = Math.min(...src.map((c) => c.start))
  const maxEnd = Math.max(...src.map((c) => c.start + clipLen(c)))
  const shift = maxEnd - minStart
  const out: ID[] = []
  for (const c of src) {
    const nc: Clip = { ...plainClip(c), id: uid('clp'), start: c.start + shift }
    p.clips.push(nc)
    out.push(nc.id)
  }
  return out
}
