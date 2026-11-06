import type React from 'react'
import { AudioWaveform, Disc3, Music4, Orbit, SlidersVertical } from 'lucide-react'
import { motion } from 'motion/react'
import { useStore } from '../core/store'
import type { Mode } from '../core/types'
import { Tooltip } from '../ui/kit'

const ITEMS: { mode: Mode; label: string; icon: React.JSX.Element; tip: string; key: string }[] = [
  { mode: 'edit', label: 'Edit', icon: <AudioWaveform />, tip: 'Arrange, cut and record', key: 'Mod+1' },
  { mode: 'mix', label: 'Mix', icon: <SlidersVertical />, tip: 'Balance volumes and add effects', key: 'Mod+2' },
  { mode: 'create', label: 'Create', icon: <Music4 />, tip: 'Make beats and melodies', key: 'Mod+3' },
  { mode: 'dj', label: 'DJ', icon: <Disc3 />, tip: 'Mix songs live on two decks', key: 'Mod+4' },
  { mode: 'visualize', label: 'Visualize', icon: <Orbit />, tip: '3D visuals for your sound', key: 'Mod+5' },
]

export function ModeRail() {
  const mode = useStore((s) => s.ui.mode)
  return (
    <nav className="rail">
      {ITEMS.map((it) => (
        <Tooltip key={it.mode} label={it.tip} shortcut={it.key} side="right">
          <motion.button
            className={`rail-item ${mode === it.mode ? 'on' : ''}`}
            onClick={() => useStore.getState().setMode(it.mode)}
            whileTap={{ scale: 0.9 }}
          >
            {mode === it.mode && <motion.span layoutId="rail-pill" className="rail-pill" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
            <motion.span className="rail-icon" animate={mode === it.mode ? { y: [0, -3, 0] } : {}} transition={{ duration: 0.35 }}>
              {it.icon}
            </motion.span>
            <span className="rail-label">{it.label}</span>
          </motion.button>
        </Tooltip>
      ))}
    </nav>
  )
}
