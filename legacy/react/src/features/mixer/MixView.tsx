import { Crosshair, Lightbulb, RotateCcw, Sparkles, Wand2, X, ChevronDown, Music, Pencil, Eraser } from 'lucide-react'
import { AnimatePresence, Reorder, motion } from 'motion/react'
import { useCallback, useRef, useState } from 'react'
import { runCommand } from '../../core/commands'
import { mutate, useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { Button, Hint, Tooltip, burst } from '../../ui/kit'
import { ChannelStrip } from './ChannelStrip'
import { MasterStrip } from './MasterStrip'
import { autoBalance } from './autoBalance'
import { captureMix, glideMix, recallSnap, type MixSnap } from './glide'
import { Rack } from './parts'
import './mixer.css'

type Slot = 'A' | 'B'

export function MixView() {
  const tracks = useStore((s) => s.project.tracks)
  const hints = useStore((s) => s.ui.hints)
  const selIds = useStore((s) => s.selection.trackIds)
  const [fx, setFx] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tips, setTips] = useState(true)
  const [snaps, setSnaps] = useState<Record<Slot, MixSnap | null>>({ A: null, B: null })
  const [active, setActive] = useState<Slot | null>(null)
  const dragSeq = useRef(0)
  const focusSaved = useRef<Record<string, boolean> | null>(null)

  const anySolo = tracks.some((t) => t.solo)
  const ids = tracks.map((t) => t.id)

  const onReorder = useCallback((order: string[]) => {
    mutate(
      'Reorder tracks',
      (p) => {
        const by = new Map(p.tracks.map((t) => [t.id, t]))
        const next = order.map((i) => by.get(i)!).filter(Boolean)
        if (next.length === p.tracks.length) p.tracks = next
      },
      { coalesce: `mx-reorder-${dragSeq.current}` },
    )
  }, [])

  const select = (id: string) => useStore.getState().select({ trackIds: [id] })

  const doAuto = async (e: React.MouseEvent) => {
    if (busy) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setBusy(true)
    try {
      const res = await autoBalance()
      if (res.changed) {
        burst(r.left + r.width / 2, r.top + r.height / 2)
        toast({ title: 'Balanced!', body: `${res.changed} track${res.changed > 1 ? 's' : ''} now sit at a similar level.`, kind: 'success' })
      } else toast('Nothing to balance yet. Add some audio first.')
    } catch (err) {
      console.warn(err)
      toast({ title: 'Could not auto-balance', kind: 'error' })
    }
    setBusy(false)
  }

  const reset = () => {
    const t: Record<string, { volume: number; pan: number; mute: boolean; solo: boolean }> = {}
    for (const tr of tracks) t[tr.id] = { volume: 1, pan: 0, mute: false, solo: false }
    glideMix('Reset mix', t, 1)
    setActive(null)
  }

  const focusDown = () => {
    const id = selIds.find((i) => ids.includes(i))
    if (!id) {
      toast('Click a strip name first, then hold Focus.')
      return
    }
    const p = useStore.getState().project
    focusSaved.current = Object.fromEntries(p.tracks.map((t) => [t.id, t.solo]))
    mutate('Focus', (d) => void d.tracks.forEach((t) => (t.solo = t.id === id)), { coalesce: 'mx-focus' })
  }
  const focusUp = () => {
    const saved = focusSaved.current
    if (!saved) return
    focusSaved.current = null
    mutate('Focus', (d) => void d.tracks.forEach((t) => (t.solo = saved[t.id] ?? false)), { coalesce: 'mx-focus' })
  }

  const pickSlot = (s: Slot) => {
    const next = { ...snaps }
    if (active && active !== s) next[active] = captureMix() // keep edits made in the slot we leave
    if (!next[s]) {
      next[s] = captureMix()
      toast(`Saved the current mix as ${s}`)
    } else if (active !== s) {
      recallSnap(`Mix ${s}`, next[s]!)
    }
    setSnaps(next)
    setActive(s)
  }

  if (!tracks.length) return <Empty />

  return (
    <div className="mx-root">
      <div className="mx-toolbar">
        <div className="mx-tb-group">
          <Tooltip label="Measure every track and even out the volumes">
            <Button variant="primary" icon={<Wand2 />} onClick={doAuto} disabled={busy}>
              {busy ? 'Listening…' : 'Auto-balance'}
            </Button>
          </Tooltip>
          <Tooltip label="Put every fader, pan and mute back to normal">
            <Button icon={<RotateCcw />} onClick={reset}>Reset mix</Button>
          </Tooltip>
          <Tooltip label="Hold to hear only the selected strip">
            <Button
              icon={<Crosshair />}
              onPointerDown={focusDown}
              onPointerUp={focusUp}
              onPointerLeave={focusUp}
              onPointerCancel={focusUp}
            >
              Focus
            </Button>
          </Tooltip>
        </div>
        <div className="mx-tb-group mx-ab">
          <span className="mx-ab-label">Compare mixes</span>
          {(['A', 'B'] as Slot[]).map((s) => (
            <Tooltip key={s} label={snaps[s] ? (active === s ? `Mix ${s} (playing)` : `Switch to mix ${s}`) : `Save current mix as ${s}`}>
              <Button className={`mx-ab-btn ${snaps[s] ? 'has' : ''}`} active={active === s} onClick={() => pickSlot(s)}>
                {s}
                {!snaps[s] && <span className="mx-ab-plus">+</span>}
              </Button>
            </Tooltip>
          ))}
          {(snaps.A || snaps.B) && (
            <Tooltip label="Forget A/B mixes">
              <Button variant="ghost" size="sm" className="bk-icon-btn" aria-label="Clear A/B" onClick={() => { setSnaps({ A: null, B: null }); setActive(null) }}>
                <Eraser size={14} />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {hints && (
        <div className="mx-tips">
          <button className="mx-tips-head" onClick={() => setTips(!tips)} aria-expanded={tips}>
            <Lightbulb size={14} />
            <span>Mix tips</span>
            <motion.span animate={{ rotate: tips ? 0 : -90 }} className="mx-tips-chev"><ChevronDown size={14} /></motion.span>
          </button>
          <AnimatePresence initial={false}>
            {tips && (
              <motion.ul
                className="mx-tips-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22 }}
              >
                <li>Start with all faders at <b>0 dB</b>. Turn down what is too loud instead of turning things up.</li>
                <li>Keep the Master peak below <b>0 dB</b>. Red means the sound is clipping.</li>
                <li>Pan instruments left and right to give each one its own space.</li>
                <li>Double-click any fader or knob to reset it.</li>
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="mx-board">
        <div className="mx-scroll">
          <Reorder.Group as="div" axis="x" values={ids} onReorder={onReorder} className="mx-strips">
            {tracks.map((t, i) => (
              <ChannelStrip
                key={t.id}
                track={t}
                index={i}
                selected={selIds.includes(t.id)}
                dimmed={t.mute || (anySolo && !t.solo)}
                onSelect={() => select(t.id)}
                onOpenFx={() => setFx(t.id)}
                onDragStart={() => void dragSeq.current++}
              />
            ))}
          </Reorder.Group>
        </div>
        <MasterStrip onOpenFx={() => setFx('master')} />
      </div>

      <AnimatePresence>
        {fx && (
          <>
            <motion.div className="mx-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFx(null)} />
            <motion.aside
              className="mx-drawer"
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            >
              <div className="mx-drawer-head">
                <h3>
                  <Sparkles size={15} /> Effects · {fx === 'master' ? 'Master' : tracks.find((t) => t.id === fx)?.name ?? 'Track'}
                </h3>
                <Button variant="ghost" size="sm" className="bk-icon-btn" aria-label="Close" onClick={() => setFx(null)}>
                  <X size={16} />
                </Button>
              </div>
              <div className="mx-drawer-body" key={fx}>
                <Rack target={fx} />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function Empty() {
  const setMode = useStore((s) => s.setMode)
  return (
    <div className="mx-empty">
      <motion.svg
        width="220"
        height="140"
        viewBox="0 0 220 140"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <rect x={20 + i * 38} y="20" width="6" height="100" rx="3" fill="var(--surface-3)" />
            <motion.rect
              x={13 + i * 38}
              width="20"
              height="14"
              rx="4"
              fill={['var(--accent)', 'var(--accent-2)', 'var(--accent-3)', 'var(--warn)', 'var(--ok)'][i]}
              initial={{ y: 70 }}
              animate={{ y: [70, 30 + ((i * 37) % 55), 70 - ((i * 23) % 40)] }}
              transition={{ duration: 3 + i * 0.4, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
            />
          </g>
        ))}
      </motion.svg>
      <h2>Your mixing desk is waiting</h2>
      <p>Every track you add gets its own channel strip with volume, pan and effects.</p>
      <div className="mx-empty-btns">
        <Button variant="primary" icon={<Pencil />} onClick={() => setMode('edit')}>Go to Edit</Button>
        <Button icon={<Music />} onClick={() => setMode('create')}>Make music in Create</Button>
        <Button variant="outline" icon={<Sparkles />} onClick={() => runCommand('io.demo')}>Load the demo song</Button>
      </div>
      <Hint>Tip: drop an audio file anywhere in Edit to get started.</Hint>
    </div>
  )
}
