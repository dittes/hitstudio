// OWNER: dj agent. DJ mode: two decks, mixer, crate, stacked waveforms.
// The DJ engine (./engine) outlives this view, so music keeps playing when
// you switch modes; call disposeDJ() to tear it down.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo } from 'react'
import { useStore } from '../../core/store'
import { Hint, Kbd } from '../../ui/kit'
import { registerDJCommands } from './commands'
import { Crate } from './Crate'
import { DeckPanel } from './DeckPanel'
import { DEMOS } from './demoLoops'
import { getDJ } from './engine'
import { Mixer } from './Mixer'
import { useDJ, type DeckIndex } from './state'
import { ZoomWaves } from './Waveforms'
import './dj.css'

export { disposeDJ, getDJ } from './engine'

registerDJCommands()

let autoloaded = false

function useHint(): string | null {
  const a = useDJ((s) => s.decks[0])
  const b = useDJ((s) => s.decks[1])
  const xf = useDJ((s) => s.xf)
  const auto = useDJ((s) => s.auto)
  const rec = useDJ((s) => s.rec)
  if (auto) return 'Watch the crossfader and the LOW knobs move — that’s a classic “bass swap” transition.'
  if (!a.itemId && !b.itemId) return 'Pick a song from the Crate below (the demo tracks are a great start) and press A or B to load it.'
  if (a.loading || b.loading || a.analyzing || b.analyzing) return 'Listening for the beat… one moment.'
  if (!a.playing && !b.playing) return 'Press ▶ on a deck to start the music. Drag the record to scratch!'
  const one = a.playing !== b.playing
  const other = a.playing ? b : a
  if (one && !other.itemId) return 'Load a second song on the other deck to mix into it.'
  if (one && !other.sync) return 'Press SYNC on the other deck so both songs play at the same speed, then press ▶.'
  if (one) return 'Press ▶ on the other deck — it will start perfectly on the beat.'
  if (!a.sync && !b.sync && Math.abs(a.bpm * (1 + a.tempo) - b.bpm * (1 + b.tempo)) > 0.2)
    return 'The beats are drifting apart — press SYNC so both songs play at the same speed.'
  if (!rec && (xf < 0.1 || xf > 0.9)) return 'Slide the crossfader to blend the songs — or press “Smooth transition” and let HitStudio do it.'
  if (!rec) return 'Sounding good! Hit REC to record your mix as a new track.'
  return 'Recording… try the filter knob, an echo or a beat roll for flair.'
}

function HintBar() {
  const hints = useStore((s) => s.ui.hints)
  const msg = useHint()
  if (!hints) return null
  return (
    <div className="dj-hintbar">
      <AnimatePresence mode="wait">
        {msg && (
          <motion.div key={msg} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            <Hint>{msg}</Hint>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="dj-keys faint">
        <Kbd k="Z" /> <Kbd k="N" /> play · <Kbd k="X" /> <Kbd k="B" /> cue · <Kbd k="C" /> <Kbd k="V" /> sync · <Kbd k="T" /> auto mix
      </div>
    </div>
  )
}

export function DJView() {
  // create the engine before children read from it
  useMemo(() => getDJ(), [])
  useEffect(() => {
    // render the demo loops in the background; first visit → load them so a
    // beginner can press play right away
    DEMOS.forEach((d) => d.render())
    const s = useDJ.getState()
    if (!autoloaded && !s.decks[0].itemId && !s.decks[1].itemId) {
      autoloaded = true
      const dj = getDJ()
      DEMOS.forEach((d, i) => dj.load(i as DeckIndex, { id: d.id, name: d.name, kind: 'demo', color: d.color, get: d.render }))
      useDJ.getState().set({ xf: 0 })
    }
  }, [])

  return (
    <div className="dj-root">
      <HintBar />
      <div className="dj-waves">
        <ZoomWaves />
      </div>
      <div className="dj-main">
        <DeckPanel i={0} />
        <Mixer />
        <DeckPanel i={1} />
      </div>
      <Crate />
    </div>
  )
}
