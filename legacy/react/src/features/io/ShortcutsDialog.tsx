import { Keyboard, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { allCommands, prettyShortcut } from '../../core/commands'
import { Modal } from '../../ui/kit'
import { ioSet, useIO } from './state'

export function ShortcutsDialog() {
  const open = useIO((s) => s.shortcutsOpen)
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    if (!open) return []
    const map = new Map<string, { label: string; keys: string[] }[]>()
    for (const c of allCommands()) {
      const keys = Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : []
      if (!keys.length) continue
      if (q && !`${c.label} ${c.group ?? ''}`.toLowerCase().includes(q.toLowerCase())) continue
      const g = c.group ?? 'Other'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push({ label: c.label, keys })
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [open, q])
  return (
    <Modal open={open} onClose={() => ioSet({ shortcutsOpen: false })} width={720} title={<span className="io-title-row"><Keyboard size={18} /> Keyboard shortcuts</span>}>
      <label className="io-search">
        <Search size={14} />
        <input autoFocus placeholder="Find a shortcut…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="io-keys">
        {groups.map(([g, items]) => (
          <div key={g} className="io-keys-group">
            <h4>{g}</h4>
            {items.map((it) => (
              <div key={it.label} className="io-key-row">
                <span>{it.label}</span>
                <span className="io-key-combos">
                  {it.keys.map((k) => (
                    <kbd key={k} className="bk-kbd">
                      {prettyShortcut(k)}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
        {!groups.length && <p className="io-muted">No shortcuts match “{q}”.</p>}
      </div>
    </Modal>
  )
}
