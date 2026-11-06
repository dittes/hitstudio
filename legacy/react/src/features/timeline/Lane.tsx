// A track lane: clips, range-selection band, file-drop ghost.
import { memo, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { snapTime, useStore } from '../../core/store'
import type { Track } from '../../core/types'
import { importFiles } from '../io'
import { ClipView } from './ClipView'
import { startRangeSelect } from './interactions'
import { S, TILE, useTL } from './state'

interface Props {
  track: Track
  index: number
}

export const Lane = memo(function Lane({ track, index }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const clips = useStore(useShallow((s) => s.project.clips.filter((c) => c.trackId === track.id)))
  const zoom = useStore((s) => s.ui.zoom)
  const selIds = useStore((s) => s.selection.clipIds)
  const sel = useMemo(() => new Set(selIds), [selIds])
  const range = useStore((s) => (s.selection.range && s.selection.trackIds.includes(track.id) ? s.selection.range : null))
  const trackSelected = useStore((s) => s.selection.trackIds.includes(track.id))
  // quantized scroll position: lanes only re-render when a new tile column comes into view
  const vt = useStore((s) => Math.floor((s.ui.scrollX * s.ui.zoom) / TILE))
  const viewW = useTL((s) => s.viewW)
  const ghost = useTL((s) => (s.dropGhost?.trackId === track.id ? s.dropGhost.at : null))
  const visL = (vt - 1) * TILE
  const visR = (vt + 2) * TILE + viewW

  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    const { zoom: z, scrollX } = S().ui
    return Math.max(0, snapTime(scrollX + (clientX - r.left) / z))
  }

  return (
    <div
      ref={ref}
      className={`tl-lane${trackSelected ? ' is-track-sel' : ''}${track.mute ? ' is-muted' : ''}`}
      data-lane-index={index}
      style={{ height: track.height, ['--c' as string]: track.color }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        if (S().ui.tool === 'cut') {
          S().select({ clipIds: [], trackIds: [track.id], range: null })
          return
        }
        startRangeSelect(e, ref.current!, track.id)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        // handled here: keep the app-wide "drop anywhere" overlay from covering the lane
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        const at = timeAt(e.clientX)
        const g = useTL.getState().dropGhost
        if (!g || g.trackId !== track.id || Math.abs(g.at - at) > 1e-6) useTL.getState().set({ dropGhost: { trackId: track.id, at } })
      }}
      onDragLeave={(e) => {
        if (ref.current && e.relatedTarget instanceof Node && ref.current.contains(e.relatedTarget)) return
        if (useTL.getState().dropGhost?.trackId === track.id) useTL.getState().set({ dropGhost: null })
      }}
      onDrop={(e) => {
        const files = e.dataTransfer.files
        useTL.getState().set({ dropGhost: null })
        if (!files.length) return
        e.preventDefault()
        importFiles(Array.from(files), { trackId: track.id, at: timeAt(e.clientX) })
      }}
    >
      <div className="tl-lane-inner">
        {range && <div className="tl-range" style={{ left: range.start * zoom, width: Math.max(1, (range.end - range.start) * zoom) }} />}
        {clips.map((c) => (
          <ClipView
            key={c.id}
            clip={c}
            color={c.color ?? track.color}
            height={track.height - 8}
            zoom={zoom}
            selected={sel.has(c.id)}
            visL={visL}
            visR={visR}
          />
        ))}
        {ghost !== null && (
          <div className="tl-drop-ghost" style={{ left: ghost * zoom }}>
            <span>Drop here</span>
          </div>
        )}
      </div>
    </div>
  )
})
