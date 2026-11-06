// Music theory helpers: scales, melody rows, diatonic chords.
import type { ScaleId } from './types'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const SCALES: Record<ScaleId, { name: string; intervals: number[]; chordBase: number[]; blurb: string }> = {
  major: { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11], chordBase: [0, 2, 4, 5, 7, 9, 11], blurb: 'Happy & bright' },
  minor: { name: 'Minor', intervals: [0, 2, 3, 5, 7, 8, 10], chordBase: [0, 2, 3, 5, 7, 8, 10], blurb: 'Moody & emotional' },
  pentatonic: { name: 'Pentatonic', intervals: [0, 2, 4, 7, 9], chordBase: [0, 2, 4, 5, 7, 9, 11], blurb: 'Impossible to sound bad' },
  dorian: { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10], chordBase: [0, 2, 3, 5, 7, 9, 10], blurb: 'Cool, jazzy minor' },
  blues: { name: 'Blues', intervals: [0, 3, 5, 6, 7, 10], chordBase: [0, 2, 3, 5, 7, 8, 10], blurb: 'Gritty & soulful' },
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

/** keys above F# fold down so the melody register stays comfortable */
export function keyOffset(key: number) {
  return key > 6 ? key - 12 : key
}

export const rowCount = (scale: ScaleId) => SCALES[scale].intervals.length * 2 + 1

export function rowMidi(key: number, scale: ScaleId, octave: number, row: number) {
  const iv = SCALES[scale].intervals
  const n = iv.length
  return 60 + keyOffset(key) + octave * 12 + Math.floor(row / n) * 12 + iv[row % n]
}

export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
export const midiName = (m: number) => NOTE_NAMES[((m % 12) + 12) % 12]
export const midiNameOct = (m: number) => `${midiName(m)}${Math.floor(m / 12) - 1}`
export const isRootRow = (scale: ScaleId, row: number) => row % SCALES[scale].intervals.length === 0

export interface ChordInfo {
  degree: number
  roman: string
  name: string
  quality: 'maj' | 'min' | 'dim'
  /** nicely voiced notes (open voicing) */
  midi: number[]
  rootMidi: number
  bassMidi: number
  /** pitch classes relative to the key */
  semis: number[]
}

export function chordFor(key: number, scale: ScaleId, padIndex: number): ChordInfo {
  const cb = SCALES[scale].chordBase
  const k = keyOffset(key)
  const up = padIndex >= 7 ? 12 : 0
  const d = padIndex % 7
  const at = (i: number) => cb[i % 7] + 12 * Math.floor(i / 7)
  const r = at(d)
  const third = at(d + 2) - r
  const fifth = at(d + 4) - r
  const quality = third === 3 ? (fifth === 6 ? 'dim' : 'min') : 'maj'
  let root = 48 + k + r
  if (root >= 55) root -= 12
  const midi = [root, root + fifth, root + third + 12, root + 12].map((m) => m + up)
  const pc = (((48 + k + r) % 12) + 12) % 12
  const bassMidi = 33 + (((pc - 33) % 12) + 12) % 12
  let roman = ROMAN[d]
  if (quality !== 'maj') roman = roman.toLowerCase()
  if (quality === 'dim') roman += '°'
  const name = NOTE_NAMES[(((k + r) % 12) + 12) % 12] + (quality === 'min' ? 'm' : quality === 'dim' ? 'dim' : '')
  return {
    degree: padIndex,
    roman,
    name,
    quality,
    midi,
    rootMidi: root,
    bassMidi,
    semis: [r % 12, (r + third) % 12, (r + fifth) % 12],
  }
}
