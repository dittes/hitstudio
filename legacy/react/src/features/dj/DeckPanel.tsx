// One deck panel: header (title, BPM, time), overview, platter + tempo
// fader, transport (CUE / PLAY / SYNC), performance pads (hot cues or beat
// rolls), loop controls and deck FX. Mirrored for deck B.
import { AnimatePresence, motion } from 'motion/react'
import { Disc3, Minus, Pause, Play, Plus, RotateCcw, Rewind, Snowflake, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IconButton, Knob, RollingNumber, Segmented, Slider, Tooltip } from '../../ui/kit'
import { formatTime } from '../../core/ids'
import { findItem, getDJ } from './engine'
import { toast } from '../../core/toast'
import { Platter } from './Platter'
import { DECK_ACCENT, HOT_COLORS, useDJ, type DeckIndex } from './state'
import { Overview } from './Waveforms'

export const DJ_DRAG_TYPE = 'application/x-bloom-dj-item'

function useDeck<T>(i: DeckIndex, sel: (d: ReturnType<typeof useDJ.getState>['decks'][0]) => T) {
  return useDJ((s) => sel(s.decks[i]))
}

/** big readouts that update ~10×/s without re-rendering the deck */
function TimeReadout({ i }: { i: DeckIndex }) {
  const el = useRef<HTMLSpanElement>(null)
  const el2 = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const t = window.setInterval(() => {
      const d = getDJ().decks[i]
      if (!el.current || !el2.current) return
      if (!d.loaded) {
        el.current.textContent = '-0:00.0'
        el2.current.textContent = '0:00'
        return
      }
      const speed = Math.max(0.01, 1 + d.st.tempo)
      const pos = d.position()
      el.current.textContent = '-' + formatTime((d.duration - pos) / speed, true).slice(0, -2)
      el2.current.textContent = formatTime(pos / speed, false)
    }, 90)
    return () => clearInterval(t)
  }, [i])
  return (
    <div className="dj-time">
      <span ref={el} className="dj-time-remain mono" />
      <span ref={el2} className="dj-time-el mono faint" />
    </div>
  )
}

export function DeckPanel({ i }: { i: DeckIndex }) {
  const dj = getDJ()
  const deck = dj.decks[i]
  const title = useDeck(i, (d) => d.title)
  const loaded = useDeck(i, (d) => !!d.itemId)
  const loading = useDeck(i, (d) => d.loading)
  const analyzing = useDeck(i, (d) => d.analyzing)
  const bpm = useDeck(i, (d) => d.bpm)
  const tempo = useDeck(i, (d) => d.tempo)
  const range = useDeck(i, (d) => d.range)
  const playing = useDeck(i, (d) => d.playing)
  const sync = useDeck(i, (d) => d.sync)
  const hot = useDeck(i, (d) => d.hot)
  const loop = useDeck(i, (d) => d.loop)
  const loopIn = useDeck(i, (d) => d.loopIn)
  const loopBeats = useDeck(i, (d) => d.loopBeats)
  const roll = useDeck(i, (d) => d.roll)
  const echo = useDeck(i, (d) => d.echo)
  const echoBeats = useDeck(i, (d) => d.echoBeats)
  const flanger = useDeck(i, (d) => d.flanger)
  const reverb = useDeck(i, (d) => d.reverb)
  const stopping = useDeck(i, (d) => d.stopping)
  const setDeck = useDJ((s) => s.setDeck)
  const [padMode, setPadMode] = useState<'hot' | 'roll'>('hot')
  const [dropOver, setDropOver] = useState(false)
  const effBpm = bpm * (1 + tempo)
  const side = i === 0 ? 'a' : 'b'
  const accent = DECK_ACCENT[i]

  const onDrop = (e: React.DragEvent) => {
    setDropOver(false)
    const id = e.dataTransfer.getData(DJ_DRAG_TYPE)
    if (id) {
      e.preventDefault()
      const it = findItem(id)
      if (it) dj.load(i, it)
      return
    }
    const f = [...e.dataTransfer.files].find((f) => /^(audio|video)\//.test(f.type) || /\.(mp3|wav|flac|ogg|m4a|aac|aiff?|opus|webm)$/i.test(f.name))
    if (f) {
      e.preventDefault()
      dj.loadFile(i, f)
    }
  }

  const bendBtn = (dir: 1 | -1) => ({
    onPointerDown: () => deck.setBend(dir * 0.04),
    onPointerUp: () => deck.setBend(0),
    onPointerLeave: () => deck.setBend(0),
    onPointerCancel: () => deck.setBend(0),
  })

  return (
    <section
      className={`dj-deck dj-deck-${side} ${dropOver ? 'is-drop' : ''} ${playing ? 'is-playing' : ''}`}
      style={{ ['--deck' as string]: accent }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DJ_DRAG_TYPE) || e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setDropOver(false)
      }}
      onDrop={onDrop}
    >
      <header className="dj-deck-head">
        <span className="dj-deck-badge">{i === 0 ? 'A' : 'B'}</span>
        <div className="dj-deck-title">
          <div className="dj-deck-name" title={title}>
            {loaded ? title : <span className="faint">Empty deck — drop a song here</span>}
          </div>
          <div className="dj-deck-sub faint">
            {loading ? 'Loading…' : analyzing ? 'Finding the beat…' : loaded ? `${bpm.toFixed(bpm % 1 ? 2 : 0)} BPM original` : 'Pick a track from the crate'}
          </div>
        </div>
        <div className="dj-bpm">
          <RollingNumber value={effBpm ? effBpm.toFixed(1) : '—.-'} className="mono" />
          <span className="dj-bpm-unit">BPM</span>
          <span className={`dj-bpm-tempo mono ${Math.abs(tempo) > 0.0005 ? 'is-off' : ''}`}>
            {tempo >= 0 ? '+' : '−'}
            {Math.abs(tempo * 100).toFixed(2)}%
          </span>
        </div>
        <TimeReadout i={i} />
      </header>

      <Overview i={i} />

      <div className="dj-deck-body">
        <div className="dj-platter-wrap">
          <Platter i={i} />
          <AnimatePresence>
            {stopping && (
              <motion.div className="dj-stopping" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                {stopping === 'brake' ? 'BRAKE' : 'SPINBACK'}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="dj-tempo">
          <Segmented
            size="sm"
            value={String(range)}
            onChange={(v) => setDeck(i, { range: Number(v), tempo: Math.max(-Number(v), Math.min(Number(v), tempo)) })}
            options={[
              { value: '0.08', label: '8', title: 'Tempo range ±8 %' },
              { value: '0.16', label: '16', title: 'Tempo range ±16 %' },
              { value: '0.5', label: '50', title: 'Tempo range ±50 %' },
            ]}
          />
          <div className="dj-tempo-fader" title="Tempo: drag to speed up / slow down. Double-click to reset.">
            <Slider
              vertical
              length={150}
              min={-range}
              max={range}
              step={0.0005}
              value={-tempo}
              defaultValue={0}
              color={accent}
              onChange={(v) => setDeck(i, { tempo: -v, sync: false })}
            />
          </div>
          <div className="dj-nudge">
            <IconButton label="Nudge slower (hold)" size="sm" variant="soft" icon={<Minus />} {...bendBtn(-1)} />
            <IconButton label="Nudge faster (hold)" size="sm" variant="soft" icon={<Plus />} {...bendBtn(1)} />
          </div>
          <IconButton label="Reset tempo" size="sm" icon={<Undo2 />} onClick={() => setDeck(i, { tempo: 0, sync: false })} />
        </div>
      </div>

      <div className="dj-transport">
        <Tooltip label="Cue: when stopped, sets the start point (hold to preview). When playing, jumps back." shortcut={i === 0 ? 'X' : 'B'} side="top">
          <motion.button
            className="dj-cue"
            whileTap={{ scale: 0.92 }}
            disabled={!loaded}
            onPointerDown={() => deck.cueDown()}
            onPointerUp={() => deck.cueUp()}
            onPointerLeave={() => deck.cueUp()}
          >
            CUE
          </motion.button>
        </Tooltip>
        <Tooltip label={playing ? 'Pause' : 'Play'} shortcut={i === 0 ? 'Z' : 'N'} side="top">
          <motion.button className={`dj-play ${playing ? 'is-on' : ''}`} whileTap={{ scale: 0.9 }} disabled={!loaded} onClick={() => deck.toggle()}>
            {playing ? <Pause /> : <Play />}
          </motion.button>
        </Tooltip>
        <Tooltip label="Sync: match this song's speed and beat to the other deck" shortcut={i === 0 ? 'C' : 'V'} side="top">
          <motion.button
            className={`dj-sync ${sync ? 'is-on' : ''}`}
            whileTap={{ scale: 0.9 }}
            disabled={!loaded}
            onClick={() => {
              if (sync) setDeck(i, { sync: false })
              else if (!deck.syncNow()) toast('Load a song on the other deck to sync to')
            }}
          >
            <span>SYNC</span>
          </motion.button>
        </Tooltip>
      </div>

      <div className="dj-pads-head">
        <Segmented
          size="sm"
          value={padMode}
          onChange={setPadMode}
          options={[
            { value: 'hot', label: 'Hot cues', title: 'Save up to 4 spots in the song and jump to them' },
            { value: 'roll', label: 'Beat roll', title: 'Hold to repeat a slice of the beat — the song keeps going underneath' },
          ]}
        />
      </div>
      <div className={`dj-pads dj-pads-${padMode}`}>
        {padMode === 'hot'
          ? hot.map((t, k) => (
              <motion.button
                key={k}
                className={`dj-pad ${t != null ? 'is-set' : ''}`}
                style={{ ['--pad' as string]: HOT_COLORS[k] }}
                whileTap={{ scale: 0.9 }}
                disabled={!loaded}
                title={t != null ? `Jump to ${formatTime(t)} · right-click to clear` : 'Empty: click to save the current spot'}
                onClick={(e) => {
                  if (e.shiftKey && t != null) deck.clearHotCue(k)
                  else deck.hotCue(k)
                  const el = e.currentTarget
                  el.classList.remove('flash')
                  void el.offsetWidth
                  el.classList.add('flash')
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (t != null) deck.clearHotCue(k)
                }}
              >
                <span className="dj-pad-n">{k + 1}</span>
                <span className="dj-pad-t mono">{t != null ? formatTime(t, false) : '+'}</span>
              </motion.button>
            ))
          : [0.25, 0.5, 1, 2, 4].map((b) => (
              <motion.button
                key={b}
                className={`dj-pad dj-roll ${roll === b ? 'is-on' : ''}`}
                whileTap={{ scale: 0.9 }}
                disabled={!loaded}
                onPointerDown={(e) => {
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                  deck.rollStart(b)
                }}
                onPointerUp={() => deck.rollEnd()}
                onPointerCancel={() => deck.rollEnd()}
              >
                <span className="dj-pad-t mono">{b < 1 ? `1/${1 / b}` : b}</span>
              </motion.button>
            ))}
      </div>

      <div className="dj-loop">
        <Tooltip label="Auto loop: repeat the next few beats forever (click again to leave)" side="top">
          <motion.button className={`dj-loop-btn ${loop && roll === null ? 'is-on' : ''}`} whileTap={{ scale: 0.92 }} disabled={!loaded} onClick={() => deck.autoLoop()}>
            <RotateCcw size={13} /> LOOP <b className="mono">{loopBeats < 1 ? `1/${Math.round(1 / loopBeats)}` : loopBeats}</b>
          </motion.button>
        </Tooltip>
        <button className="dj-mini" disabled={!loaded} onClick={() => deck.resizeLoop(0.5)} title="Halve loop">
          ½
        </button>
        <button className="dj-mini" disabled={!loaded} onClick={() => deck.resizeLoop(2)} title="Double loop">
          ×2
        </button>
        <button className={`dj-mini ${loopIn != null ? 'is-armed' : ''}`} disabled={!loaded} onClick={() => deck.loopInMark()} title="Loop in: mark where the loop starts">
          IN
        </button>
        <button className="dj-mini" disabled={!loaded} onClick={() => deck.loopOutMark()} title="Loop out: mark where it ends (starts looping)">
          OUT
        </button>
      </div>

      <div className="dj-fx">
        <div className="dj-fx-knob">
          <Knob label="Echo" value={echo} min={0} max={1} size={38} color={accent} defaultValue={0} onChange={(v) => setDeck(i, { echo: v })} hint="Echo: repeats in time with the beat" />
          <Segmented
            size="sm"
            value={String(echoBeats)}
            onChange={(v) => setDeck(i, { echoBeats: Number(v) })}
            options={[
              { value: '0.5', label: '½' },
              { value: '0.75', label: '¾' },
              { value: '1', label: '1' },
            ]}
          />
        </div>
        <Knob label="Flanger" value={flanger} min={0} max={1} size={38} color={accent} defaultValue={0} onChange={(v) => setDeck(i, { flanger: v })} hint="Flanger: jet-plane whoosh" />
        <Knob label="Reverb" value={reverb} min={0} max={1} size={38} color={accent} defaultValue={0} onChange={(v) => setDeck(i, { reverb: v })} hint="Reverb: big room space" />
        <div className="dj-fx-stops">
          <IconButton label="Brake: stop like a turntable powering off" size="sm" variant="soft" icon={<Snowflake />} disabled={!playing} onClick={() => deck.brake()} />
          <IconButton label="Spinback: whip the record backwards and stop" size="sm" variant="soft" icon={<Rewind />} disabled={!playing} onClick={() => deck.spinback()} />
        </div>
      </div>
      <AnimatePresence>
        {dropOver && (
          <motion.div className="dj-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Disc3 size={28} />
            Drop to load on deck {i === 0 ? 'A' : 'B'}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
