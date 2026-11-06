import { AudioWaveform, GripVertical, Mic, Piano } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import { memo } from 'react'
import { mutate } from '../../core/store'
import type { Track } from '../../core/types'
import { Knob, Meter } from '../../ui/kit'
import { Fader } from './Fader'
import { PeakReadout, useAnalyser } from './analysers'
import { DbField, Rack, ToggleBtn } from './parts'

interface Props {
  track: Track
  index: number
  selected: boolean
  dimmed: boolean
  onSelect: () => void
  onOpenFx: () => void
  onDragStart: () => void
}

export const ChannelStrip = memo(function ChannelStrip({ track: t, index, selected, dimmed, onSelect, onOpenFx, onDragStart }: Props) {
  const controls = useDragControls()
  const analyser = useAnalyser(t.id)
  const id = t.id
  const setVol = (g: number) => mutate('Change volume', (p) => void (p.tracks.find((x) => x.id === id)!.volume = g), { coalesce: `mx-vol-${id}` })
  const setPan = (v: number) => mutate('Change pan', (p) => void (p.tracks.find((x) => x.id === id)!.pan = v), { coalesce: `mx-pan-${id}` })
  const flag = (k: 'mute' | 'solo' | 'armed') => mutate(k === 'mute' ? 'Mute' : k === 'solo' ? 'Solo' : 'Arm track', (p) => {
    const tr = p.tracks.find((x) => x.id === id)!
    tr[k] = !tr[k]
  })
  const Icon = t.kind === 'instrument' ? Piano : AudioWaveform

  return (
    <Reorder.Item
      as="div"
      value={id}
      dragListener={false}
      dragControls={controls}
      className={`mx-strip ${selected ? 'is-selected' : ''} ${dimmed ? 'is-dim' : ''} ${t.mute ? 'is-muted' : ''}`}
      style={{ ['--tc' as string]: t.color }}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30, delay: Math.min(index, 12) * 0.045 }}
      whileDrag={{ scale: 1.03, zIndex: 20, boxShadow: 'var(--shadow)' }}
    >
      <div className="mx-strip-head" onPointerDown={onSelect}>
        <div
          className="mx-grip"
          title="Drag to reorder"
          onPointerDown={(e) => {
            onDragStart()
            controls.start(e)
          }}
        >
          <GripVertical size={14} />
        </div>
        <Icon size={14} className="mx-strip-icon" />
        <input
          className="mx-name"
          value={t.name}
          spellCheck={false}
          aria-label="Track name"
          onChange={(e) => mutate('Rename track', (p) => void (p.tracks.find((x) => x.id === id)!.name = e.target.value), { coalesce: `mx-name-${id}` })}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>

      <div className="mx-fx" onClick={onOpenFx} title="Click to open the effects">
        <Rack target={id} compact />
      </div>

      <div className="mx-pan">
        <Knob value={t.pan} min={-1} max={1} step={0.01} bipolar defaultValue={0} size={42} color={t.color} label={panLabel(t.pan)} hint="Pan: where the sound sits left/right. Double-click to center." onChange={setPan} />
      </div>

      <div className="mx-fader-row">
        <Fader value={t.volume} onChange={setVol} color={t.color} label={`${t.name} volume`} />
        <Meter analyser={analyser} length={220} thickness={9} />
      </div>

      <div className="mx-readouts">
        <DbField gain={t.volume} onSet={setVol} />
        <PeakReadout analyser={analyser} />
      </div>

      <div className="mx-btns">
        <ToggleBtn kind="mute" on={t.mute} onClick={() => flag('mute')} title="Mute: silence this track">M</ToggleBtn>
        <ToggleBtn kind="solo" on={t.solo} onClick={() => flag('solo')} title="Solo: hear only this track">S</ToggleBtn>
        <ToggleBtn kind="arm" on={t.armed} onClick={() => flag('armed')} title="Arm: get ready to record on this track">
          <Mic size={12} />
        </ToggleBtn>
      </div>
    </Reorder.Item>
  )
})

function panLabel(p: number) {
  if (Math.abs(p) < 0.01) return 'Center'
  return `${p < 0 ? 'L' : 'R'} ${Math.round(Math.abs(p) * 100)}`
}
