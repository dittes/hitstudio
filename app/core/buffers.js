// Registry of decoded audio. Buffers are immutable: destructive edits create
// a NEW buffer + id, so undo/redo of the project snapshot stays valid.
import { uid } from './ids.js'
import { computePeaks,            } from './peaks.js'

const entries = new Map                     ()
const listeners = new Set            ()

let sharedCtx                      = null
/** A context to create/decode buffers with before the engine is up. */
export function decodeContext()                   {
  if (!sharedCtx) sharedCtx = new AudioContext({ latencyHint: 'interactive' })
  return sharedCtx
}
export function setDecodeContext(ctx              ) {
  sharedCtx = ctx
}

export const buffers = {
  add(buffer             , name = 'Audio', id = uid('buf'))              {
    const entry              = { id, name, buffer, peaks: computePeaks(buffer) }
    entries.set(id, entry)
    listeners.forEach((l) => l())
    return entry
  },
  get(id        )                          {
    return entries.get(id)
  },
  all()                {
    return [...entries.values()]
  },
  has(id        ) {
    return entries.has(id)
  },
  subscribe(fn            ) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** Create an empty AudioBuffer matching the project's format. */
  create(channels        , length        , sampleRate        )              {
    return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, length), sampleRate })
  },
  async decode(data             , name        )                       {
    const audio = await decodeContext().decodeAudioData(data.slice(0))
    return buffers.add(audio, name)
  },
}

/** Copy a section of a buffer [startSec, endSec) into a new AudioBuffer. */
export function sliceBuffer(src             , startSec        , endSec        )              {
  const sr = src.sampleRate
  const s = Math.max(0, Math.floor(startSec * sr))
  const e = Math.min(src.length, Math.floor(endSec * sr))
  const out = buffers.create(src.numberOfChannels, e - s, sr)
  for (let c = 0; c < src.numberOfChannels; c++) {
    out.copyToChannel(src.getChannelData(c).subarray(s, e)                             , c)
  }
  return out
}

/** Apply a per-channel sample processor and return a new buffer. */
export function mapBuffer(
  src             ,
  fn                                                                                  ,
)              {
  const out = buffers.create(src.numberOfChannels, src.length, src.sampleRate)
  for (let c = 0; c < src.numberOfChannels; c++) {
    const copy = new Float32Array(src.getChannelData(c))
    const res = fn(copy, c, src.sampleRate)
    out.copyToChannel((res ?? copy)                             , c)
  }
  return out
}
