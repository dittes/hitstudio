import { AnimatePresence, motion } from 'motion/react'
import { Disc3, Music, Pause, Play, Plus, Minus, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { registerCommand } from '../../core/commands'
import { clamp } from '../../core/ids'
import { mutate, useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { burst, Button, Hint, Knob, Slider } from '../../ui/kit'
import { activeSections, bounceToSong } from './bounce'
import { ChordPads } from './ChordPads'
import { DrumGrid } from './DrumGrid'
import { MelodyGrid } from './MelodyGrid'
import { previewMelodyRow, startSeq, stopSeq, subscribeStep, toggleSeq, usePlaying } from './sequencer'
import { createEdit, useCreate } from './state'
import { NOTE_NAMES, SCALES, midiName, rowMidi } from './theory'
import type { ScaleId, Section, Tab } from './types'
import './create.css'

registerCommand({
  id: 'create.toggle',
  label: 'Play / stop beat',
  group: 'Create',
  shortcut: 'Shift+Space',
  enabled: () => useStore.getState().ui.mode === 'create',
  run: toggleSeq,
  keywords: 'beat loop drum sequencer',
})

const TABS: { id: Tab; label: string }[] = [
  { id: 'beat', label: 'Beat' },
  { id: 'melody', label: 'Melody' },
  { id: 'chords', label: 'Chords' },
]
const SECTIONS: { id: Section; label: string; color: string }[] = [
  { id: 'drums', label: 'Drums', color: '#fb923c' },
  { id: 'melody', label: 'Melody', color: '#a78bfa' },
  { id: 'chords', label: 'Chords', color: '#38bdf8' },
  { id: 'bass', label: 'Bass', color: '#4ade80' },
]
const LIVE_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK']

export function CreateView() {
  const tab = useCreate((s) => s.tab)
  const playing = usePlaying((s) => s.playing)
  const hints = useStore((s) => s.ui.hints)
  const bpm = useStore((s) => s.project.bpm)
  const ts = useStore((s) => s.project.timeSig)
  const key = useCreate((s) => s.key)
  const scale = useCreate((s) => s.scale)
  const swing = useCreate((s) => s.drums.swing)
  const logoRef = useRef<HTMLDivElement>(null)
  const dotsRef = useRef<(HTMLElement | null)[]>([])
  const [liveOn, setLiveOn] = useState<Set<number>>(new Set())

  // header bounce in time with the music
  useEffect(() => {
    const spb = Math.max(1, 16 / ts[1])
    return subscribeStep((loop) => {
      dotsRef.current.forEach((d) => d?.classList.remove('on'))
      if (loop < 0 || loop % spb !== 0) return
      const beat = (loop / spb) % ts[0]
      dotsRef.current[beat]?.classList.add('on')
      logoRef.current?.animate(
        [{ transform: 'scale(1) rotate(0)' }, { transform: `scale(${beat === 0 ? 1.22 : 1.1}) rotate(${beat === 0 ? -6 : 3}deg)`, offset: 0.3 }, { transform: 'scale(1) rotate(0)' }],
        { duration: 260, easing: 'cubic-bezier(.34,1.56,.64,1)' },
      )
    })
  }, [ts])

  // stop when leaving the view
  useEffect(() => () => stopSeq(), [])

  // computer keyboard = live piano
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const i = LIVE_KEYS.indexOf(e.code)
      if (i < 0 || useStore.getState().ui.mode !== 'create') return
      e.preventDefault()
      e.stopImmediatePropagation() // keep S/D etc. from triggering timeline shortcuts
      if (e.repeat) return
      previewMelodyRow(i)
      setLiveOn((s) => new Set(s).add(i))
    }
    const up = (e: KeyboardEvent) => {
      const i = LIVE_KEYS.indexOf(e.code)
      if (i >= 0) setLiveOn((s) => { const n = new Set(s); n.delete(i); return n })
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const setBpm = (v: number) => mutate('Change tempo', (p) => void (p.bpm = clamp(Math.round(v), 40, 240)), { coalesce: 'bpm' })

  return (
    <div className="cr-root">
      <header className="cr-head">
        <div className="cr-brand">
          <div className="cr-logo" ref={logoRef}><Disc3 size={22} /></div>
          <div>
            <h1>Beat Maker</h1>
            <div className="cr-beats">
              {Array.from({ length: ts[0] }, (_, i) => (
                <i key={i} ref={(el) => { dotsRef.current[i] = el }} className={i === 0 ? 'first' : ''} />
              ))}
            </div>
          </div>
        </div>

        <motion.button className={`cr-play ${playing ? 'on' : ''}`} whileTap={{ scale: 0.9 }} whileHover={{ scale: 1.05 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }} onClick={toggleSeq} aria-label={playing ? 'Stop' : 'Play'}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={playing ? 'p' : 's'} initial={{ scale: 0.4, rotate: -40, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.14 }}>
              {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </motion.span>
          </AnimatePresence>
        </motion.button>

        <div className="cr-ctl">
          <span className="cr-label">Tempo</span>
          <div className="cr-bpm">
            <button onClick={() => setBpm(bpm - 1)} aria-label="Slower"><Minus size={13} /></button>
            <input type="number" min={40} max={240} value={bpm} onChange={(e) => setBpm(Number(e.target.value) || bpm)} />
            <button onClick={() => setBpm(bpm + 1)} aria-label="Faster"><Plus size={13} /></button>
          </div>
        </div>
        <Knob label="Swing" value={Math.round(swing * 100)} min={0} max={100} unit="%" defaultValue={0} size={38} onChange={(v) => createEdit((s) => void (s.drums.swing = v / 100))} />
        <div className="cr-ctl">
          <span className="cr-label">Key</span>
          <div className="cr-selects">
            <select className="cr-select" value={key} onChange={(e) => createEdit((s) => void (s.key = Number(e.target.value)))}>
              {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
            <select className="cr-select" value={scale} title={SCALES[scale].blurb} onChange={(e) => createEdit((s) => void (s.scale = e.target.value as ScaleId))}>
              {(Object.keys(SCALES) as ScaleId[]).map((k) => <option key={k} value={k}>{SCALES[k].name}</option>)}
            </select>
          </div>
        </div>

        <nav className="cr-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`cr-tab ${tab === t.id ? 'on' : ''}`} onClick={() => createEdit((s) => void (s.tab = t.id))}>
              {tab === t.id && <motion.span layoutId="cr-tab-pill" className="cr-tab-pill" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {hints && !playing && tab === 'beat' && <Hint>Press the big play button (or Shift+Space) to hear your loop. Everything you change plays live!</Hint>}

      <main className="cr-main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} className="cr-pane" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            {tab === 'beat' && <DrumGrid />}
            {tab === 'melody' && <MelodyGrid />}
            {tab === 'chords' && <ChordPads />}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="cr-foot">
        <div className="cr-mixer">
          {SECTIONS.map((s) => (
            <SectionStrip key={s.id} id={s.id} label={s.label} color={s.color} />
          ))}
        </div>
        <LiveKeys on={liveOn} onPress={(i) => { previewMelodyRow(i); setLiveOn((s) => new Set(s).add(i)); setTimeout(() => setLiveOn((s) => { const n = new Set(s); n.delete(i); return n }), 160) }} />
        <BouncePanel />
      </footer>
    </div>
  )
}

function SectionStrip({ id, label, color }: { id: Section; label: string; color: string }) {
  const cfg = useCreate((s) => s.sections[id])
  return (
    <div className={`cr-strip ${cfg.mute ? 'muted' : ''}`} style={{ ['--c' as string]: color }}>
      <span className="cr-strip-dot" />
      <span className="cr-strip-name">{label}</span>
      <Slider value={cfg.vol} min={0} max={1} length={84} color={color} defaultValue={0.8} onChange={(v) => createEdit((s) => void (s.sections[id].vol = v))} />
      <Knob label="Sound" value={cfg.tone} min={0} max={1} defaultValue={1} size={30} color={color} onChange={(v) => createEdit((s) => void (s.sections[id].tone = v))} />
      <button className={`cr-mute ${cfg.mute ? 'on' : ''}`} title={cfg.mute ? 'Unmute' : 'Mute'} onClick={() => createEdit((s) => void (s.sections[id].mute = !s.sections[id].mute))}>
        {cfg.mute ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>
    </div>
  )
}

function LiveKeys({ on, onPress }: { on: Set<number>; onPress: (i: number) => void }) {
  const k = useCreate((s) => s.key)
  const scale = useCreate((s) => s.scale)
  const octave = useCreate((s) => s.octave)
  return (
    <div className="cr-live" title="Play the scale with your computer keyboard">
      <Music size={14} className="cr-live-ico" />
      {LIVE_KEYS.map((code, i) => (
        <motion.button key={code} className={`cr-lkey ${on.has(i) ? 'on' : ''}`} animate={{ y: on.has(i) ? 3 : 0, scale: on.has(i) ? 0.94 : 1 }} transition={{ type: 'spring', stiffness: 700, damping: 20 }} onPointerDown={() => onPress(i)}>
          <b>{code.slice(3)}</b>
          <small>{midiName(rowMidi(k, scale, octave, i))}</small>
        </motion.button>
      ))}
    </div>
  )
}

function BouncePanel() {
  const bars = useCreate((s) => s.bounceBars)
  const [busy, setBusy] = useState(false)
  const btn = useRef<HTMLSpanElement>(null)
  const go = async () => {
    if (busy) return
    if (!activeSections().length) return void toast('Nothing to add yet - make a beat first!')
    setBusy(true)
    try {
      const n = await bounceToSong(bars)
      const r = btn.current?.getBoundingClientRect()
      if (r) burst(r.left + r.width / 2, r.top)
      toast({
        title: 'Added to your song!',
        body: `${n} new track${n === 1 ? '' : 's'}, ${bars} bars each`,
        kind: 'celebrate',
        action: { label: 'Go to Edit', run: () => useStore.getState().setMode('edit') },
        ms: 5000,
      })
    } catch (e) {
      console.error(e)
      toast({ title: 'Could not add the beat', kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="cr-bounce">
      <span className="cr-label">Length</span>
      <div className="cr-bars">
        {[2, 4, 8, 16].map((b) => (
          <button key={b} className={bars === b ? 'on' : ''} onClick={() => createEdit((s) => void (s.bounceBars = b))}>
            {bars === b && <motion.span layoutId="cr-bars-pill" className="cr-chip-pill" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
            <span>{b} bars</span>
          </button>
        ))}
      </div>
      <span ref={btn} style={{ display: 'inline-flex' }}>
        <Button variant="primary" size="lg" icon={<Sparkles />} onClick={go} disabled={busy}>
          {busy ? 'Rendering…' : 'Add to my song'}
        </Button>
      </span>
    </div>
  )
}

export { startSeq }
