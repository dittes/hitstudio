// The arrangement area: ruler, reorderable track rows, playhead, minimap.
import { Plus } from 'lucide-react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { runCommand } from '../../core/commands'
import { clamp, uid } from '../../core/ids'
import { useStore } from '../../core/store'
import { Lane } from './Lane'
import { Minimap } from './Minimap'
import { Playhead } from './Playhead'
import { Ruler } from './Ruler'
import { HEADER_W, S, scrollActivity, setScroll, useTL, zoomAround } from './state'
import { TrackHeader } from './TrackHeader'

let reorderKey = 'reorder'

const TrackRow = memo(function TrackRow({ id, index }: { id: string; index: number }) {
  const live = useStore((s) => s.project.tracks.find((t) => t.id === id))
  // keep rendering the last known track while the row animates out after deletion
  const last = useRef(live)
  if (live) last.current = live
  const track = live ?? last.current
  const controls = useDragControls()
  if (!track) return null
  return (
    <Reorder.Item
      as="div"
      value={id}
      className="tl-row"
      layout="position"
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -30, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      whileDrag={{ scale: 1.012, zIndex: 20, boxShadow: '0 12px 32px rgba(0,0,0,.35)' }}
      onDragStart={() => {
        reorderKey = uid('reorder')
      }}
    >
      <TrackHeader track={track} dragControls={controls} />
      <Lane track={track} index={index} />
    </Reorder.Item>
  )
})

export function Timeline() {
  const mainRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackIds = useStore(useShallow((s) => s.project.tracks.map((t) => t.id)))
  const zoom = useStore((s) => s.ui.zoom)

  // horizontal position is a CSS variable – changing it re-renders nothing
  useLayoutEffect(() => {
    const el = mainRef.current
    if (!el) return
    const apply = () => {
      const { scrollX, zoom: z } = S().ui
      el.style.setProperty('--tl-x', `${-scrollX * z}px`)
    }
    apply()
    return useStore.subscribe((s, p) => {
      if (s.ui.scrollX !== p.ui.scrollX || s.ui.zoom !== p.ui.zoom) apply()
    })
  }, [])

  // measure the lane viewport
  useLayoutEffect(() => {
    const el = scrollRef.current
    const main = mainRef.current
    if (!el || !main) return
    const ro = new ResizeObserver(() => {
      const sbw = el.offsetWidth - el.clientWidth
      main.style.setProperty('--tl-sbw', `${sbw}px`)
      useTL.getState().set({ viewW: Math.max(50, el.clientWidth - HEADER_W) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // wheel: ⌘/ctrl zooms around the pointer, shift / horizontal swipes scroll time
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const { ui } = S()
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const r = el.getBoundingClientRect()
      const mx = clamp(e.clientX - r.left - HEADER_W, 0, useTL.getState().viewW)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const dy = clamp(e.deltaY * k, -80, 80)
        zoomAround(ui.zoom * Math.exp(-dy * 0.008), mx)
        scrollActivity.last = performance.now()
        return
      }
      const dx = e.shiftKey ? (e.deltaX || e.deltaY) * k : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX * k : 0
      if (dx) {
        e.preventDefault()
        setScroll(ui.scrollX + dx / ui.zoom)
        scrollActivity.last = performance.now()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div ref={mainRef} className="tl-main">
      <div className="tl-top">
        <div className="tl-corner">
          <span className="faint">Bars</span>
        </div>
        <Ruler />
      </div>
      <motion.div ref={scrollRef} className="tl-scroll" layoutScroll>
        <Reorder.Group
          as="div"
          axis="y"
          className="tl-rows"
          values={trackIds}
          onReorder={(order: string[]) =>
            S().mutate(
              'Reorder tracks',
              (p) => {
                const byId = new Map(p.tracks.map((t) => [t.id, t]))
                p.tracks = order.map((id) => byId.get(id)!).filter(Boolean)
              },
              { coalesce: reorderKey },
            )
          }
        >
          <AnimatePresence initial={false}>
            {trackIds.map((id, i) => (
              <TrackRow key={id} id={id} index={i} />
            ))}
          </AnimatePresence>
        </Reorder.Group>
        <div
          className="tl-add-row"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) S().select({ clipIds: [], range: null })
          }}
        >
          <motion.button className="tl-add-track" whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => runCommand('track.add')}>
            <Plus size={14} /> Add track
          </motion.button>
          <span className="faint tl-add-tip">or drop audio files anywhere</span>
        </div>
      </motion.div>
      <Playhead />
      <div className="tl-bottom">
        <div className="tl-zoom-readout mono faint">{zoom >= 100 ? `${Math.round(zoom)} px/s` : `${zoom.toFixed(zoom < 10 ? 1 : 0)} px/s`}</div>
        <Minimap />
      </div>
    </div>
  )
}
