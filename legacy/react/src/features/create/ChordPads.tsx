import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Hint, Segmented, Toggle } from '../../ui/kit'
import { useStore } from '../../core/store'
import { BASS_PATTERNS, PROG_PRESETS } from './patterns'
import { previewChord, subscribeStep } from './sequencer'
import { createEdit, useCreate } from './state'
import { INSTRUMENTS } from './synth/instruments'
import { dims } from './synth/mix'
import { chordFor } from './theory'
import type { BassPattern, ChordStyle, InstId } from './types'

const PAD_COLORS = ['#fb923c', '#f472b6', '#a78bfa', '#38bdf8', '#4ade80', '#facc15', '#2dd4bf', '#818cf8']
const CHORD_INSTS: InstId[] = ['pad', 'piano', 'pluck', 'saw', 'bell']

export function ChordPads() {
  const key = useCreate((s) => s.key)
  const scale = useCreate((s) => s.scale)
  const ch = useCreate((s) => s.chords)
  const bass = useCreate((s) => s.bass)
  const hints = useStore((s) => s.ui.hints)
  const ts = useStore((s) => s.project.timeSig)
  const bpm = useStore((s) => s.project.bpm)
  const dm = dims(ts, false, bpm)
  const [slot, setSlot] = useState(0)
  const [playingSlot, setPlayingSlot] = useState(-1)
  const lastSlot = useRef(-1)

  useEffect(
    () =>
      subscribeStep((loop) => {
        const s = loop < 0 ? -1 : Math.floor(loop / dm.barSteps) % 4
        if (s !== lastSlot.current) {
          lastSlot.current = s
          setPlayingSlot(s)
        }
      }),
    [dm.barSteps],
  )

  const pads = Array.from({ length: 8 }, (_, i) => chordFor(key, scale, i))
  const inProg = (i: number) => ch.prog.map((p, k) => (p === i % 7 ? k : -1)).filter((k) => k >= 0)

  const hit = (i: number) => {
    previewChord(i)
    createEdit((s) => {
      s.chords.prog[slot] = i % 7
      s.chords.preset = null
    })
    setSlot((slot + 1) % 4)
  }

  return (
    <div className="cr-chords">
      {hints && <Hint>Tap a pad to hear a chord. It also drops into the glowing slot below, so you can build a 4-chord progression by just tapping!</Hint>}
      <div className="cr-padgrid">
        {pads.map((c, i) => {
          const used = inProg(i)
          const active = playingSlot >= 0 && ch.prog[playingSlot] === i % 7
          return (
            <motion.button
              key={i}
              className={`cr-bigpad ${active ? 'active' : ''} ${used.length ? 'used' : ''}`}
              style={{ ['--c' as string]: PAD_COLORS[i] }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.9, y: 2 }}
              transition={{ type: 'spring', stiffness: 700, damping: 16 }}
              onClick={() => hit(i)}
            >
              <span className="cr-bigpad-roman">{c.roman}</span>
              <span className="cr-bigpad-name">{c.name}</span>
              <span className="cr-bigpad-dots">{used.map((u) => <i key={u}>{u + 1}</i>)}</span>
            </motion.button>
          )
        })}
      </div>

      <div className="cr-prog">
        <div className="cr-prog-head">
          <span className="cr-label">Chord progression</span>
          <select
            className="cr-select"
            value={ch.preset ?? ''}
            onChange={(e) => {
              const p = PROG_PRESETS.find((x) => x.id === e.target.value)
              if (!p) return
              createEdit((s) => {
                s.chords.prog = [...p.prog]
                s.chords.preset = p.id
              })
              previewChord(p.prog[0])
            }}
          >
            <option value="" disabled>Presets…</option>
            {PROG_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="cr-slots">
          {ch.prog.map((deg, i) => {
            const c = chordFor(key, scale, deg)
            return (
              <motion.button
                layout
                key={i}
                className={`cr-slot ${slot === i ? 'sel' : ''} ${playingSlot === i ? 'now' : ''}`}
                style={{ ['--c' as string]: PAD_COLORS[deg % 8] }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setSlot(i)
                  previewChord(deg)
                }}
              >
                <span className="cr-slot-n">Bar {i + 1}</span>
                <motion.span key={c.name + c.roman} className="cr-slot-roman" initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>{c.roman}</motion.span>
                <span className="cr-slot-name">{c.name}</span>
              </motion.button>
            )
          })}
        </div>
      </div>

      <div className="cr-optrow">
        <div className="cr-opt">
          <span className="cr-label">Play as</span>
          <Segmented<ChordStyle>
            size="sm"
            value={ch.style}
            onChange={(v) => createEdit((s) => void (s.chords.style = v))}
            options={[{ value: 'pad', label: 'Pad', title: 'Long, smooth chords' }, { value: 'arp', label: 'Arp', title: 'Notes one after another' }, { value: 'stabs', label: 'Stabs', title: 'Short rhythmic hits' }]}
          />
        </div>
        <div className="cr-opt">
          <span className="cr-label">Sound</span>
          <div className="cr-chips">
            {CHORD_INSTS.map((id) => (
              <motion.button key={id} whileTap={{ scale: 0.92 }} className={`cr-chip ${ch.inst === id ? 'on' : ''}`} onClick={() => { createEdit((s) => void (s.chords.inst = id)); setTimeout(() => previewChord(ch.prog[0], id), 30) }}>
                {ch.inst === id && <motion.span layoutId="cr-cinst-pill" className="cr-chip-pill" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
                <span>{INSTRUMENTS[id].name}</span>
              </motion.button>
            ))}
          </div>
        </div>
        <div className="cr-opt">
          <span className="cr-label">Bass line</span>
          <Toggle on={bass.on} onChange={(v) => createEdit((s) => void (s.bass.on = v))} />
          <Segmented<BassPattern>
            size="sm"
            value={bass.pattern}
            onChange={(v) => createEdit((s) => void (s.bass.pattern = v))}
            options={(Object.keys(BASS_PATTERNS) as BassPattern[]).map((k) => ({ value: k, label: BASS_PATTERNS[k].name }))}
          />
        </div>
      </div>
      {hints && <Hint>The bass follows your chords automatically. Try "Octave bounce" for a disco feel!</Hint>}
    </div>
  )
}
