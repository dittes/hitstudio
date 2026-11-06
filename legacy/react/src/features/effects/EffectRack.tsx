// EffectRack: the insert-effect chain of one track (or the master bus).
//   <EffectRack target={trackId | 'master'} />            full vertical card list
//   <EffectRack target={trackId} compact />                chips for mixer strips
import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import { ChevronDown, GripVertical, Plus, Power, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getEffect, type EffectDef } from '../../core/effects/registry'
import { useStore } from '../../core/store'
import type { EffectInstance } from '../../core/types'
import { Button, Hint, IconButton, Modal, burst } from '../../ui/kit'
import { PEQ_BANDS } from './defs/tone'
import { fxMeta } from './defs/shared'
import { addEffect, dragKey, editChain, endDrag, matchingPreset, setParams, useChain } from './chain'
import { PROCESSES, openProcess } from './processes'
import { EffectBrowser } from './ui/EffectBrowser'
import { EqCurve } from './ui/EqCurve'
import { CATEGORY_INFO, FxIcon } from './ui/icons'
import { ParamControls } from './ui/ParamControls'
import { CompViz, DelayViz, DriveViz, LfoViz, ReverbViz, WidthViz } from './ui/Visuals'
import './effects.css'

// collapsed state survives remounts (switching modes etc.)
const collapsedIds = new Set<string>()
const freshIds = new Set<string>()

export function EffectRack({ target, compact = false }: { target: string; compact?: boolean }) {
  const chain = useChain(target)
  const name = useStore((s) => (target === 'master' ? 'Master' : s.project.tracks.find((t) => t.id === target)?.name))
  const hints = useStore((s) => s.ui.hints)
  const [browser, setBrowser] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const pick = (type: string, preset: string | null, e: React.MouseEvent) => {
    const id = addEffect(target, type, preset)
    if (id) freshIds.add(id)
    if (e?.clientX) burst(e.clientX, e.clientY)
    setBrowser(false)
    if (compact && id) setTimeout(() => setEditing(id), 250)
  }

  if (name === undefined) return <div className="fx-rack-missing muted">This track no longer exists.</div>

  if (compact) {
    const inst = chain.find((c) => c.id === editing)
    return (
      <div className="fx-compact">
        <AnimatePresence initial={false}>
          {chain.map((fx) => (
            <CompactChip key={fx.id} fx={fx} target={target} onOpen={() => setEditing(fx.id)} />
          ))}
        </AnimatePresence>
        <motion.button className="fx-chip fx-chip-add" whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }} onClick={() => setBrowser(true)} title="Add effect">
          <Plus size={13} />
          {!chain.length && <span>Effect</span>}
        </motion.button>
        <EffectBrowser open={browser} onClose={() => setBrowser(false)} onPick={pick} title={`Add an effect to ${name}`} />
        {createPortal(
          <Modal open={!!inst} onClose={() => setEditing(null)} title={inst ? `${getEffect(inst.type)?.name ?? inst.type} · ${name}` : ''} width={460}>
            {inst && <FxCard fx={inst} target={target} index={chain.indexOf(inst)} standalone onRemoved={() => setEditing(null)} />}
          </Modal>,
          document.body,
        )}
      </div>
    )
  }

  return (
    <div className="fx-rack">
      <div className="fx-rack-head">
        <div>
          <div className="fx-rack-title">Effects</div>
          <div className="fx-rack-sub faint">
            {name} · {chain.length ? `${chain.length} effect${chain.length === 1 ? '' : 's'}, top to bottom` : 'no effects yet'}
          </div>
        </div>
        <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setBrowser(true)}>
          Add
        </Button>
      </div>

      {chain.length === 0 ? (
        <EmptyState target={target} onBrowse={() => setBrowser(true)} hints={hints} />
      ) : (
        <ChainList chain={chain} target={target} />
      )}

      {hints && chain.length > 0 && (
        <Hint>Drag the grip on the left of a card to change the order. Double-click a knob to reset it.</Hint>
      )}

      {target !== 'master' && <ProcessShelf />}

      <EffectBrowser open={browser} onClose={() => setBrowser(false)} onPick={pick} title={`Add an effect to ${name}`} />
    </div>
  )
}

// ── empty state with quick picks ─────────────────────────────
function EmptyState({ target, onBrowse, hints }: { target: string; onBrowse: () => void; hints: boolean }) {
  const quick = target === 'master' ? ['peq', 'compressor', 'limiter'] : ['vocal', 'reverb', 'echo', 'peq']
  return (
    <motion.div className="fx-empty" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <motion.div className="fx-empty-orb" animate={{ scale: [1, 1.08, 1], rotate: [0, 8, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}>
        <Sparkles size={22} />
      </motion.div>
      <div className="fx-empty-title">Add some magic</div>
      <div className="fx-empty-text muted">Effects change how this {target === 'master' ? 'whole song' : 'track'} sounds — live, and you can always switch them off.</div>
      <div className="fx-empty-quick">
        {quick.map((t, i) => {
          const d = getEffect(t)
          if (!d) return null
          return (
            <motion.button
              key={t}
              className="fx-chip"
              style={{ ['--cat' as string]: CATEGORY_INFO[d.category]?.color }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 + i * 0.06 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.92 }}
              onClick={(e) => {
                const id = addEffect(target, t)
                if (id) freshIds.add(id)
                burst(e.clientX, e.clientY)
              }}
            >
              <FxIcon name={fxMeta.get(t)?.icon} size={13} /> {d.name}
            </motion.button>
          )
        })}
        <motion.button className="fx-chip fx-chip-ghost" whileTap={{ scale: 0.92 }} onClick={onBrowse}>
          Browse all…
        </motion.button>
      </div>
      {hints && <Hint>Tip: effects run top to bottom, like pedals on a guitar board.</Hint>}
    </motion.div>
  )
}

// ── reorderable list ─────────────────────────────────────────
function ChainList({ chain, target }: { chain: EffectInstance[]; target: string }) {
  const ids = useMemo(() => chain.map((c) => c.id), [chain])
  const [order, setOrder] = useState(ids)
  const dragging = useRef(false)
  useEffect(() => {
    if (!dragging.current) setOrder(ids)
  }, [ids])
  const byId = new Map(chain.map((c) => [c.id, c]))
  const commit = () => {
    dragging.current = false
    if (order.join() === ids.join()) return
    editChain(target, 'Reorder effects', (c) => {
      c.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    })
  }
  return (
    <Reorder.Group axis="y" values={order} onReorder={setOrder} className="fx-list" as="div">
      <AnimatePresence initial={false}>
        {order.map((id, i) => {
          const fx = byId.get(id)
          if (!fx) return null
          return <ReorderCard key={id} fx={fx} target={target} index={i} onDragStart={() => (dragging.current = true)} onDragEnd={commit} />
        })}
      </AnimatePresence>
    </Reorder.Group>
  )
}

function ReorderCard({ fx, target, index, onDragStart, onDragEnd }: { fx: EffectInstance; target: string; index: number; onDragStart: () => void; onDragEnd: () => void }) {
  const controls = useDragControls()
  const [lifted, setLifted] = useState(false)
  return (
    <Reorder.Item
      value={fx.id}
      as="div"
      dragListener={false}
      dragControls={controls}
      onDragStart={() => {
        setLifted(true)
        onDragStart()
      }}
      onDragEnd={() => {
        setLifted(false)
        onDragEnd()
      }}
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: lifted ? 1.02 : 1, boxShadow: lifted ? 'var(--shadow)' : '0 0 0 rgba(0,0,0,0)' }}
      exit={{ opacity: 0, scale: 0.9, height: 0, marginBottom: 0, transition: { duration: 0.22 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 36 }}
      className={`fx-item ${lifted ? 'is-lifted' : ''}`}
    >
      <FxCard fx={fx} target={target} index={index} onGrip={(e) => controls.start(e)} />
    </Reorder.Item>
  )
}

// ── the effect card ──────────────────────────────────────────
function FxCard({
  fx,
  target,
  index,
  onGrip,
  standalone,
  onRemoved,
}: {
  fx: EffectInstance
  target: string
  index: number
  onGrip?: (e: React.PointerEvent) => void
  standalone?: boolean
  onRemoved?: () => void
}) {
  const def = getEffect(fx.type)
  const [collapsed, setCollapsed] = useState(() => !standalone && collapsedIds.has(fx.id))
  const [pulse, setPulse] = useState(0)
  const [isFresh] = useState(() => freshIds.delete(fx.id))
  if (!def) {
    return (
      <div className="fx-card is-unknown">
        <div className="fx-card-head">
          <span className="fx-card-name">Unknown effect “{fx.type}”</span>
          <IconButton label="Remove" size="sm" icon={<Trash2 />} onClick={() => editChain(target, 'Remove effect', (c) => void c.splice(c.findIndex((x) => x.id === fx.id), 1))} />
        </div>
      </div>
    )
  }
  const meta = fxMeta.get(def.type) ?? {}
  const color = CATEGORY_INFO[def.category]?.color ?? 'var(--accent)'
  const on = !fx.bypass
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const n = !c
      n ? collapsedIds.add(fx.id) : collapsedIds.delete(fx.id)
      return n
    })
  }
  const toggleBypass = () => {
    editChain(target, on ? `Switch off ${def.name}` : `Switch on ${def.name}`, (c) => {
      const e = c.find((x) => x.id === fx.id)
      if (e) e.bypass = !e.bypass
    })
    setPulse((p) => p + 1)
  }
  const remove = (e: React.MouseEvent) => {
    burst(e.clientX, e.clientY, ['#f87171', '#fb923c', '#facc15'])
    editChain(target, `Remove ${def.name}`, (c) => {
      const i = c.findIndex((x) => x.id === fx.id)
      if (i >= 0) c.splice(i, 1)
    })
    onRemoved?.()
  }
  return (
    <motion.div
      className={`fx-card ${on ? 'is-on' : 'is-off'} ${collapsed ? 'is-collapsed' : ''} ${isFresh ? 'is-fresh' : ''}`}
      style={{ ['--cat' as string]: color }}
      layout="position"
    >
      <div className="fx-card-head" onDoubleClick={standalone ? undefined : toggleCollapsed}>
        {onGrip && (
          <span className="fx-grip" onPointerDown={(e) => { e.preventDefault(); onGrip(e) }} title="Drag to reorder">
            <GripVertical size={14} />
          </span>
        )}
        <PowerButton on={on} pulse={pulse} onClick={toggleBypass} />
        <span className="fx-card-icon">
          <FxIcon name={meta.icon} size={15} />
        </span>
        <div className="fx-card-titles">
          <span className="fx-card-name">
            {!standalone && <span className="fx-card-idx faint mono">{index + 1}</span>}
            {def.name}
          </span>
          {collapsed && <span className="fx-card-summary faint">{matchingPreset(fx.type, fx.params) ?? (on ? 'on' : 'off')}</span>}
        </div>
        <PresetMenu def={def} fx={fx} target={target} />
        <IconButton label="Remove effect" size="sm" icon={<Trash2 />} onClick={remove} />
        {!standalone && (
          <motion.button className="fx-collapse" onClick={toggleCollapsed} animate={{ rotate: collapsed ? -90 : 0 }} aria-label={collapsed ? 'Expand' : 'Collapse'}>
            <ChevronDown size={15} />
          </motion.button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            className="fx-card-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 38 }}
          >
            <div className="fx-card-inner">
              <div className="fx-card-desc muted">{def.description}</div>
              <CardBody def={def} fx={fx} target={target} color={color} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function CardBody({ def, fx, target, color }: { def: EffectDef; fx: EffectInstance; target: string; color: string }) {
  const meta = fxMeta.get(def.type) ?? {}
  const [band, setBand] = useState(2)
  const change = (key: string, v: number) => setParams(target, fx.id, { [key]: v }, dragKey(fx.id, key))
  const patch = (p: Record<string, number>) => setParams(target, fx.id, p, dragKey(fx.id, 'curve'))
  const p = fx.params

  let visual: React.ReactNode = null
  switch (meta.visual) {
    case 'eq':
    case 'filter':
      visual = <EqCurve type={def.type === 'peq' ? 'peq' : 'filter'} params={p} onChange={patch} onCommit={endDrag} target={target} selected={band} onSelect={setBand} height={def.type === 'peq' ? 150 : 110} />
      break
    case 'comp':
      visual = <CompViz type={def.type} effectId={fx.id} params={p} color={color} />
      break
    case 'reverb':
      visual = <ReverbViz params={p} color={color} />
      break
    case 'delay':
      visual = <DelayViz params={p} color={color} />
      break
    case 'lfo':
      visual = <LfoViz type={def.type} params={p} color={color} />
      break
    case 'drive':
      visual = <DriveViz type={def.type} params={p} color={color} />
      break
    case 'width':
      visual = <WidthViz params={p} color={color} />
      break
  }

  if (def.type === 'peq') {
    const i = band + 1
    return (
      <>
        <div className="fx-visual">{visual}</div>
        <div className="fx-bands">
          {PEQ_BANDS.map((b, j) => (
            <motion.button key={j} className={`fx-band ${band === j ? 'on' : ''}`} style={{ ['--band' as string]: b.color }} onClick={() => setBand(j)} whileTap={{ scale: 0.92 }}>
              {band === j && <motion.span layoutId={`fx-band-${fx.id}`} className="fx-band-pill" />}
              <span className="fx-band-dot" />
              <span>{b.label}</span>
            </motion.button>
          ))}
        </div>
        <ParamControls def={def} params={p} onChange={change} onCommit={endDrag} color={PEQ_BANDS[band].color} only={[`f${i}`, `g${i}`, `q${i}`, 'out']} />
      </>
    )
  }
  return (
    <>
      {visual && <div className="fx-visual">{visual}</div>}
      <ParamControls def={def} params={p} onChange={change} onCommit={endDrag} color={color} />
    </>
  )
}

// ── power (bypass) button with a satisfying ring burst ───────
function PowerButton({ on, onClick, pulse }: { on: boolean; onClick: () => void; pulse: number }) {
  return (
    <motion.button
      className={`fx-power ${on ? 'on' : ''}`}
      onClick={onClick}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.8, rotate: -30 }}
      animate={{ rotate: on ? 0 : -90 }}
      transition={{ type: 'spring', stiffness: 600, damping: 18 }}
      aria-pressed={on}
      title={on ? 'On – click to bypass' : 'Bypassed – click to switch on'}
    >
      <Power size={13} strokeWidth={2.6} />
      <AnimatePresence>
        {pulse > 0 && (
          <motion.span
            key={pulse}
            className="fx-power-ring"
            initial={{ scale: 0.6, opacity: on ? 0.9 : 0.4 }}
            animate={{ scale: 2.4, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </motion.button>
  )
}

// ── preset dropdown ──────────────────────────────────────────
function PresetMenu({ def, fx, target }: { def: EffectDef; fx: EffectInstance; target: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const names = Object.keys(def.presets ?? {})
  const current = matchingPreset(def.type, fx.params)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  if (!names.length) return null
  const apply = (name: string | null) => {
    const vals = name ? def.presets![name] : Object.fromEntries(def.params.map((p) => [p.key, p.default]))
    editChain(target, name ? `${def.name}: ${name}` : `Reset ${def.name}`, (c) => {
      const e = c.find((x) => x.id === fx.id)
      if (e) e.params = { ...e.params, ...vals }
    })
    setOpen(false)
  }
  return (
    <div className="fx-preset" ref={ref}>
      <motion.button className={`fx-preset-btn ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} whileTap={{ scale: 0.95 }}>
        <span>{current ?? 'Presets'}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: 'inline-flex' }}>
          <ChevronDown size={12} />
        </motion.span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div className="fx-preset-menu" initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.14 }}>
            {names.map((n, i) => (
              <motion.button key={n} className={`fx-preset-item ${current === n ? 'on' : ''}`} onClick={() => apply(n)} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                {n}
                {current === n && <span className="fx-preset-check">✓</span>}
              </motion.button>
            ))}
            <div className="fx-preset-sep" />
            <button className="fx-preset-item faint" onClick={() => apply(null)}>
              Reset to default
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── compact chips (mixer strips) ─────────────────────────────
function CompactChip({ fx, target, onOpen }: { fx: EffectInstance; target: string; onOpen: () => void }) {
  const def = getEffect(fx.type)
  const color = def ? CATEGORY_INFO[def.category]?.color : 'var(--text-3)'
  const on = !fx.bypass
  return (
    <motion.div
      layout
      className={`fx-chip fx-chip-fx ${on ? 'on' : 'off'}`}
      style={{ ['--cat' as string]: color }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      whileHover={{ y: -1 }}
      title={`${def?.name ?? fx.type}${on ? '' : ' (off)'} – click to edit`}
    >
      <motion.button
        className="fx-chip-led"
        aria-label={on ? 'Bypass' : 'Switch on'}
        whileTap={{ scale: 0.7 }}
        onClick={(e) => {
          e.stopPropagation()
          editChain(target, on ? `Switch off ${def?.name}` : `Switch on ${def?.name}`, (c) => {
            const x = c.find((y) => y.id === fx.id)
            if (x) x.bypass = !x.bypass
          })
        }}
      />
      <button className="fx-chip-label" onClick={onOpen}>
        <FxIcon name={fxMeta.get(fx.type)?.icon} size={11} />
        <span>{shortName(fx.type, def?.name ?? fx.type)}</span>
      </button>
    </motion.div>
  )
}

const SHORT: Record<string, string> = {
  peq: 'EQ', eq3: 'Tone', gate: 'Gate', vocal: 'Vocal', bitcrush: 'Lo-fi', telephone: 'Phone', tremolo: 'Tremolo',
  width: 'Width', echo: 'Echo', distortion: 'Drive', compressor: 'Comp', limiter: 'Limit', wah: 'Wah',
}
const shortName = (type: string, n: string) => SHORT[type] ?? n.split(/[ /]/)[0].slice(0, 9)

// ── process shelf: destructive edits on the selected audio ───
const SHELF = ['normalize', 'noiseReduce', 'loudness', 'fadeIn', 'fadeOut', 'silenceTrim', 'speed', 'pitch', 'tempo', 'reverse', 'removeClicks', 'paulstretch', 'applyEffect', 'amplify', 'mono', 'invert']

function ProcessShelf() {
  const [open, setOpen] = useState(false)
  const hasSel = useStore((s) => s.selection.clipIds.length > 0 || !!s.selection.range)
  const list = SHELF.map((id) => PROCESSES.find((p) => p.id === id)!).filter(Boolean)
  const shown = open ? list : list.slice(0, 6)
  return (
    <div className="fx-shelf">
      <div className="fx-shelf-head">
        <div>
          <div className="fx-rack-title">Fix &amp; transform</div>
          <div className="fx-rack-sub faint">{hasSel ? 'Changes the selected audio (undo with ⌘Z)' : 'Select a clip or a time range first'}</div>
        </div>
      </div>
      <motion.div className="fx-shelf-grid" layout>
        <AnimatePresence initial={false}>
          {shown.map((p, i) => (
            <motion.button
              key={p.id}
              layout
              className={`fx-proc ${hasSel ? '' : 'is-dim'}`}
              title={p.description}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ delay: open ? (i - 6) * 0.02 : 0 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => openProcess(p.id)}
            >
              <FxIcon name={p.icon} size={15} />
              <span>{p.label}</span>
            </motion.button>
          ))}
        </AnimatePresence>
      </motion.div>
      <button className="fx-shelf-more" onClick={() => setOpen((o) => !o)}>
        {open ? 'Show fewer' : `Show all ${list.length}`}
      </button>
    </div>
  )
}

export { FxCard }
