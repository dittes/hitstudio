// Registry of decoded audio. Buffers are immutable: destructive edits create
// a NEW buffer + id, so undo/redo of the project snapshot stays valid.
import { uid } from './ids'
import { computePeaks, type Peaks } from './peaks'

export interface BufferEntry {
  id: string
  name: string
  buffer: AudioBuffer
  /** multi-resolution min/max peaks for fast waveform drawing */
  peaks: Peaks
}

const entries = new Map<string, BufferEntry>()
const listeners = new Set<() => void>()

let sharedCtx: AudioContext | null = null
/** A context to create/decode buffers with before the engine is up. */
export function decodeContext(): BaseAudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext({ latencyHint: 'interactive' })
  return sharedCtx
}
export function setDecodeContext(ctx: AudioContext) {
  sharedCtx = ctx
}

export const buffers = {
  add(buffer: AudioBuffer, name = 'Audio', id = uid('buf')): BufferEntry {
    const entry: BufferEntry = { id, name, buffer, peaks: computePeaks(buffer) }
    entries.set(id, entry)
    listeners.forEach((l) => l())
    return entry
  },
  get(id: string): BufferEntry | undefined {
    return entries.get(id)
  },
  all(): BufferEntry[] {
    return [...entries.values()]
  },
  has(id: string) {
    return entries.has(id)
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** Create an empty AudioBuffer matching the project's format. */
  create(channels: number, length: number, sampleRate: number): AudioBuffer {
    return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, length), sampleRate })
  },
  async decode(data: ArrayBuffer, name: string): Promise<BufferEntry> {
    const audio = await decodeContext().decodeAudioData(data.slice(0))
    return buffers.add(audio, name)
  },
}

/** Copy a section of a buffer [startSec, endSec) into a new AudioBuffer. */
export function sliceBuffer(src: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sr = src.sampleRate
  const s = Math.max(0, Math.floor(startSec * sr))
  const e = Math.min(src.length, Math.floor(endSec * sr))
  const out = buffers.create(src.numberOfChannels, e - s, sr)
  for (let c = 0; c < src.numberOfChannels; c++) {
    out.copyToChannel(src.getChannelData(c).subarray(s, e) as Float32Array<ArrayBuffer>, c)
  }
  return out
}

/** Apply a per-channel sample processor and return a new buffer. */
export function mapBuffer(
  src: AudioBuffer,
  fn: (data: Float32Array, channel: number, sampleRate: number) => Float32Array | void,
): AudioBuffer {
  const out = buffers.create(src.numberOfChannels, src.length, src.sampleRate)
  for (let c = 0; c < src.numberOfChannels; c++) {
    const copy = new Float32Array(src.getChannelData(c))
    const res = fn(copy, c, src.sampleRate)
    out.copyToChannel((res ?? copy) as Float32Array<ArrayBuffer>, c)
  }
  return out
}
