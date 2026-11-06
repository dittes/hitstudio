// OWNER: timeline agent. Edit mode screen.
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../../core/store'
import { registerTimelineCommands } from './commands'
import { ContextMenu } from './ContextMenu'
import { EmptyState } from './EmptyState'
import { Inspector } from './Inspector'
import { HEADER_W } from './state'
import { Timeline } from './Timeline'
import { Toolbar } from './Toolbar'
import './timeline.css'

registerTimelineCommands()

export function EditView() {
  const hasTracks = useStore((s) => s.project.tracks.length > 0)
  const tool = useStore((s) => s.ui.tool)
  const panel = useStore((s) => s.ui.panel)
  const zoom = useStore((s) => s.ui.zoom)
  const bpm = useStore((s) => s.project.bpm)
  const beatsPerBar = useStore((s) => s.project.timeSig[0])
  const beatPx = (60 / bpm) * zoom
  const barPx = beatPx * beatsPerBar
  // keep grid lines at least ~24px apart when zoomed far out
  let barGrid = barPx
  while (barGrid < 24) barGrid *= 2
  const vars = {
    '--tl-bar': `${barGrid}px`,
    '--tl-beat': `${beatPx >= 7 ? beatPx : barGrid}px`,
    '--tl-header-w': `${HEADER_W}px`,
  } as React.CSSProperties

  return (
    <div className={`tl-root tl-tool-${tool}`} style={vars}>
      <AnimatePresence mode="wait" initial={false}>
        {hasTracks ? (
          <motion.div key="tl" className="tl-shell" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            <Toolbar />
            <div className="tl-body">
              <Timeline />
              <AnimatePresence>{panel === 'inspector' && <Inspector key="insp" />}</AnimatePresence>
            </div>
          </motion.div>
        ) : (
          <EmptyState key="empty" />
        )}
      </AnimatePresence>
      <ContextMenu />
    </div>
  )
}
