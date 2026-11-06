import { AnimatePresence, motion } from 'motion/react'
import { Eraser, Wand2 } from 'lucide-react'
import React, { useCallback, useEffect, useRef } from 'react'
import { Button, Hint, Segmented } from '../../ui/kit'
import { useStore } from '../../core/store'
import { autoMelody, noteId } from './patterns'
import { previewMelodyRow, subscribeStep } from './sequencer'
import { createEdit, useCreate } from './state'
import { INSTRUMENTS } from './synth/instruments'
import { dims } from './synth/mix'
import { chordFor, isRootRow, midiNameOct, NOTE_NAMES, rowCount, rowMidi, SCALES } from './theory'
import type { InstId, ScaleId } from './types'

const BLACK = new Set([1, 3, 6, 8, 10])
const INSTS: InstId[] = ['pluck', 'pad', 'bass', 'bell', 'saw', 'piano']

export function MelodyGrid() {
  const key = useCreate((s) => s.key)
  const scale = useCreate((s) => s.scale)
  const octave = useCreate((s) => s.octave)
  const notes = useCreate((s) => s.melody.notes)
  const inst = useCreate((s) => s.melody.inst)
  const prog = useCreate((s) => s.chords.prog)
  const hints = useStore((s) => s.ui.hints)
  const ts = useStore((s) => s.project.timeSig)
  const bpm = useStore((s) => s.project.bpm)
  const dm = dims(ts, false, bpm)
  const cols = dm.melodyLen
  const R = rowCount(scale)
  const area = useRef<HTMLDivElement>(null)
  const phRef = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      subscribeStep((loop) => {
        const ph = phRef.current
        if (!ph) return
        if (loop < 0) return void (ph.style.opacity = '0')
        ph.style.opacity = '1'
        ph.style.transform = `translateX(${(loop % cols) * 100}%)`
      }),
    [cols],
  )

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = area.current!.getBoundingClientRect()
    const col = Math.max(0, Math.min(cols - 1, Math.floor(((e.clientX - r.left) / r.width) * cols)))
    const row = Math.max(0, Math.min(R - 1, R - 1 - Math.floor(((e.clientY - r.top) / r.height) * R)))
    return { col, row }
  }

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const { col, row } = pos(e)
      const list = useCreate.getState().melody.notes
      const hit = list.find((n) => n.row === row && col >= n.step && col < n.step + n.len)
      let id: string
      let mode: 'resize' | 'move'
      let moved = false
      let grabOff = 0
      if (hit) {
        id = hit.id
        mode = col === hit.step + hit.len - 1 && hit.len > 1 ? 'resize' : 'move'
        grabOff = col - hit.step
      } else {
        id = noteId()
        mode = 'resize'
        moved = true
        createEdit((s) => void s.melody.notes.push({ id, step: col, row, len: 1 }))
        previewMelodyRow(row)
      }
      let lastRow = row
      const move = (ev: PointerEvent) => {
        const p = pos(ev)
        if (mode === 'resize') {
          const n = useCreate.getState().melody.notes.find((x) => x.id === id)
          if (!n) return
          const len = Math.max(1, Math.min(cols - n.step, p.col - n.step + 1))
          if (len !== n.len) {
            moved = true
            createEdit((s) => void (s.melody.notes.find((x) => x.id === id)!.len = len))
          }
        } else {
          const n = useCreate.getState().melody.notes.find((x) => x.id === id)
          if (!n) return
          const step = Math.max(0, Math.min(cols - n.len, p.col - grabOff))
          if (step !== n.step || p.row !== n.row) {
            moved = true
            createEdit((s) => {
              const m = s.melody.notes.find((x) => x.id === id)!
              m.step = step
              m.row = p.row
            })
            if (p.row !== lastRow) {
              lastRow = p.row
              previewMelodyRow(p.row, 0.25)
            }
          }
        }
      }
      const up = () => {
        if (hit && !moved) createEdit((s) => void (s.melody.notes = s.melody.notes.filter((x) => x.id !== id)))
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cols, R],
  )

  const generate = () => {
    const st = useCreate.getState()
    const out = autoMelody(st.scale, st.chords.prog, (i) => chordFor(st.key, st.scale, i).semis, dm.barSteps)
    createEdit((s) => void (s.melody.notes = out))
    if (out[0]) previewMelodyRow(out[0].row)
  }

  const rows = Array.from({ length: R }, (_, i) => R - 1 - i)

  return (
    <div className="cr-melody">
      <div className="cr-toolbar">
        <div className="cr-chips">
          <span className="cr-label">Sound</span>
          {INSTS.map((id) => (
            <motion.button key={id} whileTap={{ scale: 0.92 }} whileHover={{ y: -1 }} className={`cr-chip ${inst === id ? 'on' : ''}`} onClick={() => { createEdit((s) => void (s.melody.inst = id)); setTimeout(() => previewMelodyRow(Math.floor(R / 2)), 30) }}>
              {inst === id && <motion.span layoutId="cr-inst-pill" className="cr-chip-pill" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
              <span>{INSTRUMENTS[id].name}</span>
            </motion.button>
          ))}
        </div>
        <div className="cr-toolbar-right">
          <Segmented<'-1' | '0' | '1'>
            size="sm"
            value={String(octave) as '-1' | '0' | '1'}
            onChange={(v) => createEdit((s) => void (s.octave = Number(v)))}
            options={[{ value: '-1', label: 'Low' }, { value: '0', label: 'Mid' }, { value: '1', label: 'High' }]}
          />
          <Button size="sm" variant="primary" icon={<Wand2 />} onClick={generate}>Auto-melody</Button>
          <Button size="sm" variant="ghost" icon={<Eraser />} onClick={() => createEdit((s) => void (s.melody.notes = []))}>Clear</Button>
        </div>
      </div>
      {hints && <Hint>Every row is a note from the {NOTE_NAMES[key]} {SCALES[scale].name} scale, so there are no wrong notes! Click to place a note, drag sideways to make it longer, click it again to remove.</Hint>}

      <div className="cr-roll">
        <div className="cr-keys">
          {rows.map((r) => {
            const m = rowMidi(key, scale, octave, r)
            return (
              <button key={r} className={`cr-key ${BLACK.has(m % 12) ? 'black' : ''} ${isRootRow(scale, r) ? 'root' : ''}`} onPointerDown={() => previewMelodyRow(r)}>
                {midiNameOct(m)}
              </button>
            )
          })}
        </div>
        <div
          className="cr-roll-area"
          ref={area}
          onPointerDown={onDown}
          style={{ ['--cols' as string]: cols, ['--rows' as string]: R, ['--bar' as string]: dm.barSteps, ['--beat' as string]: dm.stepsPerBeat }}
        >
          {rows.map((r, i) => (
            <div key={r} className={`cr-roll-row ${isRootRow(scale, r) ? 'root' : ''}`} style={{ top: `${(i / R) * 100}%`, height: `${100 / R}%` }} />
          ))}
          <AnimatePresence>
            {notes.map((n) => (
              <motion.div
                key={n.id}
                className="cr-note"
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }}
                transition={{ type: 'spring', stiffness: 600, damping: 22 }}
                style={{ left: `${(n.step / cols) * 100}%`, width: `${(n.len / cols) * 100}%`, top: `${((R - 1 - n.row) / R) * 100}%`, height: `${100 / R}%` }}
              >
                <span className="cr-note-in" />
              </motion.div>
            ))}
          </AnimatePresence>
          <div className="cr-ph-wrap2">
            <div className="cr-ph" ref={phRef} style={{ width: `${100 / cols}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export type { ScaleId }
