// Tiny UI state for io dialogs (which one is open) + a promise-based confirm dialog.
import { create } from 'zustand'

export interface ConfirmReq {
  title: string
  body: string
  confirmLabel?: string
  resolve: (ok: boolean) => void
}

export interface ExportPreset {
  format?: 'wav' | 'mp3' | 'flac' | 'aiff' | 'opus'
  target?: 'song' | 'selection' | 'loop' | 'stems'
  kbps?: number
}

interface IOState {
  exportOpen: boolean
  exportPreset: ExportPreset | null
  welcomeOpen: boolean
  shortcutsOpen: boolean
  recSetupOpen: boolean
  confirm: ConfirmReq | null
  set: (p: Partial<IOState>) => void
}

export const useIO = create<IOState>((set) => ({
  exportOpen: false,
  exportPreset: null,
  welcomeOpen: false,
  shortcutsOpen: false,
  recSetupOpen: false,
  confirm: null,
  set: (p) => set(p),
}))

export const ioSet = (p: Partial<IOState>) => useIO.getState().set(p)

export function askConfirm(title: string, body: string, confirmLabel = 'Continue'): Promise<boolean> {
  return new Promise((resolve) => ioSet({ confirm: { title, body, confirmLabel, resolve } }))
}

/** Open the file picker. Resolves [] if the user cancels. Must be called from a user gesture. */
export function pickFiles(opts: { multiple?: boolean; accept?: string } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = opts.multiple ?? true
    input.accept = opts.accept ?? 'audio/*,video/*,.mp3,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac,.aif,.aiff,.webm,.mp4,.mov,.mkv'
    input.style.display = 'none'
    input.onchange = () => {
      resolve(Array.from(input.files ?? []))
      input.remove()
    }
    input.addEventListener('cancel', () => {
      resolve([])
      input.remove()
    })
    document.body.appendChild(input)
    input.click()
  })
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const safeName = (s: string) => (s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'HitStudio song').slice(0, 120)
