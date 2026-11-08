// The factory kit: 16 sounds that were synthesized for HitStudio (see SOUND-SOURCES.md). Every pad can be replaced.
// Pads are laid out like a classic 4×4 drum machine, and keyed to the computer keyboard in the same shape.

export const PAD_KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v']

/** colour groups: one per row of four */
export const GROUPS = [
  { id: 'drums', name: 'Drums', color: '#fb923c' },
  { id: 'cymbals', name: 'Cymbals & toms', color: '#facc15' },
  { id: 'bass', name: 'Bass & keys', color: '#4ade80' },
  { id: 'fx', name: 'Melody & FX', color: '#a78bfa' },
]

const P = (file, name, group, params = {}) => ({ file, name, group, params })

export const DEFAULT_KIT = [
  P('01-kick', 'Kick', 0, { vol: 1 }),
  P('02-snare', 'Snare', 0, { vol: 0.95 }),
  P('03-clap', 'Clap', 0, { vol: 0.9, reverb: 0.18 }),
  P('04-rim', 'Rim', 0, { vol: 0.85 }),
  P('05-hat-closed', 'Hat', 1, { vol: 0.7, choke: 1 }),
  P('06-hat-open', 'Open hat', 1, { vol: 0.7, choke: 1, release: 0.05 }),
  P('07-tom', 'Tom', 1, { vol: 0.95 }),
  P('08-crash', 'Crash', 1, { vol: 0.65, reverb: 0.12 }),
  P('09-808-sub', '808', 2, { vol: 0.95, mode: 'gate', release: 0.18 }),
  P('10-bass-stab', 'Bass stab', 2, { vol: 0.85 }),
  P('11-chord-am9', 'Am9 chord', 2, { vol: 0.8, reverb: 0.22 }),
  P('12-pluck', 'Pluck', 2, { vol: 0.85, reverb: 0.2 }),
  P('13-bell', 'Bell', 3, { vol: 0.8, reverb: 0.3 }),
  P('14-vox-ooh', 'Vox ooh', 3, { vol: 0.8, mode: 'gate', attack: 0.04, release: 0.25, reverb: 0.3 }),
  P('15-riser', 'Riser', 3, { vol: 0.75 }),
  P('16-impact', 'Impact', 3, { vol: 0.8, reverb: 0.15 }),
]

/** short names used in pad labels: "Kick Punch", "Snare Crack" … */
export const SINGULAR = { kicks: 'Kick', snares: 'Snare', claps: 'Clap', rims: 'Rim', hats: 'Hat', openhats: 'Open hat', shakers: 'Shaker', toms: 'Tom', cymbals: 'Cymbal', perc: 'Perc', '808': '808', bass: 'Bass', chords: 'Chord', keys: 'Keys', bells: 'Bell', leads: 'Lead', vocal: 'Voice', fx: 'FX' }
export const SOUND_MIME = 'application/x-hitstudio-sound'

export const DEFAULT_PARAMS = {
  vol: 0.9, // 0..1.2
  pan: 0, // -1..1
  pitch: 0, // semitones
  start: 0, // 0..1 of the sample
  end: 1,
  mode: 'oneshot', // oneshot | gate | loop
  reverse: false,
  attack: 0.002, // seconds
  release: 0.08, // seconds
  cutoff: 1, // 0..1, 1 = open (low-pass sweep)
  reverb: 0.06, // 0..1 send
  choke: 0, // 0 = none, 1-4 = mute group
}
