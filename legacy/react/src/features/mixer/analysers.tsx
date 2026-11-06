import { useEffect, useRef, useState } from 'react'
import { getEngine } from '../../core/engine'
import { dbOfLinear } from './faderLaw'

export function getAnalyser(id: string): AnalyserNode | undefined {
  try {
    const e = getEngine()
    return id === 'master' ? e.masterAnalyser : e.trackAnalyser(id)
  } catch {
    return undefined
  }
}

/** Analysers appear once the engine has synced a track – keep re-checking. */
export function useAnalyser(id: string) {
  const [a, setA] = useState<AnalyserNode | undefined>(() => getAnalyser(id))
  useEffect(() => {
    const check = () => {
      const n = getAnalyser(id)
      setA((p) => (p === n ? p : n))
    }
    check()
    const t = setInterval(check, 300)
    return () => clearInterval(t)
  }, [id])
  return a
}

/** Peak-hold dB readout; turns red when clipping, click to reset. */
export function PeakReadout({ analyser }: { analyser?: AnalyserNode }) {
  const ref = useRef<HTMLButtonElement>(null)
  const hold = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const buf = new Float32Array(analyser?.fftSize ?? 1024)
    let raf = 0
    let last = ''
    let lastClip = false
    const loop = () => {
      if (analyser) {
        analyser.getFloatTimeDomainData(buf)
        let pk = 0
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i])
          if (v > pk) pk = v
        }
        if (pk > hold.current) hold.current = pk
      }
      const db = dbOfLinear(hold.current)
      const txt = hold.current === 0 ? '-∞' : db.toFixed(1)
      if (txt !== last) {
        el.textContent = txt
        last = txt
      }
      const clip = hold.current >= 0.999
      if (clip !== lastClip) {
        el.classList.toggle('is-clip', clip)
        lastClip = clip
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [analyser])
  return (
    <button
      ref={ref}
      className="mx-peak mono"
      title="Highest level reached. Turns red if the sound clips (too loud). Click to reset."
      onClick={() => {
        hold.current = 0
      }}
    >
      -∞
    </button>
  )
}
