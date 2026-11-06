import { getEngine } from '../../core/engine.js'

export function videoExtension(mime        )         {
  return mime.includes('mp4') ? 'mp4' : 'webm'
}

export function pickMime(preferred = 'mp4') {
  const mp4 = ['video/mp4;codecs=avc1.42E028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const candidates = preferred === 'webm' ? [...webm, ...mp4] : [...mp4, ...webm];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || ''
}

/** Record either renderer's canvas together with the shared master audio. */
export async function startVideoRecording(canvas, options = {})                         {
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    throw new Error('Video recording is not available in this browser.')
  }
  const eng = getEngine()
  await eng.resume()
  const dest = eng.ctx.createMediaStreamDestination()
  let stream
  let video
  const cleanup = () => {
    try { eng.masterAnalyser.disconnect(dest) } catch { /* already disconnected */ }
    video?.getTracks().forEach((t) => t.stop())
    dest.stream.getTracks().forEach((t) => t.stop())
  }
  try {
    video = canvas.captureStream(30)
    eng.masterAnalyser.connect(dest)
    stream = new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()])
    const selected = pickMime(options.format || 'mp4')
    const rec = new MediaRecorder(stream, { ...(selected ? { mimeType: selected } : {}), videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 192_000 })
    const mime = rec.mimeType || selected || 'video/webm'
    const chunks         = []
    let failure               = null
    const finished = new Promise      ((resolve, reject) => {
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

export function downloadBlob(blob      , filename        ) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
