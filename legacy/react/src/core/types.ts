// ─────────────────────────────────────────────────────────────
// HitStudio – core data model (serialisable, no AudioBuffers)
// AudioBuffers live in core/buffers.ts and are referenced by id.
// All times are in SECONDS unless the name says otherwise.
// ─────────────────────────────────────────────────────────────

export type ID = string

export interface EffectInstance {
  id: ID
  /** key in the effect registry (core/effects/registry.ts) */
  type: string
  params: Record<string, number>
  bypass: boolean
}

export interface Clip {
  id: ID
  trackId: ID
  /** id in the buffer registry */
  bufferId: ID
  name: string
  /** position on the timeline */
  start: number
  /** offset into the source buffer where playback begins */
  offset: number
  /** how much of the buffer is played */
  duration: number
  /** linear gain, 1 = unity */
  gain: number
  fadeIn: number
  fadeOut: number
  /** playback rate (tape style: changes pitch + speed). 1 = normal */
  rate: number
  color?: string
  /** true while the clip is still being recorded: the engine does not play it back */
  recording?: boolean
}

export type TrackKind = 'audio' | 'instrument'

export interface Track {
  id: ID
  name: string
  kind: TrackKind
  color: string
  /** linear 0..2 (1 = unity) */
  volume: number
  /** -1 .. 1 */
  pan: number
  mute: boolean
  solo: boolean
  /** record-armed */
  armed: boolean
  /** insert effect chain, processed in order */
  effects: EffectInstance[]
  /** UI height in px */
  height: number
}

export interface Marker {
  id: ID
  time: number
  label: string
  color?: string
}

export interface Project {
  id: ID
  name: string
  bpm: number
  timeSig: [number, number]
  sampleRate: number
  tracks: Track[]
  clips: Clip[]
  markers: Marker[]
  loop: { enabled: boolean; start: number; end: number }
  master: { volume: number; effects: EffectInstance[] }
}

/** The big sections of the app (left mode rail). */
export type Mode = 'edit' | 'mix' | 'dj' | 'create' | 'visualize'

export interface TimeRange {
  start: number
  end: number
}

export interface Selection {
  /** selected clip ids */
  clipIds: ID[]
  /** selected tracks (time-range selection applies to these) */
  trackIds: ID[]
  /** time-range selection, null = none */
  range: TimeRange | null
}

export type Tool = 'select' | 'cut' | 'draw' | 'zoom'

export interface UIState {
  mode: Mode
  tool: Tool
  /** pixels per second on the timeline */
  zoom: number
  /** timeline horizontal scroll in seconds */
  scrollX: number
  snap: boolean
  theme: 'dark' | 'light'
  /** which side panel is open in the edit view */
  panel: 'effects' | 'library' | 'inspector' | null
  /** generic modal id, owned by whichever feature opened it */
  modal: string | null
  modalProps?: Record<string, unknown>
  /** beginner hints on/off */
  hints: boolean
}
