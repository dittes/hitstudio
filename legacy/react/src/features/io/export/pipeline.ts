// Export pipeline: render (engine) → polish (mono/fades/loudness) → encode → download-ready blob(s).
import { getEngine } from '../../../core/engine'
import { projectDuration, useStore } from '../../../core/store'
import { encode, extFor, type FormatOptions } from './encode'
import { applyLoudness, audioBufferToPcm, edgeFade, fadeOut, toMono, type LoudnessPreset } from './loudness'
import type { Ctl, FormatId, Meta, PCM } from './types'
import { writeZip } from './zip'

export type Target = 'song' | 'selection' | 'loop' | 'stems'

export interface ExportSettings {
  target: Target
  format: FormatId
  wavBits: 16 | 24 | 32
  flacBits: 16 | 24
  aiffBits: 16 | 24
  mp3Kbps: number
  opusKbps: number
  sampleRate: 44100 | 48000
  channels: 1 | 2
  loudness: LoudnessPreset
  /** seconds of fade-out at the end, 0 = none */
  fade: number
  title: string
  artist: string
}

export const DEFAULT_SETTINGS: ExportSettings = {
  target: 'song',
  format: 'mp3',
  wavBits: 16,
  flacBits: 16,
  aiffBits: 16,
  mp3Kbps: 192,
  opusKbps: 96,
  sampleRate: 44100,
  channels: 2,
  loudness: 'off',
  fade: 0,
  title: '',
  artist: '',
}

export function formatOptions(s: ExportSettings): FormatOptions {
  switch (s.format) {
    case 'wav': return { format: 'wav', bits: s.wavBits, kbps: 0 }
    case 'flac': return { format: 'flac', bits: s.flacBits, kbps: 0 }
    case 'aiff': return { format: 'aiff', bits: s.aiffBits, kbps: 0 }
    case 'mp3': return { format: 'mp3', bits: 16, kbps: s.mp3Kbps }
    case 'opus': return { format: 'opus', bits: 16, kbps: s.opusKbps }
  }
}

export interface Range {
  start: number
  end: number
}

export function rangeFor(target: Target): Range | null {
  const { project, selection } = useStore.getState()
  if (target === 'selection') {
    const r = selection.range
    return r && r.end - r.start > 0.05 ? { start: r.start, end: r.end } : null
  }
  if (target === 'loop') return project.loop.end - project.loop.start > 0.05 ? { start: project.loop.start, end: project.loop.end } : null
  const d = projectDuration(project)
  return d > 0 ? { start: 0, end: d } : null
}

export function stemTracks() {
  const { project } = useStore.getState()
  return project.tracks.filter((t) => project.clips.some((c) => c.trackId === t.id))
}

export function effectiveRate(s: ExportSettings) {
  return s.format === 'opus' ? 48000 : s.sampleRate
}

export interface Polished {
  pcm: PCM
  gainDb: number
}

/** render + mono/fade/loudness. `loudness` is applied to full mixes only. */
export async function renderPolished(
  range: Range,
  s: ExportSettings,
  opts: { trackIds?: string[]; stem?: boolean } = {},
): Promise<Polished> {
  const buf = await getEngine().render({
    start: range.start,
    end: range.end,
    sampleRate: effectiveRate(s),
    channels: 2,
    trackIds: opts.trackIds,
    includeMasterFx: !opts.stem,
  })
  let pcm = audioBufferToPcm(buf)
  if (s.channels === 1) pcm = toMono(pcm)
  edgeFade(pcm, 3)
  if (s.fade > 0) fadeOut(pcm, Math.min(s.fade, (range.end - range.start) / 2))
  const gainDb = opts.stem ? 0 : applyLoudness(pcm, s.loudness)
  return { pcm, gainDb }
}

// A cache so Preview → Export doesn't render twice.
let cache: { key: string; project: unknown; value: Polished } | null = null
export async function renderPolishedCached(range: Range, s: ExportSettings): Promise<Polished> {
  const project = useStore.getState().project
  const key = JSON.stringify([range, effectiveRate(s), s.channels, s.loudness, s.fade])
  if (cache && cache.key === key && cache.project === project) return cache.value
  const value = await renderPolished(range, s)
  cache = { key, project, value }
  return value
}
export const clearExportCache = () => (cache = null)

export interface ExportOutput {
  blob: Blob
  filename: string
  gainDb: number
  note?: string
}

const safe = (s: string) => (s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'HitStudio song').slice(0, 100)

export async function runExport(
  s: ExportSettings,
  ctl: Ctl & { onPhase?: (label: string) => void },
): Promise<ExportOutput> {
  const meta: Meta = { title: s.title || undefined, artist: s.artist || undefined }
  const fo = formatOptions(s)
  const ext = extFor(s.format)
  const base = safe(s.title || useStore.getState().project.name)
  const progress = (a: number, b: number): Ctl => ({
    get cancelled() {
      return ctl.cancelled
    },
    onProgress: (p) => ctl.onProgress?.(a + (b - a) * p),
  })

  if (s.target === 'stems') {
    const range = rangeFor('song')
    const tracks = stemTracks()
    if (!range || !tracks.length) throw new Error('There’s nothing to export yet – add some audio first.')
    const files: { name: string; data: Uint8Array }[] = []
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i]
      const a = i / tracks.length
      const b = (i + 1) / tracks.length
      ctl.onPhase?.(`Track ${i + 1} of ${tracks.length}: ${t.name}`)
      ctl.onProgress?.(a)
      const { pcm } = await renderPolished(range, s, { trackIds: [t.id], stem: true })
      if (ctl.cancelled) throw new Error('cancelled')
      const blob = await encode(pcm, fo, { ...meta, title: `${meta.title ?? base} – ${t.name}` }, progress(a + (b - a) * 0.3, b))
      files.push({ name: `${String(i + 1).padStart(2, '0')} ${safe(t.name)}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) })
    }
    if (files.length === 1) return { blob: new Blob([files[0].data as BlobPart]), filename: files[0].name, gainDb: 0 }
    ctl.onPhase?.('Zipping the files together…')
    return { blob: writeZip(files), filename: `${base} – stems.zip`, gainDb: 0, note: `${files.length} files in one zip` }
  }

  const range = rangeFor(s.target)
  if (!range) throw new Error(s.target === 'song' ? 'There’s nothing to export yet – add some audio first.' : 'There’s no range selected for that option.')
  ctl.onPhase?.('Mixing your song…')
  ctl.onProgress?.(0.02)
  const { pcm, gainDb } = await renderPolishedCached(range, s)
  if (ctl.cancelled) throw new Error('cancelled')
  ctl.onPhase?.(s.format === 'opus' && extFor('opus') === 'webm' ? 'Recording Opus in real time…' : `Making your ${s.format.toUpperCase()}…`)
  const blob = await encode(pcm, fo, meta, progress(0.3, 1))
  return { blob, filename: `${base}.${ext}`, gainDb }
}
