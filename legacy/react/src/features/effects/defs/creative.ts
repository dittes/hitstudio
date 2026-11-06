// Creative: Distortion / Saturation (curve families from Audacity DistortionBase),
// Bit-crusher / Lo-fi.
import { dbToGain } from '../../../core/ids'
import { defineEffect, disconnectAll, makeCurve, paramSetter, wetDry } from './shared'

export const DRIVE_TYPES = ['Warm', 'Tube', 'Crunch', 'Fuzz', 'Cubic', 'Fold', 'Octave']

/** Transfer function of each distortion flavour; k = drive gain (≥1). */
export function driveFn(type: number, k: number): (x: number) => number {
  switch (type) {
    case 0: // soft clip (Audacity "Soft clipping": linear up to a threshold, then log curve)
      return (x) => {
        const v = x * k, a = Math.abs(v), t = 0.5
        return Math.sign(v) * (a < t ? a : t + (1 - t) * Math.tanh((a - t) / (1 - t)))
      }
    case 1: { // even-harmonic "tube" (Audacity EvenHarmonicTable)
      const amt = -0.55, C = 2.2
      return (x) => {
        const v = Math.tanh(x * k)
        return (1 + amt) * v - v * (amt / Math.tanh(C)) * Math.tanh(C * v)
      }
    }
    case 2: // hard clip
      return (x) => Math.max(-1, Math.min(1, x * k * 0.8))
    case 3: // fuzz: hard exponential overdrive (Audacity "Hard overdrive")
      return (x) => Math.sign(x) * (1 - Math.exp(-Math.abs(x) * k * 3))
    case 4: { // cubic, applied repeatedly (Audacity CubicTable)
      return (x) => {
        let v = Math.max(-1, Math.min(1, x * k))
        for (let i = 0; i < 2; i++) v = 1.5 * (v - (v * v * v) / 3)
        return v
      }
    }
    case 5: // wave folder (Audacity "Sine curve" with folding)
      return (x) => Math.sin(x * k * (Math.PI / 2))
    case 6: // rectifier → octave-up fuzz (Audacity Rectifier, full wave)
      return (x) => Math.abs(Math.tanh(x * k)) * 2 - 0.6
    default:
      return (x) => x
  }
}

/** RMS gain of a curve for a typical signal level (for automatic level matching). */
function curveGain(fn: (x: number) => number) {
  let si = 0, so = 0
  for (let i = 0; i < 256; i++) {
    const x = 0.25 * Math.sin((i / 256) * Math.PI * 2)
    const y = fn(x)
    si += x * x
    so += y * y
  }
  return Math.sqrt(so / Math.max(1e-9, si))
}

defineEffect(
  {
    type: 'distortion',
    name: 'Distortion',
    icon: '🔥',
    category: 'creative',
    description: 'From gentle warmth to full-on fuzz: adds grit, edge and harmonics.',
    params: [
      { key: 'type', label: 'Flavour', min: 0, max: DRIVE_TYPES.length - 1, default: 0, step: 1 },
      { key: 'drive', label: 'Drive', min: 0, max: 100, default: 35, step: 1, unit: '%', hint: 'How hard you push it – more = dirtier' },
      { key: 'tone', label: 'Tone', min: 500, max: 20000, default: 8000, step: 1, unit: 'Hz', curve: 'log', hint: 'Lower to tame harsh fizz' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 100, step: 1, unit: '%', hint: 'Blend some clean sound back in' },
      { key: 'out', label: 'Output', min: -24, max: 12, default: 0, step: 0.1, unit: 'dB', hint: 'Volume after distortion (auto-matched already)' },
    ],
    presets: {
      'Tape warmth': { type: 0, drive: 20, tone: 12000, mix: 100 },
      'Tube amp': { type: 1, drive: 55, tone: 7000, mix: 100 },
      'Fuzz box': { type: 3, drive: 80, tone: 4500, mix: 100 },
      'Parallel grit': { type: 2, drive: 70, tone: 6000, mix: 35 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const mix = wetDry(ctx)
      const shaper = ctx.createWaveShaper()
      shaper.oversample = '4x'
      const dc = ctx.createBiquadFilter()
      dc.type = 'highpass'
      dc.frequency.value = 20
      const tone = ctx.createBiquadFilter()
      tone.type = 'lowpass'
      tone.Q.value = -3
      const comp = ctx.createGain()
      const out = ctx.createGain()
      mix.input.connect(shaper).connect(dc).connect(tone).connect(comp).connect(mix.wet)
      mix.output.connect(out)
      let key = ''
      const update = (q: Record<string, number>) => {
        const type = Math.round(q.type ?? 0)
        const drive = q.drive ?? 35
        const k = Math.pow(10, (drive / 100) * 1.6) // 1 … 40
        if (`${type}|${drive}` !== key) {
          key = `${type}|${drive}`
          const fn = driveFn(type, k)
          shaper.curve = makeCurve(fn, 8193)
          set(comp.gain, Math.min(4, 1 / Math.max(0.05, curveGain(fn))))
        }
        set(tone.frequency, Math.min(ctx.sampleRate / 2 - 100, q.tone ?? 8000))
        const m = Math.min(1, Math.max(0, (q.mix ?? 100) / 100))
        set(mix.dry.gain, 1 - m)
        set(mix.wet.gain, m)
        set(out.gain, dbToGain(q.out ?? 0))
      }
      update(p)
      goLive()
      return { input: mix.input, output: out, update, dispose: () => disconnectAll([...mix.nodes, shaper, dc, tone, comp, out]) }
    },
  },
  { visual: 'drive', icon: 'flame', enums: { type: DRIVE_TYPES }, tags: 'distortion overdrive saturation fuzz drive grit tube tape' },
)

defineEffect(
  {
    type: 'bitcrush',
    name: 'Bit-crusher / Lo-fi',
    icon: '👾',
    category: 'creative',
    description: 'Turns your sound into a crunchy retro video-game or old-sampler version of itself.',
    params: [
      { key: 'bits', label: 'Bits', min: 1, max: 12, default: 6, step: 1, hint: 'Fewer bits = crunchier, more broken' },
      { key: 'rate', label: 'Sample rate', min: 500, max: 22000, default: 6000, step: 1, unit: 'Hz', curve: 'log', hint: 'Lower = muffled, more retro' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 100, step: 1, unit: '%' },
      { key: 'out', label: 'Output', min: -24, max: 12, default: 0, step: 0.1, unit: 'dB' },
    ],
    presets: {
      '8-bit console': { bits: 4, rate: 8000, mix: 100 },
      'Old sampler': { bits: 10, rate: 12000, mix: 100 },
      'Broken radio': { bits: 2, rate: 3000, mix: 60 },
      'Just a little': { bits: 8, rate: 16000, mix: 40 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const mix = wetDry(ctx)
      const q1 = ctx.createWaveShaper()
      q1.oversample = 'none'
      const lp1 = ctx.createBiquadFilter(), lp2 = ctx.createBiquadFilter()
      lp1.type = lp2.type = 'lowpass'
      lp1.Q.value = 2 // a little resonant bump like old samplers
      lp2.Q.value = -3
      const out = ctx.createGain()
      mix.input.connect(q1).connect(lp1).connect(lp2).connect(mix.wet)
      mix.output.connect(out)
      let lastBits = -1
      const update = (q: Record<string, number>) => {
        const bits = Math.max(1, Math.min(12, Math.round(q.bits ?? 6)))
        if (bits !== lastBits) {
          lastBits = bits
          const levels = Math.pow(2, bits) / 2
          const size = Math.min(65537, Math.max(8193, levels * 32 + 1))
          q1.curve = makeCurve((x) => Math.round(x * levels) / levels, size)
        }
        const r = Math.min(ctx.sampleRate / 2 - 100, (q.rate ?? 6000) / 2)
        set(lp1.frequency, r)
        set(lp2.frequency, r)
        const g = mix.gains(q.mix ?? 100)
        set(mix.dry.gain, g.dry)
        set(mix.wet.gain, g.wet)
        set(out.gain, dbToGain(q.out ?? 0))
      }
      update(p)
      goLive()
      return { input: mix.input, output: out, update, dispose: () => disconnectAll([...mix.nodes, q1, lp1, lp2, out]) }
    },
  },
  { visual: 'drive', icon: 'crush', tags: 'bitcrusher lofi retro 8bit chiptune sample rate' },
)
