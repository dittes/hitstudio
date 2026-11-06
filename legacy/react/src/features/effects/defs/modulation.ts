// Modulation: Chorus, Flanger, Phaser, Wah-wah, Tremolo / Auto-pan.
// LFOs are OscillatorNodes driving AudioParams (sample-accurate, works offline too).
import { DIVISIONS, WAVES, defineEffect, disconnectAll, makeCurve, onBpmChange, paramSetter, projectBpm, stereoGain, stopAll, wetDry } from './shared'

/** Stereo modulated-delay core shared by chorus & flanger. */
function modDelay(ctx: BaseAudioContext, withFeedback: boolean) {
  const mix = wetDry(ctx)
  const inp = stereoGain(ctx)
  const split = ctx.createChannelSplitter(2)
  const merge = ctx.createChannelMerger(2)
  const dL = ctx.createDelay(0.1), dR = ctx.createDelay(0.1)
  const lfo = ctx.createOscillator()
  const lfo2 = ctx.createOscillator()
  const depL = ctx.createGain(), depR = ctx.createGain(), dep2L = ctx.createGain(), dep2R = ctx.createGain()
  const fbL = ctx.createGain(), fbR = ctx.createGain()
  mix.input.connect(inp).connect(split)
  split.connect(dL, 0)
  split.connect(dR, 1)
  dL.connect(merge, 0, 0)
  dR.connect(merge, 0, 1)
  merge.connect(mix.wet)
  lfo.connect(depL).connect(dL.delayTime)
  lfo.connect(depR).connect(dR.delayTime)
  lfo2.connect(dep2L).connect(dL.delayTime)
  lfo2.connect(dep2R).connect(dR.delayTime)
  if (withFeedback) {
    dL.connect(fbL).connect(dL)
    dR.connect(fbR).connect(dR)
  }
  lfo.start()
  lfo2.start()
  return {
    mix, dL, dR, lfo, lfo2, depL, depR, dep2L, dep2R, fbL, fbR,
    dispose() {
      stopAll([lfo, lfo2])
      disconnectAll([...mix.nodes, inp, split, merge, dL, dR, lfo, lfo2, depL, depR, dep2L, dep2R, fbL, fbR])
    },
  }
}

defineEffect(
  {
    type: 'chorus',
    name: 'Chorus',
    icon: '👥',
    category: 'modulation',
    description: 'Thickens the sound as if several players played together – lush, wide and shimmery.',
    params: [
      { key: 'rate', label: 'Speed', min: 0.05, max: 5, default: 0.8, step: 0.01, unit: 'Hz', curve: 'log', hint: 'How fast the shimmer moves' },
      { key: 'depth', label: 'Depth', min: 0, max: 100, default: 45, step: 1, unit: '%', hint: 'How strong the wobble is' },
      { key: 'delay', label: 'Delay', min: 5, max: 35, default: 15, step: 0.1, unit: 'ms', hint: 'Bigger = more doubled, less shimmery' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 50, step: 1, unit: '%' },
    ],
    presets: {
      'Subtle': { rate: 0.5, depth: 25, delay: 12, mix: 35 },
      'Lush': { rate: 0.9, depth: 60, delay: 18, mix: 50 },
      '80s guitar': { rate: 1.6, depth: 50, delay: 8, mix: 50 },
      'Doubler': { rate: 0.2, depth: 15, delay: 28, mix: 45 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const m = modDelay(ctx, false)
      const update = (q: Record<string, number>) => {
        const base = (q.delay ?? 15) / 1000
        const depth = ((q.depth ?? 45) / 100) * Math.min(base * 0.9, 0.006)
        set(m.dL.delayTime, base)
        set(m.dR.delayTime, base)
        set(m.lfo.frequency, q.rate ?? 0.8)
        set(m.lfo2.frequency, (q.rate ?? 0.8) * 1.37)
        set(m.depL.gain, depth * 0.7)
        set(m.depR.gain, -depth * 0.7)
        set(m.dep2L.gain, depth * 0.3)
        set(m.dep2R.gain, depth * 0.3)
        const g = m.mix.gains(q.mix ?? 50)
        set(m.mix.dry.gain, g.dry)
        set(m.mix.wet.gain, g.wet)
      }
      update(p)
      goLive()
      return { input: m.mix.input, output: m.mix.output, update, dispose: m.dispose }
    },
  },
  { visual: 'lfo', icon: 'chorus', tags: 'chorus thick double ensemble shimmer' },
)

defineEffect(
  {
    type: 'flanger',
    name: 'Flanger',
    icon: '✈️',
    category: 'modulation',
    description: 'A sweeping "jet plane" whoosh made by a tiny moving echo.',
    params: [
      { key: 'rate', label: 'Speed', min: 0.02, max: 5, default: 0.25, step: 0.01, unit: 'Hz', curve: 'log', hint: 'How fast the whoosh sweeps' },
      { key: 'depth', label: 'Depth', min: 0, max: 100, default: 70, step: 1, unit: '%', hint: 'How wide the sweep is' },
      { key: 'delay', label: 'Delay', min: 0.5, max: 10, default: 2.5, step: 0.1, unit: 'ms', hint: 'Centre of the sweep' },
      { key: 'feedback', label: 'Intensity', min: -95, max: 95, default: 55, step: 1, unit: '%', hint: 'Makes the sweep more metallic and resonant' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 50, step: 1, unit: '%' },
    ],
    presets: {
      'Jet': { rate: 0.15, depth: 85, delay: 3, feedback: 75, mix: 50 },
      'Gentle swirl': { rate: 0.3, depth: 50, delay: 2, feedback: 30, mix: 40 },
      'Metal robot': { rate: 2.5, depth: 30, delay: 1.2, feedback: -85, mix: 55 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const m = modDelay(ctx, true)
      const update = (q: Record<string, number>) => {
        const base = (q.delay ?? 2.5) / 1000
        const depth = ((q.depth ?? 70) / 100) * base * 0.95
        set(m.dL.delayTime, base)
        set(m.dR.delayTime, base)
        set(m.lfo.frequency, q.rate ?? 0.25)
        set(m.lfo2.frequency, 0.0001)
        set(m.depL.gain, depth)
        set(m.depR.gain, depth * 0.85)
        set(m.dep2L.gain, 0)
        set(m.dep2R.gain, 0)
        const fb = Math.max(-0.95, Math.min(0.95, (q.feedback ?? 55) / 100))
        set(m.fbL.gain, fb)
        set(m.fbR.gain, fb)
        const g = m.mix.gains(q.mix ?? 50)
        set(m.mix.dry.gain, g.dry)
        set(m.mix.wet.gain, g.wet)
      }
      update(p)
      goLive()
      return { input: m.mix.input, output: m.mix.output, update, dispose: m.dispose }
    },
  },
  { visual: 'lfo', icon: 'flanger', tags: 'flange jet whoosh sweep' },
)

defineEffect(
  {
    type: 'phaser',
    name: 'Phaser',
    icon: '🌊',
    category: 'modulation',
    description: 'A swirly, spacey sweep – classic on keyboards, guitars and synths.',
    params: [
      { key: 'rate', label: 'Speed', min: 0.02, max: 8, default: 0.4, step: 0.01, unit: 'Hz', curve: 'log', hint: 'How fast it swirls' },
      { key: 'depth', label: 'Depth', min: 0, max: 100, default: 70, step: 1, unit: '%', hint: 'How wide the swirl sweeps' },
      { key: 'freq', label: 'Centre', min: 100, max: 4000, default: 700, step: 1, unit: 'Hz', curve: 'log', hint: 'Where in the sound the swirl happens' },
      { key: 'stages', label: 'Stages', min: 2, max: 12, default: 6, step: 2, hint: 'More stages = deeper, more dramatic notches' },
      { key: 'feedback', label: 'Feedback', min: 0, max: 90, default: 40, step: 1, unit: '%', hint: 'Makes the swirl sharper and more resonant' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 50, step: 1, unit: '%' },
    ],
    presets: {
      'Slow swirl': { rate: 0.2, depth: 80, freq: 600, stages: 6, feedback: 30, mix: 50 },
      'Funky': { rate: 1.2, depth: 70, freq: 900, stages: 4, feedback: 60, mix: 50 },
      'Deep space': { rate: 0.08, depth: 95, freq: 400, stages: 12, feedback: 70, mix: 55 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const mix = wetDry(ctx)
      const filters = Array.from({ length: 12 }, () => {
        const f = ctx.createBiquadFilter()
        f.type = 'allpass'
        f.Q.value = 0.6
        return f
      })
      const lfo = ctx.createOscillator()
      const dep = ctx.createGain()
      const fb = ctx.createGain()
      const fbDelay = ctx.createDelay(0.01)
      fbDelay.delayTime.value = 0
      const wetIn = ctx.createGain()
      lfo.connect(dep)
      filters.forEach((f) => dep.connect(f.frequency))
      mix.input.connect(wetIn)
      fb.connect(fbDelay).connect(wetIn)
      lfo.start()
      let stages = -1
      const wire = (n: number) => {
        wetIn.disconnect()
        filters.forEach((f) => f.disconnect())
        let cur: AudioNode = wetIn
        for (let i = 0; i < n; i++) cur = cur.connect(filters[i])
        cur.connect(mix.wet)
        cur.connect(fb)
      }
      const update = (q: Record<string, number>) => {
        const n = Math.max(2, Math.min(12, Math.round((q.stages ?? 6) / 2) * 2))
        if (n !== stages) {
          stages = n
          wire(n)
        }
        const f0 = q.freq ?? 700
        const d = (q.depth ?? 70) / 100
        filters.forEach((f) => set(f.frequency, f0))
        set(dep.gain, f0 * 0.9 * d)
        set(lfo.frequency, q.rate ?? 0.4)
        set(fb.gain, (q.feedback ?? 40) / 100 * 0.9)
        const g = mix.gains(q.mix ?? 50)
        set(mix.dry.gain, g.dry)
        set(mix.wet.gain, g.wet)
      }
      update(p)
      goLive()
      return {
        input: mix.input,
        output: mix.output,
        update,
        dispose() {
          stopAll([lfo])
          disconnectAll([...mix.nodes, ...filters, lfo, dep, fb, fbDelay, wetIn])
        },
      }
    },
  },
  { visual: 'lfo', icon: 'phaser', tags: 'phase swirl sweep' },
)

export const WAH_MODES = ['Auto (wobble)', 'Touch (follows you)']

defineEffect(
  {
    type: 'wah',
    name: 'Wah-wah',
    icon: '🎸',
    category: 'modulation',
    description: 'The talking "wah-wah" guitar sound – either wobbling by itself or reacting to how hard you play.',
    params: [
      { key: 'mode', label: 'Mode', min: 0, max: 1, default: 0, step: 1 },
      { key: 'rate', label: 'Speed', min: 0.1, max: 8, default: 1.5, step: 0.01, unit: 'Hz', curve: 'log', hint: 'How fast it says "wah" (auto mode)' },
      { key: 'sens', label: 'Sensitivity', min: 0, max: 100, default: 60, step: 1, unit: '%', hint: 'How strongly it reacts to your playing (touch mode)' },
      { key: 'low', label: 'Low point', min: 200, max: 1500, default: 350, step: 1, unit: 'Hz', curve: 'log', hint: 'Lowest "ooo" sound of the sweep' },
      { key: 'range', label: 'Range', min: 100, max: 3500, default: 1800, step: 1, unit: 'Hz', curve: 'log', hint: 'How far up it sweeps to "aaa"' },
      { key: 'reso', label: 'Resonance', min: 1, max: 15, default: 5, step: 0.1, hint: 'Sharper, more vocal "wah"' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 85, step: 1, unit: '%' },
    ],
    presets: {
      'Funk guitar': { mode: 1, sens: 70, low: 400, range: 2200, reso: 6, mix: 90 },
      'Slow wobble': { mode: 0, rate: 0.7, low: 300, range: 1500, reso: 5, mix: 85 },
      'Fast quack': { mode: 0, rate: 4, low: 450, range: 1800, reso: 8, mix: 80 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const mix = wetDry(ctx)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      const makeup = ctx.createGain()
      mix.input.connect(bp).connect(makeup).connect(mix.wet)
      const lfo = ctx.createOscillator()
      const lfoDep = ctx.createGain()
      lfo.connect(lfoDep).connect(bp.frequency)
      lfo.start()
      // envelope follower for touch mode
      const rect = ctx.createWaveShaper()
      rect.curve = makeCurve(Math.abs, 4097)
      const env = ctx.createBiquadFilter()
      env.type = 'lowpass'
      env.frequency.value = 9
      env.Q.value = -6
      const envDep = ctx.createGain()
      mix.input.connect(rect).connect(env).connect(envDep).connect(bp.frequency)
      const update = (q: Record<string, number>) => {
        const low = q.low ?? 350
        const range = q.range ?? 1800
        const touch = (q.mode ?? 0) >= 0.5
        set(bp.Q, q.reso ?? 5)
        set(makeup.gain, Math.sqrt(q.reso ?? 5) * 1.1)
        set(lfo.frequency, q.rate ?? 1.5)
        if (touch) {
          set(bp.frequency, low)
          set(lfoDep.gain, 0)
          set(envDep.gain, range * (2 + ((q.sens ?? 60) / 100) * 18))
        } else {
          set(bp.frequency, low + range / 2)
          set(lfoDep.gain, range / 2)
          set(envDep.gain, 0)
        }
        const g = mix.gains(q.mix ?? 85)
        set(mix.dry.gain, g.dry)
        set(mix.wet.gain, g.wet)
      }
      update(p)
      goLive()
      return {
        input: mix.input,
        output: mix.output,
        update,
        dispose() {
          stopAll([lfo])
          disconnectAll([...mix.nodes, bp, makeup, lfo, lfoDep, rect, env, envDep])
        },
      }
    },
  },
  { visual: 'lfo', icon: 'wah', enums: { mode: WAH_MODES }, tags: 'wah auto-wah envelope filter funk', showIf: { rate: (p) => (p.mode ?? 0) < 0.5, sens: (p) => (p.mode ?? 0) >= 0.5 } },
)

export const TREM_MODES = ['Tremolo', 'Auto-pan']
const SHAPES = ['Smooth', 'Triangle', 'Choppy']

export function lfoRate(q: Record<string, number>, bpm = projectBpm()) {
  if ((q.sync ?? 0) >= 0.5) {
    const div = DIVISIONS[Math.round(q.div ?? 1)] ?? DIVISIONS[1]
    return bpm / 60 / div.beats
  }
  return q.rate ?? 4
}

defineEffect(
  {
    type: 'tremolo',
    name: 'Tremolo / Auto-pan',
    icon: '〰️',
    category: 'modulation',
    description: 'Pulses the volume up and down, or bounces the sound between left and right speakers.',
    params: [
      { key: 'mode', label: 'Mode', min: 0, max: 1, default: 0, step: 1 },
      { key: 'sync', label: 'Sync to beat', min: 0, max: 1, default: 0, step: 1, hint: 'Lock the pulse to the song tempo' },
      { key: 'div', label: 'Note', min: 0, max: DIVISIONS.length - 1, default: 1, step: 1 },
      { key: 'rate', label: 'Speed', min: 0.1, max: 20, default: 4, step: 0.01, unit: 'Hz', curve: 'log', hint: 'Pulses per second' },
      { key: 'depth', label: 'Depth', min: 0, max: 100, default: 60, step: 1, unit: '%', hint: 'How strong the pulsing is' },
      { key: 'shape', label: 'Shape', min: 0, max: 2, default: 0, step: 1 },
    ],
    presets: {
      'Surf guitar': { mode: 0, sync: 0, rate: 6, depth: 60, shape: 0 },
      'Helicopter': { mode: 0, sync: 1, div: 0, depth: 100, shape: 2 },
      'Slow pan': { mode: 1, sync: 0, rate: 0.25, depth: 80, shape: 0 },
      'Beat pan': { mode: 1, sync: 1, div: 3, depth: 70, shape: 1 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const vca = ctx.createGain()
      const pan = ctx.createStereoPanner()
      const lfo = ctx.createOscillator()
      const smoothSq = ctx.createBiquadFilter() // tames clicks of the square wave
      smoothSq.type = 'lowpass'
      smoothSq.frequency.value = 60
      const tDep = ctx.createGain(), pDep = ctx.createGain()
      vca.connect(pan)
      lfo.connect(smoothSq)
      smoothSq.connect(tDep).connect(vca.gain)
      smoothSq.connect(pDep).connect(pan.pan)
      lfo.start()
      let cur = p
      const update = (q: Record<string, number>) => {
        cur = q
        lfo.type = WAVES[Math.round(q.shape ?? 0)] ?? 'sine'
        set(lfo.frequency, lfoRate(q))
        set(smoothSq.frequency, Math.max(30, lfoRate(q) * 12))
        const d = (q.depth ?? 60) / 100
        const panMode = (q.mode ?? 0) >= 0.5
        set(vca.gain, panMode ? 1 : 1 - d / 2)
        set(tDep.gain, panMode ? 0 : d / 2)
        set(pDep.gain, panMode ? d : 0)
      }
      update(p)
      goLive()
      const unsub = onBpmChange(() => update(cur))
      return {
        input: vca,
        output: pan,
        update,
        dispose() {
          unsub()
          stopAll([lfo])
          disconnectAll([vca, pan, lfo, smoothSq, tDep, pDep])
        },
      }
    },
  },
  {
    visual: 'lfo',
    icon: 'tremolo',
    enums: { mode: TREM_MODES, shape: SHAPES, div: DIVISIONS.map((d) => d.label) },
    toggles: ['sync'],
    tags: 'tremolo pan autopan pulse volume wobble',
    showIf: { div: (p) => (p.sync ?? 0) >= 0.5, rate: (p) => (p.sync ?? 0) < 0.5 },
  },
)
