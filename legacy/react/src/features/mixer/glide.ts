// Mix snapshots + animated "glide" between mixes (faders visibly slide).
import { clamp } from '../../core/ids'
import { getProject, mutate } from '../../core/store'

export interface MixSnap {
  tracks: Record<string, { volume: number; pan: number; mute: boolean }>
  master: number
}

export function captureMix(): MixSnap {
  const p = getProject()
  const tracks: MixSnap['tracks'] = {}
  for (const t of p.tracks) tracks[t.id] = { volume: t.volume, pan: t.pan, mute: t.mute }
  return { tracks, master: p.master.volume }
}

export interface GlideTarget {
  volume?: number
  pan?: number
  mute?: boolean
  solo?: boolean
}

let seq = 0
let cancelCurrent: (() => void) | null = null

/** Animate volumes/pans to targets over `ms`; the whole glide is ONE undo step. */
export function glideMix(label: string, tracks: Record<string, GlideTarget>, master?: number, ms = 600) {
  cancelCurrent?.()
  const p0 = getProject()
  const from: Record<string, { volume: number; pan: number }> = {}
  for (const t of p0.tracks) from[t.id] = { volume: t.volume, pan: t.pan }
  const m0 = p0.master.volume
  const key = `mx-glide-${++seq}`
  const t0 = performance.now()
  let raf = 0
  let dead = false
  const step = (now: number) => {
    if (dead) return
    const k = clamp((now - t0) / ms, 0, 1)
    const e = 1 - Math.pow(1 - k, 3)
    const mix = (a: number, b: number) => (k >= 1 ? b : a + (b - a) * e)
    mutate(
      label,
      (p) => {
        for (const tr of p.tracks) {
          const t = tracks[tr.id]
          const f = from[tr.id]
          if (!t || !f) continue
          if (t.volume !== undefined) tr.volume = mix(f.volume, t.volume)
          if (t.pan !== undefined) tr.pan = mix(f.pan, t.pan)
          if (t.mute !== undefined) tr.mute = t.mute
          if (t.solo !== undefined) tr.solo = t.solo
        }
        if (master !== undefined) p.master.volume = mix(m0, master)
      },
      { coalesce: key },
    )
    if (k < 1) raf = requestAnimationFrame(step)
    else cancelCurrent = null
  }
  raf = requestAnimationFrame(step)
  cancelCurrent = () => {
    dead = true
    cancelAnimationFrame(raf)
  }
}

export function recallSnap(label: string, s: MixSnap) {
  const tracks: Record<string, GlideTarget> = {}
  for (const [id, v] of Object.entries(s.tracks)) tracks[id] = { volume: v.volume, pan: v.pan, mute: v.mute }
  glideMix(label, tracks, s.master)
}
