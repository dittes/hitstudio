// Create-mode pattern state (own zustand store, persisted to localStorage, no undo).
import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import { applyDrumPreset, DRUM_PRESETS, emptyGrid, noteId } from './patterns'
import type { CreateData, DrumLane, Section } from './types'

const KEY = 'bloom.create.v1'
const LANES: DrumLane[] = ['kick', 'snare', 'clap', 'chat', 'ohat', 'tom', 'rim', 'perc']
const SECTIONS: Section[] = ['drums', 'melody', 'chords', 'bass']

function defaults(): CreateData {
  const drums: CreateData['drums'] = {
    long: false,
    kit: '808',
    swing: 0,
    grid: emptyGrid(),
    vol: Object.fromEntries(LANES.map((l) => [l, 0.85])) as Record<DrumLane, number>,
    mute: Object.fromEntries(LANES.map((l) => [l, false])) as Record<DrumLane, boolean>,
    preset: null,
  }
  applyDrumPreset(drums, DRUM_PRESETS[1])
  return {
    tab: 'beat',
    key: 0,
    scale: 'minor',
    octave: 0,
    drums,
    melody: {
      inst: 'pluck',
      notes: [
        [0, 7, 2], [2, 6, 1], [4, 4, 2], [8, 5, 2], [11, 4, 1], [16, 7, 2], [18, 9, 2], [22, 6, 2], [26, 5, 1], [28, 7, 3],
      ].map(([step, row, len]) => ({ id: noteId(), step, row, len })),
    },
    chords: { prog: [5, 3, 0, 4], style: 'pad', inst: 'pad', preset: 'sad' },
    bass: { on: true, pattern: 'root8' },
    sections: {
      drums: { vol: 0.9, mute: false, tone: 1 },
      melody: { vol: 0.75, mute: false, tone: 0.9 },
      chords: { vol: 0.65, mute: false, tone: 0.85 },
      bass: { vol: 0.8, mute: false, tone: 0.8 },
    },
    bounceBars: 8,
  }
}

function load(): CreateData {
  const base = defaults()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const p = JSON.parse(raw) as Partial<CreateData>
    const m: CreateData = { ...base, ...p }
    m.drums = { ...base.drums, ...p.drums, grid: { ...base.drums.grid, ...p.drums?.grid }, vol: { ...base.drums.vol, ...p.drums?.vol }, mute: { ...base.drums.mute, ...p.drums?.mute } }
    for (const l of LANES) {
      const g = m.drums.grid[l]
      if (!Array.isArray(g) || g.length < 96) m.drums.grid[l] = [...(g ?? []), ...new Array(96).fill(0)].slice(0, 96)
    }
    m.melody = { ...base.melody, ...p.melody }
    m.chords = { ...base.chords, ...p.chords }
    m.bass = { ...base.bass, ...p.bass }
    m.sections = Object.fromEntries(SECTIONS.map((s) => [s, { ...base.sections[s], ...p.sections?.[s] }])) as CreateData['sections']
    return m
  } catch {
    return base
  }
}

interface Actions {
  edit: (fn: (d: Draft<CreateData>) => void) => void
  resetAll: () => void
}
export const useCreate = create<CreateData & Actions>((set, get) => ({
  ...load(),
  edit(fn) {
    const { edit, resetAll, ...data } = get()
    const next = produce(data as CreateData, fn)
    set(next)
  },
  resetAll() {
    set(defaults())
  },
}))

let t = 0
useCreate.subscribe((s) => {
  clearTimeout(t)
  t = window.setTimeout(() => {
    const { edit, resetAll, ...data } = s
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {}
  }, 300)
})

export const createEdit = (fn: (d: Draft<CreateData>) => void) => useCreate.getState().edit(fn)
