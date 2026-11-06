// Music theory helpers: scales, melody rows, diatonic chords.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const SCALES                                                                                             = {
  major: { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11], chordBase: [0, 2, 4, 5, 7, 9, 11], blurb: 'Happy & bright' },
  minor: { name: 'Minor', intervals: [0, 2, 3, 5, 7, 8, 10], chordBase: [0, 2, 3, 5, 7, 8, 10], blurb: 'Moody & emotional' },
  pentatonic: { name: 'Pentatonic', intervals: [0, 2, 4, 7, 9], chordBase: [0, 2, 4, 5, 7, 9, 11], blurb: 'Impossible to sound bad' },
  dorian: { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10], chordBase: [0, 2, 3, 5, 7, 9, 10], blurb: 'Cool, jazzy minor' },
  blues: { name: 'Blues', intervals: [0, 3, 5, 6, 7, 10], chordBase: [0, 2, 3, 5, 7, 8, 10], blurb: 'Gritty & soulful' },
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

/** keys above F# fold down so the melody register stays comfortable */
export function keyOffset(key        ) {
  return key > 6 ? key - 12 : key
}

export const rowCount = (scale         ) => SCALES[scale].intervals.length * 2 + 1

export function rowMidi(key        , scale         , octave        , row        ) {
  const iv = SCALES[scale].intervals
  const n = iv.length
  return 60 + keyOffset(key) + octave * 12 + Math.floor(row / n) * 12 + iv[row % n]
}

export const midiToFreq = (m        ) => 440 * Math.pow(2, (m - 69) / 12)
export const midiName = (m        ) => NOTE_NAMES[((m % 12) + 12) % 12]
export const midiNameOct = (m        ) => `${midiName(m)}${Math.floor(m / 12) - 1}`
export const isRootRow = (scale         , row        ) => row % SCALES[scale].intervals.length === 0

export const CHORD_EXT = { triad: 'Triads', seventh: '7th chords', ninth: 'Rich 9ths' }

/**
 * Diatonic chord on a pad. `ext` adds the 7th ('seventh') or 7th + 9th ('ninth') for a jazzier colour.
 * `midi` is a plain root-position layout; use voiceChords() to get smooth, voice-led notes for a progression.
 */
export function chordFor(key        , scale         , padIndex        , ext = 'triad')            {
  const cb = SCALES[scale].chordBase
  const k = keyOffset(key)
  const up = padIndex >= 7 ? 12 : 0
  const d = padIndex % 7
  const at = (i        ) => cb[i % 7] + 12 * Math.floor(i / 7)
  const r = at(d)
  const third = at(d + 2) - r
  const fifth = at(d + 4) - r
  const seventh = at(d + 6) - r
  const ninth = at(d + 8) - r
  const quality = third === 3 ? (fifth === 6 ? 'dim' : 'min') : 'maj'
  let root = 48 + k + r
  if (root >= 55) root -= 12
  const tones = ext === 'ninth' ? [0, third, fifth, seventh, ninth] : ext === 'seventh' ? [0, third, fifth, seventh] : [0, third, fifth]
  const midi = (ext === 'triad' ? [root, root + fifth, root + third + 12, root + 12] : tones.map((t) => root + t)).map((m) => m + up)
  const pc = (((48 + k + r) % 12) + 12) % 12
  const bassMidi = 33 + (((pc - 33) % 12) + 12) % 12
  let roman = ROMAN[d]
  if (quality !== 'maj') roman = roman.toLowerCase()
  if (quality === 'dim') roman += '°'
  const rootName = NOTE_NAMES[(((k + r) % 12) + 12) % 12]
  let suffix = quality === 'min' ? 'm' : quality === 'dim' ? 'dim' : ''
  if (ext !== 'triad') {
    const nine = ext === 'ninth'
    if (quality === 'maj') suffix = seventh === 11 ? (nine ? 'maj9' : 'maj7') : nine ? '9' : '7'
    else if (quality === 'min') suffix = seventh === 10 ? (nine ? 'm9' : 'm7') : 'm(maj7)'
    else suffix = seventh === 10 ? 'm7b5' : 'dim7'
  }
  return {
    degree: padIndex,
    roman,
    name: rootName + suffix,
    quality,
    ext,
    tones: tones.map((t) => t + up),
    midi,
    rootMidi: root + up,
    bassMidi,
    semis: [r % 12, (r + third) % 12, (r + fifth) % 12],
  }
}

const voicingCache = new Map()
const LOW = 50
const HIGH = 61
const CENTRE = 63

/** every close-position inversion of a chord with its lowest note between LOW and HIGH */
function candidateVoicings(chord) {
  const pcs = chord.tones.map((t) => ((chord.rootMidi + t) % 12 + 12) % 12)
  const out = []
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)]
    for (let low = LOW; low <= HIGH; low++) {
      if ((((low % 12) + 12) % 12) !== order[0]) continue
      const notes = [low]
      for (let i = 1; i < order.length; i++) {
        let n = notes[i - 1] + 1
        while ((((n % 12) + 12) % 12) !== order[i]) n++
        notes.push(n)
      }
      // triads get the root doubled on top, so every voicing has at least four voices
      if (notes.length === 3) {
        let n = notes[2] + 1
        while ((((n % 12) + 12) % 12) !== pcs[0]) n++
        notes.push(n)
      }
      out.push(notes)
    }
  }
  return out
}

function voicingCost(notes, prev) {
  const mean = notes.reduce((a, b) => a + b, 0) / notes.length
  let cost = Math.abs(mean - CENTRE) * 0.35 + Math.max(0, notes[notes.length - 1] - 76) * 2
  if (prev) {
    // smallest total movement: match each new note to its nearest old one
    const m = Math.min(notes.length, prev.length)
    for (let i = 0; i < m; i++) cost += Math.abs(notes[notes.length - 1 - i] - prev[prev.length - 1 - i])
    cost += Math.abs(notes[notes.length - 1] - prev[prev.length - 1]) * 0.8 // keep the top line singable
  }
  return cost
}

/**
 * Voice-led chords for a whole progression: each chord is the inversion that moves the least from the
 * one before it (and the last one leads back to the first), so the top line glides instead of jumping.
 */
export function voiceChords(key        , scale         , prog          , ext = 'triad')              {
  const id = `${key}|${scale}|${prog.join(',')}|${ext}`
  const hit = voicingCache.get(id)
  if (hit) return hit
  const chords = prog.map((p) => chordFor(key, scale, p ?? 0, ext))
  let voiced = []
  let prev = null
  for (let pass = 0; pass < 2; pass++) {
    voiced = []
    for (const c of chords) {
      let best = null
      let bestCost = Infinity
      for (const v of candidateVoicings(c)) {
        const cost = voicingCost(v, prev)
        if (cost < bestCost) {
          bestCost = cost
          best = v
        }
      }
      voiced.push(best)
      prev = best
    }
    // second pass starts from where the loop ends, so the repeat joins smoothly
  }
  const result = chords.map((c, i) => ({ ...c, midi: voiced[i] }))
  if (voicingCache.size > 200) voicingCache.clear()
  voicingCache.set(id, result)
  return result
}
