// Shared types for the Create (beat maker) feature.
export type DrumLane = 'kick' | 'snare' | 'clap' | 'chat' | 'ohat' | 'tom' | 'rim' | 'perc'
export type KitId = '808' | 'lofi' | 'house' | 'trap'
export type InstId = 'pluck' | 'pad' | 'bass' | 'bell' | 'saw' | 'piano'
export type ScaleId = 'major' | 'minor' | 'pentatonic' | 'dorian' | 'blues'
export type Section = 'drums' | 'melody' | 'chords' | 'bass'
export type ChordStyle = 'pad' | 'arp' | 'stabs'
export type BassPattern = 'root8' | 'octave' | 'offbeat'
export type Tab = 'beat' | 'melody' | 'chords'

/** Max grid width we ever store (covers odd time signatures, 2 bars). */
export const MAX_STEPS = 96

export interface Note {
  id: string
  /** start step inside the 2-bar melody loop */
  step: number
  /** scale row, 0 = lowest note of the 2-octave range */
  row: number
  /** length in steps */
  len: number
}

export interface SectionCfg {
  vol: number
  mute: boolean
  /** 0 = dark/muffled .. 1 = bright/open */
  tone: number
}

export interface CreateData {
  tab: Tab
  /** 0 = C … 11 = B */
  key: number
  scale: ScaleId
  /** -1 low, 0 mid, 1 high */
  octave: number
  drums: {
    long: boolean
    kit: KitId
    swing: number
    grid: Record<DrumLane, number[]>
    vol: Record<DrumLane, number>
    mute: Record<DrumLane, boolean>
    preset: string | null
  }
  melody: { inst: InstId; notes: Note[] }
  chords: { prog: number[]; style: ChordStyle; inst: InstId; preset: string | null }
  bass: { on: boolean; pattern: BassPattern }
  sections: Record<Section, SectionCfg>
  bounceBars: number
}
