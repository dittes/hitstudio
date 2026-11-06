// Edit-mode toolbar: tools, snap, zoom, edit actions, quick processing, panels.
import {
  ArrowLeftRight,
  Copy,
  Magnet,
  Maximize2,
  MousePointer2,
  PanelRight,
  Plus,
  Scissors,
  SquareSplitHorizontal,
  Trash2,
  TrendingDown,
  TrendingUp,
  Volume2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { runCommand, subscribeCommands } from '../../core/commands'
import { useStore } from '../../core/store'
import type { Tool } from '../../core/types'
import { Button, Hint, IconButton, Segmented } from '../../ui/kit'
import { deleteSelection, duplicateSelection, processAvailable, splitAtPlayhead } from './commands'
import { S, zoomAround, zoomToFit } from './state'

const PROCESS: { id: string; label: string; tip: string; icon: React.ReactNode }[] = [
  { id: 'process.normalize', label: 'Normalize', tip: 'Make it as loud as possible without distortion', icon: <Volume2 /> },
  { id: 'process.fadeIn', label: 'Fade in', tip: 'Smoothly fade in from silence', icon: <TrendingUp /> },
  { id: 'process.fadeOut', label: 'Fade out', tip: 'Smoothly fade out to silence', icon: <TrendingDown /> },
  { id: 'process.reverse', label: 'Reverse', tip: 'Play it backwards', icon: <ArrowLeftRight /> },
  { id: 'process.noiseReduce', label: 'Clean up', tip: 'Reduce background hiss and noise', icon: <Wand2 /> },
]

function useCommandsVersion() {
  const [v, setV] = useState(0)
  useEffect(() => {
    const un = subscribeCommands(() => setV((x) => x + 1))
    return () => void un()
  }, [])
  return v
}

const Sep = () => <span className="tl-tb-sep" />

export function Toolbar() {
  const tool = useStore((s) => s.ui.tool)
  const snap = useStore((s) => s.ui.snap)
  const zoom = useStore((s) => s.ui.zoom)
  const panel = useStore((s) => s.ui.panel)
  const hints = useStore((s) => s.ui.hints)
  const nSel = useStore((s) => s.selection.clipIds.length)
  const hasRange = useStore((s) => !!s.selection.range && s.selection.trackIds.length > 0)
  useCommandsVersion()
  const canProcess = nSel > 0 || hasRange

  return (
    <div className="tl-toolbar">
      <Segmented<Tool>
        value={tool === 'cut' ? 'cut' : 'select'}
        onChange={(t) => S().setUI({ tool: t })}
        options={[
          { value: 'select', label: <><MousePointer2 /> Select</>, title: 'Select & move clips (1)' },
          { value: 'cut', label: <><Scissors /> Cut</>, title: 'Click a clip to cut it in two (2)' },
        ]}
      />
      <IconButton label={snap ? 'Snap to beat: on' : 'Snap to beat: off'} active={snap} icon={<Magnet />} onClick={() => S().setUI({ snap: !snap })} />
      <Sep />
      <IconButton label="Zoom out" shortcut="-" icon={<ZoomOut />} onClick={() => zoomAround(zoom / 1.5)} />
      <IconButton label="Zoom in" shortcut="=" icon={<ZoomIn />} onClick={() => zoomAround(zoom * 1.5)} />
      <IconButton label="Show whole song" shortcut="Shift+Z" icon={<Maximize2 />} onClick={zoomToFit} />
      <Sep />
      <IconButton label="Split at playhead" shortcut="S" icon={<SquareSplitHorizontal />} onClick={splitAtPlayhead} />
      <IconButton label="Duplicate" shortcut="Mod+D" icon={<Copy />} disabled={!nSel} onClick={() => duplicateSelection()} />
      <IconButton label="Delete" shortcut="Delete" icon={<Trash2 />} disabled={!canProcess} onClick={deleteSelection} />
      <Sep />
      <div className="tl-tb-process">
        {PROCESS.map((p) => (
          <IconButton
            key={p.id}
            label={`${p.label} – ${p.tip}`}
            icon={p.icon}
            disabled={!canProcess || !processAvailable(p.id)}
            onClick={() => runCommand(p.id)}
          />
        ))}
      </div>
      <div className="tl-tb-flex">
        {hints && (
          <motion.div className="tl-tb-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Hint>
              {tool === 'cut'
                ? 'Click on a clip to cut it. Press 1 to go back to Select.'
                : nSel
                  ? 'Drag edges to trim · top corners to fade · Alt-drag to copy'
                  : 'Click a clip to select it · drag on empty space to select a region'}
            </Hint>
          </motion.div>
        )}
      </div>
      <Button size="sm" variant="soft" icon={<Plus />} onClick={() => runCommand('track.add')}>
        Track
      </Button>
      <IconButton
        label={panel === 'inspector' ? 'Hide inspector' : 'Show clip & track inspector'}
        shortcut="I"
        active={panel === 'inspector'}
        icon={<PanelRight />}
        onClick={() => S().setUI({ panel: panel === 'inspector' ? null : 'inspector' })}
      />
    </div>
  )
}
