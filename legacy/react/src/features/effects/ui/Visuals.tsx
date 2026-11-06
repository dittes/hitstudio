// Little live visuals shown on effect cards.
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { getEngine } from '../../../core/engine'
import { driveFn } from '../defs/creative'
import { lfoRate } from '../defs/modulation'
import { DIVISIONS } from '../defs/shared'
import { echoTime } from '../defs/space'
import { useStore } from '../../../core/store'
import { useWidth } from './useWidth'

// ── Compressor / limiter / gate: transfer curve + live gain-reduction meter ──
export function CompViz({ type, effectId, params, color }: { type: string; effectId: string; params: Record<string, number>; color: string }) {
  const bar = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const lamp = useRef<HTMLDivElement>(null)
  const isGate = type === 'gate'
  useEffect(() => {
    let raf = 0
    let shown = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const node = getEngine().effectNode(effectId)
      const pr = node?.probe?.() ?? {}
      if (isGate) {
        const open = getEngine().isPlaying ? pr.open ?? 0 : 0
        shown += (open - shown) * 0.3
        if (lamp.current) {
          lamp.current.style.opacity = String(0.25 + shown * 0.75)
          lamp.current.style.transform = `scale(${0.85 + shown * 0.25})`
        }
        if (label.current) label.current.textContent = shown > 0.5 ? 'Open' : 'Closed'
        if (bar.current) bar.current.style.height = `${shown * 100}%`
        return
      }
      const gr = Math.min(0, pr.reduction ?? 0) // negative dB
      shown += (gr - shown) * 0.35
      if (bar.current) bar.current.style.height = `${Math.min(100, (-shown / 24) * 100)}%`
      if (label.current) label.current.textContent = `${shown > -0.15 ? '0.0' : shown.toFixed(1)} dB`
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [effectId, isGate])

  // static transfer curve
  const S = 96
  const pathD = useMemo(() => {
    const pts: string[] = []
    for (let i = 0; i <= 48; i++) {
      const inDb = -60 + (i / 48) * 60
      let out = inDb
      if (type === 'compressor') {
        const T = params.threshold ?? -18, R = params.ratio ?? 4, K = params.knee ?? 6
        if (2 * (inDb - T) < -K) out = inDb
        else if (2 * Math.abs(inDb - T) <= K) out = inDb + ((1 / R - 1) * Math.pow(inDb - T + K / 2, 2)) / (2 * K || 1)
        else out = T + (inDb - T) / R
        out += params.makeup ?? 0
      } else if (type === 'limiter') {
        const c = params.ceiling ?? -1
        out = Math.min(c, inDb + (params.gain ?? 0))
      } else if (type === 'gate') {
        const T = params.threshold ?? -45
        out = inDb < T ? inDb - (params.range ?? 40) : inDb
      } else {
        const s = (params.smooth ?? 40) / 100
        const T = -8 - s * 22, R = 1 + s * 5
        out = (inDb > T ? T + (inDb - T) / R : inDb) + s * 8
      }
      const px = (i / 48) * S
      const py = S - ((Math.max(-60, Math.min(0, out)) + 60) / 60) * S
      pts.push(`${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`)
    }
    return pts.join('')
  }, [type, params])
  const thr = type === 'compressor' || type === 'gate' ? params.threshold ?? -18 : type === 'limiter' ? params.ceiling ?? -1 : null

  return (
    <div className="fx-comp">
      <svg width={S} height={S} className="fx-comp-svg">
        <rect width={S} height={S} rx={8} className="fx-viz-bg" />
        <line x1={0} y1={S} x2={S} y2={0} className="fx-grid" strokeDasharray="3 3" />
        {thr !== null && <line x1={((thr + 60) / 60) * S} x2={((thr + 60) / 60) * S} y1={0} y2={S} className="fx-grid-strong" strokeDasharray="2 4" />}
        <motion.path d={pathD} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" initial={false} animate={{ d: pathD }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} />
      </svg>
      <div className="fx-comp-meter">
        <div className="fx-comp-meter-track">
          <div ref={bar} className={`fx-comp-meter-fill ${isGate ? 'is-gate' : ''}`} />
        </div>
        <div className="fx-comp-meter-text">
          {isGate && <div ref={lamp} className="fx-gate-lamp" />}
          <span ref={label} className="mono">{isGate ? 'Closed' : '0.0 dB'}</span>
          <small>{isGate ? 'gate' : 'squash'}</small>
        </div>
      </div>
    </div>
  )
}

// ── Reverb: animated decay envelope + ripples ────────────────────────────
export function ReverbViz({ params, color }: { params: Record<string, number>; color: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const W = useWidth(wrap, 280)
  const H = 74
  const decay = params.decay ?? 2.2
  const pre = (params.predelay ?? 15) / 1000
  const damp = (params.damping ?? 45) / 100
  const size = (params.size ?? 55) / 100
  const style = Math.round(params.style ?? 1)
  const span = Math.max(1, decay * 1.15 + pre)
  const tx = (t: number) => (t / span) * W
  const d = useMemo(() => {
    let s = `M0,${H} L${tx(pre)},${H}`
    for (let i = 0; i <= 60; i++) {
      const t = pre + (i / 60) * decay * 1.1
      // drawn in dB so the tail reads as a gentle slope: 0 dB → -60 dB over the decay time
      const amp = Math.max(0, 1 - (t - pre) / decay) ** 1.4 * Math.min(1, (t - pre) / (0.01 + size * 0.06 + 0.001))
      s += ` L${tx(t).toFixed(1)},${(H - amp * (H - 10)).toFixed(1)}`
    }
    return s + ` L${W},${H} Z`
  }, [W, decay, pre, size])
  const taps = style === 2 ? [] : Array.from({ length: style === 1 ? 10 : 7 }, (_, j) => pre + (0.01 + size * 0.07) * Math.pow((j + 1) / 8, 1.4))
  const dur = Math.min(6, Math.max(0.8, decay))
  return (
    <div ref={wrap} className="fx-reverb" style={{ height: H }}>
      <svg width={W} height={H}>
        <defs>
          <linearGradient id="fx-rv-grad" x1="0" x2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.75} />
            <stop offset="100%" stopColor={damp > 0.5 ? 'var(--accent-2)' : 'var(--accent-3)'} stopOpacity={0.08 + (1 - damp) * 0.2} />
          </linearGradient>
        </defs>
        <motion.path d={d} fill="url(#fx-rv-grad)" initial={false} animate={{ d }} transition={{ type: 'spring', stiffness: 200, damping: 28 }} />
        {taps.map((t, i) => (
          <motion.line key={i} x1={tx(t)} x2={tx(t)} y2={H} initial={false} animate={{ y1: H - (H - 14) * (0.9 - i * 0.06), x1: tx(t), x2: tx(t) }} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.8} />
        ))}
        <line x1={tx(pre)} x2={tx(pre)} y1={4} y2={H} className="fx-grid-strong" strokeDasharray="2 3" />
        <rect className="fx-reverb-scan" x={0} y={0} width={3} height={H} fill={color} style={{ animationDuration: `${dur}s` }} />
      </svg>
      <div className="fx-reverb-ripples" style={{ ['--dur' as string]: `${dur}s` }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ animationDelay: `${(i * dur) / 3}s`, borderColor: color }} />
        ))}
      </div>
      <div className="fx-reverb-label mono">{decay.toFixed(1)} s tail</div>
    </div>
  )
}

// ── Delay: bouncing echo dots ────────────────────────────────────────────
export function DelayViz({ params, color }: { params: Record<string, number>; color: string }) {
  const bpm = useStore((s) => s.project.bpm)
  const T = echoTime(params, bpm)
  const fb = Math.min(0.95, (params.feedback ?? 40) / 100)
  const pp = (params.pingpong ?? 0) >= 0.5
  const mix = (params.mix ?? 30) / 100
  const tone = params.tone ?? 6000
  const dots: { a: number; k: number }[] = [{ a: 1, k: 0 }]
  for (let k = 1; k < 10; k++) {
    const a = Math.max(0.15, mix * 1.6) * Math.pow(fb, k - 1)
    if (a < 0.04) break
    dots.push({ a: Math.min(1, a), k })
  }
  const cycle = Math.max(0.6, Math.min(8, T * (dots.length + 1.5)))
  const blur = tone < 3000 ? (3000 - tone) / 1200 : 0
  const label = (params.sync ?? 0) >= 0.5 ? `${DIVISIONS[Math.round(params.div ?? 2)]?.label} @ ${bpm} BPM` : `${Math.round(T * 1000)} ms`
  return (
    <div className="fx-delay" style={{ ['--cycle' as string]: `${cycle}s` }}>
      {pp && <div className="fx-delay-lr"><span>L</span><span>R</span></div>}
      <div className="fx-delay-row">
        {dots.map(({ a, k }) => (
          <motion.span
            key={k}
            layout
            className={`fx-delay-dot ${k === 0 ? 'is-src' : ''}`}
            style={{
              width: 8 + a * 12,
              height: 8 + a * 12,
              background: k === 0 ? 'var(--text)' : color,
              opacity: k === 0 ? 1 : 0.25 + a * 0.75,
              filter: k ? `blur(${Math.min(2, blur * (k / 3))}px)` : undefined,
              animationDelay: `${k * T}s`,
              translate: pp && k ? `0 ${k % 2 ? -10 : 10}px` : undefined,
            }}
          />
        ))}
      </div>
      <div className="fx-delay-label mono">{label} · {dots.length - 1} echoes</div>
    </div>
  )
}

// ── LFO-based effects: a scrolling wave ──────────────────────────────────
export function LfoViz({ type, params, color }: { type: string; params: Record<string, number>; color: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const W = useWidth(wrap, 280)
  const H = 46
  const bpm = useStore((s) => s.project.bpm)
  const touch = type === 'wah' && (params.mode ?? 0) >= 0.5
  const rate = type === 'tremolo' ? lfoRate(params, bpm) : params.rate ?? 1
  const depth = Math.max(0.08, (params.depth ?? (type === 'wah' ? 80 : 60)) / 100)
  const shape = type === 'tremolo' ? Math.round(params.shape ?? 0) : 0
  const period = Math.max(24, Math.min(W, 70)) // px per cycle
  const fn = (ph: number) => {
    const p = ph - Math.floor(ph)
    if (shape === 1) return 1 - 4 * Math.abs(p - 0.5)
    if (shape === 2) return p < 0.5 ? 1 : -1
    return Math.sin(p * Math.PI * 2)
  }
  const d = useMemo(() => {
    let s = ''
    for (let px = 0; px <= W + period; px += 2) s += `${px ? 'L' : 'M'}${px},${(H / 2 - fn(px / period) * depth * (H / 2 - 5)).toFixed(1)}`
    return s
  }, [W, period, depth, shape])
  const dur = touch ? 0 : Math.max(0.05, Math.min(20, 1 / Math.max(0.01, rate)))
  const pan = type === 'tremolo' && (params.mode ?? 0) >= 0.5
  return (
    <div ref={wrap} className="fx-lfo" style={{ height: H }}>
      {touch ? (
        <TouchViz W={W} H={H} color={color} />
      ) : (
        <svg width={W} height={H}>
          <g className="fx-lfo-scroll" style={{ animationDuration: `${dur}s`, ['--period' as string]: `-${period}px` }}>
            <path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
          </g>
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="fx-grid" />
        </svg>
      )}
      {pan && (
        <div className="fx-lfo-pan">
          <span>L</span>
          <i style={{ animationDuration: `${dur}s`, background: color }} />
          <span>R</span>
        </div>
      )}
      <div className="fx-lfo-label mono">{touch ? 'follows your playing' : `${rate.toFixed(2)} Hz`}</div>
    </div>
  )
}

function TouchViz({ W, H, color }: { W: number; H: number; color: string }) {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const buf = new Float32Array(512)
    let v = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const an = getEngine().masterAnalyser
      an.getFloatTimeDomainData(buf)
      let s = 0
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
      const rms = Math.sqrt(s / buf.length)
      v += (Math.min(1, rms * 5) - v) * 0.25
      if (bar.current) bar.current.style.transform = `scaleX(${0.04 + v})`
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="fx-touch" style={{ width: W, height: H }}>
      <div ref={bar} className="fx-touch-bar" style={{ background: color }} />
    </div>
  )
}

// ── Distortion / bit-crusher: transfer curve + a sine through it ─────────
export function DriveViz({ type, params, color }: { type: string; params: Record<string, number>; color: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const W = useWidth(wrap, 280)
  const H = 70
  const fn = useMemo(() => {
    if (type === 'bitcrush') {
      const levels = Math.pow(2, Math.round(params.bits ?? 6)) / 2
      return (x: number) => Math.round(x * levels) / levels
    }
    const k = Math.pow(10, ((params.drive ?? 35) / 100) * 1.6)
    return driveFn(Math.round(params.type ?? 0), k)
  }, [type, params.bits, params.drive, params.type])
  const curveD = useMemo(() => {
    let s = ''
    for (let i = 0; i <= 64; i++) {
      const x = (i / 64) * 2 - 1
      const yv = Math.max(-1.2, Math.min(1.2, fn(x)))
      s += `${i ? 'L' : 'M'}${((i / 64) * H).toFixed(1)},${(H / 2 - yv * (H / 2 - 4)).toFixed(1)}`
    }
    return s
  }, [fn])
  const waveW = Math.max(60, W - H - 12)
  const waveD = useMemo(() => {
    let s = ''
    const steps = type === 'bitcrush' ? Math.max(6, Math.round(((params.rate ?? 6000) / 22000) * 160)) : 160
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = 0.8 * Math.sin(t * Math.PI * 4)
      const yv = Math.max(-1.2, Math.min(1.2, fn(x)))
      const px = t * waveW
      const py = H / 2 - yv * (H / 2 - 4)
      s += `${i ? (type === 'bitcrush' ? `H${px.toFixed(1)}V${py.toFixed(1)}` : `L${px.toFixed(1)},${py.toFixed(1)}`) : `M0,${py.toFixed(1)}`}`
    }
    return s
  }, [fn, waveW, type, params.rate])
  return (
    <div ref={wrap} className="fx-drive" style={{ height: H }}>
      <svg width={H} height={H}>
        <rect width={H} height={H} rx={8} className="fx-viz-bg" />
        <line x1={0} y1={H} x2={H} y2={0} className="fx-grid" strokeDasharray="3 3" />
        <motion.path d={curveD} initial={false} animate={{ d: curveD }} fill="none" stroke={color} strokeWidth={2.2} />
      </svg>
      <svg width={waveW} height={H} className="fx-drive-wave">
        <path d={(() => { let s = ''; for (let i = 0; i <= 80; i++) { const t = i / 80; s += `${i ? 'L' : 'M'}${t * waveW},${H / 2 - 0.8 * Math.sin(t * Math.PI * 4) * (H / 2 - 4)}` } return s })()} fill="none" className="fx-drive-ghost" />
        <motion.path d={waveD} initial={false} animate={{ d: waveD }} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      </svg>
    </div>
  )
}

// ── Stereo width ─────────────────────────────────────────────────────────
export function WidthViz({ params, color }: { params: Record<string, number>; color: string }) {
  const w = (params.width ?? 100) / 100
  return (
    <div className="fx-width">
      <div className="fx-width-field">
        <motion.span className="fx-width-dot" animate={{ x: -w * 46, scale: 0.8 + w * 0.15 }} style={{ background: color }} transition={{ type: 'spring', stiffness: 300, damping: 18 }} />
        <motion.span className="fx-width-dot" animate={{ x: w * 46, scale: 0.8 + w * 0.15 }} style={{ background: color }} transition={{ type: 'spring', stiffness: 300, damping: 18 }} />
        <motion.span className="fx-width-arc" animate={{ scaleX: 0.15 + w * 0.6, opacity: 0.25 + w * 0.3 }} style={{ borderColor: color }} />
      </div>
      <div className="fx-width-label mono">{w < 0.05 ? 'Mono' : w < 0.95 ? 'Narrower' : w <= 1.05 ? 'Original' : 'Wider'}</div>
    </div>
  )
}

