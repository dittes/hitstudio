// Fader law: linear gain 0..2 <-> fader position 0..1, piecewise-linear in dB.
import { dbToGain, gainToDb } from '../../core/ids.js'

export const MAX_DB = 20 * Math.log10(2) // gain 2 = +6.02 dB
// [dB, position]
const STOPS                     = [
  [-90, 0],
  [-60, 0.04],
  [-48, 0.1],
  [-24, 0.27],
  [-12, 0.46],
  [-6, 0.62],
  [0, 0.8],
  [MAX_DB, 1],
]

export const FADER_TICKS                                  = [
  { db: 6, label: '+6' },
  { db: 0, label: '0' },
  { db: -6, label: '-6' },
  { db: -12, label: '-12' },
  { db: -24, label: '-24' },
  { db: -48, label: '-48' },
  { db: -Infinity, label: '-∞' },
]

export function dbToPos(db        )         {
  if (db <= -90) return 0
  if (db >= MAX_DB) return 1
  for (let i = 1; i < STOPS.length; i++) {
    const [d1, p1] = STOPS[i]
    if (db <= d1) {
      const [d0, p0] = STOPS[i - 1]
      return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0)
    }
  }
  return 1
}

export function posToDb(pos        )         {
  if (pos <= 0) return -Infinity
  if (pos >= 1) return MAX_DB
  for (let i = 1; i < STOPS.length; i++) {
    const [d1, p1] = STOPS[i]
    if (pos <= p1) {
      const [d0, p0] = STOPS[i - 1]
      return d0 + ((pos - p0) / (p1 - p0)) * (d1 - d0)
    }
  }
  return MAX_DB
}

export const gainToPos = (g        ) => (g <= 0 ? 0 : dbToPos(gainToDb(g)))
export function posToGain(pos        )         {
  const db = posToDb(pos)
  return db === -Infinity ? 0 : Math.min(2, dbToGain(db))
}

export function fmtDb(g        , digits = 1)         {
  if (g <= 0.00005) return '-∞'
  const db = gainToDb(g)
  if (db < -90) return '-∞'
  return `${db > 0.049 ? '+' : ''}${db.toFixed(digits)}`
}

export function parseDb(s        )                {
  const t = s.trim().toLowerCase().replace('−', '-').replace('db', '').trim()
  if (/^[-+]?(inf|∞)/.test(t)) return t.startsWith('+') ? null : 0
  const n = parseFloat(t)
  if (!isFinite(n)) return null
  return Math.min(2, dbToGain(n))
}

export function dbOfLinear(x        )         {
  return x <= 1e-9 ? -Infinity : 20 * Math.log10(x)
}
