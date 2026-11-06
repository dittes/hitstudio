// React-visible DJ state (knob values, deck flags). Realtime things
// (play position, phase) are read straight from the engine in rAF.
import { create } from '../../lib/state.js'

           

                                

       

export const deckDefaults = ()            => ({
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

export const useDJ = create         ((set, get) => ({
  decks: [deckDefaults(), deckDefaults()],
  xf: 0.5,
  curve: 'smooth',
  rec: false,
  recStart: 0,
  auto: null,
  zoom: 8,
  setDeck(i, patch) {
    const decks = [...get().decks]
    decks[i] = { ...decks[i], ...patch }
    set({ decks })
  },
  set(patch) {
    set(patch)
  },
}))

export const deckState = (i           ) => useDJ.getState().decks[i]
export const HOT_COLORS = ['#f87171', '#facc15', '#4ade80', '#38bdf8']
export const DECK_ACCENT = ['var(--accent)', 'var(--accent-2)']
export const DECK_HEX = ['#a78bfa', '#f472b6']
