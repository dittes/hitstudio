// ─────────────────────────────────────────────────────────────
// AudioEngine – plays the project through the Web Audio graph.
//
//   clip sources ─► track.input ─► [insert effects] ─► pan ─► volume ─► track.analyser ─┐
//                                                                                       ▼
//   engine.externalInput (DJ decks, instruments, previews) ─────────────────────► masterIn
//   masterIn ─► [master effects] ─► masterGain ─► masterAnalyser ─► safety limiter ─► out
//
// The same graph builder is used with an OfflineAudioContext for export.
//
// Smooth UI (playheads, meters, visualisers) should poll `engine.position`
// / analysers inside requestAnimationFrame. The store's transport.position is
// only updated ~15×/s to keep React renders cheap.
// ─────────────────────────────────────────────────────────────
import { buffers, setDecodeContext } from './buffers.js'
import { getEffect,                 } from './effects/registry.js'
import { projectDuration, useStore } from './store.js'

const chainKey = (fx                  ) => fx.map((f) => `${f.id}:${f.type}:${f.bypass ? 0 : 1}`).join('|')

function buildChain(ctx                  , from           , to           , fx                  )              {
  const slots              = []
  let cur            = from
  for (const inst of fx) {
    if (inst.bypass) continue
    const def = getEffect(inst.type)
    if (!def) continue
    try {
      const node = def.create(ctx, inst.params)
      cur.connect(node.input)
      cur = node.output
      slots.push({ inst, node })
    } catch (e) {
      console.warn('effect failed', inst.type, e)
    }
  }
  cur.connect(to)
  return slots
}

function soloActive(p         ) {
  return p.tracks.some((t) => t.solo)
}
function effectiveGain(t       , anySolo         ) {
  if (t.mute) return 0
  if (anySolo && !t.solo) return 0
  return t.volume
}

function buildTrack(ctx                  , t       , dest           , anySolo         )             {
  const input = ctx.createGain()
  const pan = ctx.createStereoPanner()
  const volume = ctx.createGain()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.6
  pan.pan.value = t.pan
  volume.gain.value = effectiveGain(t, anySolo)
  const chain = buildChain(ctx, input, pan, t.effects)
  pan.connect(volume)
  volume.connect(analyser)
  volume.connect(dest)
  return { input, chain, pan, volume, analyser, out: volume }
}

export function buildMixGraph(ctx                  , p         , destination           )           {
  const masterIn = ctx.createGain()
  const masterGain = ctx.createGain()
  const masterAnalyser = ctx.createAnalyser()
  masterAnalyser.fftSize = 4096
  masterAnalyser.smoothingTimeConstant = 0.78
  masterGain.gain.value = p.master.volume
  const masterChain = buildChain(ctx, masterIn, masterGain, p.master.effects)
  // gentle safety limiter so beginners never blow their ears out
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.1
  masterGain.connect(masterAnalyser)
  masterGain.connect(limiter)
  limiter.connect(destination)
  const anySolo = soloActive(p)
  const tracks = new Map                    ()
  for (const t of p.tracks) tracks.set(t.id, buildTrack(ctx, t, masterIn, anySolo))
  return { ctx, tracks, masterIn, masterChain, masterGain, masterAnalyser, out: limiter }
}

/** Schedule one clip into a track graph. Returns the source (or null if out of range). */
function scheduleClip(
  ctx                  ,
  clip      ,
  dest           ,
  playFrom        ,
  ctxStart        ,
  until = Infinity,
)                               {
  if (clip.recording) return null
  const entry = buffers.get(clip.bufferId)
  if (!entry) return null
  const rate = clip.rate || 1
  const tlDur = clip.duration / rate
  const clipEnd = clip.start + tlDur
  if (clipEnd <= playFrom || clip.start >= until) return null
  const skipped = Math.max(0, playFrom - clip.start) // timeline seconds already passed
  const when = ctxStart + Math.max(0, clip.start - playFrom)
  const bufOffset = clip.offset + skipped * rate
  let bufDur = clip.duration - skipped * rate
  if (until < clipEnd) bufDur -= (clipEnd - until) * rate
  if (bufDur <= 0.0005) return null

  const src = ctx.createBufferSource()
  src.buffer = entry.buffer
  src.playbackRate.value = rate
  const g = ctx.createGain()
  // gain envelope with fades (timeline seconds)
  const gp = g.gain
  const tStart = when - skipped // ctx time at which clip.start would be
  const fi = Math.min(clip.fadeIn, tlDur)
  const fo = Math.min(clip.fadeOut, tlDur)
  gp.setValueAtTime(clip.gain, ctxStart)
  if (fi > 0) {
    const atNow = Math.min(1, skipped / fi)
    gp.setValueAtTime(clip.gain * atNow, Math.max(when, ctxStart))
    if (atNow < 1) gp.linearRampToValueAtTime(clip.gain, tStart + fi)
  }
  if (fo > 0) {
    const foStart = tStart + tlDur - fo
    if (foStart > ctxStart) gp.setValueAtTime(clip.gain, foStart)
    gp.linearRampToValueAtTime(0.0001, tStart + tlDur)
  }
  src.connect(g).connect(dest)
  src.start(when, bufOffset, bufDur)
  return src
}

export class AudioEngine {
           ctx
  /** connect DJ decks / instruments / previews here – goes through the master bus */
           externalInput
          graph
          sources = new Map                               ()
          playing = false
          startCtxTime = 0
          startPos = 0
          pausedPos = 0
          raf = 0
          lastStoreUpdate = 0
          builtKeys = new Map                ()
          builtMasterKey = ''
          builtTrackIds = ''
          clipsRef         = []
          metronomeTimer = 0
          nextClick = 0
          listeners = new Set                                                ()

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    setDecodeContext(this.ctx)
    this.externalInput = this.ctx.createGain()
    this.graph = buildMixGraph(this.ctx, useStore.getState().project, this.ctx.destination)
    this.externalInput.connect(this.graph.masterIn)
    this.rememberBuild(useStore.getState().project)
    useStore.subscribe((s, prev) => {
      if (s.project !== prev.project) this.sync(s.project, prev.project)
    })
  }

  // ── public API ────────────────────────────────────────────
  get isPlaying() {
    return this.playing
  }
  /** current playhead in timeline seconds (smooth, call every frame) */
  get position()         {
    if (!this.playing) return this.pausedPos
    return this.startPos + (this.ctx.currentTime - this.startCtxTime)
  }
  get masterAnalyser()               {
    return this.graph.masterAnalyser
  }
  /** where to connect live sources so they go through master FX + meters */
  get masterInput()            {
    return this.graph.masterIn
  }
  trackAnalyser(trackId        )                           {
    return this.graph.tracks.get(trackId)?.analyser
  }
  /** Live track input – e.g. to monitor a mic through the track's FX */
  trackInput(trackId        )                        {
    return this.graph.tracks.get(trackId)?.input
  }
  /** Live access to an effect node instance (for effect UIs that draw meters) */
  effectNode(effectId        )                         {
    for (const tg of this.graph.tracks.values()) for (const s of tg.chain) if (s.inst.id === effectId) return s.node
    for (const s of this.graph.masterChain) if (s.inst.id === effectId) return s.node
  }

  on(fn                                                ) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
          emit(e                                   ) {
    this.listeners.forEach((l) => l(e))
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  async play(from         ) {
    await this.resume()
    if (this.playing) this.stopSources()
    const p = useStore.getState().project
    let pos = from ?? this.pausedPos
    if (p.loop.enabled && (pos >= p.loop.end || pos < p.loop.start) && from === undefined) pos = p.loop.start
    this.startPos = Math.max(0, pos)
    this.startCtxTime = this.ctx.currentTime + 0.03
    this.playing = true
    this.scheduleAll(p)
    this.nextClick = this.startCtxTime
    this.tick()
    this.startMetronome()
    useStore.getState().setTransport({ playing: true, position: this.startPos })
    this.emit('play')
  }

  pause() {
    if (!this.playing) return
    this.pausedPos = this.position
    this.halt()
    useStore.getState().setTransport({ playing: false, position: this.pausedPos })
    this.emit('stop')
  }

  /** stop and return to where playback started (beginner-friendly behaviour) */
  stop(returnToStart = true) {
    const back = this.startPos
    const wasPlaying = this.playing
    if (this.playing) this.halt()
    this.pausedPos = returnToStart && wasPlaying ? back : this.pausedPos
    useStore.getState().setTransport({ playing: false, position: this.pausedPos })
    this.emit('stop')
  }

  toggle() {
    this.playing ? this.pause() : this.play()
  }

  seek(t        ) {
    t = Math.max(0, t)
    if (this.playing) {
      this.play(t)
    } else {
      this.pausedPos = t
      useStore.getState().setTransport({ position: t })
    }
    this.emit('seek')
  }

  /** Render a range of the project to an AudioBuffer (used by export / bounce). */
  async render(opts

    = {})                       {
    const base = useStore.getState().project
    let p = base
    if (opts.trackIds) {
      const keep = new Set(opts.trackIds)
      p = { ...base, tracks: base.tracks.map((t) => ({ ...t, solo: false, mute: !keep.has(t.id) })) }
    }
    if (opts.includeMasterFx === false) p = { ...p, master: { ...p.master, effects: [] } }
    const start = opts.start ?? 0
    const end = opts.end ?? Math.max(projectDuration(p), start + 0.1)
    const tail = opts.tail ?? 0
    const sr = opts.sampleRate ?? p.sampleRate
    const ch = opts.channels ?? 2
    const len = Math.ceil((end - start + tail) * sr)
    const off = new OfflineAudioContext(ch, Math.max(1, len), sr)
    const g = buildMixGraph(off, p, off.destination)
    for (const c of p.clips) {
      const tg = g.tracks.get(c.trackId)
      if (tg) scheduleClip(off, c, tg.input, start, 0, end)
    }
    return off.startRendering()
  }

  /** Play a buffer directly (library/preview). Returns a stop function. */
  preview(buffer             , offset = 0)             {
    this.resume()
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.externalInput)
    src.start(0, offset)
    return () => {
      try {
        src.stop()
      } catch {}
    }
  }

  // ── internals ─────────────────────────────────────────────
          halt() {
    this.playing = false
    this.stopSources()
    cancelAnimationFrame(this.raf)
    clearInterval(this.metronomeTimer)
  }

          stopSources() {
    for (const s of this.sources.values()) {
      try {
        s.stop()
        s.disconnect()
      } catch {}
    }
    this.sources.clear()
  }

          scheduleAll(p         ) {
    this.clipsRef = p.clips
    const until = p.loop.enabled ? p.loop.end : Infinity
    if (this.ctx.currentTime > this.startCtxTime) {
      // re-scheduling mid-playback: re-anchor the clock 30ms ahead (position stays continuous)
      const at = this.ctx.currentTime + 0.03
      this.startPos = this.position + 0.03
      this.startCtxTime = at
    }
    for (const c of p.clips) {
      const tg = this.graph.tracks.get(c.trackId)
      if (!tg) continue
      const src = scheduleClip(this.ctx, c, tg.input, this.startPos, this.startCtxTime, until)
      if (src) this.sources.set(c.id, src)
    }
  }

          rescheduleChanged(p         ) {
    const old = new Map(this.clipsRef.map((c) => [c.id, c]))
    this.clipsRef = p.clips
    const until = p.loop.enabled ? p.loop.end : Infinity
    const at = this.ctx.currentTime + 0.02
    const pos = this.startPos + (at - this.startCtxTime)
    const seen = new Set        ()
    for (const c of p.clips) {
      seen.add(c.id)
      if (old.get(c.id) === c) continue
      const prevSrc = this.sources.get(c.id)
      if (prevSrc) {
        try { prevSrc.stop(); prevSrc.disconnect() } catch {}
        this.sources.delete(c.id)
      }
      const tg = this.graph.tracks.get(c.trackId)
      if (!tg) continue
      const src = scheduleClip(this.ctx, c, tg.input, pos, at, until)
      if (src) this.sources.set(c.id, src)
    }
    for (const [id, src] of this.sources) {
      if (!seen.has(id)) {
        try { src.stop(); src.disconnect() } catch {}
        this.sources.delete(id)
      }
    }
  }

          tick = () => {
    if (!this.playing) return
    const pos = this.position
    const p = useStore.getState().project
    if (p.loop.enabled && pos >= p.loop.end) {
      this.play(p.loop.start)
      this.emit('loop')
      return
    }
    const dur = projectDuration(p)
    if (!p.loop.enabled && dur > 0 && pos > dur + 0.5 && !useStore.getState().transport.recording) {
      this.pausedPos = dur
      this.halt()
      useStore.getState().setTransport({ playing: false, position: dur })
      this.emit('stop')
      return
    }
    const now = performance.now()
    if (now - this.lastStoreUpdate > 66) {
      this.lastStoreUpdate = now
      useStore.getState().setTransport({ position: pos })
    }
    this.raf = requestAnimationFrame(this.tick)
  }

          startMetronome() {
    clearInterval(this.metronomeTimer)
    this.metronomeTimer = window.setInterval(() => {
      if (!useStore.getState().transport.metronome || !this.playing || !['edit', 'create'].includes(useStore.getState().ui.mode)) return
      const p = useStore.getState().project
      const beat = 60 / p.bpm
      const ahead = this.ctx.currentTime + 0.12
      // align to grid
      const pos0 = this.startPos
      while (this.nextClick < ahead) {
        const tl = pos0 + (this.nextClick - this.startCtxTime)
        const beatIdx = Math.round(tl / beat)
        const gridTime = this.startCtxTime + (beatIdx * beat - pos0)
        if (gridTime >= this.ctx.currentTime - 0.01) this.click(gridTime, beatIdx % p.timeSig[0] === 0)
        this.nextClick = this.startCtxTime + ((beatIdx + 1) * beat - pos0)
      }
    }, 25)
  }

          click(when        , accent         ) {
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.frequency.value = accent ? 1600 : 1000
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(0.35, when + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
    o.connect(g).connect(this.ctx.destination)
    o.start(when)
    o.stop(when + 0.06)
  }

          rememberBuild(p         ) {
    this.builtKeys.clear()
    p.tracks.forEach((t) => this.builtKeys.set(t.id, chainKey(t.effects)))
    this.builtMasterKey = chainKey(p.master.effects)
    this.builtTrackIds = p.tracks.map((t) => t.id).join(',')
  }

  /** Bring the live graph in line with the project with minimal disruption. */
          sync(p         , prev         ) {
    const g = this.graph
    const ids = p.tracks.map((t) => t.id).join(',')
    if (ids !== this.builtTrackIds) {
      // track added/removed: create/destroy those track graphs
      const anySolo = soloActive(p)
      for (const t of p.tracks) {
        if (!g.tracks.has(t.id)) {
          g.tracks.set(t.id, buildTrack(this.ctx, t, g.masterIn, anySolo))
          this.builtKeys.set(t.id, chainKey(t.effects))
        }
      }
      for (const [id, tg] of g.tracks) {
        if (!p.tracks.find((t) => t.id === id)) {
          tg.volume.disconnect()
          tg.chain.forEach((s) => s.node.dispose())
          g.tracks.delete(id)
          this.builtKeys.delete(id)
        }
      }
      this.builtTrackIds = ids
    }
    const anySolo = soloActive(p)
    const now = this.ctx.currentTime
    for (const t of p.tracks) {
      const tg = g.tracks.get(t.id)
      if (!tg) continue
      tg.volume.gain.setTargetAtTime(effectiveGain(t, anySolo), now, 0.015)
      tg.pan.pan.setTargetAtTime(t.pan, now, 0.015)
      const key = chainKey(t.effects)
      if (key !== this.builtKeys.get(t.id)) {
        tg.input.disconnect()
        tg.chain.forEach((s) => {
          try {
            s.node.output.disconnect()
          } catch {}
          s.node.dispose()
        })
        tg.chain = buildChain(this.ctx, tg.input, tg.pan, t.effects)
        this.builtKeys.set(t.id, key)
      } else {
        // same structure: push param changes live
        tg.chain.forEach((s) => {
          const inst = t.effects.find((e) => e.id === s.inst.id)
          if (inst && inst.params !== s.inst.params) {
            s.node.update(inst.params)
            s.inst = inst
          }
        })
      }
    }
    g.masterGain.gain.setTargetAtTime(p.master.volume, now, 0.015)
    const mk = chainKey(p.master.effects)
    if (mk !== this.builtMasterKey) {
      g.masterIn.disconnect()
      g.masterChain.forEach((s) => {
        try {
          s.node.output.disconnect()
        } catch {}
        s.node.dispose()
      })
      g.masterChain = buildChain(this.ctx, g.masterIn, g.masterGain, p.master.effects)
      this.builtMasterKey = mk
    } else {
      g.masterChain.forEach((s) => {
        const inst = p.master.effects.find((e) => e.id === s.inst.id)
        if (inst && inst.params !== s.inst.params) {
          s.node.update(inst.params)
          s.inst = inst
        }
      })
    }
    // clips changed while playing → reschedule only the clips that changed
    if (this.playing && p.clips !== this.clipsRef) this.rescheduleChanged(p)
    if (p.loop !== prev.loop && this.playing && p.loop.enabled) {
      this.stopSources()
      this.scheduleAll(p)
    }
  }
}

let _engine                     = null
/** Lazily created singleton. Safe to call anywhere after first user gesture. */
export function getEngine()              {
  if (!_engine) _engine = new AudioEngine()
  return _engine
}
