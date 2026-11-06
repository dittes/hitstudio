// Two procedurally synthesised 124 BPM demo tracks so DJ mode works with zero
// files. Both are in A minor / C major so they mix harmonically.
//   • "HitStudio House"  – four-on-the-floor kick, clap, hats, rolling bass, chord stabs
//   • "Velvet Groove" – laid-back kick, rim, shaker, warm pads, keys and sub
// Rendered once with an OfflineAudioContext and cached.

export const DEMO_BPM = 124
const SR = 44100
const BARS = 32
const BEAT = 60 / DEMO_BPM
const BAR = BEAT * 4
const LEN = BAR * BARS

const midi = (n        ) => 440 * Math.pow(2, (n - 69) / 12)

function noiseBuffer(ctx                  , secs = 1)              {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate)
  const d = b.getChannelData(0)
  let s = 12345
  for (let i = 0; i < d.length; i++) {
    s = (s * 16807) % 2147483647
    d[i] = (s / 2147483647) * 2 - 1
  }
  return b
}

function kick(ctx                  , out           , t        , vol = 1, punch = 1) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.frequency.setValueAtTime(160 * punch, t)
  o.frequency.exponentialRampToValueAtTime(48, t + 0.09)
  o.frequency.exponentialRampToValueAtTime(42, t + 0.4)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004)
  g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.12)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
  o.connect(g).connect(out)
  o.start(t)
  o.stop(t + 0.45)
  // click
  const c = ctx.createOscillator()
  const cg = ctx.createGain()
  c.type = 'square'
  c.frequency.value = 1800
  cg.gain.setValueAtTime(0.08 * vol, t)
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.008)
  c.connect(cg).connect(out)
  c.start(t)
  c.stop(t + 0.01)
}

function noiseHit(
  ctx                  ,
  out           ,
  noise             ,
  t        ,
  opts                                                                                                ,
) {
  const s = ctx.createBufferSource()
  s.buffer = noise
  const f = ctx.createBiquadFilter()
  f.type = opts.type
  f.frequency.value = opts.freq
  f.Q.value = opts.q ?? 0.8
  const g = ctx.createGain()
  g.gain.setValueAtTime(opts.vol, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay)
  const p = ctx.createStereoPanner()
  p.pan.value = opts.pan ?? 0
  s.connect(f).connect(g).connect(p).connect(out)
  s.start(t, Math.random() * 0.5)
  s.stop(t + opts.decay + 0.02)
}

function clap(ctx                  , out           , noise             , t        , vol = 0.5) {
  for (let k = 0; k < 3; k++) noiseHit(ctx, out, noise, t + k * 0.011, { type: 'bandpass', freq: 1300, q: 1.2, vol: vol * 0.6, decay: 0.02 })
  noiseHit(ctx, out, noise, t + 0.033, { type: 'bandpass', freq: 1200, q: 1, vol, decay: 0.18 })
}

function synthNote(
  ctx                  ,
  out           ,
  t        ,
  dur        ,
  freq        ,
  opts                                                                                                                                                   ,
) {
  const f = ctx.createBiquadFilter()
  f.type = 'lowpass'
  f.Q.value = opts.q ?? 1
  const a = opts.attack ?? 0.005
  const r = opts.release ?? 0.08
  f.frequency.setValueAtTime(opts.cutoff * (1 + (opts.env ?? 0)), t)
  f.frequency.exponentialRampToValueAtTime(opts.cutoff, t + Math.min(dur, 0.25))
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(opts.vol, t + a)
  g.gain.setValueAtTime(opts.vol, t + Math.max(a, dur))
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, dur) + r)
  const p = ctx.createStereoPanner()
  p.pan.value = opts.pan ?? 0
  f.connect(g).connect(p).connect(out)
  const dets = opts.detune ? [-opts.detune, opts.detune] : [0]
  for (const d of dets) {
    const o = ctx.createOscillator()
    o.type = opts.type
    o.frequency.value = freq
    o.detune.value = d
    o.connect(f)
    o.start(t)
    o.stop(t + Math.max(a, dur) + r + 0.02)
  }
}

function makeBus(ctx                     ) {
  // gentle glue: compressor + a short stereo "room" via delays
  const bus = ctx.createGain()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.ratio.value = 3
  comp.attack.value = 0.01
  comp.release.value = 0.15
  bus.connect(comp).connect(ctx.destination)
  return bus
}

function reverbSend(ctx                     , dest           , secs = 2.2, wet = 0.25) {
  const conv = ctx.createConvolver()
  const len = Math.floor(ctx.sampleRate * secs)
  const ir = ctx.createBuffer(2, len, ctx.sampleRate)
  let s = 777
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    for (let i = 0; i < len; i++) {
      s = (s * 16807) % 2147483647
      d[i] = ((s / 2147483647) * 2 - 1) * Math.pow(1 - i / len, 3)
    }
  }
  conv.buffer = ir
  const g = ctx.createGain()
  g.gain.value = wet
  conv.connect(g).connect(dest)
  return conv
}

/**
 * Create each bar's nodes just before it plays (suspend/resume). Pre-creating
 * thousands of filter/gain nodes up front makes offline rendering crawl,
 * because every connected node is processed on every render quantum.
 */
function renderBars(ctx                     , scheduleBar                       )                       {
  scheduleBar(0)
  for (let b = 1; b < BARS; b++) {
    const t = Math.floor(((b * BAR - 0.08) * SR) / 128) * 128 / SR
    ctx.suspend(t).then(() => {
      scheduleBar(b)
      ctx.resume()
    })
  }
  return ctx.startRendering()
}

async function renderHouse()                       {
  const ctx = new OfflineAudioContext(2, Math.ceil(LEN * SR), SR)
  const bus = makeBus(ctx)
  const noise = noiseBuffer(ctx)
  const verb = reverbSend(ctx, bus, 1.6, 0.3)
  // A minor: Am7 – Fmaj7 – Cmaj7 – G
  const roots = [45, 41, 48, 43]
  const chords = [
    [57, 60, 64, 67],
    [53, 57, 60, 64],
    [55, 60, 64, 67],
    [55, 59, 62, 67],
  ]
  return renderBars(ctx, (bar) => {
    const t0 = bar * BAR
    const sec = Math.floor(bar / 8) // 0 intro, 1 groove, 2 breakdown-ish, 3 full
    const ci = Math.floor(bar / 2) % 4
    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * BEAT
      if (!(sec === 2 && bar % 8 >= 6)) kick(ctx, bus, tb, 0.95)
      if (b % 2 === 1 && bar >= 4) clap(ctx, bus, noise, tb, 0.42)
      // hats: 16ths soft, offbeat open hat
      for (let s = 0; s < 4; s++) {
        const th = tb + (s * BEAT) / 4
        if (s === 2) noiseHit(ctx, bus, noise, th, { type: 'highpass', freq: 7500, vol: 0.32, decay: 0.16, pan: 0.15 })
        else if (bar >= 2) noiseHit(ctx, bus, noise, th, { type: 'highpass', freq: 9000, vol: s === 0 ? 0.08 : 0.13, decay: 0.035, pan: -0.2 })
      }
      // rolling offbeat bass
      if (bar >= 8 && !(sec === 2 && bar % 8 < 4)) {
        const root = roots[ci]
        synthNote(ctx, bus, tb + BEAT / 2, BEAT * 0.38, midi(root), { type: 'sawtooth', vol: 0.32, cutoff: 260, env: 3, q: 6, release: 0.04 })
        if (b === 3) synthNote(ctx, bus, tb + (BEAT * 3) / 4, BEAT * 0.2, midi(root + 12), { type: 'sawtooth', vol: 0.18, cutoff: 400, env: 2, q: 5, release: 0.03 })
      }
    }
    // chord stabs on the "and" of 2 and the 4
    if (bar >= 12) {
      for (const at of [1.5, 3.5]) {
        for (const n of chords[ci]) {
          synthNote(ctx, verb, t0 + at * BEAT, BEAT * 0.18, midi(n + 12), { type: 'sawtooth', vol: 0.045, cutoff: 1800, env: 1.5, q: 2, detune: 9, release: 0.12, pan: (n % 3) * 0.2 - 0.2 })
          synthNote(ctx, bus, t0 + at * BEAT, BEAT * 0.18, midi(n + 12), { type: 'square', vol: 0.03, cutoff: 1500, env: 1.2, release: 0.08 })
        }
      }
    }
    // riser fx before each section
    if (bar % 8 === 7) noiseHit(ctx, verb, noise, t0 + 2 * BEAT, { type: 'bandpass', freq: 3000, q: 0.6, vol: 0.18, decay: 2 * BEAT })
  })
}

async function renderGroove()                       {
  const ctx = new OfflineAudioContext(2, Math.ceil(LEN * SR), SR)
  const bus = makeBus(ctx)
  const noise = noiseBuffer(ctx)
  const verb = reverbSend(ctx, bus, 3, 0.45)
  // C major / A minor: Fmaj7 – Em7 – Dm7 – Cmaj7
  const roots = [41, 40, 38, 36]
  const chords = [
    [53, 57, 60, 64],
    [52, 55, 59, 62],
    [50, 53, 57, 60],
    [48, 52, 55, 59],
  ]
  const swing = BEAT * 0.07
  return renderBars(ctx, (bar) => {
    const t0 = bar * BAR
    const ci = bar % 4
    const full = bar >= 4
    // kick on 1, 2, 3, 4 but softer + ghost on the "a" of 2
    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * BEAT
      kick(ctx, bus, tb, b === 0 ? 0.9 : 0.75, 0.8)
      if (b % 2 === 1 && full) {
        noiseHit(ctx, verb, noise, tb, { type: 'bandpass', freq: 2200, q: 3, vol: 0.38, decay: 0.07 }) // rim
        synthNote(ctx, bus, tb, 0.02, 1700, { type: 'triangle', vol: 0.12, cutoff: 4000, release: 0.03 })
      }
      // shaker 8ths with swing
      for (let s = 0; s < 2; s++) {
        const th = tb + (s * BEAT) / 2 + (s === 1 ? swing : 0)
        if (bar >= 2) noiseHit(ctx, bus, noise, th, { type: 'highpass', freq: 6000, vol: s ? 0.16 : 0.08, decay: 0.06, pan: 0.3 })
      }
    }
    if (full && bar % 2 === 1) kick(ctx, bus, t0 + 2.75 * BEAT, 0.45, 0.8)
    // warm pad
    for (const n of chords[ci]) {
      synthNote(ctx, verb, t0, BAR * 0.92, midi(n), { type: 'triangle', vol: 0.05, cutoff: 1100, attack: 0.25, release: 0.4, detune: 7, pan: (n % 4) * 0.15 - 0.2 })
    }
    // keys: syncopated plucks
    if (bar >= 8) {
      const pattern = [0, 0.75, 1.5, 2.5, 3.25]
      pattern.forEach((at, k) => {
        const n = chords[ci][(k + bar) % 4] + 12
        synthNote(ctx, verb, t0 + at * BEAT + (k % 2 ? swing : 0), BEAT * 0.25, midi(n), { type: 'sine', vol: 0.09, cutoff: 3000, release: 0.25, pan: k % 2 ? 0.3 : -0.3 })
        synthNote(ctx, bus, t0 + at * BEAT + (k % 2 ? swing : 0), BEAT * 0.1, midi(n + 12), { type: 'triangle', vol: 0.025, cutoff: 5000, release: 0.1 })
      })
    }
    // sub bass
    if (bar >= 6) {
      const r = roots[ci]
      synthNote(ctx, bus, t0, BEAT * 1.4, midi(r), { type: 'sine', vol: 0.42, cutoff: 300, release: 0.08 })
      synthNote(ctx, bus, t0 + 1.75 * BEAT, BEAT * 0.6, midi(r), { type: 'sine', vol: 0.35, cutoff: 300, release: 0.06 })
      synthNote(ctx, bus, t0 + 3 * BEAT, BEAT * 0.7, midi(r + (bar % 2 ? 7 : 12)), { type: 'sine', vol: 0.32, cutoff: 300, release: 0.06 })
    }
  })
}

const cache = new Map                              ()
function cached(id        , fn                            ) {
  return () => {
    let p = cache.get(id)
    if (!p) {
      p = fn()
      cache.set(id, p)
    }
    return p
  }
}

export const DEMOS            = [
  { id: 'demo:house', name: 'HitStudio House (demo)', color: '#a78bfa', render: cached('demo:house', renderHouse) },
  { id: 'demo:groove', name: 'Velvet Groove (demo)', color: '#f472b6', render: cached('demo:groove', renderGroove) },
]
