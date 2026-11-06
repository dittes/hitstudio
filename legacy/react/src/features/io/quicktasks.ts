// ohfis-style "quick tasks": pick a file first, then guide the user into the right tool.
import { runCommand } from '../../core/commands'
import { useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { importFiles } from './import'
import { ioSet, pickFiles } from './state'

export type QuickTask = 'cut' | 'join' | 'ringtone' | 'noise' | 'speed' | 'convert' | 'bpm'

export const QUICK_TASKS: { id: QuickTask; label: string; sub: string }[] = [
  { id: 'cut', label: 'Cut a song', sub: 'Keep just the best part' },
  { id: 'join', label: 'Join files', sub: 'Glue songs end to end' },
  { id: 'ringtone', label: 'Make a ringtone', sub: '30 seconds with fades' },
  { id: 'noise', label: 'Remove background noise', sub: 'Hiss, hum, fan sounds' },
  { id: 'speed', label: 'Change speed or pitch', sub: 'Faster, slower, higher, lower' },
  { id: 'convert', label: 'Convert format', sub: 'MP3, WAV, FLAC and more' },
  { id: 'bpm', label: 'Find BPM & key', sub: 'Tempo and musical key' },
]

/** call this directly from a click handler (the file picker needs a user gesture) */
export async function quickTask(kind: QuickTask) {
  const files = await pickFiles({ multiple: kind === 'join' })
  if (!files.length) return
  if (kind === 'join' && files.length < 2) toast({ title: 'Tip: pick two or more files', body: 'Hold ⌘ / Ctrl (or Shift) to select several in the file window. You can also drop more files in later.', ms: 4500 })
  const res = await importFiles(files, { sequence: kind === 'join' })
  if (!res.clipIds.length) return
  const S = useStore.getState()
  S.setMode('edit')
  S.select({ clipIds: res.clipIds, trackIds: res.trackIds })

  switch (kind) {
    case 'cut':
      toast({
        title: 'Step 1: drag on the waveform to pick the part you want',
        body: 'Then press S to split at the playhead, or export just your selection.',
        ms: 9000,
        action: { label: 'Export selection', run: () => ioSet({ exportOpen: true, exportPreset: { target: 'selection' } }) },
      })
      break
    case 'join':
      toast({
        title: `Joined ${res.clipIds.length} file${res.clipIds.length > 1 ? 's' : ''} end to end`,
        body: 'Drag a clip to reorder, then export it as a single file.',
        ms: 8000,
        action: { label: 'Export', run: () => ioSet({ exportOpen: true, exportPreset: { target: 'song' } }) },
      })
      break
    case 'ringtone': {
      const id = res.clipIds[0]
      useStore.getState().mutate('Make ringtone', (p) => {
        const c = p.clips.find((x) => x.id === id)
        if (!c) return
        c.duration = Math.min(c.duration, 30 * (c.rate || 1))
        c.fadeIn = 0.4
        c.fadeOut = 1.5
      })
      toast({
        title: 'Your 30-second ringtone is ready 🔔',
        body: 'We kept the first 30 s with soft fades. Drag the clip’s left edge to pick another start. iPhone .m4r isn’t possible in a browser, so save an MP3 and rename it.',
        ms: 10000,
        action: { label: 'Save as MP3', run: () => ioSet({ exportOpen: true, exportPreset: { format: 'mp3', target: 'song', kbps: 192 } }) },
      })
      break
    }
    case 'noise':
      toast({ title: 'Removing background noise…', body: 'Tip: select a stretch of pure noise first for best results.', ms: 6000 })
      runCommand('process.noiseReduce')
      break
    case 'speed':
      toast({ title: 'Change speed or pitch', body: 'Pitch and speed tools act on the selected clip.', ms: 6000 })
      runCommand('process.speed')
      break
    case 'convert':
      ioSet({ exportOpen: true, exportPreset: { target: 'song' } })
      break
    case 'bpm':
      runCommand('io.analyze')
      break
  }
}
