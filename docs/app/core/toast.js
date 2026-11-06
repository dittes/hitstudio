// Tiny toast bus. toast('Saved!') or toast({ title, body, kind, action })
import { create } from '../lib/state.js'

let n = 0
export const useToasts = create            ((set, get) => ({
  toasts: [],
  push(t) {
    const id = ++n
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.ms ?? 2600)
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((x) => x.id !== id) })
  },
}))
export function toast(t                            ) {
  useToasts.getState().push(typeof t === 'string' ? { title: t } : t)
}
