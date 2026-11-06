// Left-hand track header: color, name, M/S/R, volume, pan, meter, delete, reorder grip, resize.
import { GripVertical, X } from 'lucide-react'
import { motion, type DragControls } from 'motion/react'
import { memo, useState } from 'react'
import { getEngine } from '../../core/engine'
import { TRACK_COLORS, uid } from '../../core/ids'
import { useStore } from '../../core/store'
import { toast } from '../../core/toast'
import type { Track } from '../../core/types'
import { Knob, Meter, Slider, Tooltip } from '../../ui/kit'
import { beginDrag } from './interactions'
import { MAX_TRACK_H, MIN_TRACK_H, S } from './state'

const pct = (v: number) => `${Math.round(v * 100)}%`
const panFmt = (v: number) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)

function patchTrack(id: string, label: string, fn: (t: Track) => void, coalesce?: string) {
  S().mutate(
    label,
    (p) => {
      const t = p.tracks.find((x) => x.id === id)
      if (t) fn(t as Track)
    },
    coalesce ? { coalesce } : undefined,
  )
}

function ToggleBtn({ on, kind, label, tip, onClick }: { on: boolean; kind: 'm' | 's' | 'r'; label: string; tip: string; onClick: () => void }) {
  return (
    <Tooltip label={tip}>
      <motion.button
        className={`tl-tbtn tl-tbtn-${kind}${on ? ' on' : ''}`}
        whileTap={{ scale: 0.85 }}
        animate={on ? { scale: [1, 1.15, 1] } : { scale: 1 }}
        transition={{ type: 'spring', stiffness: 600, damping: 18 }}
        onClick={onClick}
        aria-pressed={on}
      >
        {label}
      </motion.button>
    </Tooltip>
  )
}

export const TrackHeader = memo(function TrackHeader({ track, dragControls }: { track: Track; dragControls: DragControls }) {
  const selected = useStore((s) => s.selection.trackIds.includes(track.id))
  const [name, setName] = useState<string | null>(null)
  const analyser = getEngine().trackAnalyser(track.id)
  const compact = track.height < 88
  const id = track.id

  return (
    <div
      className={`tl-head${selected ? ' is-sel' : ''}`}
      style={{ height: track.height, ['--c' as string]: track.color }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button, input, .bk-slider, .bk-knob')) return
        S().select({ trackIds: e.shiftKey ? [...new Set([...S().selection.trackIds, id])] : [id] })
      }}
    >
      <div className="tl-head-strip" />
      <div
        className="tl-grip"
        title="Drag to reorder"
        onPointerDown={(e) => {
          e.preventDefault()
          dragControls.start(e)
        }}
      >
        <GripVertical size={14} />
      </div>
      <div className="tl-head-main">
        <div className="tl-head-row">
          <Tooltip label="Change color">
            <motion.button
              className="tl-color-dot"
              style={{ background: track.color }}
              whileHover={{ scale: 1.25 }}
              whileTap={{ scale: 0.8, rotate: 90 }}
              onClick={() => {
                const i = TRACK_COLORS.indexOf(track.color)
                patchTrack(id, 'Track color', (t) => void (t.color = TRACK_COLORS[(i + 1) % TRACK_COLORS.length]))
              }}
            />
          </Tooltip>
          <input
            className="tl-head-name"
            value={name ?? track.name}
            spellCheck={false}
            onFocus={() => setName(track.name)}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== null && name.trim() && name !== track.name) patchTrack(id, 'Rename track', (t) => void (t.name = name.trim()))
              setName(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setName(track.name)
                requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
              }
            }}
          />
          <Tooltip label="Delete track">
            <motion.button
              className="tl-head-x"
              whileHover={{ rotate: 90 }}
              whileTap={{ scale: 0.8 }}
              onClick={() => {
                const n = S().project.clips.filter((c) => c.trackId === id).length
                S().mutate('Delete track', (p) => {
                  p.tracks = p.tracks.filter((t) => t.id !== id)
                  p.clips = p.clips.filter((c) => c.trackId !== id)
                })
                const sel = S().selection
                S().select({ trackIds: sel.trackIds.filter((t) => t !== id), clipIds: sel.clipIds.filter((c) => S().project.clips.some((x) => x.id === c)) })
                toast({ title: `Deleted “${track.name}”`, body: n ? `${n} clip${n > 1 ? 's' : ''} removed` : undefined, action: { label: 'Undo', run: () => S().undo() } })
              }}
            >
              <X size={13} />
            </motion.button>
          </Tooltip>
        </div>
        <div className="tl-head-row">
          <ToggleBtn on={track.mute} kind="m" label="M" tip="Mute – silence this track" onClick={() => patchTrack(id, track.mute ? 'Unmute' : 'Mute', (t) => void (t.mute = !t.mute))} />
          <ToggleBtn on={track.solo} kind="s" label="S" tip="Solo – hear only this track" onClick={() => patchTrack(id, track.solo ? 'Unsolo' : 'Solo', (t) => void (t.solo = !t.solo))} />
          <ToggleBtn
            on={track.armed}
            kind="r"
            label="●"
            tip="Arm – record onto this track"
            onClick={() =>
              S().mutate('Arm track', (p) => {
                const willArm = !p.tracks.find((t) => t.id === id)?.armed
                for (const t of p.tracks) t.armed = willArm && t.id === id
              })
            }
          />
          <div className="tl-head-spacer" />
          {compact && <span className="tl-head-vol mono">{pct(track.volume)}</span>}
        </div>
        {!compact && (
          <div className="tl-head-row tl-head-mix">
            <Tooltip label={`Volume ${pct(track.volume)}`}>
              <div>
                <Slider
                  value={track.volume}
                  min={0}
                  max={2}
                  defaultValue={1}
                  length={104}
                  color={track.color}
                  onChange={(v) => patchTrack(id, 'Track volume', (t) => void (t.volume = v), `vol-${id}`)}
                />
              </div>
            </Tooltip>
            <Tooltip label={`Pan ${panFmt(track.pan)}`}>
              <div className="tl-head-pan">
                <Knob
                  value={track.pan}
                  min={-1}
                  max={1}
                  bipolar
                  defaultValue={0}
                  size={26}
                  color={track.color}
                  onChange={(v) => patchTrack(id, 'Track pan', (t) => void (t.pan = v), `pan-${id}`)}
                />
              </div>
            </Tooltip>
          </div>
        )}
      </div>
      <div className="tl-head-meter">
        <Meter analyser={analyser} vertical length={Math.max(24, track.height - 18)} thickness={4} />
      </div>
      <div
        className="tl-head-resize"
        title="Drag to resize"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const h0 = track.height
          const key = uid('th')
          beginDrag(e, {
            cursor: 'ns-resize',
            threshold: 0,
            onMove: (_ev, _dx, dy) => {
              const h = Math.round(Math.min(MAX_TRACK_H, Math.max(MIN_TRACK_H, h0 + dy)))
              patchTrack(id, 'Resize track', (t) => void (t.height = h), key)
            },
          })
        }}
      />
    </div>
  )
})
