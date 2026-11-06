// Shared types for the export encoders (pure data, no DOM needed).
export interface PCM {
  /** planar float samples, one array per channel (-1..1) */
  channels: Float32Array[]
  sampleRate: number
}

export interface Meta {
  title?: string
  artist?: string
}

/** Passed to long-running encoders so the UI can show progress and cancel. */
export interface Ctl {
  /** 0..1 */
  onProgress?: (p: number) => void
  cancelled?: boolean
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}

/** Let the browser breathe (paint, handle clicks) during long loops. */
export const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export async function yieldIf(ctl: Ctl | undefined, p: number) {
  ctl?.onProgress?.(p)
  await tick()
  if (ctl?.cancelled) throw new CancelledError()
}

export const FORMATS = ['wav', 'mp3', 'flac', 'aiff', 'opus'] as const
export type FormatId = (typeof FORMATS)[number]
