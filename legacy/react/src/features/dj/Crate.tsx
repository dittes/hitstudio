// The crate: demo loops + every audio buffer in the project. Load to A/B
// with the buttons, drag a row onto a deck, or load a file from disk.
import { motion } from 'motion/react'
import { FolderOpen, Music2, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { buffers } from '../../core/buffers'
import { formatTime } from '../../core/ids'
import { Button } from '../../ui/kit'
import { cachedAnalysis } from './analysis'
import { DJ_DRAG_TYPE } from './DeckPanel'
import { crateItems, getDJ, type CrateItem } from './engine'
import { DECK_ACCENT, useDJ, type DeckIndex } from './state'

let version = 0
const subscribe = (fn: () => void) => {
  const un = buffers.subscribe(() => {
    version++
    fn()
  })
  return () => {
    un()
  }
}
const getVersion = () => version

export function Crate() {
  const v = useSyncExternalStore(subscribe, getVersion)
  const items = useMemo(() => crateItems(), [v])
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<DeckIndex>(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const loadedA = useDJ((s) => s.decks[0].itemId)
  const loadedB = useDJ((s) => s.decks[1].itemId)
  // bpm labels fill in as tracks get analysed
  const [, force] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 1500)
    return () => clearInterval(t)
  }, [])

  const shown = items.filter((it) => it.name.toLowerCase().includes(q.trim().toLowerCase()))
  const load = (i: DeckIndex, it: CrateItem) => getDJ().load(i, it)

  return (
    <section className="dj-crate">
      <header className="dj-crate-head">
        <Music2 size={15} />
        <h3>Crate</h3>
        <span className="faint">{items.length} tracks</span>
        <div className="dj-crate-search">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
        </div>
        <div className="dj-crate-spacer" />
        <Button
          size="sm"
          variant="soft"
          icon={<FolderOpen />}
          onClick={() => {
            const free = !loadedA ? 0 : !loadedB ? 1 : target
            setTarget(free as DeckIndex)
            fileRef.current?.click()
          }}
        >
          Load file…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.aif,.aiff,.opus"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) getDJ().loadFile(target, f)
            e.target.value = ''
          }}
        />
      </header>
      <div className="dj-crate-list">
        {shown.map((it, n) => (
          <CrateRow key={it.id} it={it} n={n} onLoad={load} loadedOn={it.id === loadedA ? 0 : it.id === loadedB ? 1 : null} />
        ))}
        {shown.length === 0 && <div className="dj-crate-empty faint">No tracks match “{q}”.</div>}
      </div>
    </section>
  )
}

function CrateRow({ it, n, onLoad, loadedOn }: { it: CrateItem; n: number; onLoad: (i: DeckIndex, it: CrateItem) => void; loadedOn: DeckIndex | null }) {
  const entry = it.id.startsWith('buf:') ? buffers.get(it.id.slice(4)) : undefined
  const a = entry ? cachedAnalysis(entry.buffer) : undefined
  const demoBpm = it.kind === 'demo' ? 124 : undefined
  const bpm = a?.bpm ?? demoBpm
  return (
    <div
      className={`dj-crate-row ${loadedOn !== null ? 'is-loaded' : ''}`}
      style={{ animationDelay: `${Math.min(n, 10) * 20}ms` }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DJ_DRAG_TYPE, it.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDoubleClick={() => onLoad(useDJ.getState().decks[0].itemId ? 1 : 0, it)}
      title="Drag onto a deck, or use the A / B buttons"
    >
      <span className="dj-crate-dot" style={{ background: it.color ?? 'var(--text-3)' }} />
      <span className="dj-crate-name">
        {it.kind === 'demo' && <Sparkles size={12} className="dj-crate-demo" />}
        {it.name}
      </span>
      <span className="dj-crate-kind faint">{it.kind === 'demo' ? 'Demo' : 'Project'}</span>
      <span className="dj-crate-bpm mono">{bpm ? `${bpm.toFixed(bpm % 1 ? 1 : 0)}` : '—'}</span>
      <span className="dj-crate-dur mono faint">{it.duration ? formatTime(it.duration, false) : it.kind === 'demo' ? '1:02' : ''}</span>
      <span className="dj-crate-load">
        {([0, 1] as const).map((i) => (
          <motion.button
            key={i}
            className={`dj-crate-btn ${loadedOn === i ? 'is-on' : ''}`}
            style={{ ['--deck' as string]: DECK_ACCENT[i] }}
            whileTap={{ scale: 0.88 }}
            whileHover={{ y: -1 }}
            onClick={() => onLoad(i, it)}
            title={`Load on deck ${i ? 'B' : 'A'}`}
          >
            {i ? 'B' : 'A'}
          </motion.button>
        ))}
      </span>
    </div>
  )
}
