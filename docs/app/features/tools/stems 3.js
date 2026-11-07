// Split a song into drums, bass, vocals and other, then drop the four stems on the timeline.
import { buffers, sliceBuffer } from '../../core/buffers.js'
import { makeClip, makeTrack, useStore } from '../../core/store.js'
import { toast } from '../../core/toast.js'
import { icon, escape } from '../../dom.js'
import { showModal, closeModal } from '../../dialogs.js'
import { MAX_SECONDS, STEM_NAMES, separateStems } from './stems-core.js'

export const STEM_LABEL = { drums: 'Drums', bass: 'Bass', vocals: 'Vocals', other: 'Other' }
export const STEM_COLOR = { drums: '#fb923c', bass: '#4ade80', vocals: '#f472b6', other: '#a78bfa' }
const STEM_ICON = { drums: 'drum', bass: 'bass', vocals: 'vocal', other: 'keys' }

/** Run the separation (in a Worker when possible) and return four stereo AudioBuffers. */
export async function splitIntoStems(audio, { onProgress = () => {}, signal } = {}) {
  if (audio.duration > MAX_SECONDS) throw new Error(`This song is ${Math.round(audio.duration / 60)} minutes long. Split songs up to ${MAX_SECONDS / 60} minutes, or cut a section first.`)
  const length = audio.length
  const sampleRate = audio.sampleRate
  const channels = () => {
    const l = audio.getChannelData(0).slice()
    const r = audio.numberOfChannels > 1 ? audio.getChannelData(1).slice() : l.slice()
    return { l, r }
  }
  const toBuffers = (stems) => {
    const out = {}
    for (const k of STEM_NAMES) {
      const b = buffers.create(2, length, sampleRate)
      b.copyToChannel(stems[k][0], 0)
      b.copyToChannel(stems[k][1], 1)
      stems[k] = null // release the raw arrays as soon as they are copied
      out[k] = b
    }
    return out
  }
  const onMain = async () => {
    const { l, r } = channels()
    const stems = await separateStems(l, r, sampleRate, { onProgress, shouldCancel: () => !!signal?.aborted })
    return stems ? toBuffers(stems) : null
  }
  let worker = null
  try {
    worker = new Worker(new URL('./stems-worker.js', import.meta.url), { type: 'module' })
  } catch {
    return onMain()
  }
  return new Promise((resolve, reject) => {
    const finish = (fn) => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      fn()
    }
    const abort = () => worker.postMessage({ type: 'cancel' })
    signal?.addEventListener('abort', abort)
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') onProgress(m.p)
      else if (m.type === 'cancelled') finish(() => resolve(null))
      else if (m.type === 'error') finish(() => reject(new Error(m.message)))
      else if (m.type === 'done') finish(() => resolve(toBuffers(m.stems)))
    }
    // module workers are not available everywhere: fall back to the main thread
    worker.onerror = () => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      onMain().then(resolve, reject)
    }
    const { l, r } = channels()
    worker.postMessage({ type: 'start', left: l, right: r, sampleRate }, [l.buffer, r.buffer])
  })
}

/** Progress dialog for a split. Resolves with the four stem buffers, or null when cancelled or failed. */
export async function splitWithProgress(audio, { name = 'Song', title = 'Split into instruments' } = {}) {
  const abort = new AbortController()
  let done = false
  const startedAt = performance.now()
  showModal(
    title,
    `<div class="stem-modal"><p class="stem-name">${icon('layers')}<b>${escape(name)}</b></p>
    <div class="stem-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
    <div class="stem-meta"><span class="stem-pct">Getting ready…</span><span class="stem-time faint"></span></div>
    <div class="stem-chips">${STEM_NAMES.map((k) => `<span style="--c:${STEM_COLOR[k]}">${icon(STEM_ICON[k])}${STEM_LABEL[k]}</span>`).join('')}</div>
    <p class="faint stem-note">This runs on your device and nothing is uploaded. It is a quick split: great for practising, karaoke-style mixes and remixing, but not studio-clean on dense songs.</p>
    <div class="row spread"><span></span><button data-stem-cancel>Cancel</button></div></div>`,
    () => {
      if (!done) abort.abort()
    },
  )
  const root = document.querySelector('#modal .stem-modal')
  root?.querySelector('[data-stem-cancel]')?.addEventListener('click', () => closeModal())
  const bar = root?.querySelector('.stem-bar')
  const pct = root?.querySelector('.stem-pct')
  const time = root?.querySelector('.stem-time')
  const progress = (p) => {
    if (!bar) return
    const v = Math.round(p * 100)
    bar.firstElementChild.style.width = `${v}%`
    bar.setAttribute('aria-valuenow', String(v))
    pct.textContent = p >= 1 ? 'Finishing…' : `Separating… ${v}%`
    const s = (performance.now() - startedAt) / 1000
    time.textContent = p > 0.04 && p < 1 ? `about ${Math.max(1, Math.round((s / p) * (1 - p)))} s left` : ''
  }
  let stems
  try {
    stems = await splitIntoStems(audio, { onProgress: progress, signal: abort.signal })
  } catch (error) {
    done = true
    closeModal()
    toast({ title: 'Could not split this song', body: String(error?.message || error), kind: 'error', ms: 7000 })
    return null
  }
  done = true
  if (stems) closeModal()
  return stems
}

/** Split a song and drop the four stems on the timeline. */
export async function splitSong(audio, { name = 'Song', start = 0, rate = 1 } = {}) {
  const stems = await splitWithProgress(audio, { name })
  if (!stems) return null
  const S = useStore.getState()
  const clipIds = []
  const trackIds = []
  S.mutate('Split into instruments', (p) => {
    for (const k of STEM_NAMES) {
      const entry = buffers.add(stems[k], `${name} – ${STEM_LABEL[k]}`)
      const t = makeTrack(p, { name: STEM_LABEL[k], color: STEM_COLOR[k] })
      p.tracks.push(t)
      const c = makeClip({ trackId: t.id, bufferId: entry.id, duration: stems[k].duration, start, rate, name: `${name} – ${STEM_LABEL[k]}`, color: STEM_COLOR[k] })
      p.clips.push(c)
      trackIds.push(t.id)
      clipIds.push(c.id)
    }
  })
  S.setMode('edit')
  S.select({ clipIds, trackIds })
  toast({
    title: 'Your song is split into 4 instruments 🎛️',
    body: 'Mute or solo any track, rebalance it in Mix, or export a single stem.',
    ms: 9000,
    kind: 'success',
    action: { label: 'Open Mix', run: () => useStore.getState().setMode('mix') },
  })
  return { clipIds, trackIds }
}

/** Decode a picked file (shared by the stem and karaoke tools). */
export async function decodeFile(file) {
  const base = file.name.replace(/\.[^.]+$/, '')
  toast({ title: `Reading ${file.name}…`, ms: 2500 })
  try {
    const entry = await buffers.decode(await file.arrayBuffer(), base)
    return { name: base, buffer: entry.buffer }
  } catch {
    toast({ title: 'Hmm, that file didn’t work', body: 'Try an MP3, WAV, FLAC, OGG or M4A file.', kind: 'error' })
    return null
  }
}

/** Split the section of a timeline clip that you can currently hear. */
export async function splitClip(clipId) {
  const p = useStore.getState().project
  const clip = p.clips.find((c) => c.id === clipId)
  const src = clip && buffers.get(clip.bufferId)?.buffer
  if (!clip || !src) return toast('Select a clip first.')
  const part = sliceBuffer(src, clip.offset || 0, (clip.offset || 0) + clip.duration)
  return splitSong(part, { name: clip.name || 'Clip', start: clip.start || 0, rate: clip.rate || 1 })
}

/** Decode a picked file and split it. */
export async function splitFile(file) {
  const song = await decodeFile(file)
  return song ? splitSong(song.buffer, { name: song.name }) : null
}
