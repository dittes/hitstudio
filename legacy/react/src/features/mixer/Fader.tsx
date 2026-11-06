import { motion } from 'motion/react'
import { useRef, useState } from 'react'
import { FADER_TICKS, dbToPos, fmtDb, gainToPos, posToGain } from './faderLaw'

interface Props {
  value: number // linear gain 0..2
  onChange: (g: number) => void
  onCommit?: () => void
  height?: number
  color?: string
  label?: string
}

const CAP_H = 26

export function Fader({ value, onChange, onCommit, height = 220, color = 'var(--accent)', label = 'Volume' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)
  const pos = gainToPos(value)

  const fromY = (cy: number, fine: boolean) => {
    const r = ref.current!.getBoundingClientRect()
    let n = 1 - (cy - r.top) / r.height
    n = Math.min(1, Math.max(0, n))
    let g = posToGain(n)
    if (!fine && Math.abs(g - 1) < 0.045) g = 1 // magnetic 0 dB
    if (n < 0.012) g = 0
    onChange(g)
  }

  return (
    <div
      className={`mx-fader ${drag ? 'is-drag' : ''}`}
      style={{ height }}
      role="slider"
      aria-label={label}
      aria-valuetext={`${fmtDb(value)} dB`}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.01 : 0.03
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(posToGain(Math.min(1, Math.max(0, pos + (e.key === 'ArrowUp' ? step : -step)))))
          onCommit?.()
        }
      }}
    >
      <div className="mx-fader-scale">
        {FADER_TICKS.map((t) => (
          <span key={t.label} className={`mx-tick ${t.db === 0 ? 'is-zero' : ''}`} style={{ bottom: `${dbToPos(t.db) * 100}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <div
        ref={ref}
        className="mx-fader-groove"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          setDrag(true)
          fromY(e.clientY, e.shiftKey)
        }}
        onPointerMove={(e) => drag && fromY(e.clientY, e.shiftKey)}
        onPointerUp={() => {
          setDrag(false)
          onCommit?.()
        }}
        onPointerCancel={() => {
          setDrag(false)
          onCommit?.()
        }}
        onDoubleClick={() => {
          onChange(1)
          onCommit?.()
        }}
        onWheel={(e) => {
          const n = Math.min(1, Math.max(0, pos - Math.sign(e.deltaY) * 0.015))
          onChange(posToGain(n))
        }}
        title="Drag to change volume. Double-click = 0 dB (original level). Hold Shift for fine control."
      >
        {FADER_TICKS.map((t) => (
          <i key={t.label} className={`mx-groove-tick ${t.db === 0 ? 'is-zero' : ''}`} style={{ bottom: `${dbToPos(t.db) * 100}%` }} />
        ))}
        <div className="mx-fader-fill" style={{ height: `${pos * 100}%`, background: color }} />
        <motion.div
          className="mx-fader-cap"
          style={{ bottom: `calc(${pos * 100}% - ${CAP_H / 2}px)`, height: CAP_H, ['--cap' as string]: color }}
          animate={{ scale: drag ? 1.08 : 1 }}
          whileHover={{ scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 600, damping: 26 }}
        >
          <span className="mx-cap-line" />
        </motion.div>
      </div>
    </div>
  )
}
