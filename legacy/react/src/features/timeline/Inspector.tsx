// Right side panel: selected clip properties + the selected track's effect rack.
import { PanelRightClose } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { dbToGain, formatTime, gainToDb } from '../../core/ids'
import { useStore } from '../../core/store'
import type { Clip } from '../../core/types'
import { IconButton, Knob, Slider } from '../../ui/kit'
import { EffectRack } from '../effects'
import { clipLen, S } from './state'

function patchClip(id: string, label: string, fn: (c: Clip) => void, coalesce?: string) {
  S().mutate(
    label,
    (p) => {
      const c = p.clips.find((x) => x.id === id)
      if (c) fn(c as Clip)
    },
    coalesce ? { coalesce } : undefined,
  )
}

export function Inspector() {
  const clip = useStore((s) => {
    const id = s.selection.clipIds[0]
    return id ? s.project.clips.find((c) => c.id === id) : undefined
  })
  const nSel = useStore((s) => s.selection.clipIds.length)
  const track = useStore((s) => {
    const id = s.selection.trackIds[0] ?? clip?.trackId ?? s.project.tracks[0]?.id
    return s.project.tracks.find((t) => t.id === id)
  })

  return (
    <motion.aside
      className="tl-inspector"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 300, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 40 }}
    >
      <div className="tl-insp-inner">
        <div className="tl-insp-head">
          <span className="tl-insp-title">Inspector</span>
          <IconButton size="sm" label="Close panel" icon={<PanelRightClose />} onClick={() => S().setUI({ panel: null })} />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {clip ? (
            <motion.section
              key={clip.id}
              className="tl-insp-sec"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              <ClipInspector clip={clip} />
              {nSel > 1 && <div className="faint tl-insp-note">{nSel} clips selected – showing the first one</div>}
            </motion.section>
          ) : (
            <motion.section key="none" className="tl-insp-sec tl-insp-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="tl-insp-empty-icon">♪</div>
              Select a clip to change its volume, speed and fades.
            </motion.section>
          )}
        </AnimatePresence>
        {track && (
          <section className="tl-insp-sec">
            <div className="tl-insp-label">
              <span className="tl-insp-dot" style={{ background: track.color }} />
              Effects on <b>{track.name}</b>
            </div>
            <EffectRack target={track.id} />
          </section>
        )}
      </div>
    </motion.aside>
  )
}

function ClipInspector({ clip }: { clip: Clip }) {
  const [name, setName] = useState<string | null>(null)
  const L = clipLen(clip)
  const db = clip.gain > 0 ? gainToDb(clip.gain) : -40
  const id = clip.id
  return (
    <>
      <input
        className="tl-insp-name"
        value={name ?? clip.name}
        spellCheck={false}
        onFocus={() => setName(clip.name)}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name !== null && name.trim() && name !== clip.name) patchClip(id, 'Rename clip', (c) => void (c.name = name.trim()))
          setName(null)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <div className="tl-insp-meta mono faint">
        {formatTime(clip.start)} → {formatTime(clip.start + L)} · {L.toFixed(2)} s
      </div>
      <div className="tl-insp-grid">
        <div className="tl-insp-knob">
          <Knob
            value={db}
            min={-40}
            max={12}
            step={0.1}
            unit="dB"
            label="Volume"
            defaultValue={0}
            size={52}
            onChange={(v) => patchClip(id, 'Clip volume', (c) => void (c.gain = v <= -40 ? 0 : dbToGain(v)), `cgain-${id}`)}
          />
        </div>
        <div className="tl-insp-sliders">
          <label className="tl-insp-row">
            <span>Speed (tape)</span>
            <Slider
              value={clip.rate}
              min={0.5}
              max={2}
              step={0.01}
              defaultValue={1}
              length={130}
              showValue
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) =>
                patchClip(
                  id,
                  'Clip speed',
                  (c) => {
                    c.rate = v
                    const len = c.duration / v
                    c.fadeIn = Math.min(c.fadeIn, len)
                    c.fadeOut = Math.min(c.fadeOut, len - c.fadeIn)
                  },
                  `crate-${id}`,
                )
              }
            />
          </label>
          <div className="tl-insp-hint faint">Faster also means higher pitch – like a tape machine.</div>
        </div>
      </div>
      <label className="tl-insp-row">
        <span>Fade in</span>
        <Slider
          value={clip.fadeIn}
          min={0}
          max={Math.max(0.01, Math.min(10, L))}
          step={0.01}
          defaultValue={0}
          length={150}
          showValue
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(v) => patchClip(id, 'Fade in', (c) => void (c.fadeIn = Math.min(v, L - c.fadeOut)), `cfi-${id}`)}
        />
      </label>
      <label className="tl-insp-row">
        <span>Fade out</span>
        <Slider
          value={clip.fadeOut}
          min={0}
          max={Math.max(0.01, Math.min(10, L))}
          step={0.01}
          defaultValue={0}
          length={150}
          showValue
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(v) => patchClip(id, 'Fade out', (c) => void (c.fadeOut = Math.min(v, L - c.fadeIn)), `cfo-${id}`)}
        />
      </label>
    </>
  )
}
