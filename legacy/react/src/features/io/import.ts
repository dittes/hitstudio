// Import audio / video files: decode, create tracks + clips, friendly errors.
import { buffers } from '../../core/buffers'
import { useStore, makeClip, makeTrack, clipEnd } from '../../core/store'
import { toast } from '../../core/toast'
import type { Clip, Track } from '../../core/types'

export interface ImportOptions {
  trackId?: string
  at?: number
  /** put all files one after another on a single new track (the "Join files" flow) */
  sequence?: boolean
}

const stripExt = (n: string) => n.replace(/\.[a-z0-9]{1,5}$/i, '')

const fmtMB = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`

function friendlyError(file: File, e: unknown): string {
  const isMedia = /^(audio|video)\//.test(file.type) || /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|aiff?|webm|mp4|mov|mkv)$/i.test(file.name)
  if (!isMedia) return `"${file.name}" doesn't look like an audio file.`
  if (e instanceof DOMException && e.name === 'EncodingError') return `Your browser couldn't read "${file.name}". Try converting it to MP3 or WAV first.`
  return `"${file.name}" couldn't be opened. It may be damaged or in a format this browser can't play.`
}

export interface ImportResult {
  trackIds: string[]
  clipIds: string[]
}

export async function importFiles(files: File[] | FileList, opts: ImportOptions = {}): Promise<ImportResult> {
  const list = Array.from(files)
  const result: ImportResult = { trackIds: [], clipIds: [] }
  if (!list.length) return result
  const decoded: { name: string; id: string; buffer: AudioBuffer }[] = []
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    const big = f.size > 12 * 1024 * 1024
    if (big)
      toast({
        title: `Reading ${f.name}…`,
        body: `${fmtMB(f.size)} – bigger files take a few seconds${list.length > 1 ? ` (${i + 1} of ${list.length})` : ''}.`,
        ms: 6000,
      })
    try {
      const data = await f.arrayBuffer()
      const entry = await buffers.decode(data, stripExt(f.name))
      decoded.push({ name: stripExt(f.name), id: entry.id, buffer: entry.buffer })
    } catch (e) {
      console.warn('import failed', f.name, e)
      toast({ title: 'Hmm, that file didn’t work', body: friendlyError(f, e), kind: 'error', ms: 5000 })
    }
  }
  if (!decoded.length) return result

  const S = useStore.getState()
  const wasEmpty = S.project.clips.length === 0
  const startAt = opts.at ?? 0

  S.mutate(decoded.length > 1 ? `Import ${decoded.length} files` : `Import ${decoded[0].name}`, (p) => {
    if (wasEmpty) {
      p.sampleRate = decoded[0].buffer.sampleRate
      if (/^untitled/i.test(p.name)) p.name = decoded[0].name
    }
    const mk = (d: (typeof decoded)[number], trackId: string, start: number): Clip => {
      const c = makeClip({ trackId, bufferId: d.id, duration: d.buffer.duration, name: d.name, start })
      result.clipIds.push(c.id)
      return c
    }
    if (opts.trackId && p.tracks.some((t) => t.id === opts.trackId)) {
      let t0 = startAt
      for (const d of decoded) {
        p.clips.push(mk(d, opts.trackId, t0))
        t0 += d.buffer.duration
      }
      return
    }
    if (opts.sequence) {
      const tr = makeTrack(p as never, { name: decoded.length > 1 ? 'Joined' : decoded[0].name }) as Track
      p.tracks.push(tr)
      result.trackIds.push(tr.id)
      let t0 = startAt
      for (const d of decoded) {
        p.clips.push(mk(d, tr.id, t0))
        t0 += d.buffer.duration
      }
      return
    }
    for (const d of decoded) {
      const tr = makeTrack(p as never, { name: d.name }) as Track
      p.tracks.push(tr)
      result.trackIds.push(tr.id)
      p.clips.push(mk(d, tr.id, startAt))
    }
  })
  S.select({ clipIds: result.clipIds, trackIds: result.trackIds.length ? result.trackIds : opts.trackId ? [opts.trackId] : [] })
  const total = decoded.reduce((a, d) => a + d.buffer.duration, 0)
  toast({
    title: decoded.length === 1 ? `Added “${decoded[0].name}” 🎵` : `Added ${decoded.length} files 🎶`,
    body: `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')} of audio – press Space to listen.`,
    kind: 'success',
  })
  return result
}

/** the clip's end on the timeline – handy for "append after" flows */
export function endOfTrack(trackId: string): number {
  return useStore.getState().project.clips.filter((c) => c.trackId === trackId).reduce((a, c) => Math.max(a, clipEnd(c)), 0)
}
