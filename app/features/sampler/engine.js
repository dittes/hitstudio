// Sampler engine: 16 pads, each with its own buffer, trim, envelope, filter, pitch and choke group.
//
// Voices are plain Web Audio graphs created per hit:
//   AudioBufferSourceNode → low-pass → gain envelope → panner → output stage (+ reverb send)
// The output stage is the same one Create and Jam use (reverb, glue, limiter) and it feeds the app's master
// bus, so the master EQ and the visualizer hear the sampler, too. Factory sounds are fetched from assets/sampler;
// sounds you load yourself are stored on this device (IndexedDB) and survive a reload.
import { create } from '../../lib/state.js'
import { getEngine } from '../../core/engine.js'
import { buffers } from '../../core/buffers.js'
import { makeClip, makeTrack, useStore } from '../../core/store.js'
import { toast } from '../../core/toast.js'
import { createOutputStage } from '../create/synth/mix.js'
import { encodeWav } from '../io/export/wav.js'
import { audioBufferToPcm } from '../io/export/loudness.js'
import { DEFAULT_KIT, DEFAULT_PARAMS, SINGULAR } from './kit.js'

const LS = 'hitstudio.sampler.v1'
const DB = 'hitstudio-sampler'

// ── state ────────────────────────────────────────────────────
const freshPad = (i) => ({ name: DEFAULT_KIT[i].name, custom: false, src: null, params: { ...DEFAULT_PARAMS, ...DEFAULT_KIT[i].params } })

function loadSaved() {
  const base = DEFAULT_KIT.map((_, i) => freshPad(i))
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || 'null')
    if (saved?.pads?.length === 16) {
      saved.pads.forEach((p, i) => {
        base[i] = { name: String(p.name ?? base[i].name).slice(0, 24), custom: !!p.custom, src: typeof p.src === 'string' ? p.src : null, params: { ...base[i].params, ...p.params } }
      })
    }
  } catch { /* fall back to the factory kit */ }
  return base
}

export const useSampler = create(() => ({ pads: loadSaved(), selected: 0, ready: false, loading: false }))
const S = () => useSampler.getState()
const set = (patch) => useSampler.setState(patch)

let saveTimer = 0
function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS, JSON.stringify({ pads: S().pads }))
    } catch { /* private mode */ }
  }, 250)
}

export function setParam(i, patch) {
  const pads = S().pads.slice()
  pads[i] = { ...pads[i], params: { ...pads[i].params, ...patch } }
  set({ pads })
  reversed.delete(i)
  persist()
}
export function setName(i, name) {
  const pads = S().pads.slice()
  pads[i] = { ...pads[i], name: name.slice(0, 24) }
  set({ pads })
  persist()
}
export const select = (i) => set({ selected: i })

// ── sample storage (IndexedDB) ───────────────────────────────
const openDB = () =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('samples')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
const idb = async (mode, fn) => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('samples', mode)
    const req = fn(tx.objectStore('samples'))
    tx.oncomplete = () => resolve(req?.result)
    tx.onerror = () => reject(tx.error)
  })
}

// ── buffers ──────────────────────────────────────────────────
const bufs = new Map() // pad index → AudioBuffer
const reversed = new Map()
export const padBuffer = (i) => bufs.get(i) ?? null
/** what you actually hear: the buffer, reversed if the pad is set to Reverse (this is what the displays draw) */
export const padView = (i) => bufferFor(i) ?? null

const decode = async (data) => getEngine().ctx.decodeAudioData(data.slice(0))

async function loadDefault(i) {
  const url = new URL(`../../../assets/sampler/${DEFAULT_KIT[i].file}.wav`, import.meta.url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Missing sound ${DEFAULT_KIT[i].file}`)
  bufs.set(i, await decode(await res.arrayBuffer()))
}

/** Load all 16 sounds (factory or your own). Safe to call more than once. */
let initPromise = null
export function initSampler() {
  if (initPromise) return initPromise
  set({ loading: true })
  initPromise = (async () => {
    await Promise.all(
      S().pads.map(async (p, i) => {
        try {
          if (p.src?.startsWith('lib:')) {
            const entry = (await loadManifest()).sounds.find((x) => x.id === p.src.slice(4))
            if (entry) {
              bufs.set(i, await libraryBuffer(entry))
              return
            }
          }
          if (p.custom) {
            const blob = await idb('readonly', (st) => st.get(`pad-${i}`))
            if (blob) {
              bufs.set(i, await decode(await blob.arrayBuffer()))
              return
            }
            const pads = S().pads.slice()
            pads[i] = { ...pads[i], custom: false, name: DEFAULT_KIT[i].name }
            set({ pads })
          }
          await loadDefault(i)
        } catch (error) {
          console.warn('sampler: could not load pad', i, error)
        }
      }),
    )
    set({ ready: true, loading: false })
  })()
  return initPromise
}

function setBuffer(i, buffer) {
  bufs.set(i, buffer)
  reversed.delete(i)
}

/** Put a sound on a pad: from a file, a recording or a drop. */
export async function loadBufferToPad(i, buffer, name) {
  setBuffer(i, buffer)
  try {
    await idb('readwrite', (st) => st.put(encodeWav(audioBufferToPcm(buffer), 16), `pad-${i}`))
  } catch (error) {
    toast({ title: 'Could not save this sound for next time', body: 'It will play now, but it is gone after a reload.', kind: 'error' })
  }
  const pads = S().pads.slice()
  pads[i] = { ...pads[i], custom: true, src: null, name: (name || 'My sound').slice(0, 24), params: { ...pads[i].params, start: 0, end: 1, reverse: false } }
  set({ pads })
  persist()
}

export async function loadFileToPad(i, file) {
  try {
    const buffer = await decode(await file.arrayBuffer())
    if (buffer.duration > 30) toast({ title: 'That is a long sound', body: 'Samples work best under 30 seconds. Trim it with the handles.', ms: 5000 })
    await loadBufferToPad(i, buffer, file.name.replace(/\.[^.]+$/, ''))
    return true
  } catch {
    toast({ title: 'Hmm, that file didn’t work', body: 'Try an MP3, WAV, FLAC, OGG or M4A file.', kind: 'error' })
    return false
  }
}

export async function resetPad(i) {
  try {
    await idb('readwrite', (st) => st.delete(`pad-${i}`))
  } catch { /* ignore */ }
  await loadDefault(i)
  reversed.delete(i)
  const pads = S().pads.slice()
  pads[i] = freshPad(i)
  set({ pads })
  persist()
}
export async function resetKit() {
  for (let i = 0; i < 16; i++) await resetPad(i)
}


// ── sound library (assets/sampler/manifest.json) ─────────────
let manifestPromise = null
/** { categories: [{id,name,row}], sounds: [{id,name,cat,file,dur,ch,factory?}] } */
export function loadManifest() {
  manifestPromise ??= fetch(new URL('../../../assets/sampler/manifest.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error('The sound library could not be loaded')
    return r.json()
  })
  return manifestPromise
}
const libBuffers = new Map() // sound id → decoded AudioBuffer (decoded once, only when you listen or use it)
export async function libraryBuffer(entry) {
  let b = libBuffers.get(entry.id)
  if (b) return b
  const res = await fetch(new URL(`../../../assets/sampler/${entry.file}`, import.meta.url))
  if (!res.ok) throw new Error(`Missing sound ${entry.file}`)
  b = await decode(await res.arrayBuffer())
  libBuffers.set(entry.id, b)
  return b
}
/** the label shown on a pad for a library sound: "Kick Punch", "Snare Crack", "Riser 2 s" */
export const padLabel = (entry) => {
  const sing = SINGULAR[entry.cat] ?? ''
  return (sing && !entry.name.toLowerCase().includes(sing.toLowerCase()) ? `${sing} ${entry.name}` : entry.name).slice(0, 24)
}

/** put a library sound on a pad (stored by reference: nothing is copied, it comes back after a reload) */
export async function assignLibrarySound(i, entry) {
  const buffer = await libraryBuffer(entry)
  try { await idb('readwrite', (st) => st.delete(`pad-${i}`)) } catch { /* nothing stored */ }
  setBuffer(i, buffer)
  const pads = S().pads.slice()
  pads[i] = { ...pads[i], custom: false, src: `lib:${entry.id}`, name: padLabel(entry), params: { ...pads[i].params, start: 0, end: 1, reverse: false } }
  set({ pads })
  persist()
}

let previewVoice = null
/** listen to a buffer without putting it on a pad; one preview at a time */
export function previewBuffer(buffer) {
  stopPreview()
  const { ctx, master: out, e } = output()
  void e.resume()
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const g = ctx.createGain()
  g.gain.value = 0.9
  src.connect(g).connect(out)
  const v = { src, g, onend: null }
  src.onended = () => { src.disconnect(); g.disconnect(); if (previewVoice === v) previewVoice = null; v.onend?.() }
  src.start(ctx.currentTime + 0.002)
  previewVoice = v
  return v
}
export function stopPreview() {
  const v = previewVoice
  if (!v) return
  previewVoice = null
  try { v.g.gain.setTargetAtTime(0, v.g.context.currentTime, 0.01); v.src.stop(v.g.context.currentTime + 0.05) } catch { /* ended */ }
}

// ── playback ─────────────────────────────────────────────────
let stage = null
let stageCtx = null
let master = null
function output() {
  const e = getEngine()
  if (!stage || stageCtx !== e.ctx) {
    stageCtx = e.ctx
    master = e.ctx.createGain()
    master.gain.value = 0.9
    stage = createOutputStage(e.ctx, e.externalInput)
    master.connect(stage.input)
  }
  return { ctx: e.ctx, master, stage, e }
}

/** live voices, so the editor can draw a playhead and gates/chokes can find them */
export const voices = new Set()
const hitListeners = new Set()
export const onVoice = (fn) => (hitListeners.add(fn), () => hitListeners.delete(fn))
const emit = (type, i) => hitListeners.forEach((fn) => fn(type, i))

function bufferFor(i) {
  const b = bufs.get(i)
  if (!b || !S().pads[i].params.reverse) return b
  let r = reversed.get(i)
  if (!r) {
    r = buffers.create(b.numberOfChannels, b.length, b.sampleRate)
    for (let c = 0; c < b.numberOfChannels; c++) r.copyToChannel(Float32Array.from(b.getChannelData(c)).reverse(), c)
    reversed.set(i, r)
  }
  return r
}

const cutoffHz = (v) => 120 * Math.pow(20000 / 120, v) // 0..1 → 120 Hz … 20 kHz

function fadeVoice(v, seconds, now) {
  if (v.ended) return
  const { ctx } = output()
  const t = now ?? ctx.currentTime
  v.gain.gain.cancelScheduledValues(t)
  v.gain.gain.setValueAtTime(v.gain.gain.value, t)
  v.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.006, seconds))
  try {
    v.src.stop(t + Math.max(0.006, seconds) + 0.02)
  } catch { /* already stopped */ }
}

/** play a pad. `vel` 0..1. Returns the voice (for gate release). */
export function trigger(i, vel = 0.85) {
  const b = bufferFor(i)
  if (!b) return null
  const { ctx, master: out, stage: st, e } = output()
  void e.resume()
  const p = S().pads[i].params
  const now = ctx.currentTime + 0.003

  // choke group: a hit silences the others in its group (closed / open hat)
  if (p.choke) for (const v of voices) if (v.pad !== i && S().pads[v.pad].params.choke === p.choke) fadeVoice(v, 0.012, now)
  // keep at most four voices per pad
  const mine = [...voices].filter((v) => v.pad === i)
  if (mine.length >= 4) fadeVoice(mine[0], 0.02, now)

  const rate = Math.pow(2, p.pitch / 12)
  const src = ctx.createBufferSource()
  src.buffer = b
  src.playbackRate.value = rate
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = cutoffHz(p.cutoff)
  filter.Q.value = 0.6
  const gain = ctx.createGain()
  const pan = ctx.createStereoPanner()
  pan.pan.value = p.pan
  const send = ctx.createGain()
  send.gain.value = p.reverb
  src.connect(filter).connect(gain).connect(pan)
  pan.connect(out)
  pan.connect(send).connect(st.reverbIn)

  const dur = b.duration
  const a = Math.min(dur, Math.max(0, p.start * dur))
  const z = Math.max(a + 0.005, Math.min(dur, p.end * dur))
  const level = Math.max(0.0001, vel * p.vol)
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(level, now + Math.max(0.002, p.attack))
  const v = { pad: i, src, gain, startedAt: now, rate, offset: a, length: z - a, loop: p.mode === 'loop', mode: p.mode, ended: false, release: p.release, level }
  if (p.mode === 'loop') {
    src.loop = true
    src.loopStart = a
    src.loopEnd = z
    src.start(now, a)
  } else {
    src.start(now, a)
    const playFor = (z - a) / rate
    const rel = Math.min(p.release, playFor * 0.9)
    gain.gain.setValueAtTime(level, now + Math.max(0.002, p.attack) + 0.0001)
    gain.gain.setValueAtTime(level, now + playFor - rel)
    gain.gain.linearRampToValueAtTime(0, now + playFor)
    src.stop(now + playFor + 0.03)
    v.endsAt = now + playFor
  }
  src.onended = () => {
    v.ended = true
    voices.delete(v)
    src.disconnect()
    filter.disconnect()
    gain.disconnect()
    pan.disconnect()
    send.disconnect()
    emit('end', i)
  }
  voices.add(v)
  emit('hit', i)
  return v
}

/** key / pointer released: gate and loop voices fade out with the release time */
export function release(i) {
  const { ctx } = output()
  for (const v of voices) if (v.pad === i && (v.mode === 'gate' || v.mode === 'loop') && !v.released) {
    v.released = true
    fadeVoice(v, v.release || 0.08, ctx.currentTime)
  }
}

export function stopAllVoices() {
  stopPreview()
  if (!stage) return
  for (const v of voices) fadeVoice(v, 0.03)
}

/** where the playhead of a pad's newest voice is, as 0..1 of the sample (or -1) */
export function playhead(i) {
  if (!stageCtx) return -1
  let best = null
  for (const v of voices) if (v.pad === i && (!best || v.startedAt > best.startedAt)) best = v
  if (!best) return -1
  const b = bufs.get(i)
  if (!b) return -1
  let t = (stageCtx.currentTime - best.startedAt) * best.rate
  if (t < 0) return -1
  if (best.loop) t = t % Math.max(0.001, best.length)
  else if (t > best.length) return -1
  return (best.offset + t) / b.duration
}

// ── bridge to the timeline ───────────────────────────────────
/** put the trimmed sound of a pad on its own track in the editor */
export function padToTimeline(i) {
  const b = bufferFor(i)
  if (!b) return false
  const p = S().pads[i].params
  const entry = buffers.add(b, S().pads[i].name)
  const s = useStore.getState()
  s.mutate('Add sampler sound', (draft) => {
    const t = makeTrack(draft, { name: S().pads[i].name })
    draft.tracks.push(t)
    draft.clips.push(makeClip({ trackId: t.id, bufferId: entry.id, offset: p.start * b.duration, duration: Math.max(0.01, (p.end - p.start) * b.duration), start: Math.max(0, s.transport.position || 0), name: S().pads[i].name, gain: p.vol, rate: Math.pow(2, p.pitch / 12) }))
  })
  toast({ title: `Added “${S().pads[i].name}” to the timeline`, kind: 'success', ms: 3500, action: { label: 'Open Edit', run: () => useStore.getState().setMode('edit') } })
  return true
}

// ── microphone ───────────────────────────────────────────────
let rec = null
export const isRecordingPad = () => !!rec
export async function startPadRecording(i, onDone) {
  if (rec) return false
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  } catch {
    toast({ title: 'No microphone access', body: 'Allow the microphone in your browser to record a sound.', kind: 'error' })
    return false
  }
  const chunks = []
  const mr = new MediaRecorder(stream)
  rec = { mr, stream, i }
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop())
    rec = null
    try {
      const buffer = await decode(await new Blob(chunks, { type: mr.mimeType }).arrayBuffer())
      await loadBufferToPad(i, buffer, 'Recording')
    } catch {
      toast({ title: 'That recording could not be read', kind: 'error' })
    }
    onDone?.()
  }
  mr.start()
  setTimeout(() => rec?.mr.state === 'recording' && rec.mr.stop(), 10_000) // 10 s max
  return true
}
export function stopPadRecording() {
  if (rec?.mr.state === 'recording') rec.mr.stop()
}
