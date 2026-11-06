// Playhead line across ruler + lanes. Driven entirely by requestAnimationFrame
// reading getEngine().position – never re-renders React. Also page-follows while playing.
import { useEffect, useRef } from 'react'
import { getEngine } from '../../core/engine'
import { S, scrollActivity, useTL } from './state'

export function Playhead() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let lastX = NaN
    let lastPlaying: boolean | null = null
    const eng = getEngine()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const el = ref.current
      if (!el) return
      const pos = eng.position
      const { zoom, scrollX } = S().ui
      const { viewW, dragging } = useTL.getState()
      const playing = eng.isPlaying
      if (playing !== lastPlaying) {
        el.classList.toggle('is-playing', playing)
        lastPlaying = playing
      }
      // page-style follow
      if (playing && !dragging && performance.now() - scrollActivity.last > 1500) {
        const x = (pos - scrollX) * zoom
        if (x > viewW - 12 || x < -2) {
          const viewSec = viewW / zoom
          S().setUI({ scrollX: Math.max(0, x < 0 ? pos - viewSec * 0.1 : pos - viewSec * 0.02) })
          return
        }
      }
      const x = (pos - scrollX) * zoom
      if (x !== lastX) {
        lastX = x
        el.style.transform = `translate3d(${x}px,0,0)`
        el.style.visibility = x < -12 || x > viewW + 12 ? 'hidden' : 'visible'
      }
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="tl-ph-layer" aria-hidden>
      <div ref={ref} className="tl-playhead">
        <span className="tl-playhead-head" />
        <span className="tl-playhead-line" />
      </div>
    </div>
  )
}
