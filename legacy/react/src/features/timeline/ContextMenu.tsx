// Right-click menu for clips (rendered in a portal so transforms on ancestors don't matter).
import { ArrowLeftRight, Copy, Palette, Pencil, Scissors, Trash2, TrendingDown, TrendingUp, Volume2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TRACK_COLORS } from '../../core/ids'
import { useStore } from '../../core/store'
import type { Clip } from '../../core/types'
import { Kbd } from '../../ui/kit'
import { deleteSelection, duplicateSelection, processAvailable, runProcessOn, splitClipAtTime } from './commands'
import { clipLen, S, useTL, type MenuState } from './state'

export function ContextMenu() {
  const menu = useTL((s) => s.menu)
  return createPortal(<AnimatePresence>{menu && <Menu key={`${menu.clipId}-${menu.x}-${menu.y}`} menu={menu} />}</AnimatePresence>, document.body)
}

function Menu({ menu }: { menu: MenuState }) {
  const clip = useStore((s) => s.project.clips.find((c) => c.id === menu.clipId))
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })
  const close = () => useTL.getState().set({ menu: null })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) })
  }, [menu.x, menu.y])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', close)
    }
  }, [])

  if (!clip) return null
  const act = (fn: () => void) => () => {
    close()
    fn()
  }
  const patch = (label: string, fn: (c: Clip) => void) =>
    S().mutate(label, (p) => {
      const c = p.clips.find((x) => x.id === clip.id)
      if (c) fn(c as Clip)
    })
  const L = clipLen(clip)
  const canSplit = menu.time > clip.start + 0.01 && menu.time < clip.start + L - 0.01

  return (
    <motion.div
      ref={ref}
      className="tl-menu"
      style={{ left: pos.x, top: pos.y }}
      initial={{ opacity: 0, scale: 0.94, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
      transition={{ type: 'spring', stiffness: 600, damping: 32 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="tl-menu-title">{clip.name}</div>
      <Item icon={<Scissors />} label="Split here" disabled={!canSplit} onClick={act(() => splitClipAtTime(clip.id, menu.time))} />
      <Item icon={<Copy />} label="Duplicate" kbd="Mod+D" onClick={act(() => duplicateSelection([clip.id]))} />
      <Item icon={<Pencil />} label="Rename" onClick={act(() => useTL.getState().set({ renaming: clip.id }))} />
      <div className="tl-menu-colors">
        <Palette size={14} className="faint" />
        {TRACK_COLORS.map((c) => (
          <motion.button
            key={c}
            className={`tl-menu-swatch${clip.color === c ? ' on' : ''}`}
            style={{ background: c }}
            whileHover={{ scale: 1.25 }}
            whileTap={{ scale: 0.85 }}
            onClick={act(() => patch('Clip color', (x) => void (x.color = c)))}
          />
        ))}
        <button className="tl-menu-swatch reset" title="Use track color" onClick={act(() => patch('Clip color', (x) => void delete x.color))}>
          ×
        </button>
      </div>
      <div className="tl-menu-sep" />
      <Item
        icon={<TrendingUp />}
        label={clip.fadeIn > 0 ? 'Remove fade in' : 'Fade in'}
        onClick={act(() => patch('Fade in', (x) => void (x.fadeIn = x.fadeIn > 0 ? 0 : Math.min(1, L / 4))))}
      />
      <Item
        icon={<TrendingDown />}
        label={clip.fadeOut > 0 ? 'Remove fade out' : 'Fade out'}
        onClick={act(() => patch('Fade out', (x) => void (x.fadeOut = x.fadeOut > 0 ? 0 : Math.min(1, L / 4))))}
      />
      <Item icon={<Volume2 />} label="Normalize" disabled={!processAvailable('process.normalize')} onClick={act(() => runProcessOn(clip.id, 'process.normalize'))} />
      <Item icon={<ArrowLeftRight />} label="Reverse" disabled={!processAvailable('process.reverse')} onClick={act(() => runProcessOn(clip.id, 'process.reverse'))} />
      <div className="tl-menu-sep" />
      <Item icon={<Trash2 />} label="Delete" kbd="Delete" danger onClick={act(deleteSelection)} />
    </motion.div>
  )
}

function Item({ icon, label, kbd, onClick, disabled, danger }: { icon: React.ReactNode; label: string; kbd?: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button className={`tl-menu-item${danger ? ' danger' : ''}`} disabled={disabled} onClick={onClick}>
      <span className="tl-menu-icon">{icon}</span>
      <span className="tl-menu-label">{label}</span>
      {kbd && <Kbd k={kbd} />}
    </button>
  )
}
