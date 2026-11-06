// Tone shaping: Parametric EQ, Filter (DJ sweep), Telephone/Radio, Vocal enhancer.
import { dbToGain } from '../../../core/ids.js'
import { compressorAutoMakeupDb, defineEffect, disconnectAll, makeCurve, paramSetter, wetDry } from './shared.js'

// ── Parametric EQ (5 bands) ───────────────────────────────────
export const PEQ_BANDS                                                                        = [
  { type: 'lowshelf', label: 'Bass', f: 90, color: '#f472b6' },
  { type: 'peaking', label: 'Low mid', f: 300, color: '#fb923c' },
  { type: 'peaking', label: 'Mid', f: 1200, color: '#facc15' },
  { type: 'peaking', label: 'Presence', f: 4000, color: '#4ade80' },
  { type: 'highshelf', label: 'Air', f: 11000, color: '#38bdf8' },
]

const peqParams = PEQ_BANDS.flatMap((b, i) => [
  { key: `f${i + 1}`, label: `${b.label} freq`, min: 20, max: 20000, default: b.f, step: 1, unit: 'Hz', curve: 'log'         , hint: `Which pitch range the ${b.label.toLowerCase()} band touches` },
  { key: `g${i + 1}`, label: `${b.label}`, min: -18, max: 18, default: 0, step: 0.1, unit: 'dB', hint: 'Boost (up) or cut (down) this range' },
  { key: `q${i + 1}`, label: `${b.label} width`, min: 0.2, max: 12, default: b.type === 'peaking' ? 1 : 0.7, step: 0.01, curve: 'log'         , hint: 'Small = wide and gentle, big = narrow and surgical' },
])

/** Apply EQ params to 5 biquads (also used by the response curve UI). */
export function applyPeq(
  filters                    ,
  p                        ,
  set                                         = (a, v) => (a.value = v),
) {
  filters.forEach((f, i) => {
    f.type = PEQ_BANDS[i].type
    set(f.frequency, p[`f${i + 1}`] ?? PEQ_BANDS[i].f)
    set(f.gain, p[`g${i + 1}`] ?? 0)
    // shelf Q in WebAudio is a slope-ish factor; keep it gentle
    const q = p[`q${i + 1}`] ?? 1
    set(f.Q, PEQ_BANDS[i].type === 'peaking' ? q : Math.min(q, 2))
  })
}

defineEffect(
  {
    type: 'peq',
    name: 'Parametric EQ',
    icon: '🎛️',
    category: 'tone',
    description: 'Five tone bands you can drag around: fix muddy, harsh or dull sounds with precision.',
    params: [...peqParams, { key: 'out', label: 'Output', min: -18, max: 18, default: 0, step: 0.1, unit: 'dB', hint: 'Overall volume after the EQ' }],
    presets: {
      'Clear vocal': { f1: 100, g1: -3, f2: 300, g2: -3, q2: 1.2, f3: 1200, g3: 0, f4: 4500, g4: 3.5, q4: 0.9, f5: 11000, g5: 2.5 },
      'Big drums': { f1: 70, g1: 4, f2: 400, g2: -4, q2: 1.5, f3: 1500, g3: 0, f4: 5000, g4: 2.5, f5: 10000, g5: 2 },
      'Warm & smooth': { f1: 120, g1: 2.5, f2: 300, g2: 1, f3: 2500, g3: -2, q3: 0.8, f4: 6000, g4: -2, f5: 12000, g5: -3 },
      'Bass boost': { f1: 80, g1: 6, f2: 250, g2: -1.5, f3: 1200, g3: 0, f4: 4000, g4: 0, f5: 11000, g5: 0 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const filters = PEQ_BANDS.map(() => ctx.createBiquadFilter())
      const out = ctx.createGain()
      filters.slice(1).reduce           ((a, b) => a.connect(b), filters[0])
      filters[4].connect(out)
      const update = (q                        ) => {
        applyPeq(filters, q, set)
        set(out.gain, dbToGain(q.out ?? 0))
      }
      update(p)
      goLive()
      return { input: filters[0], output: out, update, dispose: () => disconnectAll([...filters, out]) }
    },
  },
  { visual: 'eq', icon: 'eq', tags: 'equalizer equaliser tone frequency bass treble' },
)

// ── Filter (DJ one-knob sweep, LP / HP / BP) ──────────────────
export const FILTER_MODES = ['DJ sweep', 'Low-pass', 'High-pass', 'Band-pass']

export function filterSettings(p                        , sr = 48000)                                                      {
  const mode = Math.round(p.mode ?? 0)
  const reso = (p.reso ?? 20) / 100
  const nyq = sr / 2 - 100
  if (mode === 0) {
    const s = (p.sweep ?? 0) / 100
    if (Math.abs(s) < 0.02) return { type: 'lowpass', freq: nyq, q: -3 }
    if (s < 0) return { type: 'lowpass', freq: Math.min(nyq, 20000 * Math.pow(60 / 20000, -s)), q: -3 + reso * 21 }
    return { type: 'highpass', freq: 20 * Math.pow(9000 / 20, s), q: -3 + reso * 21 }
  }
  const freq = Math.min(nyq, p.cutoff ?? 1000)
  if (mode === 3) return { type: 'bandpass', freq, q: 0.5 + reso * 15 }
  return { type: mode === 1 ? 'lowpass' : 'highpass', freq, q: -3 + reso * 21 }
}

defineEffect(
  {
    type: 'filter',
    name: 'Filter',
    icon: '🌀',
    category: 'tone',
    description: 'Sweep the sound from muffled to thin like a DJ, or cut away everything above or below a pitch.',
    params: [
      { key: 'mode', label: 'Mode', min: 0, max: 3, default: 0, step: 1 },
      { key: 'sweep', label: 'Sweep', min: -100, max: 100, default: 0, step: 1, hint: 'Left = muffled (low-pass), right = thin (high-pass), middle = off' },
      { key: 'cutoff', label: 'Cutoff', min: 20, max: 20000, default: 1000, step: 1, unit: 'Hz', curve: 'log', hint: 'The pitch where the filter starts working' },
      { key: 'reso', label: 'Resonance', min: 0, max: 100, default: 25, step: 1, unit: '%', hint: 'Adds a whistly peak at the cutoff point' },
      { key: 'steep', label: 'Steep', min: 0, max: 1, default: 1, step: 1, hint: 'A sharper, more dramatic cut' },
    ],
    presets: {
      'Underwater': { mode: 0, sweep: -70, reso: 30 },
      'Thin build-up': { mode: 0, sweep: 55, reso: 45 },
      'Rumble cut': { mode: 2, cutoff: 90, reso: 10, steep: 1 },
      'Walkie band': { mode: 3, cutoff: 1500, reso: 20 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const a = ctx.createBiquadFilter()
      const b = ctx.createBiquadFilter()
      const bypassB = ctx.createGain()
      const out = ctx.createGain()
      b.connect(out)
      bypassB.connect(out)
      let lastSteep                 = null
      const update = (q                        ) => {
        const s = filterSettings(q, ctx.sampleRate)
        for (const f of [a, b]) {
          f.type = s.type
          set(f.frequency, s.freq, 0.03)
          set(f.Q, s.type === 'bandpass' ? s.q : s.q - (q.steep ? 3 : 0))
        }
        // steep = two filters in series (24 dB/oct), otherwise only the first
        const steep = (q.steep ?? 1) >= 0.5
        if (steep !== lastSteep) {
          lastSteep = steep
          a.disconnect()
          a.connect(steep ? b : bypassB)
        }
      }
      update(p)
      goLive()
      return { input: a, output: out, update, dispose: () => disconnectAll([a, b, bypassB, out]) }
    },
  },
  {
    visual: 'filter',
    icon: 'filter',
    enums: { mode: FILTER_MODES },
    toggles: ['steep'],
    tags: 'low pass high pass lowpass highpass dj sweep muffle',
    showIf: { sweep: (p) => (p.mode ?? 0) === 0, cutoff: (p) => (p.mode ?? 0) !== 0 },
  },
)

// ── Telephone / Radio ─────────────────────────────────────────
const LOFI_STYLES = ['Phone', 'AM radio', 'Megaphone', 'Walkie']
const STYLE_SETTINGS = [
  { hp: 400, lp: 3200, peak: 1400, peakDb: 5, drive: 0.25 },
  { hp: 200, lp: 4500, peak: 1000, peakDb: 3, drive: 0.15 },
  { hp: 600, lp: 3800, peak: 2200, peakDb: 9, drive: 0.6 },
  { hp: 700, lp: 2600, peak: 1700, peakDb: 7, drive: 0.75 },
]

defineEffect(
  {
    type: 'telephone',
    name: 'Telephone / Radio',
    icon: '📞',
    category: 'creative',
    description: 'Make it sound like it comes through a phone, an old radio or a megaphone.',
    params: [
      { key: 'style', label: 'Style', min: 0, max: 3, default: 0, step: 1 },
      { key: 'crunch', label: 'Crunch', min: 0, max: 100, default: 35, step: 1, unit: '%', hint: 'How broken and distorted the speaker sounds' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 100, step: 1, unit: '%', hint: 'Blend between the original and the effect' },
      { key: 'out', label: 'Output', min: -18, max: 12, default: 0, step: 0.1, unit: 'dB' },
    ],
    presets: {
      'Phone call': { style: 0, crunch: 30, mix: 100 },
      'Vintage radio': { style: 1, crunch: 20, mix: 100 },
      'Megaphone': { style: 2, crunch: 70, mix: 100 },
      'Half phone': { style: 0, crunch: 20, mix: 50 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const mix = wetDry(ctx)
      const hp1 = ctx.createBiquadFilter(), hp2 = ctx.createBiquadFilter()
      const lp1 = ctx.createBiquadFilter(), lp2 = ctx.createBiquadFilter()
      const peak = ctx.createBiquadFilter()
      const pre = ctx.createGain()
      const shaper = ctx.createWaveShaper()
      shaper.oversample = '2x'
      const post = ctx.createGain()
      const out = ctx.createGain()
      hp1.type = hp2.type = 'highpass'
      lp1.type = lp2.type = 'lowpass'
      peak.type = 'peaking'
      peak.Q.value = 1.2
      mix.input.connect(hp1).connect(hp2).connect(lp1).connect(lp2).connect(peak).connect(pre).connect(shaper).connect(post).connect(mix.wet)
      mix.output.connect(out)
      let lastCurve = -1
      const update = (q                        ) => {
        const st = STYLE_SETTINGS[Math.round(q.style ?? 0)] ?? STYLE_SETTINGS[0]
        set(hp1.frequency, st.hp); set(hp2.frequency, st.hp)
        set(lp1.frequency, st.lp); set(lp2.frequency, st.lp)
        set(peak.frequency, st.peak); set(peak.gain, st.peakDb)
        const amt = Math.min(1, st.drive * 0.5 + (q.crunch ?? 35) / 100)
        if (amt !== lastCurve) {
          lastCurve = amt
          const k = 1 + amt * 30
          shaper.curve = makeCurve((x) => Math.tanh(k * x) / Math.tanh(k))
        }
        set(pre.gain, 1)
        set(post.gain, 0.62 / (1 + amt))
        const g = mix.gains(q.mix ?? 100)
        set(mix.dry.gain, g.dry); set(mix.wet.gain, g.wet)
        set(out.gain, dbToGain(q.out ?? 0))
      }
      update(p)
      goLive()
      return { input: mix.input, output: out, update, dispose: () => disconnectAll([...mix.nodes, hp1, hp2, lp1, lp2, peak, pre, shaper, post, out]) }
    },
  },
  { icon: 'phone', enums: { style: LOFI_STYLES }, tags: 'radio phone lofi megaphone walkie' },
)

// ── Vocal enhancer ────────────────────────────────────────────
defineEffect(
  {
    type: 'vocal',
    name: 'Vocal Enhancer',
    icon: '🎤',
    category: 'tone',
    description: 'One-stop voice polish: removes mud and rumble, adds clarity and air, and evens out the volume.',
    params: [
      { key: 'lowcut', label: 'Rumble cut', min: 20, max: 200, default: 80, step: 1, unit: 'Hz', curve: 'log', hint: 'Removes low rumble, handling noise and wind' },
      { key: 'clean', label: 'De-mud', min: 0, max: 12, default: 3, step: 0.1, unit: 'dB', hint: 'Cuts the boxy "cardboard" sound around 300 Hz' },
      { key: 'presence', label: 'Clarity', min: 0, max: 12, default: 3, step: 0.1, unit: 'dB', hint: 'Brings the voice forward so words are easy to understand' },
      { key: 'air', label: 'Air', min: 0, max: 12, default: 2, step: 0.1, unit: 'dB', hint: 'Adds a breathy, expensive-sounding shine' },
      { key: 'smooth', label: 'Smooth', min: 0, max: 100, default: 40, step: 1, unit: '%', hint: 'Evens out loud and quiet words (compression)' },
    ],
    presets: {
      Podcast: { lowcut: 90, clean: 4, presence: 3, air: 1.5, smooth: 55 },
      'Singer': { lowcut: 80, clean: 2.5, presence: 2.5, air: 4, smooth: 40 },
      'Radio host': { lowcut: 70, clean: 5, presence: 5, air: 2, smooth: 75 },
      'Gentle': { lowcut: 60, clean: 1.5, presence: 1.5, air: 1, smooth: 20 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.Q.value = 0.7
      const mud = ctx.createBiquadFilter()
      mud.type = 'peaking'
      mud.frequency.value = 320
      mud.Q.value = 1.1
      const pres = ctx.createBiquadFilter()
      pres.type = 'peaking'
      pres.frequency.value = 4500
      pres.Q.value = 0.8
      const air = ctx.createBiquadFilter()
      air.type = 'highshelf'
      air.frequency.value = 10500
      const comp = ctx.createDynamicsCompressor()
      comp.knee.value = 10
      comp.attack.value = 0.008
      comp.release.value = 0.15
      const makeup = ctx.createGain()
      hp.connect(mud).connect(pres).connect(air).connect(comp).connect(makeup)
      const update = (q                        ) => {
        set(hp.frequency, q.lowcut ?? 80)
        set(mud.gain, -(q.clean ?? 3))
        set(pres.gain, q.presence ?? 3)
        set(air.gain, q.air ?? 2)
        const s = (q.smooth ?? 40) / 100
        const T = -8 - s * 22, R = 1 + s * 5
        set(comp.threshold, T)
        set(comp.ratio, R)
        // cancel the node's hidden auto-makeup, then add our own gentle one
        set(makeup.gain, dbToGain(s * 8 - compressorAutoMakeupDb(T, 10, R)))
      }
      update(p)
      goLive()
      return {
        input: hp,
        output: makeup,
        update,
        probe: () => ({ reduction: comp.reduction }),
        dispose: () => disconnectAll([hp, mud, pres, air, comp, makeup]),
      }
    },
  },
  { icon: 'mic', visual: 'comp', tags: 'voice podcast vocals clarity de-ess polish' },
)
