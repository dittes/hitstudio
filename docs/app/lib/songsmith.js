// ─────────────────────────────────────────────────────────────
// songsmith.js — a tiny "always sounds good" music generator.
//
// Pure JavaScript, no DOM, no audio. Given a genre, a mood, a busyness amount
// and a seed it returns a complete Create-mode setup (tempo, key, scale, drum
// grid, melody, chord progression, bass pattern, mix) plus an arrangement for a
// full song. Same options + seed ⇒ same result, so ideas can be shared as a code.
//
//   generateSetup({ genre: 'lofi', mood: 'chill', busy: 0.5, seed: 42 })
//     .state   drop-in Create state: key, scale, drums, melody, chords, bass, sections
//     .bpm     project tempo        .title / .code   name + shareable code
//   arrangeSong(setup, 'full')  →  [{ name, bars, startBar, parts }]
//
// Everything it produces fits the Create editors (16/32-step drum grid, 10-row
// melody grid over 2 bars, 4-slot chord progression, named bass pattern), so a
// generated idea stays fully editable in the Beat / Melody / Chords tabs.
//
// Why it sounds good:
//   • harmony: proven diatonic progressions per mood
//   • drums: genre kick/snare skeletons + a separate hi-hat "feel" (8ths,
//     16ths, offbeats, shuffles, trap rolls), accents on the beat, ghost notes,
//     open hats that choke the closed hat, and genre-specific fills
//   • bass: per-genre patterns, including one that locks to the kick drum
//   • melody: a motif (call) and an answer, chord tones on strong beats that fit
//     BOTH chords under them, stepwise motion, leaps that recover, breathing
//     rests, and a landing on the tonic
//   • instruments, levels and filters per genre so the parts sit together
// ─────────────────────────────────────────────────────────────

/** Chord colour per genre: weights for plain triads, 7th chords and rich 9ths. */
const CHORD_COLOUR = {
  lofi: [['seventh', 4], ['ninth', 3], ['triad', 1]],
  chillhop: [['seventh', 4], ['ninth', 3], ['triad', 1]],
  ambient: [['ninth', 3], ['seventh', 3], ['triad', 2]],
  house: [['seventh', 3], ['triad', 3]],
  afro: [['seventh', 2], ['triad', 4]],
  pop: [['triad', 5], ['seventh', 2]],
  synthwave: [['triad', 4], ['seventh', 2]],
  trap: [['triad', 3], ['seventh', 3], ['ninth', 1]],
  dubstep: [['triad', 4], ['seventh', 1]],
  techno: [['triad', 3], ['seventh', 1]],
  dnb: [['seventh', 3], ['triad', 3]],
  rock: [['triad', 1]],
}
/** How roomy the reverb feels (1 = normal). */
const SPACE = { lofi: 1.2, chillhop: 1.1, ambient: 1.7, dreamy: 1.4, house: 0.8, synthwave: 1.3, trap: 0.85, pop: 0.95, afro: 0.8, rock: 0.7, dubstep: 0.75, techno: 0.7, dnb: 0.75 }
const pickColour = (genreId, seed, bumpMood) => {
  const r = createRng((seed ^ 0x9e3779b9) >>> 0)
  const pairs = CHORD_COLOUR[genreId] ?? [['triad', 1]]
  const ext = r.weighted(pairs)
  return bumpMood === 'dreamy' && ext === 'triad' && pairs.some(([e]) => e === 'seventh') ? 'seventh' : ext
}

export const MAX_STEPS = 96
export const LANES = ['kick', 'snare', 'clap', 'chat', 'ohat', 'tom', 'rim', 'perc']
/** rows the Create melody grid shows (0 = lowest tonic) */
export const MELODY_ROWS = 10

// ── deterministic randomness ─────────────────────────────────
export function createRng(seed) {
  let a = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo, hi) => lo + next() * (hi - lo),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** weighted pick from [[value, weight], …] */
    weighted(pairs) {
      const total = pairs.reduce((s, [, w]) => s + w, 0)
      let r = next() * total
      for (const [v, w] of pairs) if ((r -= w) <= 0) return v
      return pairs[pairs.length - 1][0]
    },
  }
}

export function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export const randomSeed = () => Math.floor(Math.random() * 0xffffffff) >>> 0

/** Short, shareable code, e.g. "lofi-chill-7" or "house-happy-1a2b-b70" (busy 70 %) */
export function setupCode(s) {
  const b = Math.round((s.busy ?? 0.5) * 100)
  return `${s.genre}-${s.mood}-${s.seed.toString(36)}${b === 50 ? '' : `-b${b}`}`
}
export function parseSetupCode(code) {
  const m = /^([a-z]+)-([a-z]+)-([0-9a-z]+)(?:-b(\d{1,3}))?$/.exec(String(code).trim().toLowerCase())
  if (!m || !GENRES[m[1]] || !MOODS[m[2]]) return null
  return { genre: m[1], mood: m[2], seed: parseInt(m[3], 36) >>> 0, busy: m[4] ? Math.min(100, +m[4]) / 100 : 0.5 }
}

// ── music theory (mirrors features/create/theory.js) ─────────
const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  blues: [0, 3, 5, 6, 7, 10],
}
const CHORD_BASE = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  blues: [0, 2, 3, 5, 7, 8, 10],
}
/** pitch classes (relative to the key) of the triad on a chord-pad degree */
export function chordPitchClasses(scale, degree) {
  const cb = CHORD_BASE[scale]
  const at = (i) => cb[i % 7] + 12 * Math.floor(i / 7)
  const d = degree % 7
  return [at(d) % 12, at(d + 2) % 12, at(d + 4) % 12]
}
const rowPitchClass = (scale, row) => {
  const iv = SCALE_INTERVALS[scale]
  return iv[((row % iv.length) + iv.length) % iv.length]
}

// ── moods: harmony + scale choices ───────────────────────────
// Progressions are chord-pad degrees (0 = I/i, 3 = IV/iv, 4 = V/v, 5 = vi/VI …).
export const MOODS = {
  happy: {
    name: 'Happy',
    icon: 'sun',
    scales: [['major', 5], ['pentatonic', 3]],
    progs: [[0, 4, 5, 3], [0, 3, 4, 3], [0, 5, 3, 4], [3, 4, 0, 0], [0, 3, 5, 4], [0, 2, 3, 4], [0, 4, 3, 4], [3, 0, 4, 5]],
  },
  chill: {
    name: 'Chill',
    icon: 'waves',
    scales: [['dorian', 4], ['major', 3], ['pentatonic', 2]],
    progs: [[1, 4, 0, 5], [0, 5, 1, 4], [3, 2, 1, 0], [0, 3, 0, 3], [5, 3, 0, 4], [1, 4, 0, 0], [3, 4, 2, 5], [0, 1, 3, 1]],
  },
  dark: {
    name: 'Dark',
    icon: 'moon',
    scales: [['minor', 6], ['blues', 1]],
    progs: [[0, 5, 6, 4], [0, 3, 4, 0], [0, 5, 2, 6], [0, 0, 5, 4], [0, 6, 5, 6], [0, 3, 5, 4], [0, 5, 3, 6], [0, 2, 5, 4]],
  },
  dreamy: {
    name: 'Dreamy',
    icon: 'sparkle',
    scales: [['major', 4], ['pentatonic', 3], ['dorian', 2]],
    progs: [[0, 2, 3, 4], [3, 0, 4, 5], [0, 3, 5, 3], [5, 3, 0, 4], [0, 4, 3, 3], [3, 4, 2, 5], [0, 5, 3, 3], [3, 2, 5, 4]],
  },
  epic: {
    name: 'Epic',
    icon: 'flame',
    scales: [['minor', 5], ['major', 2]],
    progs: [[5, 4, 3, 4], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 5, 4], [3, 4, 5, 5], [5, 5, 3, 4], [0, 6, 5, 4], [3, 5, 4, 4]],
  },
}

// ── genres ───────────────────────────────────────────────────
// Drum skeletons: '.' off · 'o' ghost · 'x' normal · 'X' accent (16 steps / bar).
// Hi-hats are added separately from `hats` (a feel), so skeleton × feel = lots of grooves.
const E = '................'
const K = (kick, snare, clap = E, rim = E, perc = E, tom = E) => ({ kick, snare, clap, rim, perc, tom })

export const GENRES = {
  lofi: {
    name: 'Lo-fi', icon: 'tape', blurb: 'Dusty, slow and cozy',
    bpm: [72, 86], kits: ['lofi'], swing: [0.26, 0.42], moods: ['chill', 'dreamy', 'dark'],
    skeletons: [
      K('X.....o...X.....', '....x.......x...', E, '..o.......o.....', '.......o........'),
      K('X......oX.......', '....x.......x..o', E, E, '.....o.......o..'),
      K('X.........X..o..', '....x.......x...', E, '..o...o.........'),
      K('X..o......X.....', '....x.......x...', E, '.......o.......o'),
    ],
    hats: [['8ths', 4], ['shuffle', 3], ['sparse', 2]],
    ghost: 0.35, openHat: 0.25, fills: ['snare', 'tom', 'none'],
    melodyInst: [['piano', 3], ['bell', 2], ['rhodes', 3], ['flute', 2], ['marimba', 1]],
    chordInst: [['rhodes', 4], ['piano', 2], ['pad', 3], ['strings', 1]],
    chordStyle: [['pad', 5], ['stabs', 2]],
    bass: [['offbeat', 3], ['kick', 3], ['root8', 1], ['walk', 1]],
    bassInst: [['bass', 3], ['picked', 2], ['sub808', 1]],
    density: 0.42, rhythm: 'laidback', long: true,
    mix: { drums: [0.85, 0.62], melody: [0.62, 0.58], chords: [0.6, 0.55], bass: [0.75, 0.55] },
  },
  house: {
    name: 'House', icon: 'speaker', blurb: 'Four-on-the-floor and bright stabs',
    bpm: [120, 126], kits: ['house'], swing: [0, 0.08], moods: ['happy', 'dreamy', 'chill', 'dark'],
    skeletons: [
      K('X...X...X...X...', E, '....X.......X...', '.......o.......o', '...o..o....o..o.'),
      K('X...X...X...X...', E, '....X.......X...', E, '.o.....o.o......'),
      K('X...X...X...X..o', E, '....X.......X...', '...o......o.....'),
      K('X...X...X...X...', '....x.......x...', '....X.......X...', E, '..o...o...o...o.'),
    ],
    hats: [['offbeat', 5], ['16ths', 3], ['8ths', 1]],
    ghost: 0.1, openHat: 0.7, fills: ['snare', 'hats', 'none'],
    melodyInst: [['pluck', 4], ['saw', 2], ['bell', 2], ['supersaw', 1], ['marimba', 1]],
    chordInst: [['piano', 3], ['organ', 3], ['pluck', 2], ['pad', 2], ['rhodes', 1]],
    chordStyle: [['stabs', 4], ['offbeat', 4], ['arp', 2], ['pad', 1]],
    bass: [['offbeat', 4], ['octave', 3], ['sync', 2]],
    bassInst: [['bass', 4], ['reese', 1], ['picked', 1]],
    density: 0.55, rhythm: 'syncopated', long: false,
    mix: { drums: [0.9, 0.9], melody: [0.62, 0.8], chords: [0.62, 0.75], bass: [0.8, 0.62] },
  },
  synthwave: {
    name: 'Synthwave', icon: 'sunset', blurb: 'Neon 80s drive',
    bpm: [96, 112], kits: ['808', 'house'], swing: [0, 0.04], moods: ['epic', 'dark', 'dreamy'],
    skeletons: [
      K('X.......X.......', '....X.......X...', '....x.......x...'),
      K('X.......X.x.....', '....X.......X...'),
      K('X...X...X...X...', '....X.......X...', '....x.......x...'),
    ],
    hats: [['8ths', 4], ['16ths', 3]],
    ghost: 0.05, openHat: 0.3, fills: ['tom', 'snare'],
    melodyInst: [['saw', 4], ['supersaw', 3], ['brass', 1], ['bell', 1]],
    chordInst: [['pad', 4], ['strings', 2], ['supersaw', 2], ['saw', 1]],
    chordStyle: [['pad', 3], ['arp', 4]],
    bass: [['pulse', 4], ['root8', 3], ['octave', 3]],
    bassInst: [['bass', 4], ['reese', 1]],
    density: 0.5, rhythm: 'straight', long: true,
    mix: { drums: [0.88, 0.8], melody: [0.6, 0.75], chords: [0.62, 0.7], bass: [0.74, 0.6] },
  },
  trap: {
    name: 'Trap', icon: 'gem', blurb: 'Rolling hats and huge 808s',
    bpm: [136, 150], kits: ['trap'], swing: [0, 0.06], moods: ['dark', 'epic', 'dreamy'],
    skeletons: [
      K('X.......o..X....', '........X.......', '........x.......', E, '...........o...o'),
      K('X......X..X.....', '........X.......', '........x.......', '...o..........o.'),
      K('X.....X...X..X..', '........X.......', E, E, '....o.......o...'),
      K('X..X......X.....', '........X.......', '........x.......'),
    ],
    hats: [['trap', 6], ['8ths', 1]],
    ghost: 0.15, openHat: 0.3, fills: ['hats', 'snare', 'none'],
    melodyInst: [['bell', 4], ['pluck', 2], ['flute', 2], ['marimba', 2], ['piano', 1]],
    chordInst: [['pad', 4], ['strings', 2], ['piano', 1]],
    chordStyle: [['pad', 5], ['arp', 1]],
    bass: [['kick', 5], ['sub', 3], ['offbeat', 1]],
    bassInst: [['sub808', 6], ['bass', 1]],
    density: 0.38, rhythm: 'sparse', long: true,
    mix: { drums: [0.9, 0.8], melody: [0.6, 0.7], chords: [0.52, 0.55], bass: [0.9, 0.45] },
  },
  pop: {
    name: 'Pop', icon: 'vocal', blurb: 'Catchy, bright, radio-ready',
    bpm: [100, 118], kits: ['808', 'house'], swing: [0, 0.06], moods: ['happy', 'dreamy', 'epic'],
    skeletons: [
      K('X.......X.x.....', '....X.......X...', '....x.......x...', E, '..o...o...o...o.'),
      K('X..x....X.......', '....X.......X...', '....x.......x...'),
      K('X...X...X...X...', '....X.......X...', '....X.......X...', E, 'o.o.o.o.o.o.o.o.'),
      K('X.....x.X.......', '....X.......X...', '....x.......x...'),
    ],
    hats: [['8ths', 5], ['16ths', 2], ['offbeat', 1]],
    ghost: 0.12, openHat: 0.35, fills: ['snare', 'tom'],
    melodyInst: [['pluck', 4], ['piano', 3], ['bell', 2], ['saw', 1], ['marimba', 1], ['supersaw', 1]],
    chordInst: [['piano', 4], ['pad', 2], ['strings', 2], ['rhodes', 1], ['guitar', 1]],
    chordStyle: [['pad', 2], ['stabs', 3], ['arp', 2], ['offbeat', 1]],
    bass: [['root8', 4], ['octave', 2], ['kick', 2]],
    bassInst: [['bass', 3], ['picked', 2], ['sub808', 1]],
    density: 0.55, rhythm: 'catchy', long: true,
    mix: { drums: [0.86, 0.85], melody: [0.7, 0.8], chords: [0.6, 0.72], bass: [0.78, 0.6] },
  },
  chillhop: {
    name: 'Chillhop', icon: 'coffee', blurb: 'Mellow, jazzy hip-hop beats',
    bpm: [80, 94], kits: ['jazz', 'lofi', '808'], swing: [0.18, 0.32], moods: ['chill', 'dreamy', 'happy'],
    skeletons: [
      K('X.....o.X.o.....', '....X.......X...', '....o.......o...', '.o.....o........'),
      K('X..X......X.....', '....X.......X..o', E, '.......o.......o'),
      K('X.....X...X.....', '....X.......X...', E, '.o.....o.o......'),
      K('X.......X.X.....', '....X.......X...', E, '...o......o.....'),
    ],
    hats: [['shuffle', 4], ['8ths', 3]],
    ghost: 0.45, openHat: 0.25, fills: ['snare', 'none'],
    melodyInst: [['rhodes', 3], ['flute', 3], ['piano', 2], ['marimba', 2], ['bell', 1], ['brass', 1]],
    chordInst: [['rhodes', 5], ['piano', 3], ['strings', 1], ['organ', 1]],
    chordStyle: [['stabs', 3], ['pad', 3]],
    bass: [['kick', 3], ['offbeat', 2], ['walk', 3]],
    bassInst: [['picked', 3], ['bass', 3]],
    density: 0.5, rhythm: 'laidback', long: true,
    mix: { drums: [0.88, 0.7], melody: [0.66, 0.65], chords: [0.6, 0.6], bass: [0.78, 0.55] },
  },
  ambient: {
    name: 'Ambient', icon: 'cloud', blurb: 'Floaty pads, no rush',
    bpm: [70, 84], kits: ['lofi'], swing: [0, 0.1], moods: ['dreamy', 'chill', 'dark'],
    skeletons: [
      K('X...............', E, E, E, '......o.......o.'),
      K('X.......o.......', E, E, '....o...........'),
    ],
    hats: [['sparse', 5]],
    ghost: 0, openHat: 0.4, fills: ['none'],
    melodyInst: [['bell', 4], ['flute', 2], ['pad', 2], ['piano', 2], ['marimba', 1]],
    chordInst: [['pad', 5], ['strings', 3]],
    chordStyle: [['pad', 6], ['arp', 2]],
    bass: [['sub', 4], ['offbeat', 1]],
    bassInst: [['sub808', 3], ['bass', 2]],
    density: 0.26, rhythm: 'sparse', long: false, bassOn: 0.5,
    mix: { drums: [0.5, 0.45], melody: [0.62, 0.62], chords: [0.72, 0.6], bass: [0.6, 0.45] },
  },
  afro: {
    name: 'Afro / Dancehall', icon: 'palm', blurb: 'Bouncy, sunny groove',
    bpm: [96, 108], kits: ['808', 'house'], swing: [0.06, 0.16], moods: ['happy', 'chill', 'dreamy'],
    skeletons: [
      K('X..x..x.X..x..x.', '......X.......X.', E, '...x..x....x..x.', '.o..o..o..o..o..'),
      K('X...X...X...X...', '...x..x....x..x.', E, '......o.......o.', '.o..o..o..o..o..', '..........x..x..'),
      K('X..x....X..x....', '....X.......X...', E, '..o..o....o..o..', 'o..o..o.o..o..o.'),
    ],
    hats: [['8ths', 3], ['16ths', 2], ['offbeat', 2]],
    ghost: 0.15, openHat: 0.3, fills: ['tom', 'none'],
    melodyInst: [['marimba', 4], ['pluck', 3], ['bell', 2], ['flute', 2], ['brass', 1]],
    chordInst: [['pluck', 3], ['organ', 2], ['piano', 2], ['rhodes', 2], ['pad', 1]],
    chordStyle: [['offbeat', 4], ['stabs', 3], ['arp', 2]],
    bass: [['sync', 4], ['kick', 3], ['octave', 1]],
    bassInst: [['bass', 3], ['sub808', 2], ['picked', 1]],
    density: 0.52, rhythm: 'syncopated', long: false,
    mix: { drums: [0.88, 0.85], melody: [0.66, 0.8], chords: [0.6, 0.7], bass: [0.8, 0.6] },
  },
  rock: {
    name: 'Rock', icon: 'guitar', blurb: 'Guitars, live drums, big energy',
    bpm: [108, 138], kits: ['rock'], swing: [0, 0.03], moods: ['epic', 'happy', 'dark'],
    skeletons: [
      K('X.......X.x.....', '....X.......X...'),
      K('X.....x.X.......', '....X.......X...'),
      K('X.x.....X.x.....', '....X.......X..o'),
      K('X...X...X...X...', '....X.......X...'),
      K('X.....x...x.....', '....X.......X...', E, E, E, '..............x.'),
    ],
    hats: [['8ths', 6], ['16ths', 1]],
    ghost: 0.15, openHat: 0.35, fills: ['tom', 'snare', 'tom'],
    melodyInst: [['guitar', 4], ['saw', 2], ['organ', 2], ['brass', 1]],
    chordInst: [['guitar', 6], ['organ', 1], ['piano', 1]],
    chordStyle: [['power', 6], ['stabs', 1], ['pad', 1]],
    bass: [['root8', 5], ['kick', 3], ['octave', 1]],
    bassInst: [['picked', 6], ['bass', 1]],
    density: 0.5, rhythm: 'straight', long: true,
    mix: { drums: [0.92, 0.85], melody: [0.6, 0.72], chords: [0.62, 0.7], bass: [0.8, 0.6] },
  },
  dubstep: {
    name: 'Dubstep', icon: 'bass', blurb: 'Half-time drums and wobble bass',
    bpm: [138, 142], kits: ['dubstep'], swing: [0, 0.04], moods: ['dark', 'epic'],
    skeletons: [
      K('X.........X.....', '........X.......', '........x.......'),
      K('X......X..X.....', '........X.......', '........x.......', E, '..............o.'),
      K('X.........X..X..', '........X.......', E, '...o...........o'),
      K('X.......o.X.....', '........X.......', '........x.......', E, '.o.......o......'),
    ],
    hats: [['8ths', 3], ['trap', 2], ['sparse', 1]],
    ghost: 0.2, openHat: 0.25, fills: ['snare', 'hats', 'tom'],
    melodyInst: [['bell', 3], ['supersaw', 3], ['pluck', 2], ['strings', 1]],
    chordInst: [['pad', 3], ['strings', 2], ['supersaw', 2]],
    chordStyle: [['pad', 5], ['stabs', 2]],
    bass: [['sub', 4], ['kick', 3], ['sync', 2]],
    bassInst: [['wobble', 7], ['reese', 2]],
    density: 0.36, rhythm: 'sparse', long: true,
    mix: { drums: [0.92, 0.9], melody: [0.58, 0.72], chords: [0.52, 0.62], bass: [0.82, 0.4] },
  },
  techno: {
    name: 'Techno', icon: 'cpu', blurb: 'Hypnotic and driving',
    bpm: [124, 132], kits: ['house', '808'], swing: [0, 0.04], moods: ['dark', 'epic'],
    skeletons: [
      K('X...X...X...X...', E, '....x.......x...', '.o.o.......o.o..', 'o..o..o..o..o..o'),
      K('X...X...X...X...', E, E, '...o.......o....', '..o...o...o...o.'),
      K('X...X...X...X.o.', E, '....x.......x...', E, '.o..o..o..o..o..'),
    ],
    hats: [['offbeat', 4], ['16ths', 3]],
    ghost: 0, openHat: 0.8, fills: ['hats', 'none'],
    melodyInst: [['pluck', 3], ['saw', 3], ['supersaw', 1], ['bell', 1]],
    chordInst: [['pad', 3], ['pluck', 2], ['organ', 1], ['supersaw', 1]],
    chordStyle: [['arp', 4], ['offbeat', 2], ['stabs', 2]],
    bass: [['offbeat', 4], ['pulse', 3], ['kick', 1]],
    bassInst: [['bass', 3], ['reese', 2]],
    density: 0.4, rhythm: 'straight', long: false, progHold: 0.5,
    mix: { drums: [0.92, 0.85], melody: [0.55, 0.65], chords: [0.55, 0.6], bass: [0.82, 0.58] },
  },
  dnb: {
    name: 'Drum & Bass', icon: 'zap', blurb: 'Fast breaks, rolling bass',
    bpm: [170, 176], kits: ['808', 'house'], swing: [0, 0.04], moods: ['dark', 'epic', 'dreamy'],
    skeletons: [
      K('X.........X.....', '....X.......X...', E, E, '.o.....o........'),
      K('X.....X...X.....', '....X..o....X...', E, '...o......o.....'),
      K('X.........X..X..', '....X.......X...'),
    ],
    hats: [['8ths', 3], ['16ths', 3]],
    ghost: 0.4, openHat: 0.2, fills: ['snare', 'tom'],
    melodyInst: [['pad', 2], ['bell', 3], ['pluck', 2], ['strings', 1], ['supersaw', 1]],
    chordInst: [['pad', 4], ['strings', 3]],
    chordStyle: [['pad', 6], ['arp', 1]],
    bass: [['sub', 3], ['kick', 3], ['sync', 1]],
    bassInst: [['reese', 4], ['sub808', 2]],
    density: 0.3, rhythm: 'sparse', long: true,
    mix: { drums: [0.9, 0.85], melody: [0.6, 0.7], chords: [0.62, 0.62], bass: [0.86, 0.5] },
  },
}

// ── drums ────────────────────────────────────────────────────
const VEL = { '.': 0, o: 0.42, x: 0.8, X: 1 }

function emptyGrid() {
  return Object.fromEntries(LANES.map((l) => [l, new Array(MAX_STEPS).fill(0)]))
}

/** Hi-hat feels (velocity per 16th, one bar). `bar` lets feels vary across bars. */
function hatFeel(kind, rng, busy, bar) {
  const v = new Array(16).fill(0)
  const accent = (s) => (s % 4 === 0 ? 0.85 : s % 2 === 0 ? 0.62 : 0.4)
  switch (kind) {
    case '8ths':
      for (let s = 0; s < 16; s += 2) v[s] = accent(s)
      if (busy > 0.6) for (let s = 1; s < 16; s += 4) if (rng.chance(busy - 0.4)) v[s + 2] = 0.35
      break
    case '16ths':
      for (let s = 0; s < 16; s++) v[s] = accent(s) * (s % 2 ? 0.75 : 1)
      if (busy < 0.35) for (let s = 1; s < 16; s += 2) v[s] = 0
      break
    case 'offbeat':
      for (let s = 2; s < 16; s += 4) v[s] = 0.85
      if (busy > 0.45) for (let s = 0; s < 16; s += 4) v[s] = 0.3
      break
    case 'shuffle':
      for (let s = 0; s < 16; s += 2) v[s] = accent(s)
      for (let s = 3; s < 16; s += 4) if (rng.chance(0.35 + busy * 0.4)) v[s] = 0.32
      break
    case 'sparse':
      for (const s of [4, 12]) v[s] = 0.45
      if (busy > 0.5) v[8] = 0.35
      break
    case 'trap': {
      for (let s = 0; s < 16; s += 2) v[s] = accent(s)
      // signature rolls: a run of 16ths with rising velocity, different per bar
      const starts = bar % 2 === 0 ? [rng.pick([5, 6, 10])] : [rng.pick([12, 13]), rng.pick([2, 6])]
      for (const st of starts.slice(0, busy > 0.4 ? 2 : 1)) {
        const len = rng.pick([2, 3, 4])
        for (let i = 0; i < len && st + i < 16; i++) v[st + i] = 0.45 + (i / len) * 0.45
      }
      break
    }
  }
  return v
}

/** Build a drum grid (MAX_STEPS long) from a genre with tasteful variation. */
export function makeDrums(genre, rng, { busy = 0.5, long = genre.long, fill = true } = {}) {
  const si = rng.int(0, genre.skeletons.length - 1)
  const sk = genre.skeletons[si]
  const feel = rng.weighted(genre.hats)
  const grid = emptyGrid()
  const bars = long ? 2 : 1
  const len = bars * 16
  for (let bar = 0; bar < bars; bar++) {
    const hats = hatFeel(feel, rng, busy, bar)
    for (let s = 0; s < 16; s++) {
      const i = bar * 16 + s
      for (const lane of ['kick', 'snare', 'clap', 'rim', 'perc', 'tom']) {
        const ch = (sk[lane] || E)[s]
        let v = VEL[ch] ?? 0
        // fewer percussion hits when "simple"
        if ((lane === 'rim' || lane === 'perc') && v > 0 && busy < 0.3 && ch !== 'X' && rng.chance(0.6)) v = 0
        if (v > 0) v = Math.min(1, Math.max(0.3, v + rng.range(-0.07, 0.05)))
        grid[lane][i] = v
      }
      grid.chat[i] = hats[s] ? Math.min(1, hats[s] + rng.range(-0.05, 0.05)) : 0
    }
  }
  // second bar answers the first: a small kick variation on a weak 16th
  if (long && rng.chance(0.55 + busy * 0.3)) {
    const cands = [22, 23, 26, 27, 30].filter((i) => grid.kick[i] === 0 && grid.snare[i] < 0.7)
    if (cands.length) grid.kick[rng.pick(cands)] = 0.62
  }
  // ghost snares just before / after the backbeat
  const backbeats = []
  for (let i = 0; i < len; i++) if (grid.snare[i] >= 0.75 || grid.clap[i] >= 0.75) backbeats.push(i)
  for (const b of backbeats) {
    for (const off of [-1, 2, 3]) {
      const i = b + off
      if (i >= 0 && i < len && grid.snare[i] === 0 && grid.kick[i] === 0 && rng.chance(genre.ghost * (0.4 + busy))) grid.snare[i] = rng.range(0.22, 0.34)
    }
  }
  // open hats on the "and", and they choke the closed hat
  if (rng.chance(genre.openHat)) {
    const spots = genre === GENRES.house || genre === GENRES.techno ? [2, 6, 10, 14] : rng.pick([[14], [6, 14], [10]])
    for (let bar = 0; bar < bars; bar++)
      for (const s of spots) {
        const i = bar * 16 + s
        grid.ohat[i] = 0.62
        grid.chat[i] = 0
      }
  }
  // fill at the end of the loop (last bar)
  const fillKind = rng.pick(genre.fills)
  if (fill && long && fillKind !== 'none' && rng.chance(0.55 + busy * 0.35)) {
    const start = len - rng.pick(busy > 0.6 ? [6, 4] : [4, 3])
    for (let i = start; i < len; i++) {
      const t = (i - start) / (len - start)
      if (fillKind === 'snare') {
        if ((i - start) % 2 === 0 || i >= len - 2) grid.snare[i] = 0.4 + t * 0.55
      } else if (fillKind === 'tom') {
        if ((i - start) % 2 === 0) grid.tom[i] = 0.7 + t * 0.25
        grid.chat[i] = 0
      } else if (fillKind === 'hats') grid.chat[i] = 0.45 + t * 0.5
    }
    grid.ohat[len - 1] = 0
  }
  // tile across the stored grid
  for (const lane of LANES) for (let i = len; i < MAX_STEPS; i++) grid[lane][i] = grid[lane][i % len]
  return { grid, long, skeleton: si, feel }
}

/** A lighter version of a beat (for intros/verses): fewer hats, no percussion or toms. */
export function liteDrums(grid) {
  const g = Object.fromEntries(LANES.map((l) => [l, grid[l].slice()]))
  g.perc.fill(0)
  g.ohat.fill(0)
  g.tom.fill(0)
  g.rim = g.rim.map((v) => v * 0.7)
  g.clap = g.clap.map((v) => v * 0.6)
  g.snare = g.snare.map((v) => (v < 0.4 ? 0 : v))
  g.chat = g.chat.map((v, i) => (i % 4 === 2 ? Math.max(v, 0.5) * 0.75 : 0))
  return g
}

/** Only kick + 8th hats (for build-ups). */
export function kickOnly(grid) {
  const g = Object.fromEntries(LANES.map((l) => [l, new Array(grid[l].length).fill(0)]))
  g.kick = grid.kick.slice()
  g.chat = grid.chat.map((v, i) => (i % 2 === 0 ? Math.max(v, 0.5) : 0))
  return g
}

// ── melody ───────────────────────────────────────────────────
const RHYTHMS = {
  sparse: [[0, 6, 8], [0, 8, 12], [0, 3, 8], [0, 10], [2, 8, 11], [0, 7, 10]],
  laidback: [[0, 3, 6, 10], [2, 6, 8, 12], [0, 4, 7, 10, 12], [0, 3, 8, 11], [1, 4, 8, 12]],
  straight: [[0, 4, 8, 12], [0, 2, 4, 8, 12], [0, 4, 6, 8, 12, 14], [0, 2, 4, 6, 8, 12]],
  syncopated: [[0, 3, 6, 8, 11, 14], [2, 5, 8, 10, 13], [0, 3, 6, 10, 12], [0, 2, 5, 8, 10, 13]],
  catchy: [[0, 2, 4, 6, 8, 12], [0, 3, 6, 8, 12, 14], [0, 2, 4, 8, 10, 12], [0, 2, 3, 6, 8, 11]],
}

let noteCounter = 0
const noteId = () => `g${Date.now().toString(36)}${(noteCounter++).toString(36)}`

/**
 * Motif-based melody for the Create grid: 2 bars (32 sixteenths), rows 0..9 of the scale.
 * Bar 1 is the "call", bar 2 answers it and resolves to the tonic. The 2-bar melody repeats
 * over the 4-chord progression, so strong beats aim for notes that fit BOTH chords under them.
 */
export function makeMelody({ scale, prog, density = 0.5, rhythm = 'straight', rng, rows = MELODY_ROWS }) {
  const n = SCALE_INTERVALS[scale].length
  const tonicRow = n <= rows - 1 ? n : 0
  const lo = 0
  const hi = rows - 1
  const fits = (row, bar) => {
    const pc = rowPitchClass(scale, row)
    const a = chordPitchClasses(scale, prog[bar] ?? 0)
    const b = chordPitchClasses(scale, prog[bar + 2] ?? prog[bar] ?? 0)
    return a.includes(pc) && b.includes(pc) ? 2 : a.includes(pc) ? 1 : 0
  }
  const bestNear = (row, bar) => {
    let best = row
    let bestScore = -1e9
    for (let r = lo; r <= hi; r++) {
      const s = fits(r, bar) * 3 - Math.abs(r - row) * 1.2 - (r === hi || r === lo ? 0.5 : 0)
      if (s > bestScore) {
        bestScore = s
        best = r
      }
    }
    return best
  }
  // pick a rhythm, then thin or thicken it with density
  const pool = RHYTHMS[rhythm] || RHYTHMS.straight
  let rh = rng.pick(pool).slice()
  if (density < 0.32 && rh.length > 3) rh = rh.filter((s, i) => i === 0 || !rng.chance(0.4))
  if (density > 0.6) for (const s of [...rh]) if (s + 1 < 16 && !rh.includes(s + 1) && !rh.includes(s + 2) && rng.chance(density - 0.45)) rh.push(s + 2)
  rh = [...new Set(rh)].filter((s) => s < 16).sort((a, b) => a - b)

  // call (bar 0): stepwise, leaps recover in the opposite direction
  const call = []
  // the home note sits high in the grid, so the phrase starts below it and climbs through it to a peak
  const room = hi - tonicRow
  let cur = bestNear(tonicRow + rng.pick(room < 3 ? [-4, -3, -2] : [0, -2, 2, -1]), 0)
  // a phrase has a shape: rise to a peak around two thirds of the way, then settle back
  const peak = Math.min(hi, tonicRow + Math.max(1, Math.min(room, rng.pick([3, 4, 5]))))
  const settle = tonicRow + rng.pick([1, 2, 0])
  const startRow = cur
  const targetAt = (i) => {
    const p = rh.length > 1 ? i / (rh.length - 1) : 0
    return p < 0.62 ? startRow + (peak - startRow) * (p / 0.62) : peak + (settle - peak) * ((p - 0.62) / 0.38)
  }
  let lastMove = 0
  let same = 0
  rh.forEach((s, i) => {
    const strong = s % 4 === 0
    if (i > 0) {
      let move
      if (Math.abs(lastMove) >= 3) move = -Math.sign(lastMove) * rng.pick([1, 2])
      else {
        const want = Math.sign(Math.round(targetAt(i) - cur))
        move = rng.weighted([[1, 4], [-1, 4], [2, 2], [-2, 2], [0, 1.2], [3, 0.8], [-3, 0.8], [4, 0.4]].map(([mv, w]) => [mv, want && Math.sign(mv) === want ? w * 2.2 : want && Math.sign(mv) === -want ? w * 0.55 : w]))
      }
      cur += move
      if (strong) cur = bestNear(cur, 0)
      cur = Math.max(lo, Math.min(hi, cur))
      if (cur === call[call.length - 1].row) same++
      else same = 0
      if (same >= 2) {
        cur = Math.max(lo, Math.min(hi, cur + rng.pick([1, -1])))
        same = 0
      }
      lastMove = cur - call[call.length - 1].row
    }
    const next = rh[i + 1] ?? 16
    const room = next - s
    const len = Math.max(1, Math.min(room, rng.weighted([[1, 2], [2, 4], [3, 2], [4, 1]])))
    call.push({ s, row: cur, len, strong })
  })

  // make sure the call really has a high point (a flat line is not a melody)
  if (call.length >= 3) {
    const rowsNow = call.map((c) => c.row)
    if (Math.max(...rowsNow) - Math.min(...rowsNow) < 3) {
      const pi = Math.max(1, Math.min(call.length - 2, Math.round((call.length - 1) * 0.62)))
      call[pi].row = Math.max(lo, Math.min(hi, bestNear(Math.max(peak, Math.min(...rowsNow) + 3), 0)))
    }
  }

  // answer (bar 1): same rhythm, either repeat-with-twist, a sequence, or an inversion
  const mode = rng.weighted([['repeat', 3], ['sequence', 2], ['invert', 1]])
  const shift = mode === 'sequence' ? rng.pick([1, 2, -1, -2]) : 0
  const answer = call.map((c, i) => {
    let row = c.row
    if (mode === 'sequence') row += shift
    if (mode === 'invert' && i > 0) row = call[0].row - (c.row - call[0].row)
    if (mode === 'repeat' && i >= call.length - 2) row += rng.pick([-1, 1, -2])
    if (c.strong) row = bestNear(row, 1)
    return { ...c, s: c.s + 16, row: Math.max(lo, Math.min(hi, row)) }
  })
  // land on the tonic, sustained
  const last = answer[answer.length - 1]
  if (last) {
    last.row = tonicRow
    last.len = Math.max(last.len, Math.min(4, 32 - last.s))
  }
  // breathing room: drop the odd note, land on the tonic, then never let one pitch hammer more than twice in a row
  const line = [...call, ...answer].filter((x, i, all) => i === 0 || i === call.length || i === all.length - 1 || !rng.chance(0.06))
  if (line.length) line[line.length - 1].row = tonicRow
  for (let i = 2; i < line.length; i++) {
    if (line[i].row === line[i - 1].row && line[i - 1].row === line[i - 2].row) {
      const t = i === line.length - 1 ? i - 1 : i // the closing tonic stays put
      const up = line[t].row + 1 <= hi
      const down = line[t].row - 1 >= lo
      line[t].row += up && down ? (rng.chance(0.5) ? 1 : -1) : up ? 1 : -1
    }
  }
  return line.map((x) => ({ id: noteId(), step: x.s, row: x.row, len: x.len }))
}

// ── names ────────────────────────────────────────────────────
const ADJ = {
  happy: ['Golden', 'Sunny', 'Bright', 'Lucky', 'Candy', 'Summer', 'Electric', 'Pink', 'Lemon', 'Weekend'],
  chill: ['Lazy', 'Velvet', 'Slow', 'Soft', 'Sunday', 'Paper', 'Blue', 'Warm', 'Quiet', 'Linen'],
  dark: ['Midnight', 'Hollow', 'Cold', 'Shadow', 'Black', 'Static', 'Iron', 'Silent', 'Smoke', 'Neon'],
  dreamy: ['Floating', 'Cloud', 'Pastel', 'Moonlit', 'Glass', 'Hazy', 'Starry', 'Faded', 'Velvet', 'Lilac'],
  epic: ['Rising', 'Burning', 'Endless', 'Titan', 'Wild', 'Thunder', 'Crimson', 'Final', 'Golden', 'Storm'],
}
const NOUN = ['Hearts', 'Lights', 'Rooftops', 'Waves', 'Signals', 'Gardens', 'Echoes', 'Streets', 'Skies', 'Machines', 'Dreams', 'Avenue', 'Coast', 'Orbit', 'Fever', 'Motion', 'Season', 'Tape', 'Run', 'Bloom', 'Horizon', 'Satellites', 'Tides', 'Letters']

export function songTitle(mood, rng) {
  return `${rng.pick(ADJ[mood] || ADJ.chill)} ${rng.pick(NOUN)}`
}

// ── the main entry point ─────────────────────────────────────
/**
 * @param {{genre?: string, mood?: string, seed?: number, key?: number, busy?: number}} opts
 *   busy: 0 = simple and roomy … 1 = busy and energetic (default 0.5)
 */
export function generateSetup(opts = {}) {
  const seed = (opts.seed ?? randomSeed()) >>> 0
  const busy = Math.min(1, Math.max(0, opts.busy ?? 0.5))
  const rng = createRng(seed)
  // always consume the same random numbers, so a code (genre+mood given) recreates a "surprise" idea exactly
  const genrePick = rng.pick(Object.keys(GENRES))
  const genreId = opts.genre && GENRES[opts.genre] ? opts.genre : genrePick
  const g = GENRES[genreId]
  const moodPick = rng.pick(g.moods)
  const moodId = opts.mood && MOODS[opts.mood] ? opts.mood : moodPick
  const m = MOODS[moodId]

  const scale = rng.weighted(m.scales)
  const key = opts.key ?? rng.pick([0, 2, 4, 5, 7, 9, 10, 1, 3, 8])
  const bpm = Math.round(rng.range(g.bpm[0], g.bpm[1]) + (busy - 0.5) * 4)
  let prog = rng.pick(m.progs).slice()
  if (g.progHold && rng.chance(g.progHold)) prog = [prog[0], prog[0], prog[1], prog[1]]

  const drums = makeDrums(g, rng, { busy })
  const melody = makeMelody({ scale, prog, density: g.density + (busy - 0.5) * 0.4 + rng.range(-0.05, 0.05), rhythm: g.rhythm, rng })
  const mixVal = (pair) => +Math.min(1, Math.max(0, pair[0] + rng.range(-0.03, 0.03))).toFixed(2)
  const tone = (pair) => +Math.min(1, Math.max(0.3, pair[1] + rng.range(-0.05, 0.05) + (busy - 0.5) * 0.1)).toFixed(2)
  let chordStyle = rng.weighted(g.chordStyle)
  if (busy < 0.25 && chordStyle === 'arp') chordStyle = 'pad'

  const state = {
    key,
    scale,
    octave: 0,
    drums: {
      long: drums.long,
      kit: rng.pick(g.kits),
      swing: +rng.range(g.swing[0], g.swing[1]).toFixed(2),
      grid: drums.grid,
      vol: Object.fromEntries(LANES.map((l) => [l, l === 'kick' ? 0.95 : l === 'chat' ? 0.68 : l === 'ohat' ? 0.6 : 0.82])),
      mute: Object.fromEntries(LANES.map((l) => [l, false])),
      preset: null,
    },
    melody: { inst: rng.weighted(g.melodyInst), notes: melody },
    chords: { prog, style: chordStyle, inst: rng.weighted(g.chordInst), preset: null, ext: chordStyle === 'power' ? 'triad' : pickColour(genreId, seed, moodId) },
    space: +((SPACE[genreId] ?? 1) * (moodId === 'dreamy' ? 1.15 : 1)).toFixed(2),
    bass: { on: g.bassOn === undefined ? true : rng.chance(g.bassOn), pattern: rng.weighted(g.bass), inst: rng.weighted(g.bassInst ?? [['bass', 1]]) },
    sections: {
      drums: { vol: mixVal(g.mix.drums), mute: false, tone: tone(g.mix.drums) },
      melody: { vol: mixVal(g.mix.melody), mute: false, tone: tone(g.mix.melody) },
      chords: { vol: mixVal(g.mix.chords), mute: false, tone: tone(g.mix.chords) },
      bass: { vol: mixVal(g.mix.bass), mute: false, tone: tone(g.mix.bass) },
    },
  }
  const setup = { seed, busy, genre: genreId, mood: moodId, title: songTitle(moodId, rng), bpm, state, feel: drums.feel }
  setup.code = setupCode(setup)
  return setup
}

/** Re-roll only one part of an existing setup, keeping everything else. */
export function rerollPart(setup, part, seed = randomSeed()) {
  const rng = createRng(seed)
  const g = GENRES[setup.genre]
  const m = MOODS[setup.mood]
  const busy = setup.busy ?? 0.5
  const s = structuredClone(setup.state)
  if (part === 'drums') {
    const d = makeDrums(g, rng, { busy })
    s.drums.grid = d.grid
    s.drums.long = d.long
    s.drums.kit = rng.pick(g.kits)
  } else if (part === 'melody') {
    s.melody.notes = makeMelody({ scale: s.scale, prog: s.chords.prog, density: g.density + (busy - 0.5) * 0.4, rhythm: g.rhythm, rng })
    s.melody.inst = rng.weighted(g.melodyInst)
  } else if (part === 'chords') {
    s.chords.prog = rng.pick(m.progs).slice()
    s.chords.style = rng.weighted(g.chordStyle)
    s.chords.inst = rng.weighted(g.chordInst)
    s.chords.ext = s.chords.style === 'power' ? 'triad' : pickColour(setup.genre, seed, setup.mood)
    s.melody.notes = makeMelody({ scale: s.scale, prog: s.chords.prog, density: g.density + (busy - 0.5) * 0.4, rhythm: g.rhythm, rng })
  } else if (part === 'bass') {
    const options = g.bass.filter(([p]) => p !== s.bass.pattern)
    s.bass.pattern = rng.weighted(options.length ? options : g.bass)
    s.bass.inst = rng.weighted(g.bassInst ?? [['bass', 1]])
    s.bass.on = true
  }
  return { ...setup, state: s }
}

// ── arrangement ──────────────────────────────────────────────
/** Song forms built from 4-bar blocks. parts.drums: 'full' | 'lite' | 'kick' | null */
export const FORMS = {
  loop: [{ name: 'Loop', bars: 8, parts: { drums: 'full', melody: true, chords: true, bass: true } }],
  short: [
    { name: 'Intro', bars: 4, parts: { drums: null, melody: false, chords: true, bass: false } },
    { name: 'Verse', bars: 8, parts: { drums: 'lite', melody: false, chords: true, bass: true } },
    { name: 'Chorus', bars: 8, parts: { drums: 'full', melody: true, chords: true, bass: true } },
    { name: 'Outro', bars: 4, parts: { drums: null, melody: true, chords: true, bass: false } },
  ],
  full: [
    { name: 'Intro', bars: 4, parts: { drums: null, melody: false, chords: true, bass: false } },
    { name: 'Verse', bars: 8, parts: { drums: 'lite', melody: false, chords: true, bass: true } },
    { name: 'Build', bars: 4, parts: { drums: 'kick', melody: false, chords: true, bass: true } },
    { name: 'Chorus', bars: 8, parts: { drums: 'full', melody: true, chords: true, bass: true } },
    { name: 'Break', bars: 4, parts: { drums: null, melody: true, chords: true, bass: false } },
    { name: 'Verse 2', bars: 8, parts: { drums: 'lite', melody: true, chords: true, bass: true } },
    { name: 'Chorus', bars: 8, parts: { drums: 'full', melody: true, chords: true, bass: true } },
    { name: 'Outro', bars: 4, parts: { drums: 'lite', melody: false, chords: true, bass: false } },
  ],
}

export function arrangeSong(setup, form = 'full') {
  const blocks = FORMS[form] || FORMS.full
  let bar = 0
  return blocks.map((b) => {
    const out = { ...b, startBar: bar, parts: { ...b.parts } }
    if (setup.genre === 'ambient' && out.parts.drums === 'full') out.parts.drums = 'lite'
    if (!setup.state.bass.on) out.parts.bass = false
    bar += b.bars
    return out
  })
}

export const totalBars = (arrangement) => arrangement.reduce((s, b) => s + b.bars, 0)

// ── curated demo sets (fixed seeds) ──────────────────────────
export const DEMO_SETS = [
  { id: 'gen:lofi-rain', title: 'Rainy Window', genre: 'lofi', mood: 'chill', seed: 7 },
  { id: 'gen:house-sun', title: 'Sunset Terrace', genre: 'house', mood: 'happy', seed: 12, busy: 0.6 },
  { id: 'gen:synth-night', title: 'Neon Drive', genre: 'synthwave', mood: 'epic', seed: 31 },
  { id: 'gen:trap-ice', title: 'Ice Cold', genre: 'trap', mood: 'dark', seed: 44, busy: 0.65 },
  { id: 'gen:pop-gold', title: 'Golden Hour', genre: 'pop', mood: 'happy', seed: 58 },
  { id: 'gen:jazz-cafe', title: 'Corner Café', genre: 'chillhop', mood: 'chill', seed: 63 },
  { id: 'gen:ambient-float', title: 'Floating Gardens', genre: 'ambient', mood: 'dreamy', seed: 77, busy: 0.3 },
  { id: 'gen:afro-beach', title: 'Beach Party', genre: 'afro', mood: 'happy', seed: 85, busy: 0.6 },
  { id: 'gen:techno-iron', title: 'Iron Pulse', genre: 'techno', mood: 'dark', seed: 91, busy: 0.6 },
  { id: 'gen:dnb-rush', title: 'Night Rush', genre: 'dnb', mood: 'epic', seed: 104 },
  { id: 'gen:pop-dream', title: 'Paper Planes', genre: 'pop', mood: 'dreamy', seed: 121 },
  { id: 'gen:lofi-dark', title: 'Smoke Rings', genre: 'lofi', mood: 'dark', seed: 133, busy: 0.4 },
  { id: 'gen:rock-road', title: 'Open Road', genre: 'rock', mood: 'epic', seed: 140, busy: 0.6 },
  { id: 'gen:rock-garage', title: 'Garage Lights', genre: 'rock', mood: 'happy', seed: 152 },
  { id: 'gen:dub-quake', title: 'Earthquake', genre: 'dubstep', mood: 'dark', seed: 166, busy: 0.6 },
  { id: 'gen:chillhop-sunday', title: 'Sunday Pages', genre: 'chillhop', mood: 'chill', seed: 171 },
]

export function demoSetup(demo) {
  const s = generateSetup({ genre: demo.genre, mood: demo.mood, seed: demo.seed, busy: demo.busy })
  return { ...s, title: demo.title, demoId: demo.id }
}
