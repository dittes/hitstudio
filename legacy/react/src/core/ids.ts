let n = 0
export function uid(prefix = 'id'): string {
  n = (n + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}${n.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export const TRACK_COLORS = [
  '#a78bfa', // violet
  '#f472b6', // pink
  '#fb923c', // orange
  '#facc15', // yellow
  '#4ade80', // green
  '#2dd4bf', // teal
  '#38bdf8', // sky
  '#818cf8', // indigo
]

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const dbToGain = (db: number) => Math.pow(10, db / 20)
export const gainToDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g))

export function formatTime(sec: number, withMs = true): string {
  if (!isFinite(sec)) sec = 0
  const neg = sec < 0
  sec = Math.abs(sec)
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 1000)
  const base = `${neg ? '-' : ''}${m}:${s.toString().padStart(2, '0')}`
  return withMs ? `${base}.${ms.toString().padStart(3, '0')}` : base
}
