// Recording: mic → AudioWorklet (inline Blob module) → chunks → live-growing clip.
// Falls back to ScriptProcessor where AudioWorklet is unavailable.
import { create } from 'zustand'
import { buffers } from '../../core/buffers'
import { getEngine } from '../../core/engine'
import { uid } from '../../core/ids'
import { makeClip, makeTrack, useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { burst } from '../../ui/kit'
import { ioSet } from './state'

// ── persistent settings ─────────────────────────────────────
export interface RecSettings {
  deviceId: string
  /** noise suppression + echo cancellation (browser DSP). Off = purest sound. */
  clean: boolean
  monitor: boolean
  countIn: boolean
  mode: 'voice' | 'music'
}
const KEY = 'bloom.rec.settings'
const DEFAULTS: RecSettings = { deviceId: '', clean: false, monitor: false, countIn: false, mode: 'voice' }
function load(): RecSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return DEFAULTS
  }
}
export const useRecSettings = create<RecSettings & { patch: (p: Partial<RecSettings>) => void }>((set, get) => ({
  ...load(),
  patch(p) {
    set(p)
    const { deviceId, clean, monitor, countIn, mode } = get()
    localStorage.setItem(KEY, JSON.stringify({ deviceId, clean, monitor, countIn, mode }))
  },
}))

// ── live state for the HUD ──────────────────────────────────
export const useRec = create<{
  phase: 'idle' | 'starting' | 'countin' | 'recording'
  beat: number
  beats: number
  elapsed: number
  analyser: AnalyserNode | null
}>(() => ({ phase: 'idle', beat: 0, beats: 4, elapsed: 0, analyser: null }))
const setRec = (p: Partial<ReturnType<typeof useRec.getState>>) => useRec.setState(p)

export function micConstraints(s: RecSettings): MediaStreamConstraints {
  return {
    audio: {
      deviceId: s.deviceId ? { exact: s.deviceId } : undefined,
      echoCancellation: s.clean,
      noiseSuppression: s.clean,
      autoGainControl: false,
      channelCount: s.mode === 'voice' ? 1 : 2,
    },
  }
}

export function micErrorMessage(e: unknown): { title: string; body: string } {
  const name = (e as DOMException)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return { title: 'Microphone is blocked', body: 'Click the lock icon next to the web address and allow the microphone, then try again.' }
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return { title: 'No microphone found', body: 'Plug one in (or pick another input in Recording setup) and try again.' }
  if (name === 'NotReadableError') return { title: 'Microphone is busy', body: 'Another app may be using it. Close it and try again.' }
  return { title: 'Couldn’t start recording', body: String((e as Error)?.message ?? e) }
}

// ── worklet source ──────────────────────────────────────────
const WORKLET_SRC = `
class BloomRec extends AudioWorkletProcessor {
  constructor(o) {
    super()
    this.nch = o.processorOptions.channels
    this.size = 4096
    this.on = false
    this.reset()
    this.port.onmessage = (e) => {
      if (e.data === 'start') this.on = true
      else if (e.data === 'stop') { this.on = false; this.send(); this.port.postMessage('done') }
    }
  }
  reset() { this.bufs = Array.from({ length: this.nch }, () => new Float32Array(this.size)); this.pos = 0 }
  send() {
    if (!this.pos) return
    const ch = this.bufs.map((b) => b.slice(0, this.pos))
    this.port.postMessage({ ch }, ch.map((c) => c.buffer))
    this.reset()
  }
  process(inputs) {
    if (!this.on) return true
    const inp = inputs[0] || []
    const n = inp[0] ? inp[0].length : 128
    for (let c = 0; c < this.nch; c++) { const s = inp[c] || inp[0]; if (s) this.bufs[c].set(s, this.pos) }
    this.pos += n
    if (this.pos + 128 > this.size) this.send()
    return true
  }
}
registerProcessor('bloom-rec', BloomRec)
`
const loaded = new WeakSet<BaseAudioContext>()
async function ensureWorklet(ctx: AudioContext) {
  if (loaded.has(ctx)) return
  const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
    loaded.add(ctx)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── session ─────────────────────────────────────────────────
interface Session {
  stream: MediaStream
  src: MediaStreamAudioSourceNode
  sink: GainNode
  node: AudioNode
  nch: number
  chunks: Float32Array[][]
  total: number
  cancelled: boolean
  stopping: boolean
  takeKey: string
  bufferId: string
  clipId: string | null
  trackId: string | null
  createdTrack: boolean
  armedTrack: string | null
  startPos: number
  clipStart: number
  clipOffset: number
  sampleRate: number
  timers: number[]
  off: (() => void) | null
  capture: (on: boolean) => void
  finish: () => Promise<void>
  monitorGain: GainNode | null
  overdub: boolean
  lastLive: number
}
let session: Session | null = null

export const isRecording = () => session !== null

function concat(s: Session, upto = s.total): AudioBuffer {
  const out = new AudioBuffer({ numberOfChannels: s.nch, length: Math.max(1, upto), sampleRate: s.sampleRate })
  for (let c = 0; c < s.nch; c++) {
    const dst = new Float32Array(upto)
    let o = 0
    for (const ch of s.chunks) {
      const src = ch[c] ?? ch[0]
      const n = Math.min(src.length, upto - o)
      if (n <= 0) break
      dst.set(n === src.length ? src : src.subarray(0, n), o)
      o += n
    }
    out.copyToChannel(dst, c)
  }
  return out
}

function updateClip(s: Session, final = false) {
  const buf = concat(s)
  buffers.add(buf, 'Recording', s.bufferId)
  const dur = Math.max(0.05, buf.duration - s.clipOffset)
  const st = useStore.getState()
  st.mutate(
    'Record',
    (p) => {
      let trackId = s.trackId
      if (!trackId) {
        const tr = makeTrack(p as never, { name: p.tracks.some((t) => t.name.startsWith('Recording')) ? `Recording ${p.tracks.length + 1}` : 'Recording' })
        p.tracks.push(tr)
        trackId = tr.id
        s.trackId = trackId
        s.createdTrack = true
      }
      let clip = s.clipId ? p.clips.find((c) => c.id === s.clipId) : undefined
      if (!clip) {
        const c = makeClip({ trackId, bufferId: s.bufferId, duration: dur, name: 'Take', start: s.clipStart, offset: s.clipOffset })
        if (!final) c.recording = true
        s.clipId = c.id
        p.clips.push(c)
      } else {
        clip.duration = dur
        if (final) delete clip.recording
        else clip.recording = true
      }
    },
    { coalesce: s.takeKey },
  )
}

function cleanup(s: Session) {
  s.timers.forEach((t) => clearInterval(t))
  s.timers = []
  s.off?.()
  s.off = null
  try {
    s.node.disconnect()
    s.src.disconnect()
    s.sink.disconnect()
    s.monitorGain?.disconnect()
  } catch {}
  s.stream.getTracks().forEach((t) => t.stop())
  setRec({ phase: 'idle', analyser: null, elapsed: 0, beat: 0 })
  useStore.getState().setTransport({ recording: false })
}

export async function toggleRecording() {
  const ph = useRec.getState().phase
  if (ph === 'recording' || ph === 'countin') return stopRecording()
  if (ph === 'starting') return
  if (!localStorage.getItem('bloom.rec.setupSeen')) {
    ioSet({ recSetupOpen: true })
    return
  }
  await startRecording()
}

export async function startRecording() {
  if (session || useRec.getState().phase !== 'idle') return
  const cfg = useRecSettings.getState()
  localStorage.setItem('bloom.rec.setupSeen', '1')
  ioSet({ recSetupOpen: false })
  setRec({ phase: 'starting' })
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(micConstraints(cfg))
  } catch (e) {
    setRec({ phase: 'idle' })
    toast({ ...micErrorMessage(e), kind: 'error', ms: 6000 })
    return
  }
  const eng = getEngine()
  await eng.resume()
  const ctx = eng.ctx
  const st = useStore.getState()
  const track = stream.getAudioTracks()[0]
  const nch = Math.max(1, Math.min(2, track?.getSettings().channelCount ?? (cfg.mode === 'voice' ? 1 : 2)))
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  src.connect(analyser)
  const sink = ctx.createGain()
  sink.gain.value = 0
  sink.connect(ctx.destination)

  const s: Session = {
    stream, src, sink, nch,
    node: sink,
    chunks: [], total: 0, cancelled: false, stopping: false,
    takeKey: `rec-${uid('t')}`,
    bufferId: uid('buf'),
    clipId: null, trackId: null, createdTrack: false,
    armedTrack: st.project.tracks.find((t) => t.armed && t.kind === 'audio')?.id ?? null,
    startPos: 0, clipStart: 0, clipOffset: 0,
    sampleRate: ctx.sampleRate,
    timers: [], off: null,
    capture: () => {},
    finish: async () => {},
    monitorGain: null,
    overdub: st.project.clips.length > 0,
    lastLive: 0,
  }
  s.trackId = s.armedTrack

  // capture node
  let workletOk = false
  try {
    await ensureWorklet(ctx)
    const node = new AudioWorkletNode(ctx, 'bloom-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: nch, channelCountMode: 'explicit', outputChannelCount: [nch], processorOptions: { channels: nch } })
    let resolveDone: (() => void) | null = null
    node.port.onmessage = (e) => {
      if (e.data === 'done') resolveDone?.()
      else if (e.data?.ch) {
        s.chunks.push(e.data.ch as Float32Array[])
        s.total += e.data.ch[0].length
      }
    }
    src.connect(node)
    node.connect(sink)
    s.node = node
    s.capture = (on) => node.port.postMessage(on ? 'start' : 'stop')
    s.finish = () =>
      new Promise<void>((res) => {
        resolveDone = res
        node.port.postMessage('stop')
        setTimeout(res, 600)
      })
    workletOk = true
  } catch (e) {
    console.warn('AudioWorklet unavailable, falling back to ScriptProcessor', e)
  }
  if (!workletOk) {
    const sp = ctx.createScriptProcessor(4096, nch, nch)
    let on = false
    sp.onaudioprocess = (ev) => {
      if (!on) return
      const ch: Float32Array[] = []
      for (let c = 0; c < nch; c++) ch.push(ev.inputBuffer.getChannelData(Math.min(c, ev.inputBuffer.numberOfChannels - 1)).slice())
      s.chunks.push(ch)
      s.total += ch[0].length
    }
    src.connect(sp)
    sp.connect(sink)
    s.node = sp
    s.capture = (v) => (on = v)
    s.finish = async () => {
      on = false
    }
  }
  if (cfg.monitor) {
    s.monitorGain = ctx.createGain()
    s.monitorGain.gain.value = 0.9
    src.connect(s.monitorGain)
    s.monitorGain.connect(eng.externalInput)
  }
  session = s
  setRec({ analyser, phase: 'countin', elapsed: 0 })

  // react to the user pressing Space/Esc etc. during recording
  s.off = eng.on((e) => {
    if (e === 'stop' && session === s && !s.stopping && useRec.getState().phase === 'recording') void stopRecording()
  })

  // ── count-in (one bar of clicks) ──
  if (cfg.countIn) {
    const p = useStore.getState().project
    const beats = p.timeSig[0]
    const beatDur = 60 / p.bpm
    const t0 = ctx.currentTime + 0.12
    setRec({ beats, beat: 0 })
    for (let i = 0; i < beats; i++) {
      const when = t0 + i * beatDur
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = i === 0 ? 1600 : 1000
      g.gain.setValueAtTime(0.0001, when)
      g.gain.exponentialRampToValueAtTime(0.4, when + 0.003)
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
      o.connect(g).connect(ctx.destination)
      o.start(when)
      o.stop(when + 0.08)
      s.timers.push(window.setTimeout(() => !s.cancelled && setRec({ beat: i + 1 }), (when - ctx.currentTime) * 1000))
    }
    await new Promise<void>((res) => setTimeout(res, (t0 + beats * beatDur - ctx.currentTime) * 1000))
    if (s.cancelled) return
  }

  // ── go! ──
  s.startPos = eng.position
  const tCap = ctx.currentTime
  s.capture(true)
  st.setTransport({ recording: true })
  await eng.play(s.startPos)
  const startCtx = ctx.currentTime - (eng.position - s.startPos)
  const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + ((track?.getSettings() as { latency?: number })?.latency ?? 0)
  const shift = startCtx - tCap + lat
  if (shift >= 0) {
    s.clipStart = s.startPos
    s.clipOffset = shift
  } else {
    s.clipStart = s.startPos - shift
    s.clipOffset = 0
  }
  setRec({ phase: 'recording' })
  const t = performance.now()
  s.timers.push(
    window.setInterval(() => {
      if (session !== s) return
      const elapsed = (performance.now() - t) / 1000
      setRec({ elapsed })
      // live growing clip – gentler when other clips are playing (the engine re-schedules on every change)
      const every = Math.min(4, Math.max(s.overdub ? 1.5 : 0.5, elapsed * 0.08))
      if (s.total / s.sampleRate > s.clipOffset + 0.25 && elapsed - s.lastLive >= every) {
        s.lastLive = elapsed
        updateClip(s)
      }
    }, 120),
  )
}

export async function stopRecording() {
  const s = session
  if (!s || s.stopping) return
  s.stopping = true
  if (useRec.getState().phase === 'countin') {
    s.cancelled = true
    cleanup(s)
    session = null
    return
  }
  await s.finish()
  const eng = getEngine()
  eng.stop()
  const secs = s.total / s.sampleRate - s.clipOffset
  cleanup(s)
  session = null
  if (secs < 0.2) {
    if (s.clipId)
      useStore.getState().mutate('Record', (p) => {
        p.clips = p.clips.filter((c) => c.id !== s.clipId)
        if (s.createdTrack) p.tracks = p.tracks.filter((t) => t.id !== s.trackId)
      })
    toast({ title: 'That was a very short take', body: 'Press R, say or play something, then press R again.' })
    return
  }
  updateClip(s, true)
  const st = useStore.getState()
  // name the take after the track
  const tr = st.project.tracks.find((t) => t.id === s.trackId)
  const takes = st.project.clips.filter((c) => c.trackId === s.trackId).length
  st.mutate('Name take', (p) => {
    const c = p.clips.find((x) => x.id === s.clipId)
    if (c) c.name = `${tr?.name ?? 'Take'} ${takes}`
  }, { coalesce: s.takeKey })
  st.select({ clipIds: s.clipId ? [s.clipId] : [], trackIds: s.trackId ? [s.trackId] : [] })
  toast({ title: 'Nice take! 🎙️', body: 'Press Space to listen back. Don’t like it? ⌘Z and try again.', kind: 'celebrate' })
  burst(window.innerWidth / 2, window.innerHeight - 90)
}
