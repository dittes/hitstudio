// Preset patterns + tasteful generators.
import { SCALES } from './theory'
import { MAX_STEPS, type BassPattern, type CreateData, type DrumLane, type KitId, type Note, type ScaleId } from './types'

export const DRUM_LANE_IDS: DrumLane[] = ['kick', 'snare', 'clap', 'chat', 'ohat', 'tom', 'rim', 'perc']

export const emptyGrid = (): Record<DrumLane, number[]> =>
  Object.fromEntries(DRUM_LANE_IDS.map((l) => [l, new Array(MAX_STEPS).fill(0)])) as Record<DrumLane, number[]>

const CH: Record<string, number> = { '.': 0, o: 0.5, x: 0.8, X: 1 }

export interface DrumPreset {
  id: string
  name: string
  bpm: number
  kit: KitId
  swing: number
  rows: Record<DrumLane, string>
}

const P = (id: string, name: string, bpm: number, kit: KitId, swing: number, r: string[]): DrumPreset => ({
  id, name, bpm, kit, swing,
  rows: { kick: r[0], snare: r[1], clap: r[2], chat: r[3], ohat: r[4], tom: r[5], rim: r[6], perc: r[7] },
})

const E = '................'
export const DRUM_PRESETS: DrumPreset[] = [
  P('house', 'House', 124, 'house', 0, ['X...X...X...X...', E, '....X.......X...', 'o.o.o.o.o.o.o.o.', '..x...x...x...x.', E, '.......o.......o', '...o..o....o..o.']),
  P('hiphop', 'Hip-hop', 92, '808', 0.15, ['X.....o.X.o.....', '....X.......X...', '....o.......o...', 'x.x.x.x.x.x.x.x.', '..............o.', E, '.o.....o........', E]),
  P('trap', 'Trap', 140, 'trap', 0, ['X.......o..X....', '........X.......', '........x.......', 'x.x.x.xxx.x.xxxx', '......o.......o.', E, E, '...........o...o']),
  P('lofi', 'Lo-fi', 78, 'lofi', 0.35, ['X.....o...X.....', '....x.......x...', E, 'o.o.o.o.o.o.o.o.', '...............o', E, '..o.......o.....', '.......o........']),
  P('rock', 'Rock', 112, '808', 0, ['X.....x.X.x.....', '....X.......X...', E, 'x.x.x.x.x.x.x.x.', '...............o', '..............xo', E, E]),
  P('reggaeton', 'Reggaeton', 96, '808', 0, ['X...X...X...X...', '...x..x....x..x.', E, 'x.x.x.x.x.x.x.x.', E, E, '......o.......o.', '.o..o..o..o..o..']),
]

export function applyDrumPreset(d: CreateData['drums'], pr: DrumPreset) {
  for (const lane of DRUM_LANE_IDS) {
    const row = pr.rows[lane]
    for (let i = 0; i < MAX_STEPS; i++) d.grid[lane][i] = CH[row[i % 16]] ?? 0
  }
  d.kit = pr.kit
  d.swing = pr.swing
  d.preset = pr.id
}

/** "Randomize (tasteful)": a solid backbeat with a little random spice. */
export function randomizeDrums(d: CreateData['drums'], n: number) {
  const r = Math.random
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  for (const lane of DRUM_LANE_IDS) d.grid[lane].fill(0)
  const style = pick(['four', 'boom', 'half'])
  for (let i = 0; i < n; i++) {
    const s = i % 16
    const bar2 = i >= 16 && n > 16
    // kick
    const kp = style === 'four' ? (s % 4 === 0 ? 1 : 0.06) : s === 0 ? 1 : s === 8 ? (style === 'half' ? 0 : 0.6) : [3, 6, 10, 11, 14].includes(s) ? (bar2 ? 0.34 : 0.22) : 0
    if (r() < kp) d.grid.kick[i] = s % 4 === 0 ? 0.9 + r() * 0.1 : 0.55 + r() * 0.2
    // backbeat
    const bb = style === 'half' ? s === 8 : s === 4 || s === 12
    if (bb) {
      d.grid.snare[i] = 0.85 + r() * 0.15
      if (r() < 0.6) d.grid.clap[i] = 0.6 + r() * 0.3
    } else if (r() < 0.04 && s % 2 === 1) d.grid.snare[i] = 0.3 + r() * 0.2
    // hats
    if (s % 2 === 0) d.grid.chat[i] = s % 4 === 0 ? 0.75 + r() * 0.15 : 0.45 + r() * 0.2
    else if (r() < 0.22) d.grid.chat[i] = 0.25 + r() * 0.2
    if ((s === 6 || s === 14) && r() < 0.5) {
      d.grid.ohat[i] = 0.6
      d.grid.chat[i] = 0
    }
    if (r() < 0.06 && s % 2 === 1) d.grid.rim[i] = 0.5 + r() * 0.3
    if (r() < 0.08 && s % 4 !== 0) d.grid.perc[i] = 0.4 + r() * 0.3
    if ((i === n - 2 || i === n - 1) && r() < 0.35) d.grid.tom[i] = 0.6 + r() * 0.3
  }
  d.preset = null
}

// ── chords ───────────────────────────────────────────────────
export const PROG_PRESETS: { id: string; name: string; prog: number[] }[] = [
  { id: 'pop', name: 'Pop: I–V–vi–IV', prog: [0, 4, 5, 3] },
  { id: 'sad', name: 'Sad: vi–IV–I–V', prog: [5, 3, 0, 4] },
  { id: '50s', name: '50s: I–vi–IV–V', prog: [0, 5, 3, 4] },
  { id: 'chill', name: 'Chill: ii–V–I–vi', prog: [1, 4, 0, 5] },
  { id: 'epic', name: 'Epic: vi–V–IV–V', prog: [5, 4, 3, 4] },
  { id: 'dream', name: 'Dreamy: I–iii–IV–V', prog: [0, 2, 3, 4] },
]

export const CHORD_STYLES = {
  pad: { name: 'Pad' },
  arp: { name: 'Arp' },
  stabs: { name: 'Stabs' },
}
export const STAB_STEPS = [0, 3, 6, 10, 12]
export const ARP_ORDER = [0, 1, 2, 3, 2, 1]

// ── bass ─────────────────────────────────────────────────────
export const BASS_PATTERNS: Record<BassPattern, { name: string; /** [stepInBar16, lengthInSteps, octaveUp] */ hits: [number, number, number][] }> = {
  root8: { name: 'Root 8ths', hits: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 2, 0] as [number, number, number]) },
  octave: { name: 'Octave bounce', hits: [[0, 2, 0], [2, 2, 1], [4, 2, 0], [6, 2, 1], [8, 2, 0], [10, 2, 1], [12, 2, 0], [14, 2, 1]] },
  offbeat: { name: 'Offbeat', hits: [[0, 3, 0], [6, 2, 0], [10, 2, 0], [14, 2, 0]] },
}

// ── auto melody ──────────────────────────────────────────────
let nid = 0
export const noteId = () => `n${Date.now().toString(36)}${(nid++).toString(36)}`

const RHYTHMS = [
  [0, 4, 8, 12],
  [0, 3, 6, 8, 12],
  [0, 2, 4, 8, 10, 12],
  [0, 4, 6, 8, 12, 14],
  [0, 6, 8, 14],
  [0, 3, 6, 10, 12],
]

export function autoMelody(scale: ScaleId, prog: number[], chordSemis: (padIndex: number) => number[], barSteps: number): Note[] {
  const r = Math.random
  const iv = SCALES[scale].intervals
  const n = iv.length
  const R = n * 2 + 1
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const rhythm = pick(RHYTHMS).filter((s) => s < barSteps)
  const notes: Note[] = []
  let cur = n + pick([0, 1, 2])
  const isChordTone = (row: number, padIdx: number) => chordSemis(padIdx).includes(iv[row % n] % 12)
  const nearestChordTone = (row: number, padIdx: number) => {
    let best = row
    let bd = 99
    for (let k = 1; k < R - 1; k++) {
      if (isChordTone(k, padIdx) && Math.abs(k - row) < bd) {
        bd = Math.abs(k - row)
        best = k
      }
    }
    return best
  }
  const phrase: { off: number; step: number; row: number; len: number; rest: boolean }[] = []
  for (let b = 0; b < 2; b++) {
    const padIdx = prog[b] ?? 0
    rhythm.forEach((s, i) => {
      const strong = s % 8 === 0 || s % 4 === 0 && r() < 0.5
      if (b === 1 && i < rhythm.length - 2 && phrase[i]) {
        // answer phrase: repeat the first bar, but nudge a few notes
        const base = phrase[i]
        const nudge = r() < 0.4 ? pick([-1, 1, 2]) : 0
        const row = Math.max(0, Math.min(R - 1, base.row + nudge))
        phrase.push({ ...base, off: b * barSteps, step: b * barSteps + s, row, rest: base.rest })
        cur = row
        return
      }
      if (strong) cur = nearestChordTone(cur + pick([-2, -1, 0, 1, 2]), padIdx)
      else cur += pick([-2, -1, -1, 1, 1, 2])
      cur = Math.max(1, Math.min(R - 2, cur))
      const next = rhythm[i + 1] ?? barSteps
      const len = Math.max(1, Math.min(next - s - (r() < 0.5 ? 1 : 0), pick([1, 2, 2, 3, 4])))
      phrase.push({ off: b * barSteps, step: b * barSteps + s, row: cur, len, rest: !strong && r() < 0.12 })
    })
  }
  for (const p of phrase) if (!p.rest) notes.push({ id: noteId(), step: p.step, row: p.row, len: p.len })
  // finish on the tonic (or the fifth) for a satisfying landing
  const last = notes[notes.length - 1]
  if (last) last.row = r() < 0.7 ? n : Math.min(R - 1, n + Math.round(n * 0.57))
  return notes
}
