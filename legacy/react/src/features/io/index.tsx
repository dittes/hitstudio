// OWNER: io agent – import / record / export / save-load / welcome / demo / analysis / shortcuts help.
import { useEffect } from 'react'
import { registerCommands } from '../../core/commands'
import { sliceBuffer, buffers } from '../../core/buffers'
import { useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { getAutosaveInfo, startAutosave } from './autosave'
import { ConfirmDialog } from './ConfirmDialog'
import { loadDemoSong } from './demo'
import { ExportDialog } from './ExportDialog'
import { detectBpm, detectKey } from './analysis'
import { importFiles as importFilesImpl } from './import'
import { openProjectFile, saveProjectFile } from './project-file'
import { RecordHUD, RecordSetup } from './RecordUI'
import { toggleRecording } from './record'
import { ShortcutsDialog } from './ShortcutsDialog'
import { ioSet, pickFiles } from './state'
import { WELCOME_KEY, WelcomeDialog } from './WelcomeDialog'
import './io.css'

export { detectBpm, detectKey } from './analysis'

/** Decode files and add them to the project (one new track per file, or onto `opts.trackId` at `opts.at`). */
export async function importFiles(files: File[] | FileList, opts?: { trackId?: string; at?: number }): Promise<void> {
  await importFilesImpl(files, opts)
}

async function analyzeSelection() {
  const st = useStore.getState()
  const clip = st.project.clips.find((c) => c.id === st.selection.clipIds[0]) ?? st.project.clips[0]
  const entry = clip && buffers.get(clip.bufferId)
  if (!clip || !entry) {
    toast({ title: 'Pick a clip first', body: 'Click a clip on the timeline (or import a song), then try again.' })
    return
  }
  toast({ title: 'Listening for tempo and key…', ms: 1800 })
  await new Promise((r) => setTimeout(r, 30))
  const part = sliceBuffer(entry.buffer, clip.offset, clip.offset + clip.duration)
  const bpm = detectBpm(part)
  await new Promise((r) => setTimeout(r, 0))
  const key = detectKey(part)
  if (!bpm && !key) {
    toast({ title: 'Couldn’t hear a clear beat or key', body: 'Try a longer or louder section.', kind: 'error' })
    return
  }
  toast({
    title: `${bpm ? `${bpm} BPM` : 'Tempo unclear'}${key ? ` · ${key}` : ''}`,
    body: `“${clip.name}” sounds like this. Handy for matching songs or picking a scale.`,
    kind: 'success',
    ms: 10000,
    action: bpm
      ? {
          label: `Set project tempo to ${Math.round(bpm)}`,
          run: () => {
            useStore.getState().mutate('Set tempo', (p) => void (p.bpm = Math.max(30, Math.min(300, Math.round(bpm)))))
            toast({ title: `Project tempo is now ${Math.round(bpm)} BPM`, kind: 'success', ms: 1800 })
          },
        }
      : undefined,
  })
}

let registered = false
function registerIOCommands() {
  if (registered) return
  registered = true
  registerCommands([
    {
      id: 'io.import',
      label: 'Import audio…',
      group: 'File',
      shortcut: 'Mod+I',
      keywords: 'add open file audio video mp3 wav drop',
      run: () => void pickFiles().then((f) => { if (f.length) void importFilesImpl(f) }),
    },
    { id: 'transport.record', label: 'Record / Stop recording', group: 'Transport', shortcut: 'R', keywords: 'mic microphone voice', run: () => void toggleRecording() },
    { id: 'io.recordSetup', label: 'Recording setup…', group: 'Transport', keywords: 'microphone input device monitor count-in', run: () => ioSet({ recSetupOpen: true }) },
    { id: 'io.export', label: 'Export audio…', group: 'File', shortcut: 'Mod+E', keywords: 'save download mp3 wav flac aiff opus stems bounce', run: () => ioSet({ exportOpen: true }) },
    { id: 'io.save', label: 'Save project (.hitstudio)', group: 'File', shortcut: 'Mod+S', run: () => void saveProjectFile() },
    {
      id: 'io.open',
      label: 'Open project (.hitstudio)…',
      group: 'File',
      shortcut: 'Mod+O',
      run: () => void pickFiles({ multiple: false, accept: '.hitstudio,.bloom,application/zip' }).then((f) => { if (f[0]) void openProjectFile(f[0]) }),
    },
    { id: 'io.welcome', label: 'Show welcome screen', group: 'Help', keywords: 'start home tutorial', run: () => ioSet({ welcomeOpen: true }) },
    { id: 'io.demo', label: 'Load demo song', group: 'File', keywords: 'example sample try', run: () => void loadDemoSong() },
    { id: 'io.analyze', label: 'Find BPM & key of selected clip', group: 'Tools', keywords: 'tempo detect analyse analyze key', run: () => void analyzeSelection() },
    { id: 'io.shortcuts', label: 'Keyboard shortcuts', group: 'Help', shortcut: ['Shift+?', '?'], keywords: 'help keys hotkeys', run: () => ioSet({ shortcutsOpen: true }) },
  ])
}
registerIOCommands()

let booted = false
export function IOLayer() {
  useEffect(() => {
    if (booted) return
    booted = true
    startAutosave()
    // first visit / empty project → welcome. If there's an autosave, always offer to continue.
    void getAutosaveInfo().then((info) => {
      const empty = useStore.getState().project.clips.length === 0
      const dismissed = localStorage.getItem(WELCOME_KEY) === '1'
      if (empty && (!dismissed || info)) ioSet({ welcomeOpen: true })
    })
  }, [])
  return (
    <>
      <ExportDialog />
      <WelcomeDialog />
      <ShortcutsDialog />
      <RecordSetup />
      <RecordHUD />
      <ConfirmDialog />
    </>
  )
}
