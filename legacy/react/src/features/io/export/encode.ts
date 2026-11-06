// Format dispatch: PCM + options → Blob. Pure (no React / store).
import { encodeAiff } from './aiff'
import { encodeFlac } from './flac'
import { encodeMp3 } from './mp3'
import { encodeOpus, encodeOpusRealtime, opusSupported, realtimeOpusSupported } from './opus'
import type { Ctl, FormatId, Meta, PCM } from './types'
import { encodeWav } from './wav'

export interface FormatOptions {
  format: FormatId
  /** wav: 16|24|32 · flac/aiff: 16|24 */
  bits: number
  /** mp3 / opus bitrate */
  kbps: number
}

export interface FormatInfo {
  id: FormatId
  label: string
  ext: string
  mime: string
  blurb: string
  emoji: string
}

export const FORMAT_INFO: FormatInfo[] = [
  { id: 'wav', label: 'WAV', ext: 'wav', mime: 'audio/wav', blurb: 'Studio quality. Big files, plays everywhere.', emoji: '🎚️' },
  { id: 'mp3', label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', blurb: 'Small and universal. Great for sharing.', emoji: '🎧' },
  { id: 'flac', label: 'FLAC', ext: 'flac', mime: 'audio/flac', blurb: 'Perfect quality at about half the size.', emoji: '💎' },
  { id: 'aiff', label: 'AIFF', ext: 'aiff', mime: 'audio/aiff', blurb: 'Apple-friendly lossless audio.', emoji: '🍏' },
  { id: 'opus', label: 'Opus', ext: 'opus', mime: 'audio/ogg', blurb: 'Tiny and modern. Best quality per byte.', emoji: '🚀' },
]
export const infoFor = (f: FormatId) => FORMAT_INFO.find((x) => x.id === f)!

export function opusMode(): 'webcodecs' | 'realtime' | 'none' {
  return opusSupported() ? 'webcodecs' : realtimeOpusSupported() ? 'realtime' : 'none'
}

export function extFor(f: FormatId): string {
  return f === 'opus' && opusMode() === 'realtime' ? 'webm' : infoFor(f).ext
}

export async function encode(pcm: PCM, o: FormatOptions, meta: Meta, ctl?: Ctl): Promise<Blob> {
  switch (o.format) {
    case 'wav':
      return encodeWav(pcm, o.bits as 16 | 24 | 32, meta)
    case 'aiff':
      return encodeAiff(pcm, o.bits === 24 ? 24 : 16, meta)
    case 'flac':
      return encodeFlac(pcm, o.bits === 24 ? 24 : 16, meta, ctl)
    case 'mp3':
      return encodeMp3(pcm, o.kbps, meta, ctl)
    case 'opus':
      return opusSupported() ? encodeOpus(pcm, o.kbps, meta, ctl) : encodeOpusRealtime(pcm, o.kbps, ctl)
  }
}

/** rough output size in bytes, for the friendly "about 4.2 MB" label */
export function estimateBytes(o: FormatOptions, seconds: number, sampleRate: number, channels: number): number {
  switch (o.format) {
    case 'wav':
    case 'aiff':
      return seconds * sampleRate * channels * (o.bits / 8)
    case 'flac':
      return seconds * sampleRate * channels * (o.bits / 8) * 0.58
    case 'mp3':
    case 'opus':
      return (seconds * o.kbps * 1000) / 8
  }
}

export function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}
