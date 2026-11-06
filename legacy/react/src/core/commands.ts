// Command registry: every action that can be triggered by a keyboard shortcut,
// the command palette (⌘K) or a menu. Features register their own commands:
//
//   registerCommand({ id: 'clip.split', label: 'Split at playhead', shortcut: 'S', group: 'Edit', run: () => ... })
//
// Shortcut syntax: 'Mod+Z' (Mod = ⌘ on mac, Ctrl elsewhere), 'Shift+Mod+Z', 'Space', 'Delete', 'S', 'ArrowLeft'.
export interface Command {
  id: string
  label: string
  group?: string
  shortcut?: string | string[]
  /** lucide icon name or emoji, optional */
  icon?: string
  /** return false to disable in the palette */
  enabled?: () => boolean
  run: () => void
  /** extra words for palette search */
  keywords?: string
}

const cmds = new Map<string, Command>()
const subs = new Set<() => void>()

export function registerCommand(c: Command) {
  cmds.set(c.id, c)
  subs.forEach((s) => s())
}
export function registerCommands(list: Command[]) {
  list.forEach(registerCommand)
}
export function runCommand(id: string) {
  const c = cmds.get(id)
  if (c && (c.enabled?.() ?? true)) c.run()
}
export function allCommands() {
  return [...cmds.values()]
}
export function subscribeCommands(fn: () => void) {
  subs.add(fn)
  return () => subs.delete(fn)
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function prettyShortcut(s: string) {
  return s
    .replace('Mod', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace(/\+/g, isMac ? '' : '+')
}

function eventToShortcut(e: KeyboardEvent) {
  const parts: string[] = []
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod')
  let k = e.key
  if (k === ' ') k = 'Space'
  else if (k.length === 1) k = k.toUpperCase()
  if (e.code.startsWith('Digit')) k = e.code.slice(5)
  if (e.code.startsWith('Key')) k = e.code.slice(3)
  if (k === 'Backspace') k = 'Delete'
  parts.push(k)
  return parts.join('+')
}

export function installKeyboard() {
  const handler = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
      if (e.key !== 'Escape') return
    }
    const sc = eventToShortcut(e)
    for (const c of cmds.values()) {
      const list = Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : []
      if (list.includes(sc) && (c.enabled?.() ?? true)) {
        e.preventDefault()
        c.run()
        return
      }
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}
