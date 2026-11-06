import { Download, Moon, Redo2, Search, Sun, Undo2 } from 'lucide-react'
import { motion } from 'motion/react'
import { runCommand } from '../core/commands'
import { useStore } from '../core/store'
import { MiniVisualizer } from '../features/visualizer'
import { Button, IconButton } from '../ui/kit'

export function TopBar() {
  const name = useStore((s) => s.project.name)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const undoLabel = useStore((s) => s.past[s.past.length - 1]?.label)
  const theme = useStore((s) => s.ui.theme)
  return (
    <header className="topbar">
      <button className="topbar-brand" aria-label="HitStudio home" onClick={() => runCommand('io.welcome')}>
        <motion.div className="logo" whileHover={{ rotate: 20, scale: 1.08 }} transition={{ type: 'spring', stiffness: 300, damping: 10 }}>
          <span />
          <span />
          <span />
        </motion.div>
        <span className="brand-name">HitStudio</span>
      </button>
      <input
        className="project-name"
        value={name}
        spellCheck={false}
        onChange={(e) => useStore.getState().mutate('Rename project', (p) => void (p.name = e.target.value), { coalesce: 'rename-project' })}
      />
      <div className="topbar-group">
        <IconButton label={undoLabel ? `Undo ${undoLabel}` : 'Undo'} shortcut="Mod+Z" disabled={!canUndo} onClick={() => runCommand('edit.undo')} icon={<Undo2 />} />
        <IconButton label="Redo" shortcut="Shift+Mod+Z" disabled={!canRedo} onClick={() => runCommand('edit.redo')} icon={<Redo2 />} />
      </div>
      <div className="topbar-viz">
        <MiniVisualizer />
      </div>
      <div className="topbar-group">
        <button className="palette-btn" onClick={() => runCommand('palette.open')}>
          <Search size={14} /> <span>Search actions…</span> <kbd className="bk-kbd">⌘K</kbd>
        </button>
        <IconButton
          label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          onClick={() => runCommand('view.theme')}
          icon={
            <motion.span key={theme} initial={{ rotate: -90, scale: 0.4 }} animate={{ rotate: 0, scale: 1 }} style={{ display: 'inline-flex' }}>
              {theme === 'dark' ? <Sun /> : <Moon />}
            </motion.span>
          }
        />
        <Button variant="primary" icon={<Download />} onClick={() => runCommand('io.export')}>
          Export
        </Button>
      </div>
    </header>
  )
}
