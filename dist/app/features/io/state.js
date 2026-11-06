// Tiny UI state for io dialogs (which one is open) + a promise-based confirm dialog.
import { create } from '../../lib/state.js'

export const useIO = create         ((set) => ({
  exportOpen: false,
  exportPreset: null,
  welcomeOpen: false,
  shortcutsOpen: false,
  recSetupOpen: false,
  confirm: null,
  set: (p) => set(p),
}))

export const ioSet = (p                  ) => useIO.getState().set(p)

export function askConfirm(title        , body        , confirmLabel = 'Continue')                   {
  return new Promise((resolve) => ioSet({ confirm: { title, body, confirmLabel, resolve } }))
}

/** Open the file picker. Resolves [] if the user cancels. Must be called from a user gesture. */
export function pickFiles(opts                                          = {})                  {
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

export function download(blob      , filename        ) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const safeName = (s        ) => (s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'HitStudio song').slice(0, 120)
