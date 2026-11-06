import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { allCommands, prettyShortcut, registerCommand, subscribeCommands } from '../core/commands'

let openPalette: () => void = () => {}
registerCommand({ id: 'palette.open', label: 'Search actions', shortcut: 'Mod+K', group: 'View', run: () => openPalette() })

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const [, force] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  openPalette = () => {
    setQ('')
    setI(0)
    setOpen(true)
  }
  useEffect(() => { const u = subscribeCommands(() => force((n) => n + 1)); return () => void u() }, [])
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30)
  }, [open])
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return allCommands()
      .filter((c) => c.id !== 'palette.open' && (c.enabled?.() ?? true))
      .filter((c) => words.every((w) => `${c.label} ${c.group ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(w)))
      .slice(0, 40)
  }, [q, open])
  const run = (idx: number) => {
    const c = list[idx]
    if (!c) return
    setOpen(false)
    setTimeout(() => c.run(), 10)
  }
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="bk-modal-backdrop palette-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={() => setOpen(false)}>
          <motion.div
            className="palette"
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <input
              ref={input}
              className="palette-input"
              placeholder="What do you want to do?  e.g. “normalize”, “reverb”, “export mp3”"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setI(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') (e.preventDefault(), setI((x) => Math.min(list.length - 1, x + 1)))
                else if (e.key === 'ArrowUp') (e.preventDefault(), setI((x) => Math.max(0, x - 1)))
                else if (e.key === 'Enter') run(i)
                else if (e.key === 'Escape') setOpen(false)
              }}
            />
            <div className="palette-list">
              {list.map((c, idx) => (
                <div key={c.id} className={`palette-item ${idx === i ? 'on' : ''}`} onPointerEnter={() => setI(idx)} onClick={() => run(idx)}>
                  {idx === i && <motion.span layoutId="pal-hl" className="palette-hl" transition={{ type: 'spring', stiffness: 700, damping: 40 }} />}
                  <span className="palette-label">{c.label}</span>
                  <span className="palette-group">{c.group}</span>
                  {c.shortcut && <kbd className="bk-kbd">{prettyShortcut(Array.isArray(c.shortcut) ? c.shortcut[0] : c.shortcut)}</kbd>}
                </div>
              ))}
              {list.length === 0 && <div className="palette-empty faint">Nothing found – try another word</div>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
