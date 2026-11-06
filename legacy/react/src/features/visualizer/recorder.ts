import { getEngine } from '../../core/engine'

export interface VideoRecorder {
  mime: string
  stop(): Promise<Blob>
}

export function videoExtension(mime: string): string {
  return mime.includes('mp4') ? 'mp4' : 'webm'
}

function pickMime(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || ''
}

/** Record either renderer's canvas together with the shared master audio. */
export async function startVideoRecording(canvas: HTMLCanvasElement): Promise<VideoRecorder> {
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    throw new Error('Video recording is not available in this browser.')
  }
  const eng = getEngine()
  await eng.resume()
  const dest = eng.ctx.createMediaStreamDestination()
  let stream: MediaStream | undefined
  let video: MediaStream | undefined
  const cleanup = () => {
    try { eng.masterAnalyser.disconnect(dest) } catch { /* already disconnected */ }
    video?.getTracks().forEach((t) => t.stop())
    dest.stream.getTracks().forEach((t) => t.stop())
  }
  try {
    video = canvas.captureStream(30)
    eng.masterAnalyser.connect(dest)
    stream = new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()])
    const selected = pickMime()
    const rec = new MediaRecorder(stream, { ...(selected ? { mimeType: selected } : {}), videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 })
    const mime = rec.mimeType || selected || 'video/webm'
    const chunks: Blob[] = []
    let failure: Error | null = null
    const finished = new Promise<Blob>((resolve, reject) => {
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.onerror = () => {
        failure = new Error('The browser could not finish recording this video.')
        if (rec.state !== 'inactive') rec.stop()
        cleanup()
        reject(failure)
      }
      rec.onstop = () => {
        cleanup()
        if (failure) reject(failure)
        else if (!chunks.length) reject(new Error('The recording was empty. Try a longer take.'))
        else resolve(new Blob(chunks, { type: mime }))
      }
    })
    // A recorder can fail before the user presses Stop; retain the error for stop().
    void finished.catch(() => {})
    rec.start(500)
    return {
      mime,
      stop() {
        if (rec.state !== 'inactive') rec.stop()
        return finished
      },
    }
  } catch (error) {
    cleanup()
    throw error
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
