// Global state (zustand + immer) with snapshot undo/redo.
//
//   const tracks = useStore(s => s.project.tracks)
//   useStore.getState().mutate('Rename track', p => { p.tracks[0].name = 'Vox' })
//
// `mutate` is THE way to change the project: it records undo history.
// Use `mutate(label, fn, { coalesce: 'key' })` for continuous drags
// (consecutive mutations with the same coalesce key collapse into one undo step).
import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import type { Clip, ID, Mode, Project, Selection, Track, UIState } from './types'
import { TRACK_COLORS, uid } from './ids'

export function newProject(name = 'Untitled song'): Project {
  return {
    id: uid('prj'),
    name,
    bpm: 120,
    timeSig: [4, 4],
    sampleRate: 48000,
    tracks: [],
    clips: [],
    markers: [],
    loop: { enabled: false, start: 0, end: 8 },
    master: { volume: 1, effects: [] },
  }
}

export function makeTrack(p: Project, partial: Partial<Track> = {}): Track {
  const i = p.tracks.length
  return {
    id: uid('trk'),
    name: `Track ${i + 1}`,
    kind: 'audio',
    color: TRACK_COLORS[i % TRACK_COLORS.length],
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    effects: [],
    height: 96,
    ...partial,
  }
}

export function makeClip(partial: Partial<Clip> & Pick<Clip, 'trackId' | 'bufferId' | 'duration'>): Clip {
  return {
    id: uid('clp'),
    name: 'Clip',
    start: 0,
    offset: 0,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    rate: 1,
    ...partial,
  }
}

interface HistoryEntry {
  label: string
  project: Project
}

export interface StoreState {
  project: Project
  ui: UIState
  selection: Selection
  /** transport — written by the engine */
  transport: { playing: boolean; recording: boolean; position: number; metronome: boolean }

  past: HistoryEntry[]
  future: HistoryEntry[]
  lastCoalesce: string | null

  mutate: (label: string, fn: (p: Draft<Project>) => void, opts?: { coalesce?: string }) => void
  undo: () => void
  redo: () => void
  setUI: (patch: Partial<UIState>) => void
  setMode: (m: Mode) => void
  select: (patch: Partial<Selection>) => void
  setTransport: (patch: Partial<StoreState['transport']>) => void
  loadProject: (p: Project) => void
}

const MAX_HISTORY = 200

export const useStore = create<StoreState>((set, get) => ({
  project: newProject(),
  ui: {
    mode: 'edit',
    tool: 'select',
    zoom: 80,
    scrollX: 0,
    snap: true,
    theme: (localStorage.getItem('bloom.theme') as 'dark' | 'light') || 'dark',
    panel: null,
    modal: null,
    hints: localStorage.getItem('bloom.hints') !== 'off',
  },
  selection: { clipIds: [], trackIds: [], range: null },
  transport: { playing: false, recording: false, position: 0, metronome: false },
  past: [],
  future: [],
  lastCoalesce: null,

  mutate(label, fn, opts) {
    const { project, past, lastCoalesce } = get()
    const next = produce(project, fn)
    if (next === project) return
    const coalesce = opts?.coalesce ?? null
    const merge = coalesce !== null && coalesce === lastCoalesce && past.length > 0
    set({
      project: next,
      past: merge ? past : [...past.slice(-MAX_HISTORY + 1), { label, project }],
      future: [],
      lastCoalesce: coalesce,
    })
  },
  undo() {
    const { past, future, project } = get()
    const prev = past[past.length - 1]
    if (!prev) return
    set({
      project: prev.project,
      past: past.slice(0, -1),
      future: [{ label: prev.label, project }, ...future],
      lastCoalesce: null,
    })
    toastHook?.(`Undo: ${prev.label}`)
  },
  redo() {
    const { past, future, project } = get()
    const nxt = future[0]
    if (!nxt) return
    set({
      project: nxt.project,
      past: [...past, { label: nxt.label, project }],
      future: future.slice(1),
      lastCoalesce: null,
    })
    toastHook?.(`Redo: ${nxt.label}`)
  },
  setUI(patch) {
    if (patch.theme) localStorage.setItem('bloom.theme', patch.theme)
    if (patch.hints !== undefined) localStorage.setItem('bloom.hints', patch.hints ? 'on' : 'off')
    set({ ui: { ...get().ui, ...patch } })
  },
  setMode(mode) {
    set({ ui: { ...get().ui, mode } })
  },
  select(patch) {
    set({ selection: { ...get().selection, ...patch } })
  },
  setTransport(patch) {
    set({ transport: { ...get().transport, ...patch } })
  },
  loadProject(p) {
    set({ project: p, past: [], future: [], selection: { clipIds: [], trackIds: [], range: null } })
  },
}))

let toastHook: ((msg: string) => void) | null = null
export function setUndoToastHook(fn: (msg: string) => void) {
  toastHook = fn
}

// ── handy selectors / helpers ────────────────────────────────
export const getProject = () => useStore.getState().project
export const mutate: StoreState['mutate'] = (...a) => useStore.getState().mutate(...a)

export function projectDuration(p: Project): number {
  let end = 0
  for (const c of p.clips) end = Math.max(end, c.start + c.duration / (c.rate || 1))
  return end
}

export function clipEnd(c: Clip) {
  return c.start + c.duration / (c.rate || 1)
}

export function trackById(p: Project, id: ID) {
  return p.tracks.find((t) => t.id === id)
}

/** Snap a time to the beat grid if snapping is on. */
export function snapTime(t: number, force = false): number {
  const { ui, project } = useStore.getState()
  if (!ui.snap && !force) return t
  const beat = 60 / project.bpm
  // snap resolution depends on zoom: finer when zoomed in
  const pxPerBeat = beat * ui.zoom
  let div = 1
  if (pxPerBeat > 160) div = 4
  else if (pxPerBeat > 80) div = 2
  else if (pxPerBeat < 20) div = 0.25
  const step = beat / div
  return Math.round(t / step) * step
}
