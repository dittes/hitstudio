// DJ engine singleton: two decks + crossfader + recorder + Auto-DJ, running on
// the studio's AudioContext and feeding getEngine().externalInput (so the mix
// goes through master FX, meters and the visualiser).
//
// It keeps running when the DJ view unmounts (DJs switch views); call
// disposeDJ() to tear everything down.
import { buffers } from '../../core/buffers.js'
import { getEngine } from '../../core/engine.js'
import { makeClip, makeTrack, useStore } from '../../core/store.js'
import { toast } from '../../core/toast.js'
import { analyze } from './analysis.js'
import { Deck, EQ_MIN } from './deck.js'
import { DEMOS } from './demoLoops.js'
import { deckDefaults, useDJ,                                                            } from './state.js'

export function crateItems()              {
  const demos              = DEMOS.map((d) => ({ id: d.id, name: d.name, kind: 'demo', color: d.color, get: d.render }))
  const proj              = buffers.all().map((e) => ({
    id: `buf:${e.id}`,
    name: e.name,
    kind: 'project',
    duration: e.buffer.duration,
    get: async () => e.buffer,
  }))
  return [...demos, ...proj.reverse()]
}

export function findItem(id        )                        {
  return crateItems().find((c) => c.id === id)
}

export function xfGains(x        , curve         )                   {
  if (curve === 'linear') return [1 - x, x]
  if (curve === 'cut') {
    const e = 0.06
    return [x > 1 - e ? (1 - x) / e : 1, x < e ? x / e : 1]
  }
  return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)]
}

const ease = (t        ) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

export class DJEngine {
           ctx
           master
           decks
          timer = 0
          unsub
          auto                 = null
          rec                                                                                               = null
          loadToken = [0, 0]

  constructor() {
    const eng = getEngine()
    this.ctx = eng.ctx
    this.master = this.ctx.createGain()
    this.master.connect(eng.externalInput)
    this.decks = [new Deck(0, this.ctx, this.master), new Deck(1, this.ctx, this.master)]
    this.decks[0].other = this.decks[1]
    this.decks[1].other = this.decks[0]
    this.applyXf(useDJ.getState())
    this.unsub = useDJ.subscribe((s, prev) => {
      for (const i of [0, 1]         ) if (s.decks[i] !== prev.decks[i]) this.decks[i].applyParams(s.decks[i], prev.decks[i])
      if (s.xf !== prev.xf || s.curve !== prev.curve) this.applyXf(s)
    })
    this.timer = window.setInterval(this.tick, 25)
  }

          applyXf(s         ) {
    const [a, b] = xfGains(s.xf, s.curve)
    const now = this.ctx.currentTime
    this.decks[0].xf.gain.setTargetAtTime(a, now, 0.008)
    this.decks[1].xf.gain.setTargetAtTime(b, now, 0.008)
  }

          tick = () => {
    const now = this.ctx.currentTime
    this.decks[0].tick(now)
    this.decks[1].tick(now)
    if (this.auto) this.autoStep(now)
  }

  // ── loading ──────────────────────────────────────────────
  async load(i           , item           ) {
    const deck = this.decks[i]
    const st = useDJ.getState()
    if (st.auto && (st.auto.from === i || st.auto.to === i)) this.cancelAuto()
    const token = ++this.loadToken[i]
    deck.pause()
    const keep = st.decks[i]
    useDJ.getState().setDeck(i, {
      ...deckDefaults(),
      // keep the mixer settings, reset the track-specific ones
      trim: keep.trim,
      eq: keep.eq,
      kill: keep.kill,
      filter: keep.filter,
      res: keep.res,
      fader: keep.fader,
      echo: keep.echo,
      echoBeats: keep.echoBeats,
      flanger: keep.flanger,
      reverb: keep.reverb,
      range: keep.range,
      itemId: item.id,
      title: item.name,
      color: item.color ?? (i === 0 ? '#a78bfa' : '#f472b6'),
      loading: true,
    })
    try {
      const buf = await item.get()
      if (token !== this.loadToken[i]) return
      deck.setTrack(buf)
      useDJ.getState().setDeck(i, { loading: false, analyzing: true, duration: buf.duration })
      const a = await analyze(buf)
      if (token !== this.loadToken[i]) return
      deck.setAnalysis(a)
      useDJ.getState().setDeck(i, { analyzing: false, bpm: a.bpm, firstBeat: a.firstBeat, cue: a.firstBeat })
      deck.seek(a.firstBeat)
    } catch (e) {
      console.error(e)
      useDJ.getState().setDeck(i, { loading: false, analyzing: false, itemId: null, title: '' })
      toast({ title: 'Could not load that track', kind: 'error' })
    }
  }

  async loadFile(i           , file      ) {
    try {
      const data = await file.arrayBuffer()
      const entry = await buffers.decode(data, file.name.replace(/\.[^.]+$/, ''))
      await this.load(i, { id: `buf:${entry.id}`, name: entry.name, kind: 'project', get: async () => entry.buffer })
    } catch (e) {
      console.error(e)
      toast({ title: 'That file could not be decoded', body: 'Try MP3, WAV, FLAC, OGG or M4A.', kind: 'error' })
    }
  }

  // ── Auto-DJ / smooth transition ──────────────────────────
  async smoothTransition(bars = 16) {
    if (this.auto) {
      this.cancelAuto()
      toast('Transition cancelled')
      return
    }
    const [A, B] = this.decks
    const s = useDJ.getState()
    let from
    if (A.st.playing && B.st.playing) from = s.xf <= 0.5 ? 0 : 1
    else if (A.st.playing) from = 0
    else if (B.st.playing) from = 1
    else {
      toast({ title: 'Start a song first', body: 'Press ▶ on a deck, then try the smooth transition.' })
      return
    }
    const to = (1 - from)
    const fd = this.decks[from], td = this.decks[to]
    if (!td.loaded) {
      const other = DEMOS.find((d) => d.id !== fd.st.itemId) ?? DEMOS[0]
      toast(`Loading “${other.name}” on deck ${to ? 'B' : 'A'}…`)
      await this.load(to, { id: other.id, name: other.name, kind: 'demo', color: other.color, get: other.render })
      if (!td.loaded || !fd.st.playing) return
    }
    if (td.st.analyzing || fd.st.analyzing) return
    // how much room does the outgoing track have?
    const barSec = (4 * 60) / Math.max(40, fd.effectiveBpm || 120)
    const remain = (fd.duration - fd.position()) / Math.max(0.1, 1 + fd.st.tempo)
    bars = Math.max(4, Math.min(bars, Math.floor(remain / barSec) || 4))
    const fromSide = from === 0 ? 0 : 1
    const saved = { fromEq: [...fd.st.eq]                            , fromFilter: fd.st.filter, toEq: [...td.st.eq]                             }
    const set = useDJ.getState().setDeck
    // prepare incoming deck: bass out, fader up, synced, start on the grid
    set(to, { eq: [EQ_MIN, td.st.eq[1], td.st.eq[2]], kill: [false, false, false], fader: Math.max(td.st.fader, 0.8), filter: 0 })
    if (fd.st.fader < 0.5) set(from, { fader: 0.85 })
    useDJ.getState().set({ xf: fromSide })
    if (!td.st.playing) {
      td.seek(td.st.cue || td.st.firstBeat)
      td.syncNow()
      await td.play()
    } else td.syncNow()
    this.auto = { from, to, t0: this.ctx.currentTime, dur: bars * barSec, fromSide, saved }
    useDJ.getState().set({ auto: { from, to, progress: 0, bars } })
    toast({ title: `Smooth transition over ${bars} bars`, body: 'Sit back — HitStudio is mixing for you. Press again to cancel.' })
  }

          autoStep(now        ) {
    const a = this.auto
    const p = Math.min(1, (now - a.t0) / a.dur)
    const set = useDJ.getState().setDeck
    const toSide = 1 - a.fromSide
    const fd = this.decks[a.from]
    // crossfader: from-side → centre (0..50 %) → to-side (56..100 %)
    let xf
    if (p < 0.5) xf = a.fromSide + (0.5 - a.fromSide) * ease(p / 0.5)
    else if (p < 0.56) xf = 0.5
    else xf = 0.5 + (toSide - 0.5) * ease((p - 0.56) / 0.44)
    // bass swap around the middle (one bar)
    const swap = ease((p - 0.5) / 0.06)
    const toLow = EQ_MIN + (a.saved.toEq[0] - EQ_MIN) * swap
    const fromLow = a.saved.fromEq[0] + (EQ_MIN - a.saved.fromEq[0]) * swap
    // outgoing track gets a gentle high-pass in the second half
    const fromFilter = p > 0.6 ? a.saved.fromFilter + (0.45 - a.saved.fromFilter) * ease((p - 0.6) / 0.4) : a.saved.fromFilter
    useDJ.getState().set({ xf, auto: { ...useDJ.getState().auto , progress: p } })
    const fs = useDJ.getState().decks[a.from]
    const ts = useDJ.getState().decks[a.to]
    set(a.from, { eq: [fromLow, fs.eq[1], fs.eq[2]], filter: fromFilter })
    set(a.to, { eq: [toLow, ts.eq[1], ts.eq[2]] })
    if (p >= 1 || !fd.st.playing) {
      fd.pause()
      set(a.from, { eq: a.saved.fromEq, filter: a.saved.fromFilter, sync: false })
      set(a.to, { eq: a.saved.toEq })
      useDJ.getState().set({ xf: toSide, auto: null })
      this.auto = null
      toast({ title: 'Transition complete ✨', body: `Deck ${a.to ? 'B' : 'A'} is now playing.`, kind: 'success' })
    }
  }

  cancelAuto() {
    const a = this.auto
    if (!a) return
    this.auto = null
    const set = useDJ.getState().setDeck
    set(a.from, { filter: a.saved.fromFilter, eq: a.saved.fromEq })
    set(a.to, { eq: a.saved.toEq })
    useDJ.getState().set({ auto: null })
  }

  // ── recording the mix ────────────────────────────────────
  get recording() {
    return !!this.rec
  }
  async startRecording() {
    if (this.rec) return
    if (this.ctx.state !== 'running') await this.ctx.resume()
    const sp = this.ctx.createScriptProcessor(4096, 2, 2)
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    const rec = { sp, sink, chunks: [[], []]                    , frames: 0 }
    sp.onaudioprocess = (e) => {
      const ib = e.inputBuffer
      rec.chunks[0].push(new Float32Array(ib.getChannelData(0)))
      rec.chunks[1].push(new Float32Array(ib.getChannelData(ib.numberOfChannels > 1 ? 1 : 0)))
      rec.frames += ib.length
    }
    this.master.connect(sp)
    sp.connect(sink).connect(this.ctx.destination)
    this.rec = rec
    useDJ.getState().set({ rec: true, recStart: performance.now() })
  }

  /** Stops recording and adds the mix as a new track. Returns the duration in seconds. */
  stopRecording()         {
    const rec = this.rec
    if (!rec) return 0
    this.rec = null
    try {
      this.master.disconnect(rec.sp)
    } catch {}
    rec.sp.disconnect()
    rec.sink.disconnect()
    rec.sp.onaudioprocess = null
    useDJ.getState().set({ rec: false })
    if (rec.frames < this.ctx.sampleRate * 0.5) {
      toast('Recording too short — nothing added')
      return 0
    }
    // trim leading/trailing digital silence
    const L = concat(rec.chunks[0], rec.frames), R = concat(rec.chunks[1], rec.frames)
    let s = 0, e = rec.frames
    while (s < e && Math.abs(L[s]) < 1e-4 && Math.abs(R[s]) < 1e-4) s++
    while (e > s && Math.abs(L[e - 1]) < 1e-4 && Math.abs(R[e - 1]) < 1e-4) e--
    if (e - s < this.ctx.sampleRate * 0.25) {
      toast('The mix was silent — nothing added')
      return 0
    }
    const buf = buffers.create(2, e - s, this.ctx.sampleRate)
    buf.copyToChannel(L.subarray(s, e)                             , 0)
    buf.copyToChannel(R.subarray(s, e)                             , 1)
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const name = `DJ mix ${stamp}`
    const entry = buffers.add(buf, name)
    useStore.getState().mutate('Record DJ mix', (p) => {
      const t = makeTrack(p, { name: 'DJ Mix' })
      p.tracks.push(t)
      p.clips.push(makeClip({ trackId: t.id, bufferId: entry.id, duration: buf.duration, name }))
    })
    return buf.duration
  }

  dispose() {
    clearInterval(this.timer)
    this.unsub()
    if (this.rec) this.stopRecording()
    this.decks.forEach((d) => d.dispose())
    this.master.disconnect()
  }
}

function concat(chunks                , frames        ) {
  const out = new Float32Array(frames)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

let inst                  = null
export function getDJ()           {
  if (!inst) {
    inst = new DJEngine()
  }
  return inst
}
export function peekDJ()                  {
  return inst
}
/** Stop everything and free the audio graph (e.g. when a project is closed). */
export function disposeDJ() {
  inst?.dispose()
  inst = null
  useDJ.setState({ decks: [deckDefaults(), deckDefaults()], auto: null, rec: false })
}

