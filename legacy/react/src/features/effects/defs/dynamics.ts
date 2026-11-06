// Dynamics: Compressor, Limiter, Noise gate.
import { dbToGain } from '../../../core/ids'
import { compressorAutoMakeupDb, defineEffect, disconnectAll, makeCurve, paramSetter, wetDry } from './shared'

defineEffect(
  {
    type: 'compressor',
    name: 'Compressor',
    icon: '🗜️',
    category: 'dynamics',
    description: 'Makes loud parts quieter so everything sits evenly — punchier drums, steadier vocals.',
    params: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, default: -18, step: 0.1, unit: 'dB', hint: 'Sounds louder than this get turned down' },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, step: 0.1, curve: 'log', hint: 'How hard to squash: 2 = gentle, 10+ = very strong' },
      { key: 'attack', label: 'Attack', min: 0.1, max: 200, default: 10, step: 0.1, unit: 'ms', curve: 'log', hint: 'How fast it reacts. Slower lets the punch through' },
      { key: 'release', label: 'Release', min: 10, max: 1000, default: 150, step: 1, unit: 'ms', curve: 'log', hint: 'How fast it lets go after a loud part' },
      { key: 'knee', label: 'Knee', min: 0, max: 40, default: 6, step: 0.1, unit: 'dB', hint: 'Soft knee = smoother, more natural squashing' },
      { key: 'makeup', label: 'Makeup', min: 0, max: 24, default: 4, step: 0.1, unit: 'dB', hint: 'Turns everything back up after squashing' },
      { key: 'mix', label: 'Mix', min: 0, max: 100, default: 100, step: 1, unit: '%', hint: 'Less than 100% = "parallel" compression: punch with natural dynamics' },
    ],
    presets: {
      'Gentle glue': { threshold: -14, ratio: 2, attack: 30, release: 200, knee: 12, makeup: 2, mix: 100 },
      'Vocal leveler': { threshold: -22, ratio: 4, attack: 5, release: 120, knee: 8, makeup: 6, mix: 100 },
      'Punchy drums': { threshold: -20, ratio: 6, attack: 25, release: 80, knee: 3, makeup: 5, mix: 100 },
      'New York (parallel)': { threshold: -35, ratio: 12, attack: 2, release: 100, knee: 2, makeup: 12, mix: 40 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const mix = wetDry(ctx)
      const comp = ctx.createDynamicsCompressor()
      const makeup = ctx.createGain()
      mix.input.connect(comp).connect(makeup).connect(mix.wet)
      const update = (q: Record<string, number>) => {
        set(comp.threshold, q.threshold ?? -18)
        set(comp.ratio, q.ratio ?? 4)
        set(comp.attack, (q.attack ?? 10) / 1000)
        set(comp.release, (q.release ?? 150) / 1000)
        set(comp.knee, q.knee ?? 6)
        const auto = compressorAutoMakeupDb(q.threshold ?? -18, q.knee ?? 6, q.ratio ?? 4)
        set(makeup.gain, dbToGain((q.makeup ?? 0) - auto))
        const m = Math.min(1, Math.max(0, (q.mix ?? 100) / 100))
        set(mix.dry.gain, 1 - m)
        set(mix.wet.gain, m)
      }
      update(p)
      goLive()
      return {
        input: mix.input,
        output: mix.output,
        update,
        probe: () => ({ reduction: comp.reduction }),
        dispose: () => disconnectAll([...mix.nodes, comp, makeup]),
      }
    },
  },
  { visual: 'comp', icon: 'comp', tags: 'dynamics squash level punch glue' },
)

defineEffect(
  {
    type: 'limiter',
    name: 'Limiter',
    icon: '🧱',
    category: 'dynamics',
    description: 'A brick wall for volume: makes things louder without ever going over the top.',
    params: [
      { key: 'gain', label: 'Loudness', min: 0, max: 24, default: 3, step: 0.1, unit: 'dB', hint: 'Pushes the sound into the wall – louder overall' },
      { key: 'ceiling', label: 'Ceiling', min: -12, max: 0, default: -1, step: 0.1, unit: 'dB', hint: 'The wall: nothing will ever be louder than this' },
      { key: 'release', label: 'Release', min: 10, max: 800, default: 100, step: 1, unit: 'ms', curve: 'log', hint: 'Shorter = louder but can pump' },
    ],
    presets: {
      'Safe': { gain: 0, ceiling: -1, release: 120 },
      'Louder': { gain: 4, ceiling: -1, release: 100 },
      'Loudest': { gain: 9, ceiling: -0.5, release: 50 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const pre = ctx.createGain()
      const comp = ctx.createDynamicsCompressor()
      comp.knee.value = 0
      comp.ratio.value = 20
      comp.attack.value = 0.001
      const clip = ctx.createWaveShaper()
      clip.oversample = '4x'
      const unMakeup = ctx.createGain()
      pre.connect(comp).connect(unMakeup).connect(clip)
      let lastCeil = NaN
      const update = (q: Record<string, number>) => {
        const ceil = q.ceiling ?? -1
        set(pre.gain, dbToGain(q.gain ?? 0))
        set(comp.threshold, ceil - 2)
        set(unMakeup.gain, dbToGain(-compressorAutoMakeupDb(ceil - 2, 0, 20)))
        set(comp.release, (q.release ?? 100) / 1000)
        if (ceil !== lastCeil) {
          lastCeil = ceil
          const c = dbToGain(ceil)
          // linear up to 70% of the ceiling, then a soft knee into a flat wall
          clip.curve = makeCurve((x) => {
            const ax = Math.abs(x), k = c * 0.7
            const y = ax <= k ? ax : k + (c - k) * Math.tanh((ax - k) / (c - k))
            return Math.sign(x) * Math.min(c, y)
          }, 8193)
        }
      }
      update(p)
      goLive()
      return {
        input: pre,
        output: clip,
        update,
        probe: () => ({ reduction: comp.reduction }),
        dispose: () => disconnectAll([pre, comp, unMakeup, clip]),
      }
    },
  },
  { visual: 'comp', icon: 'limiter', tags: 'loud maximizer master ceiling brickwall' },
)

defineEffect(
  {
    type: 'gate',
    name: 'Noise Gate',
    icon: '🚪',
    category: 'dynamics',
    description: 'Mutes the quiet bits between words or hits, so hiss and room noise disappear in the gaps.',
    params: [
      { key: 'threshold', label: 'Threshold', min: -80, max: 0, default: -45, step: 0.5, unit: 'dB', hint: 'Anything quieter than this gets turned down' },
      { key: 'range', label: 'Range', min: 0, max: 80, default: 40, step: 0.5, unit: 'dB', hint: 'How much to turn the quiet parts down' },
      { key: 'attack', label: 'Open speed', min: 0.5, max: 50, default: 3, step: 0.1, unit: 'ms', curve: 'log', hint: 'How quickly the gate opens when sound starts' },
      { key: 'release', label: 'Close speed', min: 10, max: 1000, default: 120, step: 1, unit: 'ms', curve: 'log', hint: 'How slowly it closes after the sound stops' },
    ],
    presets: {
      'Clean voice': { threshold: -48, range: 25, attack: 3, release: 150 },
      'Tight drums': { threshold: -30, range: 60, attack: 0.5, release: 60 },
      'Hiss killer': { threshold: -55, range: 18, attack: 5, release: 250 },
    },
    create(ctx, p) {
      const { set, goLive } = paramSetter(ctx)
      const input = ctx.createGain()
      const vca = ctx.createGain()
      vca.gain.value = 0
      input.connect(vca)
      // side chain: |x| → envelope (low-pass) → threshold curve → smoothing → vca.gain
      const rect = ctx.createWaveShaper()
      rect.curve = makeCurve(Math.abs, 4097)
      const env = ctx.createBiquadFilter()
      env.type = 'lowpass'
      env.Q.value = -6
      const pre = ctx.createGain()
      const curve = ctx.createWaveShaper()
      const smooth = ctx.createBiquadFilter()
      smooth.type = 'lowpass'
      smooth.Q.value = -6
      const probeA = ctx.createAnalyser()
      probeA.fftSize = 256
      input.connect(rect).connect(env).connect(pre).connect(curve).connect(smooth)
      smooth.connect(vca.gain)
      smooth.connect(probeA)
      let lastRange = NaN
      const update = (q: Record<string, number>) => {
        const thr = dbToGain(q.threshold ?? -45)
        // rectified average ≈ 0.64 × peak for sines; compensate so threshold feels like a peak level
        set(pre.gain, 0.5 / (thr * 0.64))
        set(env.frequency, 1 / (2 * Math.PI * ((q.release ?? 120) / 1000)) * 2.2)
        set(smooth.frequency, 1 / (2 * Math.PI * ((q.attack ?? 3) / 1000)))
        const range = q.range ?? 40
        if (range !== lastRange) {
          lastRange = range
          const floorDb = -range
          curve.curve = makeCurve((x) => {
            if (x <= 0) return dbToGain(floorDb)
            const r = x / 0.5 // 1 at threshold
            if (r >= 1) return 1
            if (r <= 0.5) return dbToGain(floorDb)
            const t = (r - 0.5) / 0.5 // soft 6 dB knee
            return dbToGain(floorDb * (1 - t * t * (3 - 2 * t)))
          }, 8193)
        }
      }
      update(p)
      goLive()
      const buf = new Float32Array(256)
      return {
        input,
        output: vca,
        update,
        probe: () => {
          probeA.getFloatTimeDomainData(buf)
          return { open: Math.max(0, Math.min(1, buf[buf.length - 1])) }
        },
        dispose: () => disconnectAll([input, vca, rect, env, pre, curve, smooth, probeA]),
      }
    },
  },
  { icon: 'gate', visual: 'comp', tags: 'gate expander noise hiss silence' },
)
