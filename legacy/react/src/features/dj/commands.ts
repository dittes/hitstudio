// DJ keyboard shortcuts + palette entries (active only in DJ mode).
//   Z play A · X cue A · C sync A   |   V sync B · B cue B · N play B   (mirrored)
//   Q loop A · P loop B · T smooth transition
//   Shift+1..4 hot cues A · Shift+7..0 hot cues B
import { registerCommands } from '../../core/commands'
import { useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { getDJ } from './engine'
import { DEMOS } from './demoLoops'
import { useDJ, type DeckIndex } from './state'

const inDJ = () => useStore.getState().ui.mode === 'dj'
const deck = (i: DeckIndex) => getDJ().decks[i]
const cueTap = (i: DeckIndex) => () => {
  const d = deck(i)
  d.cueDown()
  d.cueUp()
}
const sync = (i: DeckIndex) => () => {
  const d = deck(i)
  if (d.st.sync) useDJ.getState().setDeck(i, { sync: false })
  else if (!d.syncNow()) toast('Load a song on the other deck to sync to')
}

let done = false
export function registerDJCommands() {
  if (done) return
  done = true
  const g = 'DJ'
  registerCommands([
    { id: 'dj.playA', label: 'DJ: Play / pause deck A', group: g, shortcut: 'Z', enabled: inDJ, run: () => deck(0).toggle() },
    { id: 'dj.cueA', label: 'DJ: Cue deck A', group: g, shortcut: 'X', enabled: inDJ, run: cueTap(0) },
    { id: 'dj.syncA', label: 'DJ: Sync deck A', group: g, shortcut: 'C', enabled: inDJ, run: sync(0) },
    { id: 'dj.syncB', label: 'DJ: Sync deck B', group: g, shortcut: 'V', enabled: inDJ, run: sync(1) },
    { id: 'dj.cueB', label: 'DJ: Cue deck B', group: g, shortcut: 'B', enabled: inDJ, run: cueTap(1) },
    { id: 'dj.playB', label: 'DJ: Play / pause deck B', group: g, shortcut: 'N', enabled: inDJ, run: () => deck(1).toggle() },
    { id: 'dj.loopA', label: 'DJ: Auto loop deck A', group: g, shortcut: 'Q', enabled: inDJ, run: () => deck(0).autoLoop() },
    { id: 'dj.loopB', label: 'DJ: Auto loop deck B', group: g, shortcut: 'P', enabled: inDJ, run: () => deck(1).autoLoop() },
    {
      id: 'dj.transition',
      label: 'DJ: Smooth transition to the other deck (Auto-DJ)',
      group: g,
      shortcut: 'T',
      enabled: inDJ,
      keywords: 'auto dj mix blend crossfade',
      run: () => getDJ().smoothTransition(),
    },
    {
      id: 'dj.record',
      label: 'DJ: Start / stop recording the mix',
      group: g,
      enabled: inDJ,
      keywords: 'rec capture mix',
      run: () => {
        const dj = getDJ()
        if (dj.recording) {
          const s = dj.stopRecording()
          if (s > 0) toast({ title: 'Mix saved as a new track 🎧', kind: 'celebrate' })
        } else dj.startRecording()
      },
    },
    {
      id: 'dj.loadDemos',
      label: 'DJ: Load the demo tracks on both decks',
      group: g,
      enabled: inDJ,
      run: () => {
        const dj = getDJ()
        DEMOS.forEach((d, i) => dj.load(i as DeckIndex, { id: d.id, name: d.name, kind: 'demo', color: d.color, get: d.render }))
      },
    },
    {
      id: 'dj.stopAll',
      label: 'DJ: Stop both decks',
      group: g,
      enabled: inDJ,
      run: () => {
        const dj = getDJ()
        dj.cancelAuto()
        dj.decks.forEach((d) => d.pause())
      },
    },
    ...([0, 1, 2, 3] as const).flatMap((k) => [
      { id: `dj.hotA${k + 1}`, label: `DJ: Hot cue ${k + 1} deck A`, group: g, shortcut: `Shift+${k + 1}`, enabled: inDJ, run: () => void deck(0).hotCue(k) },
      { id: `dj.hotB${k + 1}`, label: `DJ: Hot cue ${k + 1} deck B`, group: g, shortcut: `Shift+${(k + 7) % 10}`, enabled: inDJ, run: () => void deck(1).hotCue(k) },
    ]),
  ])
}
