// Real-time effect registry. Every insert effect (track or master) is built
// from a definition here. Works on AudioContext AND OfflineAudioContext, so the
// same chain is used for live playback and for export rendering.
//
// Feature code registers more effects with `registerEffect(def)` (see
// features/effects). Keep `create` synchronous & context-agnostic.

export interface EffectParamDef {
  key: string
  label: string
  min: number
  max: number
  default: number
  step?: number
  unit?: string
  /** 'log' for frequency-like params */
  curve?: 'lin' | 'log'
  /** short beginner-friendly explanation */
  hint?: string
}

export interface EffectNode {
  input: AudioNode
  output: AudioNode
  /** apply new params (called live while the user drags) */
  update(params: Record<string, number>): void
  dispose(): void
  /** optional: analyser for the effect UI (e.g. EQ curve, gain reduction) */
  probe?: () => Record<string, number>
}

export interface EffectDef {
  type: string
  name: string
  /** emoji or short glyph shown on the effect card */
  icon: string
  category: 'tone' | 'space' | 'dynamics' | 'modulation' | 'creative' | 'utility'
  /** one sentence, beginner language */
  description: string
  params: EffectParamDef[]
  /** named parameter presets */
  presets?: Record<string, Record<string, number>>
  create(ctx: BaseAudioContext, params: Record<string, number>): EffectNode
}

const defs = new Map<string, EffectDef>()

export function registerEffect(def: EffectDef) {
  defs.set(def.type, def)
}
export function getEffect(type: string) {
  return defs.get(type)
}
export function allEffects(): EffectDef[] {
  return [...defs.values()]
}
export function defaultParams(type: string): Record<string, number> {
  const d = defs.get(type)
  const out: Record<string, number> = {}
  d?.params.forEach((p) => (out[p.key] = p.default))
  return out
}

// ── built-in starter: 3-band EQ (reference implementation) ──
registerEffect({
  type: 'eq3',
  name: 'Tone (EQ)',
  icon: '🎚️',
  category: 'tone',
  description: 'Make it brighter, warmer or punchier by boosting or cutting lows, mids and highs.',
  params: [
    { key: 'low', label: 'Low', min: -18, max: 18, default: 0, step: 0.1, unit: 'dB', hint: 'Bass and rumble' },
    { key: 'mid', label: 'Mid', min: -18, max: 18, default: 0, step: 0.1, unit: 'dB', hint: 'Body of voices and instruments' },
    { key: 'high', label: 'High', min: -18, max: 18, default: 0, step: 0.1, unit: 'dB', hint: 'Air and sparkle' },
  ],
  presets: {
    Warm: { low: 3, mid: -1, high: -2 },
    Bright: { low: -1, mid: 0, high: 4 },
    'Phone call': { low: -18, mid: 6, high: -18 },
  },
  create(ctx, p) {
    const low = ctx.createBiquadFilter()
    low.type = 'lowshelf'
    low.frequency.value = 250
    const mid = ctx.createBiquadFilter()
    mid.type = 'peaking'
    mid.frequency.value = 1200
    mid.Q.value = 0.8
    const high = ctx.createBiquadFilter()
    high.type = 'highshelf'
    high.frequency.value = 5000
    low.connect(mid).connect(high)
    const update = (q: Record<string, number>) => {
      low.gain.value = q.low ?? 0
      mid.gain.value = q.mid ?? 0
      high.gain.value = q.high ?? 0
    }
    update(p)
    return {
      input: low,
      output: high,
      update,
      dispose() {
        low.disconnect(); mid.disconnect(); high.disconnect()
      },
    }
  },
})
