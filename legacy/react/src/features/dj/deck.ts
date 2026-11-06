// One DJ deck: AudioBufferSourceNode playback with precise, self-tracked
// position (rate changes / ramps are integrated over time), loops, beat rolls
// (slip mode), cue + hot cues, sync, scratch, brake / spinback, and the channel
// strip (trim → 3-band kill EQ → LP/HP filter → fader → crossfader → FX sends).
//
//   src ─► srcGain ─► trim ─┬► low  (LP×2)      ─► gL ─┐
//                           ├► mid  (HP×2,LP×2) ─► gM ─┼► eqSum ─► lp ─► hp ─┬► analyser (PFL meter)
//                           └► high (HP×2)      ─► gH ─┘                     └► fader ─► xf ─► post
//   post ─► out (dry) · post ─► echo (delay ⇄ fb+tone) ─► out
//   post ─► flanger (LFO-modulated short delay ⇄ fb) ─► out · post ─► reverb send ─► convolver ─► out
import type { TrackAnalysis } from './analysis'
import { deckState, useDJ, type DeckIndex, type DeckState, type LoopRegion } from './state'

const dbToGain = (db: number) => Math.pow(10, db / 20)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** audio seconds per platter revolution (33⅓ rpm) */
export const SEC_PER_REV = 1.8
export const EQ_MIN = -26

const reverseCache = new WeakMap<AudioBuffer, AudioBuffer>()
function reversedBuffer(buf: AudioBuffer): AudioBuffer {
  let r = reverseCache.get(buf)
  if (!r) {
    r = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate })
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = new Float32Array(buf.getChannelData(c))
      d.reverse()
      r.copyToChannel(d, c)
    }
    reverseCache.set(buf, r)
  }
  return r
}

function impulse(ctx: BaseAudioContext, secs: number) {
  const len = Math.floor(ctx.sampleRate * secs)
  const b = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
  }
  return b
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = Math.SQRT1_2) {
  const n = ctx.createBiquadFilter()
  n.type = type
  n.frequency.value = f
  n.Q.value = q
  return n
}

interface Ramp {
  /** duration from anchorT */
  T: number
  r0: number
  r1: number
}

export class Deck {
  readonly i: DeckIndex
  readonly ctx: AudioContext
  readonly out: GainNode
  readonly analyser: AnalyserNode
  other!: Deck

  buffer: AudioBuffer | null = null
  analysis: TrackAnalysis | null = null

  // strip nodes
  private trim: GainNode
  private gBand: GainNode[]
  private lp: BiquadFilterNode
  private hp: BiquadFilterNode
  private fader: GainNode
  readonly xf: GainNode
  private echoSend: GainNode
  private echoDelay: DelayNode
  private echoFb: GainNode
  private flWet: GainNode
  private flFb: GainNode
  private revSend: GainNode
  private lfo: OscillatorNode

  // transport bookkeeping
  private src: { node: AudioBufferSourceNode; gain: GainNode } | null = null
  private srcLoop: LoopRegion | null = null
  private pos = 0
  private slip = 0
  private anchorT = 0
  private rate = 1
  private dir: 1 | -1 = 1
  private ramp: Ramp | null = null
  private running = false
  private bend = 0
  private corr = 0
  private scratching = false
  private scratchV = 0
  private wasPlaying = false
  private cueHeld = false
  private rollSaved: LoopRegion | null = null
  private stopAt = 0

  constructor(i: DeckIndex, ctx: AudioContext, dest: AudioNode) {
    this.i = i
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.connect(dest)
    this.trim = ctx.createGain()
    // 3-band split (Linkwitz-Riley-ish: two cascaded Butterworths)
    const xLo = 250, xHi = 2500
    const lowA = biquad(ctx, 'lowpass', xLo), lowB = biquad(ctx, 'lowpass', xLo)
    const midA = biquad(ctx, 'highpass', xLo), midB = biquad(ctx, 'highpass', xLo)
    const midC = biquad(ctx, 'lowpass', xHi), midD = biquad(ctx, 'lowpass', xHi)
    const hiA = biquad(ctx, 'highpass', xHi), hiB = biquad(ctx, 'highpass', xHi)
    this.gBand = [ctx.createGain(), ctx.createGain(), ctx.createGain()]
    const sum = ctx.createGain()
    this.trim.connect(lowA).connect(lowB).connect(this.gBand[0]).connect(sum)
    this.trim.connect(midA).connect(midB).connect(midC).connect(midD).connect(this.gBand[1]).connect(sum)
    this.trim.connect(hiA).connect(hiB).connect(this.gBand[2]).connect(sum)
    this.lp = biquad(ctx, 'lowpass', 22000)
    this.hp = biquad(ctx, 'highpass', 10)
    sum.connect(this.lp).connect(this.hp)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.5
    this.hp.connect(this.analyser)
    this.fader = ctx.createGain()
    this.xf = ctx.createGain()
    const post = ctx.createGain()
    this.hp.connect(this.fader).connect(this.xf).connect(post)
    post.connect(this.out)
    // echo
    this.echoSend = ctx.createGain()
    this.echoSend.gain.value = 0
    this.echoDelay = ctx.createDelay(4)
    this.echoFb = ctx.createGain()
    const tone = biquad(ctx, 'lowpass', 3800)
    const toneHp = biquad(ctx, 'highpass', 180)
    post.connect(this.echoSend).connect(this.echoDelay)
    this.echoDelay.connect(tone).connect(toneHp).connect(this.echoFb).connect(this.echoDelay)
    toneHp.connect(this.out)
    // flanger
    const flDelay = ctx.createDelay(0.05)
    flDelay.delayTime.value = 0.004
    this.flWet = ctx.createGain()
    this.flWet.gain.value = 0
    this.flFb = ctx.createGain()
    this.flFb.gain.value = 0
    this.lfo = ctx.createOscillator()
    this.lfo.frequency.value = 0.22
    const depth = ctx.createGain()
    depth.gain.value = 0.0028
    this.lfo.connect(depth).connect(flDelay.delayTime)
    this.lfo.start()
    post.connect(flDelay)
    flDelay.connect(this.flFb).connect(flDelay)
    flDelay.connect(this.flWet).connect(this.out)
    // reverb
    this.revSend = ctx.createGain()
    this.revSend.gain.value = 0
    const conv = ctx.createConvolver()
    conv.buffer = impulse(ctx, 2.8)
    post.connect(this.revSend).connect(conv).connect(this.out)
    this.applyParams(this.st)
  }

  get st(): DeckState {
    return deckState(this.i)
  }
  private set(patch: Partial<DeckState>) {
    useDJ.getState().setDeck(this.i, patch)
  }

  get loaded() {
    return !!this.buffer
  }
  get isRunning() {
    return this.running
  }
  get isScratching() {
    return this.scratching
  }
  get duration() {
    return this.buffer?.duration ?? 0
  }
  /** current absolute playback speed (1 = normal) */
  get speed(): number {
    if (!this.running) return 0
    return this.dir * this.rateAt(this.ctx.currentTime)
  }
  get beatLen() {
    const bpm = this.st.bpm || 120
    return 60 / bpm
  }
  /** BPM as currently heard (tempo fader applied) */
  get effectiveBpm() {
    return (this.st.bpm || 0) * (1 + this.st.tempo)
  }

  // ── position integration ─────────────────────────────────
  private rateAt(now: number) {
    if (!this.ramp) return this.rate
    const dt = Math.max(0, now - this.anchorT)
    const { T, r0, r1 } = this.ramp
    return dt >= T ? r1 : r0 + ((r1 - r0) * dt) / T
  }
  private travel(now: number) {
    if (!this.running) return 0
    const dt = Math.max(0, now - this.anchorT)
    if (!this.ramp) return this.rate * dt
    const { T, r0, r1 } = this.ramp
    if (dt <= T) return r0 * dt + ((r1 - r0) * dt * dt) / (2 * T)
    return r0 * T + ((r1 - r0) * T) / 2 + r1 * (dt - T)
  }
  private wrap(p: number) {
    const L = this.srcLoop
    if (L && this.dir > 0 && p >= L.end) {
      const len = L.end - L.start
      if (len > 0.001) return L.start + ((p - L.start) % len)
    }
    return p
  }
  /** smooth playhead in track seconds – call every frame */
  position(now = this.ctx.currentTime): number {
    if (!this.buffer) return 0
    return clamp(this.wrap(this.pos + this.dir * this.travel(now)), 0, this.buffer.duration)
  }
  private integrate(now: number) {
    const tr = this.travel(now)
    const raw = this.pos + this.dir * tr
    this.slip += this.dir * tr
    if (this.ramp) {
      const r = this.rateAt(now)
      const dt = Math.max(0, now - this.anchorT)
      this.ramp = dt >= this.ramp.T ? null : { T: this.ramp.T - dt, r0: r, r1: this.ramp.r1 }
      this.rate = r
    }
    this.pos = clamp(this.wrap(raw), 0, this.duration)
    this.anchorT = now
  }

  // ── sources ──────────────────────────────────────────────
  private killSource(now: number) {
    const s = this.src
    if (!s) return
    this.src = null
    try {
      s.gain.gain.cancelScheduledValues(now)
      s.gain.gain.setValueAtTime(s.gain.gain.value, now)
      s.gain.gain.linearRampToValueAtTime(0, now + 0.006)
      s.node.stop(now + 0.012)
      s.node.onended = () => {
        s.node.disconnect()
        s.gain.disconnect()
      }
    } catch {
      /* already stopped */
    }
  }
  private startSource(now: number) {
    this.killSource(now)
    const b = this.buffer
    if (!b) return
    const buf = this.dir > 0 ? b : reversedBuffer(b)
    const node = this.ctx.createBufferSource()
    node.buffer = buf
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(1, now + 0.005)
    node.playbackRate.setValueAtTime(Math.max(0, this.rate), now)
    if (this.ramp) node.playbackRate.linearRampToValueAtTime(Math.max(0, this.ramp.r1), now + this.ramp.T)
    const L = this.dir > 0 ? this.st.loop : null
    this.srcLoop = null
    if (L && L.end - L.start > 0.005) {
      if (this.pos >= L.end) this.pos = L.start + ((this.pos - L.start) % (L.end - L.start))
      node.loop = true
      node.loopStart = L.start
      node.loopEnd = L.end
      this.srcLoop = L
    }
    const off = this.dir > 0 ? this.pos : b.duration - this.pos
    node.connect(gain).connect(this.trim)
    node.start(now, clamp(off, 0, Math.max(0, buf.duration - 1e-4)))
    this.src = { node, gain }
  }
  private targetRate() {
    if (this.scratching) return Math.abs(this.scratchV)
    return Math.max(0, (1 + this.st.tempo) * (1 + this.bend + this.corr))
  }
  private applyRate() {
    if (this.ramp) return
    const r = this.targetRate()
    if (Math.abs(r - this.rate) < 1e-7) return
    const now = this.ctx.currentTime
    this.integrate(now)
    this.rate = r
    if (this.src) {
      const p = this.src.node.playbackRate
      p.cancelScheduledValues(now)
      p.setValueAtTime(r, now)
    }
  }

  // ── loading ──────────────────────────────────────────────
  setTrack(buf: AudioBuffer | null) {
    const now = this.ctx.currentTime
    this.running = false
    this.killSource(now)
    this.buffer = buf
    this.analysis = null
    this.pos = 0
    this.slip = 0
    this.dir = 1
    this.ramp = null
    this.bend = this.corr = 0
    this.rollSaved = null
    // prepare the reverse copy for scratching while idle
    if (buf) setTimeout(() => this.buffer === buf && reversedBuffer(buf), 400)
  }
  setAnalysis(a: TrackAnalysis) {
    this.analysis = a
  }

  // ── transport ────────────────────────────────────────────
  async play() {
    if (!this.buffer) return
    if (this.ctx.state !== 'running') this.ctx.resume()
    const now = this.ctx.currentTime
    if (this.st.stopping) this.finishStop(now, false)
    this.integrate(now)
    this.cueHeld = false
    if (!this.running) {
      if (this.pos >= this.duration - 0.02) this.pos = this.st.cue < this.duration - 0.05 ? this.st.cue : 0
      this.slip = this.pos
      this.dir = 1
      this.ramp = null
      this.rate = this.targetRate()
      this.running = true
      this.startSource(now)
    }
    this.set({ playing: true })
    if (this.st.sync) this.alignPhase()
  }
  pause() {
    const now = this.ctx.currentTime
    this.integrate(now)
    this.running = false
    this.ramp = null
    this.dir = 1
    this.killSource(now)
    this.cueHeld = false
    const patch: Partial<DeckState> = { playing: false, stopping: null }
    if (this.st.roll !== null) {
      patch.roll = null
      patch.loop = this.rollSaved
      this.pos = clamp(this.slip, 0, this.duration)
    }
    this.set(patch)
  }
  toggle() {
    this.st.playing ? this.pause() : this.play()
  }
  seek(t: number) {
    if (!this.buffer) return
    const now = this.ctx.currentTime
    this.integrate(now)
    this.pos = clamp(t, 0, this.duration)
    this.slip = this.pos
    if (this.running) this.startSource(now)
  }

  // ── cue / hot cues ───────────────────────────────────────
  cueDown() {
    if (!this.buffer) return
    if (this.st.playing) {
      this.pause()
      this.seek(this.st.cue)
      return
    }
    const p = this.position()
    if (Math.abs(p - this.st.cue) > 0.005) this.set({ cue: this.snap(p) })
    this.seek(this.st.cue)
    // preview while held
    const now = this.ctx.currentTime
    this.integrate(now)
    this.dir = 1
    this.rate = this.targetRate()
    this.running = true
    this.cueHeld = true
    this.startSource(now)
  }
  cueUp() {
    if (!this.cueHeld) return
    this.cueHeld = false
    this.pause()
    this.seek(this.st.cue)
  }
  hotCue(k: number) {
    if (!this.buffer) return
    const h = this.st.hot[k]
    if (h == null) {
      const hot = [...this.st.hot]
      hot[k] = this.snap(this.position())
      this.set({ hot })
      return 'set' as const
    }
    this.seek(h)
    if (!this.st.playing) this.play()
    return 'jump' as const
  }
  clearHotCue(k: number) {
    const hot = [...this.st.hot]
    hot[k] = null
    this.set({ hot })
  }

  // ── beat grid helpers ────────────────────────────────────
  beatPhase(now = this.ctx.currentTime) {
    return (this.position(now) - this.st.firstBeat) / this.beatLen
  }
  /** snap to the nearest beat when within 1/8 beat (gentle quantize) */
  snap(t: number) {
    if (!this.st.bpm) return t
    const bl = this.beatLen
    const n = Math.round((t - this.st.firstBeat) / bl)
    const q = this.st.firstBeat + n * bl
    return Math.abs(q - t) < bl / 8 && q >= 0 ? q : t
  }
  private gridFloor(t: number, step: number) {
    const fb = this.st.firstBeat
    return Math.max(0, fb + Math.floor((t - fb) / step + 1e-6) * step)
  }

  // ── loops ────────────────────────────────────────────────
  setLoop(L: LoopRegion | null) {
    this.set({ loop: L, loopIn: null })
    if (this.running) {
      const now = this.ctx.currentTime
      this.integrate(now)
      this.startSource(now)
    }
  }
  autoLoop(beats = this.st.loopBeats) {
    if (!this.buffer) return
    if (this.st.loop) return this.setLoop(null)
    const len = beats * this.beatLen
    const p = this.position()
    const start = this.st.bpm ? this.gridFloor(p, Math.min(1, beats) * this.beatLen) : p
    this.set({ loopBeats: beats })
    this.setLoop({ start, end: Math.min(this.duration, start + len) })
  }
  loopInMark() {
    if (!this.buffer) return
    this.set({ loopIn: this.snap(this.position()) })
  }
  loopOutMark() {
    const i = this.st.loopIn
    if (i == null) {
      if (this.st.loop) this.setLoop(null)
      return
    }
    const o = this.snap(this.position())
    if (o - i > 0.05) this.setLoop({ start: i, end: o })
  }
  resizeLoop(f: number) {
    const L = this.st.loop
    const nb = clamp(this.st.loopBeats * f, 1 / 8, 64)
    this.set({ loopBeats: nb })
    if (L) this.setLoop({ start: L.start, end: Math.min(this.duration, L.start + (L.end - L.start) * f) })
  }
  rollStart(beats: number) {
    if (!this.running || !this.buffer || !this.st.playing) return
    const now = this.ctx.currentTime
    this.integrate(now)
    if (this.st.roll === null) {
      this.rollSaved = this.st.loop
      this.slip = this.pos
    }
    const step = beats * this.beatLen
    const start = this.gridFloor(this.pos, Math.min(step, this.beatLen))
    this.set({ roll: beats })
    this.setLoop({ start, end: start + step })
  }
  rollEnd() {
    if (this.st.roll === null) return
    const now = this.ctx.currentTime
    this.integrate(now)
    this.set({ roll: null, loop: this.rollSaved })
    let p = this.slip
    const L = this.rollSaved
    if (L && p >= L.end) p = L.start + ((p - L.start) % (L.end - L.start))
    this.pos = clamp(p, 0, this.duration)
    this.slip = this.pos
    if (this.running) this.startSource(now)
  }

  // ── tempo / sync ─────────────────────────────────────────
  setBend(b: number) {
    this.bend = b
    this.applyRate()
  }
  /** tempo (fraction) that would match the other deck, folding half/double time */
  syncTempo(): number | null {
    const o = this.other
    if (!this.st.bpm || !o.loaded || !o.st.bpm) return null
    let ratio = o.effectiveBpm / this.st.bpm
    while (ratio > 1.5) ratio /= 2
    while (ratio < 0.67) ratio *= 2
    return ratio - 1
  }
  syncNow(): boolean {
    const t = this.syncTempo()
    if (t === null) return false
    const range = Math.abs(t) <= this.st.range ? this.st.range : Math.abs(t) <= 0.08 ? 0.08 : Math.abs(t) <= 0.16 ? 0.16 : 0.5
    this.set({ tempo: clamp(t, -0.5, 0.5), range, sync: true })
    this.alignPhase()
    return true
  }
  /** jump so our beats (and bars when tempos match) line up with the other deck */
  alignPhase() {
    const o = this.other
    if (!this.running || !o.running || !o.st.playing || !this.st.bpm || !o.st.bpm) return
    const now = this.ctx.currentTime
    const ratio = o.effectiveBpm / Math.max(1, this.effectiveBpm)
    const bars = Math.abs(ratio - 1) < 0.05
    const mod = bars ? 4 : 1
    const mine = this.beatPhase(now), theirs = o.beatPhase(now)
    let err = (((theirs - mine) % mod) + mod) % mod
    if (err > mod / 2) err -= mod
    if (Math.abs(err) < 0.003) return
    let target = this.position(now) + err * this.beatLen
    if (target < 0) target += mod * this.beatLen
    if (this.st.roll !== null) return
    this.seek(target)
  }

  // ── scratch (platter) ────────────────────────────────────
  scratchStart() {
    if (!this.buffer) return
    const now = this.ctx.currentTime
    if (this.st.stopping) this.finishStop(now, true)
    this.integrate(now)
    this.wasPlaying = this.st.playing
    this.scratching = true
    this.scratchV = 0
    this.ramp = null
    this.rate = 0
    if (this.running && this.src) {
      const p = this.src.node.playbackRate
      p.cancelScheduledValues(now)
      p.setValueAtTime(0, now)
    } else {
      this.running = true
      this.startSource(now)
    }
  }
  /** v = audio seconds per real second (signed) */
  scratchMove(v: number) {
    if (!this.scratching) return
    v = clamp(v, -6, 6)
    const want: 1 | -1 = v >= 0 ? 1 : -1
    if (Math.abs(v) > 0.03 && want !== this.dir) {
      const now = this.ctx.currentTime
      this.integrate(now)
      this.dir = want
      this.scratchV = v
      this.rate = Math.abs(v)
      this.startSource(now)
      return
    }
    this.scratchV = v
    this.applyRate()
  }
  scratchEnd() {
    if (!this.scratching) return
    const now = this.ctx.currentTime
    this.integrate(now)
    this.scratching = false
    this.scratchV = 0
    if (this.wasPlaying) {
      this.rate = this.targetRate()
      if (this.dir < 0) {
        this.dir = 1
        this.startSource(now)
      } else if (this.src) {
        const p = this.src.node.playbackRate
        p.cancelScheduledValues(now)
        p.setValueAtTime(this.rate, now)
      } else this.startSource(now)
    } else {
      this.running = false
      this.dir = 1
      this.killSource(now)
    }
  }

  // ── brake / spinback ─────────────────────────────────────
  brake(secs = 1.2) {
    if (!this.running || !this.st.playing || this.scratching) return
    const now = this.ctx.currentTime
    this.integrate(now)
    this.ramp = { T: secs, r0: this.rate, r1: 0 }
    if (this.src) {
      const p = this.src.node.playbackRate
      p.cancelScheduledValues(now)
      p.setValueAtTime(this.rate, now)
      p.linearRampToValueAtTime(0, now + secs)
    }
    this.stopAt = now + secs
    this.set({ stopping: 'brake' })
  }
  spinback(secs = 1.5) {
    if (!this.running || !this.st.playing || this.scratching) return
    const now = this.ctx.currentTime
    this.integrate(now)
    this.dir = -1
    this.rate = 3.2
    this.ramp = { T: secs, r0: 3.2, r1: 0 }
    this.startSource(now)
    this.stopAt = now + secs
    this.set({ stopping: 'spin' })
  }
  private finishStop(now: number, keep: boolean) {
    this.integrate(now)
    this.ramp = null
    if (keep) {
      this.rate = this.targetRate()
      this.set({ stopping: null })
      return
    }
    this.pause()
  }

  // ── called by the engine every ~25 ms ────────────────────
  tick(now: number) {
    if (!this.buffer) return
    const st = this.st
    if (st.stopping && now >= this.stopAt) {
      this.finishStop(now, false)
      return
    }
    if (this.running && !this.scratching) {
      const p = this.position(now)
      if (this.dir > 0 && !this.srcLoop && p >= this.duration - 0.003) {
        this.pause()
        this.pos = this.duration
        return
      }
    }
    // sync lock: follow the other deck's tempo, gently pull phase
    if (st.sync && !st.stopping) {
      const t = this.syncTempo()
      if (t !== null && Math.abs(t - st.tempo) > 1e-5) this.set({ tempo: clamp(t, -0.5, 0.5) })
      const o = this.other
      let corr = 0
      if (this.running && st.playing && o.running && o.st.playing && !this.scratching && !o.isScratching && st.roll === null && !this.cueHeld) {
        let err = (((o.beatPhase(now) - this.beatPhase(now)) % 1) + 1) % 1
        if (err > 0.5) err -= 1
        if (Math.abs(err) > 0.004) corr = clamp(err * 0.15, -0.015, 0.015)
      }
      if (Math.abs(corr - this.corr) > 0.0004 || (corr === 0 && this.corr !== 0)) {
        this.corr = corr
        this.applyRate()
      }
    } else if (this.corr !== 0) {
      this.corr = 0
      this.applyRate()
    }
  }

  // ── strip parameters ─────────────────────────────────────
  applyParams(s: DeckState, prev?: DeckState) {
    const now = this.ctx.currentTime
    const tc = 0.012
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, tc)
    if (!prev || s.trim !== prev.trim) set(this.trim.gain, dbToGain(s.trim))
    if (!prev || s.eq !== prev.eq || s.kill !== prev.kill)
      for (let b = 0; b < 3; b++) set(this.gBand[b].gain, s.kill[b] || s.eq[b] <= EQ_MIN + 0.1 ? 0 : dbToGain(s.eq[b]))
    if (!prev || s.filter !== prev.filter || s.res !== prev.res) {
      const f = s.filter
      const q = 0.707 + s.res * 11
      if (f < -0.02) {
        set(this.lp.frequency, 20000 * Math.pow(70 / 20000, Math.min(1, -f)))
        set(this.lp.Q, q)
        set(this.hp.frequency, 10)
        set(this.hp.Q, 0.707)
      } else if (f > 0.02) {
        set(this.hp.frequency, 20 * Math.pow(12000 / 20, Math.min(1, f)))
        set(this.hp.Q, q)
        set(this.lp.frequency, 22000)
        set(this.lp.Q, 0.707)
      } else {
        set(this.lp.frequency, 22000)
        set(this.hp.frequency, 10)
        set(this.lp.Q, 0.707)
        set(this.hp.Q, 0.707)
      }
    }
    if (!prev || s.fader !== prev.fader) set(this.fader.gain, Math.pow(s.fader / 0.85, 2))
    if (!prev || s.echo !== prev.echo) {
      set(this.echoSend.gain, s.echo * 0.9)
      set(this.echoFb.gain, s.echo > 0 ? 0.3 + s.echo * 0.4 : 0.45)
    }
    if (!prev || s.echoBeats !== prev.echoBeats || s.bpm !== prev.bpm || s.tempo !== prev.tempo) {
      const bpm = (s.bpm || 120) * (1 + s.tempo)
      this.echoDelay.delayTime.setTargetAtTime(clamp((s.echoBeats * 60) / bpm, 0.02, 3.9), now, 0.05)
    }
    if (!prev || s.flanger !== prev.flanger) {
      set(this.flWet.gain, s.flanger * 0.85)
      set(this.flFb.gain, s.flanger * 0.72)
      this.lfo.frequency.setTargetAtTime(0.12 + s.flanger * 0.25, now, 0.1)
    }
    if (!prev || s.reverb !== prev.reverb) set(this.revSend.gain, s.reverb * 0.9)
    if (!prev || s.tempo !== prev.tempo) this.applyRate()
  }

  dispose() {
    const now = this.ctx.currentTime
    this.running = false
    this.killSource(now)
    try {
      this.lfo.stop()
    } catch {}
    this.out.disconnect()
  }
}
