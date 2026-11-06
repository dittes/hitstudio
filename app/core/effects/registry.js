// Real-time effect registry. Every insert effect (track or master) is built
// from a definition here. Works on AudioContext AND OfflineAudioContext, so the
// same chain is used for live playback and for export rendering.
//
// Feature code registers more effects with `registerEffect(def)` (see
// features/effects). Keep `create` synchronous & context-agnostic.

const defs = new Map                   ()

export function registerEffect(def           ) {
  defs.set(def.type, def)
}
export function getEffect(type        ) {
  return defs.get(type)
}
export function allEffects()              {
  return [...defs.values()]
}
export function defaultParams(type        )                         {
  const d = defs.get(type)
  const out                         = {}
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
    const update = (q                        ) => {
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
