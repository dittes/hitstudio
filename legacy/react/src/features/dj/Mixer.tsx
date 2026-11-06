// Centre mixer: per-channel trim, 3-band kill EQ, filter, VU + channel
// fader; crossfader with curve; REC the mix; Auto-DJ smooth transition.
import { AnimatePresence, motion } from 'motion/react'
import { Circle, Sparkles, Square } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { getEngine } from '../../core/engine'
import { toast } from '../../core/toast'
import { Knob, Meter, Segmented, Slider, Tooltip, burst } from '../../ui/kit'
import { EQ_MIN } from './deck'
import { getDJ } from './engine'
import { DECK_ACCENT, useDJ, type DeckIndex, type XfCurve } from './state'

/** EQ knob position (−1..1, centre = flat) ⇄ dB (−26 = kill .. +6) */
const eqToKnob = (db: number) => (db >= 0 ? db / 6 : -db / EQ_MIN)
const knobToEq = (n: number) => (n >= 0 ? n * 6 : -n * EQ_MIN)
const BANDS = ['High', 'Mid', 'Low'] as const
const BAND_IDX = [2, 1, 0] as const

function EqKnob({ i, band }: { i: DeckIndex; band: 0 | 1 | 2 }) {
  const db = useDJ((s) => s.decks[i].eq[band])
  const kill = useDJ((s) => s.decks[i].kill[band])
  const setDeck = useDJ((s) => s.setDeck)
  const toggleKill = () => {
    const k = [...useDJ.getState().decks[i].kill] as [boolean, boolean, boolean]
    k[band] = !k[band]
    setDeck(i, { kill: k })
  }
  const name = BANDS[2 - band]
  return (
    <div className={`dj-eq ${kill ? 'is-kill' : ''}`} onDoubleClick={toggleKill} title={`${name}: turn to boost/cut · double-click to kill (mute) the ${name.toLowerCase()}s`}>
      <Knob
        label={name}
        value={eqToKnob(db)}
        min={-1}
        max={1}
        bipolar
        size={36}
        color={kill ? 'var(--danger)' : DECK_ACCENT[i]}
        onChange={(v) => {
          const eq = [...useDJ.getState().decks[i].eq] as [number, number, number]
          eq[band] = Math.abs(v) < 0.04 ? 0 : knobToEq(v)
          setDeck(i, { eq })
        }}
      />
      <button className={`dj-kill ${kill ? 'is-on' : ''}`} onClick={toggleKill} onDoubleClick={(e) => e.stopPropagation()}>
        {kill || db <= EQ_MIN + 0.1 ? 'KILL' : `${db > 0 ? '+' : ''}${db.toFixed(db > -10 ? 1 : 0)}`}
      </button>
    </div>
  )
}

function Channel({ i }: { i: DeckIndex }) {
  const d = useDJ((s) => s.decks[i])
  const setDeck = useDJ((s) => s.setDeck)
  const analyser = getDJ().decks[i].analyser
  const acc = DECK_ACCENT[i]
  return (
    <div className={`dj-ch dj-ch-${i ? 'b' : 'a'}`} style={{ ['--deck' as string]: acc }}>
      <div className="dj-ch-tag">{i ? 'B' : 'A'}</div>
      <Knob label="Gain" value={d.trim} min={-12} max={12} bipolar size={32} unit="dB" step={0.1} defaultValue={0} color={acc} onChange={(v) => setDeck(i, { trim: v })} hint="Gain / trim: match loudness between songs" />
      {BAND_IDX.map((b) => (
        <EqKnob key={b} i={i} band={b} />
      ))}
      <div className={`dj-filter ${Math.abs(d.filter) > 0.02 ? 'is-on' : ''}`}>
        <Knob
          label={d.filter < -0.02 ? 'Low-pass' : d.filter > 0.02 ? 'High-pass' : 'Filter'}
          value={d.filter}
          min={-1}
          max={1}
          bipolar
          size={40}
          defaultValue={0}
          color={acc}
          onChange={(v) => setDeck(i, { filter: Math.abs(v) < 0.03 ? 0 : v })}
          hint="Filter: left = muffled (low-pass), right = thin (high-pass). Double-click resets."
        />
        <Knob label="Reso" value={d.res} min={0} max={1} size={24} defaultValue={0.3} color={acc} onChange={(v) => setDeck(i, { res: v })} hint="Filter resonance" />
      </div>
      <div className="dj-ch-fader">
        <Meter analyser={analyser} length={128} thickness={7} />
        <Slider vertical length={128} min={0} max={1} value={d.fader} defaultValue={0.85} color={acc} onChange={(v) => setDeck(i, { fader: v })} />
      </div>
    </div>
  )
}

function RecButton() {
  const rec = useDJ((s) => s.rec)
  const recStart = useDJ((s) => s.recStart)
  const t = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!rec) return
    const iv = window.setInterval(() => {
      const s = Math.floor((performance.now() - recStart) / 1000)
      if (t.current) t.current.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    }, 250)
    return () => clearInterval(iv)
  }, [rec, recStart])
  return (
    <Tooltip label={rec ? 'Stop and add the mix to your song as a new track' : 'Record your mix'} side="bottom">
      <motion.button
        className={`dj-rec ${rec ? 'is-on' : ''}`}
        whileTap={{ scale: 0.92 }}
        onClick={(e) => {
          const dj = getDJ()
          if (!rec) {
            dj.startRecording()
            toast({ title: 'Recording your mix', body: 'Press REC again to stop — it becomes a new track.' })
          } else {
            const secs = dj.stopRecording()
            if (secs > 0) {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              burst(r.left + r.width / 2, r.top + r.height / 2)
              toast({ title: 'Mix saved as a new track 🎧', body: `${secs.toFixed(1)} s added — find it in Edit mode.`, kind: 'celebrate' })
            }
          }
        }}
      >
        {rec ? <Square size={12} fill="currentColor" /> : <Circle size={12} fill="currentColor" />}
        <span>REC</span>
        {rec && <span ref={t} className="mono dj-rec-t">0:00</span>}
      </motion.button>
    </Tooltip>
  )
}

function AutoButton() {
  const auto = useDJ((s) => s.auto)
  return (
    <Tooltip label="Smooth transition: HitStudio syncs the songs and blends into the other deck over 16 bars" shortcut="T" side="bottom">
      <motion.button className={`dj-auto ${auto ? 'is-on' : ''}`} whileTap={{ scale: 0.94 }} onClick={() => getDJ().smoothTransition()}>
        <Sparkles size={14} />
        <span>{auto ? `Mixing… ${Math.round(auto.progress * 100)}%` : 'Smooth transition'}</span>
        <AnimatePresence>
          {auto && <motion.i className="dj-auto-bar" initial={{ scaleX: 0 }} animate={{ scaleX: auto.progress }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} />}
        </AnimatePresence>
      </motion.button>
    </Tooltip>
  )
}

export function Mixer() {
  const xf = useDJ((s) => s.xf)
  const curve = useDJ((s) => s.curve)
  const set = useDJ((s) => s.set)
  return (
    <section className="dj-mixer">
      <div className="dj-mixer-top">
        <RecButton />
        <AutoButton />
      </div>
      <div className="dj-mixer-chs">
        <Channel i={0} />
        <div className="dj-master">
          <span className="faint">Master</span>
          <Meter analyser={getEngine().masterAnalyser} length={220} thickness={6} />
        </div>
        <Channel i={1} />
      </div>
      <div className="dj-xf">
        <div className="dj-xf-labels">
          <span style={{ color: DECK_ACCENT[0] }}>A</span>
          <span className="faint">Crossfader</span>
          <span style={{ color: DECK_ACCENT[1] }}>B</span>
        </div>
        <div className="dj-xf-track" onDoubleClick={() => set({ xf: 0.5 })}>
          <Slider min={0} max={1} step={0.001} value={xf} length={230} defaultValue={0.5} color="transparent" onChange={(v) => set({ xf: v })} />
        </div>
        <Segmented<XfCurve>
          size="sm"
          value={curve}
          onChange={(c) => set({ curve: c })}
          options={[
            { value: 'smooth', label: 'Smooth', title: 'Constant-power blend (best for mixing)' },
            { value: 'linear', label: 'Linear', title: 'Straight blend' },
            { value: 'cut', label: 'Cut', title: 'Sharp cut (for scratching)' },
          ]}
        />
      </div>
    </section>
  )
}
