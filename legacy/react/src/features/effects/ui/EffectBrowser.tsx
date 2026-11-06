// Animated effect browser: categories, search, one-click add (optionally with a preset).
import { AnimatePresence, motion } from 'motion/react'
import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { allEffects, type EffectDef } from '../../../core/effects/registry'
import { Modal } from '../../../ui/kit'
import { fxMeta } from '../defs/shared'
import { CATEGORY_INFO, CATEGORY_ORDER, FxIcon } from './icons'

export function EffectBrowser({
  open,
  onClose,
  onPick,
  title = 'Add an effect',
}: {
  open: boolean
  onClose: () => void
  onPick: (type: string, preset: string | null, e: React.MouseEvent) => void
  title?: string
}) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('all')
  const [hover, setHover] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      setQ('')
      setTimeout(() => input.current?.focus(), 80)
    }
  }, [open])
  const all = useMemo(() => allEffects(), [open])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter((d) => {
      if (cat !== 'all' && d.category !== cat) return false
      if (!s) return true
      const hay = `${d.name} ${d.description} ${d.category} ${fxMeta.get(d.type)?.tags ?? ''} ${Object.keys(d.presets ?? {}).join(' ')}`.toLowerCase()
      return s.split(/\s+/).every((w) => hay.includes(w))
    })
  }, [all, q, cat])
  const groups = CATEGORY_ORDER.map((c) => ({ c, items: list.filter((d) => d.category === c) })).filter((g) => g.items.length)
  const cats = CATEGORY_ORDER.filter((c) => all.some((d) => d.category === c))

  // portalled to <body> so a transformed / overflow-clipped parent can't trap the fixed backdrop
  return createPortal(
    <Modal open={open} onClose={onClose} title={title} width={760}>
      <div className="fx-browser">
        <div className="fx-browser-top">
          <div className="fx-search">
            <Search size={15} />
            <input
              ref={input}
              value={q}
              placeholder="Search: “echo”, “warm”, “podcast”…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && list[0]) onPick(list[0].type, null, e as unknown as React.MouseEvent)
              }}
            />
            <AnimatePresence>
              {q && (
                <motion.button className="fx-search-x" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} onClick={() => setQ('')} aria-label="Clear search">
                  <X size={13} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          <div className="fx-cats">
            {['all', ...cats].map((c) => (
              <button key={c} className={`fx-cat ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)} style={c !== 'all' ? { ['--cat' as string]: CATEGORY_INFO[c]?.color } : undefined}>
                {cat === c && <motion.span layoutId="fx-cat-pill" className="fx-cat-pill" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
                <span>{c === 'all' ? 'All' : CATEGORY_INFO[c]?.label ?? c}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="fx-browser-list">
          <AnimatePresence mode="popLayout">
            {groups.map(({ c, items }) => (
              <motion.section key={c} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fx-browser-group">
                <h4 style={{ color: CATEGORY_INFO[c]?.color }}>
                  {CATEGORY_INFO[c]?.label} <span className="faint">· {CATEGORY_INFO[c]?.blurb}</span>
                </h4>
                <div className="fx-browser-grid">
                  {items.map((d, i) => (
                    <BrowserTile key={d.type} def={d} i={i} hover={hover === d.type} setHover={setHover} onPick={onPick} />
                  ))}
                </div>
              </motion.section>
            ))}
          </AnimatePresence>
          {!groups.length && (
            <motion.div className="fx-browser-empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              Nothing matches “{q}”. Try “space”, “loud” or “retro”.
            </motion.div>
          )}
        </div>
      </div>
    </Modal>,
    document.body,
  )
}

function BrowserTile({
  def,
  i,
  hover,
  setHover,
  onPick,
}: {
  def: EffectDef
  i: number
  hover: boolean
  setHover: (t: string | null) => void
  onPick: (type: string, preset: string | null, e: React.MouseEvent) => void
}) {
  const color = CATEGORY_INFO[def.category]?.color ?? 'var(--accent)'
  const presets = Object.keys(def.presets ?? {})
  return (
    <motion.div
      layout
      className="fx-tile"
      style={{ ['--cat' as string]: color }}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: i * 0.025, type: 'spring', stiffness: 420, damping: 30 }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      onHoverStart={() => setHover(def.type)}
      onHoverEnd={() => setHover(null)}
      onClick={(e) => onPick(def.type, null, e)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onPick(def.type, null, e as unknown as React.MouseEvent)}
    >
      <div className="fx-tile-icon">
        <motion.span animate={hover ? { rotate: [0, -10, 10, 0], scale: 1.12 } : { rotate: 0, scale: 1 }} transition={{ duration: 0.45 }}>
          <FxIcon name={fxMeta.get(def.type)?.icon} size={18} />
        </motion.span>
      </div>
      <div className="fx-tile-body">
        <div className="fx-tile-name">{def.name}</div>
        <div className="fx-tile-desc">{def.description}</div>
        {presets.length > 0 && (
          <div className="fx-tile-presets">
            {presets.slice(0, 4).map((p) => (
              <button
                key={p}
                className="fx-chip-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onPick(def.type, p, e)
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}
