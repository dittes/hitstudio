// Bloom UI kit – shared, animated primitives. Import from 'src/ui/kit'.
// Every control has tactile micro-feedback (press scale, hover lift, value pop).
import { AnimatePresence, motion } from 'motion/react'
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { prettyShortcut } from '../core/commands'
import './kit.css'

// ── Button ──────────────────────────────────────────────────
type BtnVariant = 'primary' | 'ghost' | 'soft' | 'danger' | 'outline'
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> {
  variant?: BtnVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: React.ReactNode
  active?: boolean
}
export function Button({ variant = 'soft', size = 'md', icon, active, className = '', children, ...rest }: ButtonProps) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={`bk-btn bk-btn-${variant} bk-${size} ${active ? 'is-active' : ''} ${className}`}
      {...rest}
    >
      {icon && <span className="bk-btn-icon">{icon}</span>}
      {children && <span>{children}</span>}
    </motion.button>
  )
}

export function IconButton({
  label,
  shortcut,
  size = 'md',
  variant = 'ghost',
  ...rest
}: ButtonProps & { label: string; shortcut?: string }) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <Button aria-label={label} variant={variant} size={size} className="bk-icon-btn" {...rest} />
    </Tooltip>
  )
}

// ── Tooltip ─────────────────────────────────────────────────
export function Tooltip({
  label,
  shortcut,
  children,
  side = 'bottom',
}: {
  label: React.ReactNode
  shortcut?: string
  children: React.ReactElement
  side?: 'top' | 'bottom' | 'right' | 'left'
}) {
  const [open, setOpen] = useState(false)
  const t = useRef<number>(0)
  return (
    <span
      className="bk-tip-wrap"
      onPointerEnter={() => {
        t.current = window.setTimeout(() => setOpen(true), 380)
      }}
      onPointerLeave={() => {
        clearTimeout(t.current)
        setOpen(false)
      }}
      onPointerDown={() => {
        clearTimeout(t.current)
        setOpen(false)
      }}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            className={`bk-tip bk-tip-${side}`}
            initial={{ opacity: 0, scale: 0.92, y: side === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.14 }}
          >
            {label}
            {shortcut && <kbd>{prettyShortcut(shortcut)}</kbd>}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

// ── drag helper (pointer capture, shift = fine) ─────────────
export function useDrag(onMove: (dx: number, dy: number, e: PointerEvent) => void, onEnd?: () => void) {
  return useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      let lx = e.clientX,
        ly = e.clientY
      const move = (ev: PointerEvent) => {
        const f = ev.shiftKey ? 0.2 : 1
        onMove((ev.clientX - lx) * f, (ev.clientY - ly) * f, ev)
        lx = ev.clientX
        ly = ev.clientY
      }
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        onEnd?.()
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    },
    [onMove, onEnd],
  )
}

const toNorm = (v: number, min: number, max: number, curve: 'lin' | 'log' = 'lin') =>
  curve === 'log' ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min)
const fromNorm = (n: number, min: number, max: number, curve: 'lin' | 'log' = 'lin') =>
  curve === 'log' ? min * Math.pow(max / min, n) : min + n * (max - min)

function fmtVal(v: number, unit?: string, step = 0.01) {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  if (unit === 'Hz' && v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return `${v.toFixed(dec)}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`
}

// ── Knob ────────────────────────────────────────────────────
export interface KnobProps {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  onCommit?: () => void
  label?: string
  unit?: string
  step?: number
  curve?: 'lin' | 'log'
  defaultValue?: number
  size?: number
  color?: string
  /** bipolar knobs fill from the centre (e.g. pan, EQ gain) */
  bipolar?: boolean
  hint?: string
}
export function Knob({
  value,
  min,
  max,
  onChange,
  onCommit,
  label,
  unit,
  step = 0.01,
  curve = 'lin',
  defaultValue,
  size = 44,
  color = 'var(--accent)',
  bipolar,
  hint,
}: KnobProps) {
  const [drag, setDrag] = useState(false)
  const norm = Math.min(1, Math.max(0, toNorm(value, min, max, curve)))
  const valRef = useRef(norm)
  valRef.current = norm
  const onDown = useDrag(
    (_dx, dy) => {
      const n = Math.min(1, Math.max(0, valRef.current - dy / 180))
      let v = fromNorm(n, min, max, curve)
      v = Math.round(v / step) * step
      valRef.current = n
      onChange(v)
    },
    () => {
      setDrag(false)
      onCommit?.()
    },
  )
  const r = size / 2 - 4
  const a0 = -135,
    a1 = 135
  const ang = a0 + norm * (a1 - a0)
  const arc = (from: number, to: number) => {
    const p = (a: number) => {
      const rad = ((a - 90) * Math.PI) / 180
      return [size / 2 + r * Math.cos(rad), size / 2 + r * Math.sin(rad)]
    }
    const [x0, y0] = p(from),
      [x1, y1] = p(to)
    const large = Math.abs(to - from) > 180 ? 1 : 0
    const sweep = to > from ? 1 : 0
    return `M${x0},${y0} A${r},${r} 0 ${large} ${sweep} ${x1},${y1}`
  }
  const zeroAng = bipolar ? 0 : a0
  return (
    <div className={`bk-knob ${drag ? 'is-drag' : ''}`} title={hint}>
      <motion.svg
        width={size}
        height={size}
        onPointerDown={(e) => {
          setDrag(true)
          onDown(e)
        }}
        onDoubleClick={() => {
          if (defaultValue !== undefined) {
            onChange(defaultValue)
            onCommit?.()
          }
        }}
        onWheel={(e) => {
          const n = Math.min(1, Math.max(0, norm - Math.sign(e.deltaY) * 0.02))
          onChange(Math.round(fromNorm(n, min, max, curve) / step) * step)
        }}
        whileHover={{ scale: 1.06 }}
        animate={{ scale: drag ? 1.1 : 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        style={{ cursor: 'ns-resize', touchAction: 'none' }}
      >
        <path d={arc(a0, a1)} stroke="var(--surface-3)" strokeWidth={3.5} fill="none" strokeLinecap="round" />
        {Math.abs(ang - zeroAng) > 0.5 && (
          <path
            d={ang > zeroAng ? arc(zeroAng, ang) : arc(ang, zeroAng)}
            stroke={color}
            strokeWidth={3.5}
            fill="none"
            strokeLinecap="round"
            style={{ filter: drag ? `drop-shadow(0 0 4px ${color})` : undefined }}
          />
        )}
        <circle cx={size / 2} cy={size / 2} r={r - 6} fill="var(--surface-2)" stroke="var(--border-strong)" />
        <line
          x1={size / 2}
          y1={size / 2}
          x2={size / 2}
          y2={size / 2 - (r - 9)}
          stroke="var(--text)"
          strokeWidth={2}
          strokeLinecap="round"
          transform={`rotate(${ang} ${size / 2} ${size / 2})`}
        />
      </motion.svg>
      {label && (
        <div className="bk-knob-label">
          <AnimatePresence mode="wait" initial={false}>
            {drag ? (
              <motion.span key="v" className="mono" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.1 }}>
                {fmtVal(value, unit, step)}
              </motion.span>
            ) : (
              <motion.span key="l" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.1 }}>
                {label}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ── Slider (horizontal or vertical fader) ───────────────────
export interface SliderProps {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  onCommit?: () => void
  step?: number
  vertical?: boolean
  length?: number
  defaultValue?: number
  color?: string
  label?: string
  unit?: string
  curve?: 'lin' | 'log'
  showValue?: boolean
  format?: (v: number) => string
}
export function Slider({
  value,
  min,
  max,
  onChange,
  onCommit,
  step = 0.01,
  vertical,
  length = 140,
  defaultValue,
  color = 'var(--accent)',
  label,
  unit,
  curve = 'lin',
  showValue,
  format,
}: SliderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)
  const norm = Math.min(1, Math.max(0, toNorm(value, min, max, curve)))
  const setFromEvent = (cx: number, cy: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let n = vertical ? 1 - (cy - r.top) / r.height : (cx - r.left) / r.width
    n = Math.min(1, Math.max(0, n))
    onChange(Math.round(fromNorm(n, min, max, curve) / step) * step)
  }
  return (
    <div className={`bk-slider ${vertical ? 'is-v' : 'is-h'} ${drag ? 'is-drag' : ''}`}>
      {label && <div className="bk-slider-label">{label}</div>}
      <div
        ref={ref}
        className="bk-slider-track"
        style={vertical ? { height: length } : { width: length }}
        onPointerDown={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          setDrag(true)
          setFromEvent(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => drag && setFromEvent(e.clientX, e.clientY)}
        onPointerUp={() => {
          setDrag(false)
          onCommit?.()
        }}
        onDoubleClick={() => {
          if (defaultValue !== undefined) {
            onChange(defaultValue)
            onCommit?.()
          }
        }}
      >
        <div
          className="bk-slider-fill"
          style={vertical ? { height: `${norm * 100}%`, background: color } : { width: `${norm * 100}%`, background: color }}
        />
        <motion.div
          className="bk-slider-thumb"
          style={vertical ? { bottom: `calc(${norm * 100}% - 8px)` } : { left: `calc(${norm * 100}% - 8px)` }}
          animate={{ scale: drag ? 1.25 : 1 }}
          whileHover={{ scale: 1.15 }}
          transition={{ type: 'spring', stiffness: 600, damping: 25 }}
        />
      </div>
      {showValue && <div className="bk-slider-val mono">{format ? format(value) : fmtVal(value, unit, step)}</div>}
    </div>
  )
}

// ── Toggle ──────────────────────────────────────────────────
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  const id = useId()
  return (
    <label className="bk-toggle" htmlFor={id}>
      <button id={id} role="switch" aria-checked={on} className={`bk-toggle-track ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
        <motion.span className="bk-toggle-dot" layout transition={{ type: 'spring', stiffness: 700, damping: 30 }} />
      </button>
      {label && <span>{label}</span>}
    </label>
  )
}

// ── Segmented control ───────────────────────────────────────
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T
  options: { value: T; label: React.ReactNode; title?: string }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  const id = useId()
  return (
    <div className={`bk-seg bk-seg-${size}`}>
      {options.map((o) => (
        <button key={o.value} title={o.title} className={`bk-seg-opt ${o.value === value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={`seg-${id}`} className="bk-seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
          <span className="bk-seg-text">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

// ── Modal ───────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 520,
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  width?: number
  footer?: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="bk-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={onClose}>
          <motion.div
            className="bk-modal"
            style={{ width }}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="bk-modal-head">
                <h2>{title}</h2>
                <button className="bk-modal-x" onClick={onClose} aria-label="Close">
                  ×
                </button>
              </div>
            )}
            <div className="bk-modal-body">{children}</div>
            {footer && <div className="bk-modal-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Level meter (reads an AnalyserNode every frame) ─────────
export function Meter({
  analyser,
  vertical = true,
  length = 120,
  thickness = 6,
}: {
  analyser?: AnalyserNode | null
  vertical?: boolean
  length?: number
  thickness?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const dpr = devicePixelRatio
    const w = vertical ? thickness : length
    const h = vertical ? length : thickness
    c.width = w * dpr
    c.height = h * dpr
    ctx.scale(dpr, dpr)
    const buf = new Float32Array(analyser?.fftSize ?? 1024)
    let peak = 0,
      hold = 0,
      holdT = 0,
      raf = 0
    const draw = () => {
      let rms = 0
      if (analyser) {
        analyser.getFloatTimeDomainData(buf)
        let s = 0,
          pk = 0
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i])
          s += v * v
          if (v > pk) pk = v
        }
        rms = Math.sqrt(s / buf.length)
        peak = Math.max(pk, peak * 0.92)
      } else peak *= 0.9
      const toN = (g: number) => Math.max(0, Math.min(1, (20 * Math.log10(g + 1e-9) + 60) / 60))
      const n = toN(peak)
      if (n >= hold) {
        hold = n
        holdT = performance.now()
      } else if (performance.now() - holdT > 800) hold = Math.max(n, hold - 0.01)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = getComputedStyle(c).getPropertyValue('--surface-3') || '#333'
      ctx.beginPath()
      ctx.roundRect(0, 0, w, h, thickness / 2)
      ctx.fill()
      const grad = vertical ? ctx.createLinearGradient(0, h, 0, 0) : ctx.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0, '#4ade80')
      grad.addColorStop(0.7, '#a3e635')
      grad.addColorStop(0.86, '#facc15')
      grad.addColorStop(1, '#f87171')
      ctx.fillStyle = grad
      ctx.beginPath()
      if (vertical) ctx.roundRect(0, h - n * h, w, n * h, thickness / 2)
      else ctx.roundRect(0, 0, n * w, h, thickness / 2)
      ctx.fill()
      ctx.globalAlpha = 0.35
      const rn = toN(rms)
      ctx.fillStyle = '#fff'
      if (vertical) ctx.fillRect(0, h - rn * h, w, 1.5)
      else ctx.fillRect(rn * w, 0, 1.5, h)
      ctx.globalAlpha = 1
      ctx.fillStyle = hold > 0.95 ? '#f87171' : '#fff'
      if (vertical) ctx.fillRect(0, h - hold * h, w, 2)
      else ctx.fillRect(hold * w - 2, 0, 2, h)
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [analyser, vertical, length, thickness])
  return <canvas ref={ref} className="bk-meter" style={vertical ? { width: thickness, height: length } : { width: length, height: thickness }} />
}

// ── Card / Panel ────────────────────────────────────────────
export function Card({ children, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bk-card ${className}`} {...rest}>
      {children}
    </div>
  )
}

/** Small friendly hint bubble for beginners (hidden when hints are off). */
export function Hint({ children }: { children: React.ReactNode }) {
  return (
    <motion.div className="bk-hint" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
      <span className="bk-hint-dot" />
      {children}
    </motion.div>
  )
}

export function Kbd({ k }: { k: string }) {
  return <kbd className="bk-kbd">{prettyShortcut(k)}</kbd>
}

/** Animated number that rolls when it changes */
export function RollingNumber({ value, className = '' }: { value: string; className?: string }) {
  return (
    <span className={`bk-roll ${className}`}>
      {value.split('').map((ch, i) => (
        <AnimatePresence key={i} mode="popLayout" initial={false}>
          <motion.span
            key={ch + i}
            initial={{ y: '60%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-60%', opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ display: 'inline-block' }}
          >
            {ch}
          </motion.span>
        </AnimatePresence>
      ))}
    </span>
  )
}

/** Particle burst for celebratory moments (export done, first recording…). */
export function burst(x: number, y: number, colors = ['#a78bfa', '#f472b6', '#fb923c', '#38bdf8', '#4ade80']) {
  const n = 22
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span')
    el.className = 'bk-confetti'
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.background = colors[i % colors.length]
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4
    const d = 60 + Math.random() * 70
    el.animate(
      [
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 30}px)) scale(.4) rotate(${Math.random() * 360}deg)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.22,1,.36,1)' },
    ).onfinish = () => el.remove()
    document.body.appendChild(el)
  }
}
