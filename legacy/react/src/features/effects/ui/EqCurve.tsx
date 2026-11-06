// Interactive frequency-response curve for the Parametric EQ and the Filter.
// The response is computed with BiquadFilterNode.getFrequencyResponse() on a scratch
// OfflineAudioContext (never rendered), so it matches the real audio exactly.
// A live spectrum of the track (or master) is drawn underneath.
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getEngine } from '../../../core/engine'
import { PEQ_BANDS, applyPeq, filterSettings } from '../defs/tone'
import { useWidth } from './useWidth'

let scratch: OfflineAudioContext | null = null
const ctx = () => (scratch ??= new OfflineAudioContext(1, 128, 48000))

const FMIN = 20, FMAX = 20000
const N = 220
const FREQS = (() => {
  const f = new Float32Array(N)
  for (let i = 0; i < N; i++) f[i] = FMIN * Math.pow(FMAX / FMIN, i / (N - 1))
  return f
})()

function response(filters: BiquadFilterNode[], extraDb = 0): Float32Array {
  const total = new Float32Array(N).fill(1)
  const mag = new Float32Array(N), ph = new Float32Array(N)
  for (const f of filters) {
    f.getFrequencyResponse(FREQS, mag, ph)
    for (let i = 0; i < N; i++) total[i] *= mag[i]
  }
  const out = new Float32Array(N)
  const g = Math.pow(10, extraDb / 20)
  for (let i = 0; i < N; i++) out[i] = 20 * Math.log10(Math.max(1e-6, total[i] * g))
  return out
}

/** dB response of a single PEQ band (for the coloured band shapes). */
function bandResponse(i: number, p: Record<string, number>) {
  const fl = PEQ_BANDS.map(() => ctx().createBiquadFilter())
  applyPeq(fl, p)
  return response([fl[i]])
}

export interface EqCurveProps {
  type: 'peq' | 'filter'
  params: Record<string, number>
  onChange: (patch: Record<string, number>) => void
  onCommit?: () => void
  target: string
  selected?: number
  onSelect?: (i: number) => void
  height?: number
}

export function EqCurve({ type, params, onChange, onCommit, target, selected = -1, onSelect, height = 150 }: EqCurveProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const W = useWidth(wrap, 300)
  const H = height
  const range = type === 'peq' ? 20 : 30
  const x = (f: number) => (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * W
  const fx = (px: number) => FMIN * Math.pow(FMAX / FMIN, Math.min(1, Math.max(0, px / W)))
  const y = (dbv: number) => H / 2 - (dbv / range) * (H / 2 - 8)
  const yd = (py: number) => ((H / 2 - py) / (H / 2 - 8)) * range

  const curve = useMemo(() => {
    if (type === 'peq') {
      const fl = PEQ_BANDS.map(() => ctx().createBiquadFilter())
      applyPeq(fl, params)
      return response(fl, params.out ?? 0)
    }
    const s = filterSettings(params, 48000)
    const a = ctx().createBiquadFilter(), b = ctx().createBiquadFilter()
    for (const f of [a, b]) {
      f.type = s.type
      f.frequency.value = Math.min(23900, s.freq)
      f.Q.value = s.type === 'bandpass' ? s.q : s.q - ((params.steep ?? 1) >= 0.5 ? 3 : 0)
    }
    return response((params.steep ?? 1) >= 0.5 ? [a, b] : [a])
  }, [type, params])

  const bands = useMemo(() => (type === 'peq' ? PEQ_BANDS.map((_, i) => bandResponse(i, params)) : []), [type, params])

  const path = (arr: Float32Array) => {
    let d = ''
    for (let i = 0; i < N; i++) d += `${i ? 'L' : 'M'}${((i / (N - 1)) * W).toFixed(1)},${Math.max(-2, Math.min(H + 2, y(arr[i]))).toFixed(1)}`
    return d
  }
  const linePath = path(curve)
  const areaPath = `${linePath}L${W},${y(0)}L0,${y(0)}Z`

  // handles
  const handles =
    type === 'peq'
      ? PEQ_BANDS.map((b, i) => ({ f: params[`f${i + 1}`] ?? b.f, g: params[`g${i + 1}`] ?? 0, color: b.color, label: b.label }))
      : (() => {
          const s = filterSettings(params, 48000)
          const reso = params.reso ?? 25
          const f = (params.mode ?? 0) === 0 && Math.abs(params.sweep ?? 0) < 2 ? 20000 : Math.min(20000, s.freq)
          return [{ f, g: (reso / 100) * 24 - 3, color: 'var(--accent)', label: 'Cutoff' }]
        })()

  const drag = useRef<{ i: number } | null>(null)
  const [dragging, setDragging] = useState(-1)
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const r = wrap.current!.getBoundingClientRect()
    const px = e.clientX - r.left, py = e.clientY - r.top
    const i = drag.current.i
    const f = Math.round(fx(px))
    const g = Math.round(Math.max(-18, Math.min(18, yd(py))) * 10) / 10
    if (type === 'peq') onChange({ [`f${i + 1}`]: f, [`g${i + 1}`]: g })
    else {
      const reso = Math.round(Math.max(0, Math.min(100, ((yd(py) + 3) / 24) * 100)))
      if ((params.mode ?? 0) === 0) {
        // map frequency back to the sweep knob: left half = low-pass, right half = high-pass
        const lpS = -Math.log(f / 20000) / Math.log(20000 / 60)
        const hpS = Math.log(f / 20) / Math.log(9000 / 20)
        const sweep = params.sweep ?? 0
        const s = sweep > 0 ? hpS : -lpS
        onChange({ sweep: Math.round(Math.max(-100, Math.min(100, s * 100))), reso })
      } else onChange({ cutoff: f, reso })
    }
  }

  // live spectrum underlay
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const eng = getEngine()
    const g = c.getContext('2d')!
    const dpr = devicePixelRatio
    c.width = W * dpr
    c.height = H * dpr
    let raf = 0
    let data: Float32Array<ArrayBuffer> | null = null
    let smooth: Float32Array | null = null
    const color = getComputedStyle(c).getPropertyValue('--accent-3').trim() || '#38bdf8'
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const an = target === 'master' ? eng.masterAnalyser : eng.trackAnalyser(target)
      if (!an || !eng.isPlaying) {
        if (smooth) {
          g.clearRect(0, 0, c.width, c.height)
          smooth = null
        }
        return
      }
      if (!data || data.length !== an.frequencyBinCount) data = new Float32Array(an.frequencyBinCount)
      an.getFloatFrequencyData(data)
      const sr = an.context.sampleRate
      const cols = Math.max(32, Math.floor(W / 3))
      if (!smooth || smooth.length !== cols) smooth = new Float32Array(cols).fill(-100)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, H)
      g.beginPath()
      g.moveTo(0, H)
      for (let i = 0; i < cols; i++) {
        const f = FMIN * Math.pow(FMAX / FMIN, i / (cols - 1))
        const bin = Math.min(data.length - 1, Math.round((f / (sr / 2)) * data.length))
        const v = data[bin]
        smooth[i] = Math.max(v, smooth[i] - 1.5)
        const n = Math.max(0, Math.min(1, (smooth[i] + 100) / 80))
        g.lineTo((i / (cols - 1)) * W, H - n * H * 0.9)
      }
      g.lineTo(W, H)
      g.closePath()
      g.fillStyle = color
      g.globalAlpha = 0.16
      g.fill()
      g.globalAlpha = 1
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [W, H, target])

  const grid = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
  return (
    <div
      ref={wrap}
      className={`fx-eq ${dragging >= 0 ? 'is-drag' : ''}`}
      style={{ height: H }}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        if (drag.current) onCommit?.()
        drag.current = null
        setDragging(-1)
      }}
    >
      <canvas ref={canvas} className="fx-eq-spec" style={{ width: W, height: H }} />
      <svg width={W} height={H} className="fx-eq-svg">
        <defs>
          <linearGradient id={`fx-eqfill-${type}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="50%" stopColor="var(--accent)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        {grid.map((f) => (
          <g key={f}>
            <line x1={x(f)} x2={x(f)} y1={0} y2={H} className="fx-grid" />
            <text x={x(f) + 3} y={H - 4} className="fx-grid-label">{f >= 1000 ? `${f / 1000}k` : f}</text>
          </g>
        ))}
        {[-12, 0, 12].map((d) => (
          <g key={d}>
            <line x1={0} x2={W} y1={y(d)} y2={y(d)} className={d === 0 ? 'fx-grid-strong' : 'fx-grid'} />
            <text x={4} y={y(d) - 3} className="fx-grid-label">{d > 0 ? `+${d}` : d}</text>
          </g>
        ))}
        {bands.map((b, i) => (
          <path
            key={i}
            d={`${path(b)}L${W},${y(0)}L0,${y(0)}Z`}
            fill={PEQ_BANDS[i].color}
            opacity={selected === i || dragging === i ? 0.22 : 0.07}
            style={{ transition: 'opacity .2s' }}
          />
        ))}
        <path d={areaPath} fill={`url(#fx-eqfill-${type})`} />
        <path d={linePath} className="fx-eq-line" />
        {handles.map((h, i) => (
          <g key={i} transform={`translate(${x(h.f)},${y(h.g)})`}>
            <motion.circle
              r={9}
              fill={h.color}
              fillOpacity={0.25}
              stroke={h.color}
              strokeWidth={2}
              className="fx-eq-handle"
              whileHover={{ scale: 1.25 }}
              animate={{ scale: dragging === i ? 1.35 : selected === i ? 1.15 : 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                ;(wrap.current as HTMLElement).setPointerCapture(e.pointerId)
                drag.current = { i }
                setDragging(i)
                onSelect?.(i)
              }}
              onWheel={(e) => {
                if (type !== 'peq') return
                const k = `q${i + 1}`
                const q = params[k] ?? 1
                onChange({ [k]: Math.round(Math.max(0.2, Math.min(12, q * (e.deltaY > 0 ? 0.9 : 1.1))) * 100) / 100 })
              }}
            />
            <text y={4} textAnchor="middle" className="fx-eq-num">{type === 'peq' ? i + 1 : '◆'}</text>
          </g>
        ))}
      </svg>
      {dragging >= 0 && (
        <motion.div className="fx-eq-readout mono" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          {handles[dragging].label}: {handles[dragging].f >= 1000 ? `${(handles[dragging].f / 1000).toFixed(2)} kHz` : `${Math.round(handles[dragging].f)} Hz`}
          {type === 'peq' ? ` · ${handles[dragging].g > 0 ? '+' : ''}${handles[dragging].g.toFixed(1)} dB` : ''}
        </motion.div>
      )}
    </div>
  )
}
