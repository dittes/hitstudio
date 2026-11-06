// Icon + colour per effect / process / category.
import {
  Activity, ArrowLeftRight, ArrowUpDown, AudioLines, AudioWaveform, Blend, BrickWall, ChartColumn, Combine, DoorClosed, Eraser,
  FastForward, Flame, Funnel, Gamepad2, Gauge, Guitar, Landmark, Mic, MousePointerClick, Orbit, Phone, Plane, Repeat, Rewind,
  Scissors, Shell, SlidersHorizontal, Snowflake, Sparkles, Speaker, Timer, TrendingDown, TrendingUp, Users, Volume2, WandSparkles,
  WavesHorizontal, Wind, Zap,
} from 'lucide-react'
import type { ComponentType } from 'react'

type Ico = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

const MAP: Record<string, Ico> = {
  eq: SlidersHorizontal,
  filter: Funnel,
  phone: Phone,
  mic: Mic,
  comp: Gauge,
  limiter: BrickWall,
  gate: DoorClosed,
  reverb: Landmark,
  echo: Repeat,
  width: ArrowLeftRight,
  chorus: Users,
  flanger: Plane,
  phaser: Orbit,
  wah: Guitar,
  tremolo: Activity,
  flame: Flame,
  crush: Gamepad2,
  // processes
  normalize: ChartColumn,
  amplify: Volume2,
  reverse: Rewind,
  fadeIn: TrendingUp,
  fadeOut: TrendingDown,
  noise: Wind,
  silence: Scissors,
  speed: FastForward,
  tempo: Timer,
  pitch: AudioLines,
  clicks: MousePointerClick,
  loudness: Speaker,
  invert: ArrowUpDown,
  mono: Combine,
  paulstretch: Snowflake,
  applyEffect: WandSparkles,
  eraser: Eraser,
  zap: Zap,
  shell: Shell,
  blend: Blend,
}

export function FxIcon({ name, size = 16 }: { name?: string; size?: number }) {
  const I = (name && MAP[name]) || Sparkles
  return <I size={size} strokeWidth={2} />
}

export const CATEGORY_INFO: Record<string, { label: string; color: string; blurb: string; icon: Ico }> = {
  tone: { label: 'Tone', color: '#f472b6', blurb: 'Shape the colour of the sound', icon: SlidersHorizontal },
  dynamics: { label: 'Volume control', color: '#fb923c', blurb: 'Even out loud and quiet parts', icon: Gauge },
  space: { label: 'Space', color: '#38bdf8', blurb: 'Rooms, echoes and width', icon: Landmark },
  modulation: { label: 'Movement', color: '#a78bfa', blurb: 'Wobbles, swirls and shimmer', icon: WavesHorizontal },
  creative: { label: 'Creative', color: '#4ade80', blurb: 'Grit, lo-fi and wild colours', icon: Flame },
  utility: { label: 'Utility', color: '#facc15', blurb: 'Handy helpers', icon: AudioWaveform },
}

export const CATEGORY_ORDER = ['tone', 'dynamics', 'space', 'modulation', 'creative', 'utility']
