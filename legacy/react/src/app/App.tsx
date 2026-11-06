import type React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { installKeyboard } from '../core/commands'
import { useStore, setUndoToastHook } from '../core/store'
import { toast } from '../core/toast'
import type { Mode } from '../core/types'
import { CreateView } from '../features/create'
import { DJView } from '../features/dj'
import { importFiles, IOLayer } from '../features/io'
import { MixView } from '../features/mixer'
import { EditView } from '../features/timeline'
import { VisualizeView } from '../features/visualizer'
import './app.css'
import { CommandPalette } from './CommandPalette'
import { registerCoreCommands } from './coreCommands'
import { ModeRail } from './ModeRail'
import { Toasts } from './Toasts'
import { TopBar } from './TopBar'
import { TransportBar } from './TransportBar'

const VIEWS: Record<Mode, () => React.JSX.Element> = {
  edit: EditView,
  mix: MixView,
  dj: DJView,
  create: CreateView,
  visualize: VisualizeView,
}

registerCoreCommands()
setUndoToastHook((m) => toast({ title: m, ms: 1200 }))

export function App() {
  const mode = useStore((s) => s.ui.mode)
  const theme = useStore((s) => s.ui.theme)
  const [dragging, setDragging] = useState(false)

  useEffect(() => installKeyboard(), [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const View = VIEWS[mode]
  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.defaultPrevented) {
          setDragging(false)
          return
        }
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        setDragging(false)
        // features may handle drops themselves (e.g. onto a track) and call preventDefault
        if (e.defaultPrevented) return
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          importFiles(e.dataTransfer.files)
        }
      }}
    >
      <TopBar />
      <ModeRail />
      <main className="app-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            className="app-view"
            initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(2px)' }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <View />
          </motion.div>
        </AnimatePresence>
      </main>
      <TransportBar />
      <IOLayer />
      <CommandPalette />
      <Toasts />
      <AnimatePresence>
        {dragging && (
          <motion.div className="app-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="app-drop-card" initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}>
              <div className="app-drop-icon">♪</div>
              <div>{mode === 'dj' ? 'Drop a song onto deck A or B' : 'Drop audio to add it to your song'}</div>
              <div className="faint">MP3, WAV, FLAC, OGG, M4A … or a video file</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
