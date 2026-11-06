// Auto-balance: render every track on its own, measure loudness, and pick
// volumes so that all tracks sit at a similar level.
import { getEngine } from '../../core/engine'
import { clamp } from '../../core/ids'
import { getProject } from '../../core/store'
import { glideMix, type GlideTarget } from './glide'

/** Loudness (dB RMS) of the "active" parts of a buffer (ignores silence). */
export function bufferLoudnessDb(buf: AudioBuffer): number | null {
  const win = Math.max(256, Math.floor(buf.sampleRate * 0.05))
  const chans: Float32Array[] = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  let sum = 0
  let n = 0
  for (let s = 0; s + win <= buf.length; s += win) {
    let e = 0
    for (const ch of chans) for (let i = s; i < s + win; i++) e += ch[i] * ch[i]
    e /= win * chans.length
    if (e > 1e-7) {
      // > about -70 dB
      sum += e
      n++
    }
  }
  if (!n) return null
  return 10 * Math.log10(sum / n)
}

export async function autoBalance(): Promise<{ changed: number; skipped: number }> {
  const p = getProject()
  const engine = getEngine()
  const items: { id: string; db: number; vol: number }[] = []
  let skipped = 0
  for (const t of p.tracks) {
    const hasClips = p.clips.some((c) => c.trackId === t.id)
    if (!hasClips || t.mute || t.volume <= 0.001) {
      skipped++
      continue
    }
    const buf = await engine.render({ trackIds: [t.id], includeMasterFx: false, sampleRate: 22050 })
    const db = bufferLoudnessDb(buf)
    if (db === null) {
      skipped++
      continue
    }
    // loudness at unity fader (undo the current volume)
    items.push({ id: t.id, db: db - 20 * Math.log10(t.volume), vol: t.volume })
  }
  if (items.length === 0) return { changed: 0, skipped }
  const loudest = Math.max(...items.map((i) => i.db))
  const quietest = Math.min(...items.map((i) => i.db))
  // loudest track at (or below) 0 dB, nobody needs more than +6 dB
  const target = Math.min(loudest, quietest + 6)
  const targets: Record<string, GlideTarget> = {}
  for (const it of items) {
    targets[it.id] = { volume: clamp(Math.pow(10, (target - it.db) / 20), 0.02, 2) }
  }
  glideMix('Auto-balance', targets, undefined, 650)
  return { changed: items.length, skipped }
}
