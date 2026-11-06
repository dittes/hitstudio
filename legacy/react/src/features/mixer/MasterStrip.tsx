import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { mutate, useStore } from '../../core/store'
import { Hint, Meter } from '../../ui/kit'
import { Fader } from './Fader'
import { PeakReadout, useAnalyser } from './analysers'
import { dbOfLinear } from './faderLaw'
import { DbField, Rack } from './parts'

function Loudness({ analyser }: { analyser?: AnalyserNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!analyser) return
    const buf = new Float32Array(analyser.fftSize)
    let ms = 0
    let raf = 0
    let last = performance.now()
    let txt = ''
    const loop = () => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      analyser.getFloatTimeDomainData(buf)
      let s = 0
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
      s /= buf.length
      // ~3 s short-term average, faster rise
      const tau = s > ms ? 0.4 : 3
      ms += (s - ms) * (1 - Math.exp(-dt / tau))
      const db = dbOfLinear(Math.sqrt(ms))
      const t = isFinite(db) && db > -80 ? db.toFixed(1) : '-∞'
      if (t !== txt && ref.current) {
        ref.current.textContent = t
        txt = t
      }
      if (bar.current) bar.current.style.width = `${Math.max(0, Math.min(1, (db + 40) / 40)) * 100}%`
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [analyser])
  return (
    <div className="mx-loud">
      <div className="mx-loud-top">
        <span>Loudness</span>
        <span className="mono">
          <b ref={ref}>-∞</b> dB
        </span>
      </div>
      <div className="mx-loud-bar">
        <div ref={bar} className="mx-loud-fill" />
        <i style={{ left: `${((-14 + 40) / 40) * 100}%` }} title="A common target for streaming is around -14" />
      </div>
    </div>
  )
}

function Spectrum({ analyser }: { analyser?: AnalyserNode }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !analyser) return
    const g = c.getContext('2d')!
    const dpr = devicePixelRatio || 1
    const W = 150,
      H = 54
    c.width = W * dpr
    c.height = H * dpr
    g.scale(dpr, dpr)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const bars = 32
    const smooth = new Float32Array(bars)
    const color = getComputedStyle(c).getPropertyValue('--accent').trim() || '#a78bfa'
    const color2 = getComputedStyle(c).getPropertyValue('--accent-2').trim() || '#f472b6'
    let raf = 0
    const loop = () => {
      analyser.getByteFrequencyData(data)
      g.clearRect(0, 0, W, H)
      const grad = g.createLinearGradient(0, H, 0, 0)
      grad.addColorStop(0, color)
      grad.addColorStop(1, color2)
      g.fillStyle = grad
      const bw = W / bars
      const n = data.length * 0.7
      for (let i = 0; i < bars; i++) {
        const a = Math.floor(Math.pow(i / bars, 2) * n) + 1
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / bars, 2) * n))
        let m = 0
        for (let k = a; k < b && k < data.length; k++) m = Math.max(m, data[k])
        smooth[i] = Math.max(m / 255, smooth[i] * 0.86)
        const h = Math.max(1.5, smooth[i] * H)
        g.beginPath()
        g.roundRect(i * bw + 0.8, H - h, bw - 1.6, h, 1.5)
        g.fill()
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [analyser])
  return <canvas ref={ref} className="mx-spectrum" style={{ width: 150, height: 54 }} />
}

export function MasterStrip({ onOpenFx }: { onOpenFx: () => void }) {
  const vol = useStore((s) => s.project.master.volume)
  const hints = useStore((s) => s.ui.hints)
  const analyser = useAnalyser('master')
  const set = (g: number) => mutate('Change master volume', (p) => void (p.master.volume = g), { coalesce: 'mx-master-vol' })
  return (
    <div className="mx-strip mx-master">
      <div className="mx-strip-head mx-master-head">
        <SlidersHorizontal size={14} className="mx-strip-icon" />
        <span className="mx-master-title">Master</span>
      </div>
      <div className="mx-fx" onClick={onOpenFx} title="Click to open the master effects">
        <Rack target="master" compact />
      </div>
      <Spectrum analyser={analyser} />
      <Loudness analyser={analyser} />
      <div className="mx-fader-row">
        <Fader value={vol} onChange={set} label="Master volume" color="var(--accent-2)" />
        <Meter analyser={analyser} length={220} thickness={12} />
      </div>
      <div className="mx-readouts">
        <DbField gain={vol} onSet={set} />
        <PeakReadout analyser={analyser} />
      </div>
      {hints && <Hint>Keep the peak under 0 dB</Hint>}
    </div>
  )
}
