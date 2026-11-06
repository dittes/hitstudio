// React-visible DJ state (knob values, deck flags). Realtime things
// (play position, phase) are read straight from the engine in rAF.
import { create } from 'zustand'

export type DeckIndex = 0 | 1
export type XfCurve = 'smooth' | 'linear' | 'cut'

export interface LoopRegion {
  start: number
  end: number
}

export interface DeckState {
  /** crate item id that is loaded (or null) */
  itemId: string | null
  title: string
  color: string
  duration: number
  loading: boolean
  analyzing: boolean
  bpm: number
  firstBeat: number
  playing: boolean
  /** tempo fader as a fraction (+0.05 = +5 %) */
  tempo: number
  /** fader range: 0.08 / 0.16 / 0.5 */
  range: number
  sync: boolean
  /** dB, −12..+12 */
  trim: number
  /** dB for [low, mid, high]; −26 .. +6 */
  eq: [number, number, number]
  kill: [boolean, boolean, boolean]
  /** −1 (low-pass) .. 0 (off) .. +1 (high-pass) */
  filter: number
  /** 0..1 */
  res: number
  /** channel fader 0..1 */
  fader: number
  echo: number
  echoBeats: number
  flanger: number
  reverb: number
  cue: number
  hot: (number | null)[]
  loop: LoopRegion | null
  /** pending manual loop-in point */
  loopIn: number | null
  loopBeats: number
  /** active beat-roll length in beats, or null */
  roll: number | null
  /** set while braking / spinning back */
  stopping: 'brake' | 'spin' | null
}

export const deckDefaults = (): DeckState => ({
  itemId: null,
  title: '',
  color: '',
  duration: 0,
  loading: false,
  analyzing: false,
  bpm: 0,
  firstBeat: 0,
  playing: false,
  tempo: 0,
  range: 0.08,
  sync: false,
  trim: 0,
  eq: [0, 0, 0],
  kill: [false, false, false],
  filter: 0,
  res: 0.3,
  fader: 0.85,
  echo: 0,
  echoBeats: 0.75,
  flanger: 0,
  reverb: 0,
  cue: 0,
  hot: [null, null, null, null],
  loop: null,
  loopIn: null,
  loopBeats: 4,
  roll: null,
  stopping: null,
})

export interface AutoState {
  from: DeckIndex
  to: DeckIndex
  progress: number
  bars: number
}

export interface DJState {
  decks: [DeckState, DeckState]
  /** 0 = full deck A, 1 = full deck B */
  xf: number
  curve: XfCurve
  rec: boolean
  recStart: number
  auto: AutoState | null
  /** zoomed waveform seconds visible */
  zoom: number
  setDeck: (i: DeckIndex, patch: Partial<DeckState>) => void
  set: (patch: Partial<Omit<DJState, 'decks' | 'setDeck' | 'set'>>) => void
}

export const useDJ = create<DJState>((set, get) => ({
  decks: [deckDefaults(), deckDefaults()],
  xf: 0.5,
  curve: 'smooth',
  rec: false,
  recStart: 0,
  auto: null,
  zoom: 8,
  setDeck(i, patch) {
    const decks = [...get().decks] as [DeckState, DeckState]
    decks[i] = { ...decks[i], ...patch }
    set({ decks })
  },
  set(patch) {
    set(patch)
  },
}))

export const deckState = (i: DeckIndex) => useDJ.getState().decks[i]
export const HOT_COLORS = ['#f87171', '#facc15', '#4ade80', '#38bdf8']
export const DECK_ACCENT = ['var(--accent)', 'var(--accent-2)'] as const
export const DECK_HEX = ['#a78bfa', '#f472b6'] as const
