// One clip on a lane: tiled waveform, name, trim/fade/gain handles.
import { memo, useEffect, useRef, useState } from 'react'
import { gainToDb } from '../../core/ids'
import { snapTime, useStore } from '../../core/store'
import type { Clip } from '../../core/types'
import { splitClipAtTime } from './commands'
import { startClipMove, startFade, startGain, startTrim } from './interactions'
import { clipLen, S, seenClips, TILE, useTL } from './state'
import { useBufferEntry, WaveTile } from './Waveform'

const HEAD_H = 17

interface Props {
  clip: Clip
  color: string
  height: number
  zoom: number
  selected: boolean
  /** visible window in lane-content px (quantized, see Lane) */
  visL: number
  visR: number
}

function fmtDb(g: number) {
  if (g <= 0) return '−∞ dB'
  const db = gainToDb(g)
  return `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`
}

export const ClipView = memo(function ClipView({ clip, color, height, zoom, selected, visL, visR }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const entry = useBufferEntry(clip.bufferId)
  const [isNew] = useState(() => !seenClips.has(clip.id))
  useEffect(() => {
    seenClips.add(clip.id)
  }, [clip.id])
  const renaming = useTL((s) => s.renaming === clip.id)

  const len = clipLen(clip)
  const left = clip.start * zoom
  const w = Math.max(3, len * zoom)
  const waveH = Math.max(8, height - HEAD_H - 2)

  // visible tiles only
  const tiles: number[] = []
  if (entry) {
    const a = Math.max(0, visL - left),
      b = Math.min(w, visR - left)
    if (b > a) for (let k = Math.floor(a / TILE); k * TILE < b; k++) tiles.push(k)
  }

  const fiPx = Math.min(w, clip.fadeIn * zoom)
  const foPx = Math.min(w, clip.fadeOut * zoom)
  const gainY = HEAD_H + Math.max(0, Math.min(1, 1 - clip.gain / 2)) * waveH
  const narrow = w < 28

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const tool = S().ui.tool
    if (tool === 'cut') {
      const rect = ref.current!.getBoundingClientRect()
      let t = clip.start + (e.clientX - rect.left) / zoom
      if (!e.shiftKey) t = snapTime(t)
      const id = splitClipAtTime(clip.id, t)
      if (id) S().select({ clipIds: [id], trackIds: [clip.trackId], range: null })
      return
    }
    startClipMove(e, clip)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (S().ui.tool !== 'cut' || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    let t = clip.start + (e.clientX - rect.left) / zoom
    if (!e.shiftKey) t = snapTime(t)
    ref.current.style.setProperty('--razor-x', `${(t - clip.start) * zoom}px`)
  }

  return (
    <div
      ref={ref}
      className={`tl-clip${selected ? ' is-sel' : ''}${isNew ? ' tl-pop' : ''}${narrow ? ' is-narrow' : ''}${clip.gain === 0 ? ' is-silent' : ''}`}
      style={{ left, width: w, height, ['--c' as string]: color }}
      data-clip-id={clip.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onDoubleClick={(e) => {
        if (S().ui.tool !== 'select') return
        e.stopPropagation()
        useTL.getState().set({ renaming: clip.id })
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const s = S()
        if (!s.selection.clipIds.includes(clip.id)) s.select({ clipIds: [clip.id], trackIds: [clip.trackId], range: null })
        const rect = ref.current!.getBoundingClientRect()
        useTL.getState().set({ menu: { x: e.clientX, y: e.clientY, clipId: clip.id, time: clip.start + (e.clientX - rect.left) / zoom } })
      }}
    >
      <div className="tl-clip-bg" />
      <div className="tl-clip-head">
        {renaming ? (
          <RenameInput clip={clip} />
        ) : (
          <span className="tl-clip-name">{clip.name}</span>
        )}
        {clip.rate !== 1 && <span className="tl-clip-tag">{clip.rate.toFixed(2)}×</span>}
        {clip.gain !== 1 && <span className="tl-clip-tag">{fmtDb(clip.gain)}</span>}
      </div>
      <div className="tl-clip-wave" style={{ top: HEAD_H, height: waveH }}>
        {entry
          ? tiles.map((k) => (
              <WaveTile
                key={k}
                entry={entry}
                x={k * TILE}
                width={Math.min(TILE, w - k * TILE)}
                height={waveH}
                zoom={zoom}
                offset={clip.offset}
                rate={clip.rate || 1}
                gain={clip.gain}
                color={color}
              />
            ))
          : <div className="tl-clip-loading" />}
        {fiPx > 1 && (
          <svg className="tl-fade" width={fiPx} height={waveH} style={{ left: 0 }}>
            <path d={`M0,0 L${fiPx},0 L0,${waveH / 2} Z M0,${waveH} L${fiPx},${waveH} L0,${waveH / 2} Z`} className="tl-fade-shade" />
            <path d={`M${fiPx},0 L0,${waveH / 2} L${fiPx},${waveH}`} className="tl-fade-line" />
          </svg>
        )}
        {foPx > 1 && (
          <svg className="tl-fade" width={foPx} height={waveH} style={{ right: 0 }}>
            <path d={`M${foPx},0 L0,0 L${foPx},${waveH / 2} Z M${foPx},${waveH} L0,${waveH} L${foPx},${waveH / 2} Z`} className="tl-fade-shade" />
            <path d={`M0,0 L${foPx},${waveH / 2} L0,${waveH}`} className="tl-fade-line" />
          </svg>
        )}
      </div>

      {!narrow && (
        <>
          <div
            className="tl-gain-line"
            style={{ top: gainY }}
            title={`Clip volume ${fmtDb(clip.gain)} – drag up/down`}
            onPointerDown={(e) => e.button === 0 && startGain(e, clip)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              S().mutate('Clip volume', (p) => {
                const c = p.clips.find((x) => x.id === clip.id)
                if (c) c.gain = 1
              })
            }}
          >
            <span className="tl-gain-label mono">{fmtDb(clip.gain)}</span>
          </div>
          <div
            className="tl-fade-h tl-fade-in"
            style={{ left: fiPx }}
            title="Drag to fade in"
            onPointerDown={(e) => e.button === 0 && startFade(e, clip, 'in', ref.current!)}
          />
          <div
            className="tl-fade-h tl-fade-out"
            style={{ right: foPx }}
            title="Drag to fade out"
            onPointerDown={(e) => e.button === 0 && startFade(e, clip, 'out', ref.current!)}
          />
        </>
      )}
      <div className="tl-trim tl-trim-l" onPointerDown={(e) => e.button === 0 && startTrim(e, clip, 'l')} />
      <div className="tl-trim tl-trim-r" onPointerDown={(e) => e.button === 0 && startTrim(e, clip, 'r')} />
    </div>
  )
})

function RenameInput({ clip }: { clip: Clip }) {
  const [v, setV] = useState(clip.name)
  const done = (commit: boolean) => {
    if (commit && v.trim() && v !== clip.name) {
      useStore.getState().mutate('Rename clip', (p) => {
        const c = p.clips.find((x) => x.id === clip.id)
        if (c) c.name = v.trim()
      })
    }
    useTL.getState().set({ renaming: null })
  }
  return (
    <input
      className="tl-clip-rename"
      autoFocus
      value={v}
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true)
        else if (e.key === 'Escape') done(false)
        e.stopPropagation()
      }}
    />
  )
}
