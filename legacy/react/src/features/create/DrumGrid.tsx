import { motion } from 'motion/react'
import { Dices, Eraser, Volume2, VolumeX } from 'lucide-react'
import React, { memo, useCallback, useEffect, useRef } from 'react'
import { clamp } from '../../core/ids'
import { mutate, useStore } from '../../core/store'
import { Button, Hint, Knob, Segmented } from '../../ui/kit'
import { applyDrumPreset, DRUM_PRESETS, randomizeDrums, DRUM_LANE_IDS } from './patterns'
import { previewDrum, subscribeStep } from './sequencer'
import { createEdit, useCreate } from './state'
import { KITS, LANES } from './synth/drums'
import { dims } from './synth/mix'
import type { DrumLane, KitId } from './types'

interface CellProps {
  v: number
  beat: boolean
  lane: DrumLane
  step: number
}
const Cell = memo(function Cell({ v, beat, lane, step }: CellProps) {
  return (
    <div className={`cr-cell ${v > 0 ? 'on' : ''} ${beat ? 'beat' : ''}`} data-lane={lane} data-step={step} style={{ ['--v' as string]: v }}>
      {v > 0 && <motion.i className="cr-cell-fill" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 700, damping: 22 }} style={{ height: `${28 + v * 72}%` }} />}
    </div>
  )
})

const cellAt = (x: number, y: number) => {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.cr-cell') as HTMLElement | null
  return el ? { lane: el.dataset.lane as DrumLane, step: Number(el.dataset.step) } : null
}

export function DrumGrid() {
  const d = useCreate((s) => s.drums)
  const hints = useStore((s) => s.ui.hints)
  const ts = useStore((s) => s.project.timeSig)
  const bpm = useStore((s) => s.project.bpm)
  const dm = dims(ts, d.long, bpm)
  const n = dm.drumLen
  const phRef = useRef<HTMLDivElement>(null)
  const padRefs = useRef<Partial<Record<DrumLane, HTMLElement | null>>>({})

  // moving playhead + pad bounce, imperative so React doesn't re-render per step
  useEffect(() => {
    return subscribeStep((loop) => {
      const ph = phRef.current
      if (!ph) return
      if (loop < 0) {
        ph.style.opacity = '0'
        return
      }
      const s = loop % n
      ph.style.opacity = '1'
      ph.style.transform = `translateX(${s * 100}%)`
      const st = useCreate.getState().drums
      for (const l of DRUM_LANE_IDS) {
        if (st.grid[l][s] > 0 && !st.mute[l]) {
          padRefs.current[l]?.animate(
            [{ transform: 'scale(1)' }, { transform: `scale(${1.08 + st.grid[l][s] * 0.12})`, offset: 0.25 }, { transform: 'scale(1)' }],
            { duration: 190, easing: 'cubic-bezier(.34,1.56,.64,1)' },
          )
        }
      }
    })
  }, [n])

  const drag = useRef<{ lane: DrumLane; step: number; y: number; startV: number; mode: 'paint' | 'erase'; moved: boolean; sx: number } | null>(null)

  const onDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const c = cellAt(e.clientX, e.clientY)
    if (!c) return
    const g = useCreate.getState().drums.grid[c.lane][c.step]
    const created = g === 0
    drag.current = { lane: c.lane, step: c.step, y: e.clientY, startV: created ? 0.8 : g, mode: created ? 'paint' : 'erase', moved: false, sx: e.clientX }
    if (created) {
      createEdit((s) => {
        s.drums.grid[c.lane][c.step] = 0.8
        s.drums.preset = null
      })
      previewDrum(c.lane, 0.8)
    }
    const move = (ev: PointerEvent) => {
      const dr = drag.current
      if (!dr) return
      const cc = cellAt(ev.clientX, ev.clientY)
      if (cc && cc.lane === dr.lane && cc.step !== dr.step) {
        if (!dr.moved && dr.mode === 'erase') createEdit((s) => void (s.drums.grid[dr.lane][dr.step] = 0))
        dr.moved = true
        dr.step = cc.step
        dr.y = ev.clientY
        const val = dr.mode === 'paint' ? 0.8 : 0
        createEdit((s) => void (s.drums.grid[dr.lane][cc.step] = val))
        if (val) previewDrum(dr.lane, val)
      } else if (!dr.moved || (cc && cc.step === dr.step)) {
        const dy = dr.y - ev.clientY
        if (Math.abs(dy) > 4 && useCreate.getState().drums.grid[dr.lane][dr.step] > 0) {
          dr.moved = true
          const v = clamp(dr.startV + dy / 70, 0.1, 1)
          createEdit((s) => void (s.drums.grid[dr.lane][dr.step] = v))
        }
      }
    }
    const up = () => {
      const dr = drag.current
      if (dr && !dr.moved && dr.mode === 'erase') createEdit((s) => void (s.drums.grid[dr.lane][dr.step] = 0))
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  const onContext = useCallback((e: React.MouseEvent) => {
    const c = cellAt(e.clientX, e.clientY)
    if (!c) return
    e.preventDefault()
    const v = useCreate.getState().drums.grid[c.lane][c.step]
    const next = v === 0 ? 0.35 : v < 0.5 ? 0.6 : v < 0.75 ? 0.85 : v < 0.95 ? 1 : 0
    createEdit((s) => void (s.drums.grid[c.lane][c.step] = next))
    if (next) previewDrum(c.lane, next)
  }, [])

  const loadPreset = (id: string) => {
    const pr = DRUM_PRESETS.find((p) => p.id === id)!
    createEdit((s) => applyDrumPreset(s.drums, pr))
    mutate('Set tempo', (p) => void (p.bpm = pr.bpm), { coalesce: 'bpm' })
    previewDrum('kick')
  }

  return (
    <div className="cr-drums">
      <div className="cr-toolbar">
        <div className="cr-chips">
          <span className="cr-label">Style</span>
          {DRUM_PRESETS.map((p) => (
            <motion.button key={p.id} whileTap={{ scale: 0.92 }} whileHover={{ y: -1 }} className={`cr-chip ${d.preset === p.id ? 'on' : ''}`} onClick={() => loadPreset(p.id)}>
              {d.preset === p.id && <motion.span layoutId="cr-preset-pill" className="cr-chip-pill" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
              <span>{p.name}</span>
            </motion.button>
          ))}
        </div>
        <div className="cr-toolbar-right">
          <Segmented<KitId>
            size="sm"
            value={d.kit}
            onChange={(v) => createEdit((s) => void (s.drums.kit = v))}
            options={(Object.keys(KITS) as KitId[]).map((k) => ({ value: k, label: KITS[k].name, title: KITS[k].blurb }))}
          />
          <Segmented<'16' | '32'>
            size="sm"
            value={d.long ? '32' : '16'}
            onChange={(v) => createEdit((s) => void (s.drums.long = v === '32'))}
            options={[{ value: '16', label: `${dm.barSteps} steps` }, { value: '32', label: `${dm.barSteps * 2} steps` }]}
          />
          <Button size="sm" icon={<Dices />} onClick={() => { createEdit((s) => randomizeDrums(s.drums, n)); previewDrum('snare') }}>
            Randomize
          </Button>
          <Button size="sm" variant="ghost" icon={<Eraser />} onClick={() => createEdit((s) => { for (const l of DRUM_LANE_IDS) s.drums.grid[l].fill(0); s.drums.preset = null })}>
            Clear
          </Button>
        </div>
      </div>
      {hints && <Hint>Click squares to add drum hits. Start with the Kick on 1, 5, 9, 13! Drag a square up or down to change how loud it is, right-click to cycle volume.</Hint>}

      <div className="cr-lanes" onPointerDown={onDown} onContextMenu={onContext}>
        {LANES.map((L) => {
          const muted = d.mute[L.id]
          return (
            <div key={L.id} className={`cr-lane ${muted ? 'muted' : ''}`} style={{ ['--c' as string]: L.color }}>
              <div className="cr-lane-head" onPointerDown={(e) => e.stopPropagation()}>
                <motion.button
                  className="cr-pad"
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: 'spring', stiffness: 700, damping: 18 }}
                  onPointerDown={() => previewDrum(L.id)}
                  aria-label={`Play ${L.label}`}
                >
                  <span className="cr-pad-face" ref={(el) => { padRefs.current[L.id] = el }}>{L.label}</span>
                </motion.button>
                <Knob value={d.vol[L.id]} min={0} max={1} defaultValue={0.85} size={26} color={L.color} label="" onChange={(v) => createEdit((s) => void (s.drums.vol[L.id] = v))} />
                <button className={`cr-mute ${muted ? 'on' : ''}`} title={muted ? 'Unmute' : 'Mute'} onClick={() => createEdit((s) => void (s.drums.mute[L.id] = !s.drums.mute[L.id]))}>
                  {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
              </div>
              <div className="cr-cells" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                {Array.from({ length: n }, (_, i) => (
                  <Cell key={i} v={d.grid[L.id][i]} beat={i % dm.stepsPerBeat === 0} lane={L.id} step={i} />
                ))}
              </div>
            </div>
          )
        })}
        <div className="cr-ph-wrap">
          <div className="cr-ph" ref={phRef} style={{ width: `${100 / n}%` }} />
        </div>
      </div>
    </div>
  )
}
