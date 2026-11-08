// Shared types for the export encoders (pure data, no DOM needed).

/** Passed to long-running encoders so the UI can show progress and cancel. */

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}

/** Let the browser breathe (paint, handle clicks) during long loops. */
export const tick = () => new Promise      ((r) => setTimeout(r, 0))

export async function yieldIf(ctl                 , p        ) {
  ctl?.onProgress?.(p)
  await tick()
  if (ctl?.cancelled) throw new CancelledError()
}

export const FORMATS = ['wav', 'mp3', 'flac', 'aiff', 'opus']

