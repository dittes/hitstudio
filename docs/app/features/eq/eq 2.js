// Master equalizer: 10 fixed bands after the master fader, so it shapes everything you hear
// (song list, Beat Maker, DJ decks and the studio mix) and is included in exports.
// State lives in project.master.eq = { enabled, gains: number[10], preset }. Older projects have
// no eq field; eqOf() treats that as flat.

export const EQ_BANDS = [
  { f: 31, label: '31', type: 'lowshelf' },
  { f: 62, label: '62', type: 'peaking' },
  { f: 125, label: '125', type: 'peaking' },
  { f: 250, label: '250', type: 'peaking' },
  { f: 500, label: '500', type: 'peaking' },
  { f: 1000, label: '1k', type: 'peaking' },
  { f: 2000, label: '2k', type: 'peaking' },
  { f: 4000, label: '4k', type: 'peaking' },
  { f: 8000, label: '8k', type: 'peaking' },
  { f: 16000, label: '16k', type: 'highshelf' },
]
export const EQ_RANGE = 12
const Q = 1.41

/** Presets, in the order they appear on the Equalizer screen. */
export const EQ_PRESETS = [
  { id: 'flat', name: 'Flat', hint: 'No change', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass-boost', name: 'Bass boost', hint: 'More low end', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'bass-cut', name: 'Bass cut', hint: 'Less boom', gains: [-7, -5, -3, -1, 0, 0, 0, 0, 0, 0] },
  { id: 'treble-boost', name: 'Treble boost', hint: 'More sparkle', gains: [0, 0, 0, 0, 0, 0, 1, 3, 5, 6] },
  { id: 'loudness', name: 'Loudness', hint: 'Lows and highs up, for quiet listening', gains: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5] },
  { id: 'vocal', name: 'Vocal', hint: 'Voices come forward', gains: [-3, -2, -1, 0, 2, 3, 3, 2, 0, -1] },
  { id: 'warm', name: 'Warm', hint: 'Soft and full', gains: [2, 3, 2, 1, 0, 0, -1, -2, -2, -3] },
  { id: 'bright', name: 'Bright', hint: 'Crisp and airy', gains: [-1, -1, 0, 0, 0, 1, 2, 3, 4, 4] },
  { id: 'club', name: 'Club', hint: 'Punchy bass, clear top', gains: [5, 4, 3, 1, 0, -1, 0, 1, 2, 3] },
  { id: 'acoustic', name: 'Acoustic', hint: 'Natural body and detail', gains: [2, 2, 1, 0, 1, 1, 2, 2, 2, 1] },
  { id: 'speech', name: 'Speech', hint: 'Podcasts and voice memos', gains: [-8, -6, -3, 0, 1, 2, 3, 2, 0, -2] },
  { id: 'lofi', name: 'Lo-fi', hint: 'Muffled, old-radio feel', gains: [-6, -2, 1, 2, 2, 1, -1, -4, -8, -12] },
]

export const FLAT_EQ = Object.freeze({ enabled: true, gains: EQ_PRESETS[0].gains, preset: 'flat' })

/** The project's EQ, normalized (missing or malformed → flat). */
export function eqOf(p) {
  const eq = p?.master?.eq
  if (!eq || !Array.isArray(eq.gains) || eq.gains.length !== EQ_BANDS.length) return FLAT_EQ
  return {
    enabled: eq.enabled !== false,
    gains: eq.gains.map((g) => Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Number(g) || 0))),
    preset: typeof eq.preset === 'string' ? eq.preset : 'custom',
  }
}

/** True when the EQ actually changes the sound. */
export const eqActive = (eq) => eq.enabled && eq.gains.some((g) => Math.abs(g) >= 0.05)

export const presetById = (id) => EQ_PRESETS.find((p) => p.id === id)
export function eqLabel(eq) {
  return presetById(eq.preset)?.name ?? 'Custom'
}

/** Automatic headroom: pull the level down by half the largest boost so boosts don't slam the limiter. */
export const eqHeadroomDb = (eq) => (eqActive(eq) ? -Math.max(0, ...eq.gains) / 2 : 0)

/** Create the band filters on any (live or offline) audio context. */
export function makeEqFilters(ctx) {
  return EQ_BANDS.map((b) => {
    const f = ctx.createBiquadFilter()
    f.type = b.type
    f.frequency.value = b.f
    if (b.type === 'peaking') f.Q.value = Q
    f.gain.value = 0
    return f
  })
}

/** input → trim → band filters → output. `apply(eq)` updates it smoothly on a live context. */
export function buildEq(ctx, eq = FLAT_EQ) {
  const input = ctx.createGain()
  const trim = ctx.createGain()
  const filters = makeEqFilters(ctx)
  input.connect(trim)
  filters.reduce((prev, f) => (prev.connect(f), f), trim)
  const output = filters[filters.length - 1]
  const live = typeof ctx.startRendering !== 'function'
  const set = (param, value) => {
    if (live) param.setTargetAtTime(value, ctx.currentTime, 0.02)
    else param.value = value
  }
  const apply = (next) => {
    const on = eqActive(next)
    filters.forEach((f, i) => set(f.gain, on ? next.gains[i] : 0))
    set(trim.gain, Math.pow(10, eqHeadroomDb(next) / 20))
  }
  apply(eq)
  return { input, output, filters, apply }
}
