import { registerCommands } from '../core/commands'
import { getEngine } from '../core/engine'
import { makeTrack, useStore } from '../core/store'
import type { Mode } from '../core/types'

export function registerCoreCommands() {
  const S = () => useStore.getState()
  const modes: [Mode, string, string][] = [
    ['edit', 'Edit', '1'],
    ['mix', 'Mix', '2'],
    ['create', 'Create', '3'],
    ['dj', 'DJ', '4'],
    ['visualize', 'Visualize', '5'],
  ]
  registerCommands([
    { id: 'transport.toggle', label: 'Play / Pause', group: 'Transport', shortcut: 'Space', run: () => getEngine().toggle() },
    { id: 'transport.stop', label: 'Stop', group: 'Transport', shortcut: 'Escape', run: () => getEngine().stop() },
    { id: 'transport.home', label: 'Go to start', group: 'Transport', shortcut: ['Home', 'Enter'], run: () => getEngine().seek(0) },
    { id: 'transport.back', label: 'Back 5 seconds', group: 'Transport', shortcut: 'ArrowLeft', run: () => getEngine().seek(getEngine().position - 5) },
    { id: 'transport.fwd', label: 'Forward 5 seconds', group: 'Transport', shortcut: 'ArrowRight', run: () => getEngine().seek(getEngine().position + 5) },
    {
      id: 'transport.loop',
      label: 'Toggle loop',
      group: 'Transport',
      shortcut: 'L',
      run: () => {
        const sel = S().selection.range
        S().mutate('Toggle loop', (p) => {
          p.loop.enabled = !p.loop.enabled
          if (p.loop.enabled && sel && sel.end - sel.start > 0.05) {
            p.loop.start = sel.start
            p.loop.end = sel.end
          }
        })
      },
    },
    {
      id: 'transport.metronome',
      label: 'Toggle metronome',
      group: 'Transport',
      shortcut: 'M',
      run: () => S().setTransport({ metronome: !S().transport.metronome }),
    },
    { id: 'edit.undo', label: 'Undo', group: 'Edit', shortcut: 'Mod+Z', run: () => S().undo() },
    { id: 'edit.redo', label: 'Redo', group: 'Edit', shortcut: ['Shift+Mod+Z', 'Mod+Y'], run: () => S().redo() },
    {
      id: 'track.add',
      label: 'Add empty track',
      group: 'Tracks',
      shortcut: 'Shift+Mod+N',
      run: () => S().mutate('Add track', (p) => void p.tracks.push(makeTrack(p as any))),
    },
    {
      id: 'view.theme',
      label: 'Toggle light / dark theme',
      group: 'View',
      run: () => S().setUI({ theme: S().ui.theme === 'dark' ? 'light' : 'dark' }),
    },
    { id: 'view.hints', label: 'Toggle beginner hints', group: 'View', run: () => S().setUI({ hints: !S().ui.hints }) },
    ...modes.map(([m, label, key]) => ({
      id: `mode.${m}`,
      label: `Go to ${label}`,
      group: 'Navigate',
      shortcut: `Mod+${key}`,
      run: () => S().setMode(m),
    })),
  ])
}
