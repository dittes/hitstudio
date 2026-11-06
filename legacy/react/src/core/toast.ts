// Tiny toast bus. toast('Saved!') or toast({ title, body, kind, action })
import { create } from 'zustand'
export interface Toast {
  id: number
  title: string
  body?: string
  kind?: 'info' | 'success' | 'error' | 'celebrate'
  action?: { label: string; run: () => void }
  ms?: number
}
interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}
let n = 0
export const useToasts = create<ToastState>((set, get) => ({
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
export function toast(t: string | Omit<Toast, 'id'>) {
  useToasts.getState().push(typeof t === 'string' ? { title: t } : t)
}
