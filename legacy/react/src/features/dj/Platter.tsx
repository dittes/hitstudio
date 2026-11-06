// Spinning vinyl / jog wheel. Rotation follows the deck's real play position
// (33⅓ rpm), so scratching, brakes and spinbacks look right. Drag the record
// to scratch, drag the outer rim while playing to nudge (pitch bend).
import { useEffect, useRef } from 'react'
import { getDJ } from './engine'
import { SEC_PER_REV } from './deck'
import { DECK_HEX, useDJ, type DeckIndex } from './state'

const TAU = Math.PI * 2

export function Platter({ i, size = 196 }: { i: DeckIndex; size?: number }) {
  const spin = useRef<SVGGElement>(null)
  const glow = useRef<SVGCircleElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const title = useDJ((s) => s.decks[i].title)
  const loaded = useDJ((s) => !!s.decks[i].itemId)
  const color = useDJ((s) => s.decks[i].color) || DECK_HEX[i]
  const playing = useDJ((s) => s.decks[i].playing)

  useEffect(() => {
    let raf = 0
    const deck = getDJ().decks[i]
    const draw = () => {
      const pos = deck.position()
      const ang = ((pos / SEC_PER_REV) * 360) % 360
      spin.current?.setAttribute('transform', `rotate(${ang} 100 100)`)
      if (glow.current) {
        const st = deck.st
        let a = 0
        if (deck.isRunning && st.bpm && deck.speed > 0.2) {
          const ph = deck.beatPhase()
          const f = ph - Math.floor(ph)
          const down = Math.round(ph - f) % 4 === 0
          a = Math.pow(1 - f, 3) * (down ? 1 : 0.6)
        }
        glow.current.style.opacity = String(0.15 + a * 0.85)
        glow.current.style.strokeWidth = String(3 + a * 4)
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [i])

  // ── scratch / nudge interaction ──
  const onPointerDown = (e: React.PointerEvent) => {
    const deck = getDJ().decks[i]
    if (!deck.loaded || e.button !== 0) return
    e.preventDefault()
    const el = root.current!
    el.setPointerCapture(e.pointerId)
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const angleOf = (x: number, y: number) => Math.atan2(y - cy, x - cx)
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy) / (r.width / 2)
    const mode: 'scratch' | 'nudge' = dist > 0.8 && deck.st.playing ? 'nudge' : 'scratch'
    let last = angleOf(e.clientX, e.clientY)
    let lastT = performance.now()
    let lastMove = lastT
    let v = 0
    el.classList.add(mode === 'scratch' ? 'is-scratch' : 'is-nudge')
    if (mode === 'scratch') deck.scratchStart()
    const idle = window.setInterval(() => {
      if (performance.now() - lastMove > 55) {
        v *= 0.3
        if (mode === 'scratch') deck.scratchMove(Math.abs(v) < 0.02 ? 0 : v)
        else deck.setBend(0)
      }
    }, 30)
    const move = (ev: PointerEvent) => {
      const a = angleOf(ev.clientX, ev.clientY)
      let d = a - last
      if (d > Math.PI) d -= TAU
      if (d < -Math.PI) d += TAU
      const now = performance.now()
      const dt = Math.max(0.004, (now - lastT) / 1000)
      last = a
      lastT = now
      lastMove = now
      const revPerSec = d / TAU / dt
      if (mode === 'scratch') {
        v = v * 0.35 + revPerSec * SEC_PER_REV * 0.65
        deck.scratchMove(v)
      } else {
        deck.setBend(Math.max(-0.2, Math.min(0.2, revPerSec * 0.12)))
      }
    }
    const up = () => {
      clearInterval(idle)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.classList.remove('is-scratch', 'is-nudge')
      if (mode === 'scratch') deck.scratchEnd()
      else deck.setBend(0)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const label = title || (i === 0 ? 'Deck A' : 'Deck B')
  const grooves = [92, 86, 80, 74, 68, 62, 56, 50]
  return (
    <div
      ref={root}
      className={`dj-platter ${playing ? 'is-playing' : ''} ${loaded ? '' : 'is-empty'}`}
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
      title={loaded ? 'Drag the record to scratch · drag the outer rim to nudge' : undefined}
    >
      <svg viewBox="0 0 200 200" width={size} height={size}>
        <defs>
          <radialGradient id={`dj-vinyl-${i}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2a2a34" />
            <stop offset="70%" stopColor="#141419" />
            <stop offset="100%" stopColor="#0b0b0f" />
          </radialGradient>
          <linearGradient id={`dj-sheen-${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="45%" stopColor="#fff" stopOpacity="0" />
            <stop offset="55%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id={`dj-label-${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={i === 0 ? '#6d5bd0' : '#c2417f'} />
          </linearGradient>
          <path id={`dj-arc-${i}`} d="M 100 100 m -21 0 a 21 21 0 1 1 42 0 a 21 21 0 1 1 -42 0" />
        </defs>
        {/* outer ring + beat glow */}
        <circle cx="100" cy="100" r="98" className="dj-platter-ring" />
        <circle ref={glow} cx="100" cy="100" r="97" fill="none" stroke={color} className="dj-platter-glow" />
        {/* strobe dots on the rim */}
        <g ref={spin}>
          <circle cx="100" cy="100" r="93" fill={`url(#dj-vinyl-${i})`} />
          {grooves.map((r) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#fff" strokeOpacity={0.045} strokeWidth={r % 12 === 2 ? 1.6 : 0.8} />
          ))}
          <circle cx="100" cy="100" r="40" fill={`url(#dj-label-${i})`} />
          <text className="dj-platter-label" fontSize="7.2" fill="#fff">
            <textPath href={`#dj-arc-${i}`} startOffset="0">
              {(label.length > 34 ? label.slice(0, 33) + '…' : label).toUpperCase()}
            </textPath>
          </text>
          <rect x="98.6" y="8" width="2.8" height="30" rx="1.4" fill={color} />
          <circle cx="100" cy="100" r="4.5" fill="#d9d9e3" />
        </g>
        <circle cx="100" cy="100" r="93" fill={`url(#dj-sheen-${i})`} pointerEvents="none" />
      </svg>
    </div>
  )
}
