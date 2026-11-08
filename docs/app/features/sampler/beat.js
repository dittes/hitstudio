// Beat manager: a 16-row step sequencer for the sampler. Each row is a pad, each column a sixteenth note.
// Four patterns (A–D) of one or two bars, tempo, swing and per-row mutes. It plays the pads through the same
// engine as your fingers do, scheduled ahead on the audio clock so it stays tight.
import { create } from '../../lib/state.js'
import { getEngine } from '../../core/engine.js'
import { trigger, stopAllVoices } from './engine.js'

export const STEPS_MAX = 32
export const PATTERNS = ['A', 'B', 'C', 'D']
const LS = 'hitstudio.sampler.beat.v1'

const emptyPattern = () => Array.from({ length: 16 }, () => new Array(STEPS_MAX).fill(0)) // 0 off · 1 normal · 2 accent
const defaults = () => ({ patterns: PATTERNS.map(() => emptyPattern()), active: 0, length: 16, bpm: 96, swing: 0.12, mutes: new Array(16).fill(false), view: 0, playing: false, recording: false })

function load() {
  const base = defaults()
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || 'null')
    if (saved?.patterns?.length === 4) {
      base.patterns = saved.patterns.map((pat) => Array.from({ length: 16 }, (_, r) => Array.from({ length: STEPS_MAX }, (_, c) => Math.max(0, Math.min(2, Number(pat?.[r]?.[c]) || 0)))))
      base.active = Math.max(0, Math.min(3, saved.active | 0))
      base.length = saved.length === 32 ? 32 : 16
      base.bpm = Math.max(50, Math.min(220, Number(saved.bpm) || base.bpm))
      base.swing = Math.max(0, Math.min(0.6, Number(saved.swing) ?? base.swing))
      base.mutes = Array.from({ length: 16 }, (_, i) => !!saved.mutes?.[i])
    }
  } catch { /* start with an empty beat */ }
  return base
}

export const useBeat = create(() => load())
const B = () => useBeat.getState()
const set = (patch) => useBeat.setState(patch)

let saveTimer = 0
function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { patterns, active, length, bpm, swing, mutes } = B()
    try { localStorage.setItem(LS, JSON.stringify({ patterns, active, length, bpm, swing, mutes })) } catch { /* private mode */ }
  }, 250)
}

/** edit helpers: always produce a new array so subscribers see the change */
function editPattern(fn) {
  const patterns = B().patterns.map((p) => p.map((r) => r.slice()))
  fn(patterns[B().active])
  set({ patterns })
  persist()
}
export const getStep = (row, col) => B().patterns[B().active][row][col]
export function setStep(row, col, value) {
  if (B().patterns[B().active][row][col] === value) return
  editPattern((p) => { p[row][col] = value })
}
export const clearPattern = () => editPattern((p) => p.forEach((r) => r.fill(0)))
export function setActive(i) { set({ active: i, view: 0 }); persist() }
export function setLength(n) { set({ length: n === 32 ? 32 : 16, view: 0 }); persist() }
export const setView = (v) => set({ view: v ? 1 : 0 })
export function setBpm(bpm) { set({ bpm: Math.max(50, Math.min(220, Math.round(bpm))) }); persist() }
export function setSwing(v) { set({ swing: Math.max(0, Math.min(0.6, v)) }); persist() }
export function toggleMute(row) { const mutes = B().mutes.slice(); mutes[row] = !mutes[row]; set({ mutes }); persist() }
export const isEmpty = () => B().patterns[B().active].every((r) => r.every((v) => !v))

/** Copy the current pattern into another slot (A→B …) */
export function copyTo(slot) {
  const patterns = B().patterns.map((p) => p.map((r) => r.slice()))
  patterns[slot] = patterns[B().active].map((r) => r.slice())
  set({ patterns })
  persist()
}

// ── ready-made grooves (rows follow the factory kit: 0 kick, 1 snare, 2 clap, 3 rim, 4 hat, 5 open hat, 6 tom, 7 crash, 8 808, 9 bass stab) ──
const X = (str) => [...str.replace(/\s/g, '')].map((c) => (c === 'X' ? 2 : c === 'x' ? 1 : 0))
export const GROOVES = [
  { id: 'boombap', name: 'Boom bap', bpm: 90, swing: 0.2, rows: { 0: 'X..x ..x. ..X. .x..', 1: '.... X... .... X...', 4: 'x.x. x.x. x.x. x.xx', 5: '.... .... .... ..x.' } },
  { id: 'house', name: 'House', bpm: 124, swing: 0.04, rows: { 0: 'X... X... X... X...', 2: '.... X... .... X...', 4: '..x. ..x. ..x. ..x.', 5: '..x. ..x. ..x. ..x.' } },
  { id: 'trap', name: 'Trap', bpm: 140, swing: 0, rows: { 0: 'X... ..x. ...X ....', 1: '.... .... X... ....', 4: 'xxxx xxxx xxxx xxxx', 8: 'X... ..x. ...X ....' } },
  { id: 'lofi', name: 'Lo-fi', bpm: 78, swing: 0.3, rows: { 0: 'X... ..x. .xX. ....', 1: '.... X... .... X..x', 3: '..x. .... ..x. ....', 4: 'x.x. x.x. x.x. x.xx' } },
  { id: 'afro', name: 'Afro', bpm: 102, swing: 0.14, rows: { 0: 'X..x ..x. X..x ..x.', 1: '.... .... x... ..x.', 3: '..x. ..x. ..x. ..x.', 4: 'x.xx x.xx x.xx x.xx', 6: '.... .... .... ..x.' } },
  { id: 'dnb', name: 'Drum & bass', bpm: 172, swing: 0, rows: { 0: 'X... ..x. .... ..x.', 1: '.... X... ...x X...', 4: 'x.x. x.x. x.x. x.x.', 5: '.... ...x .... ....' } },
]
export const loadGroove = (id) => { const g = GROOVES.find((x) => x.id === id); if (g) loadRows(g.rows, g.bpm, g.swing) }
/** Replace the current pattern with rows like { 0: 'X... x...' } (pad index → 16 steps), and set tempo and swing. */
export function loadRows(rows, bpm, swing) {
  editPattern((p) => {
    p.forEach((r) => r.fill(0))
    for (const [row, str] of Object.entries(rows)) { const cells = X(str); for (let c = 0; c < 16; c++) p[Number(row)][c] = cells[c]; if (B().length === 32) for (let c = 0; c < 16; c++) p[Number(row)][16 + c] = cells[c] }
  })
  set({ bpm, swing, mutes: new Array(16).fill(false) })
  persist()
}
export function randomize() {
  editPattern((p) => {
    p.forEach((r) => r.fill(0))
    const len = B().length
    for (let c = 0; c < len; c++) {
      if (c % 4 === 0 && Math.random() < 0.85) p[0][c] = c % 8 === 0 ? 2 : 1
      else if (c % 16 !== 0 && Math.random() < 0.12) p[0][c] = 1
      if (c % 8 === 4) p[1][c] = 2
      if (c % 2 === 0 && Math.random() < 0.8) p[4][c] = 1
      if (Math.random() < 0.07) p[5][c] = 1
      if (Math.random() < 0.05) p[3][c] = 1
      if (c % 8 === 0 && Math.random() < 0.3) p[2][c] = 1
      if (Math.random() < 0.06) p[9][c] = 1
    }
  })
}

// ── transport ────────────────────────────────────────────────
const LOOKAHEAD = 0.14
let timer = 0
let nextT = 0
let counter = 0
const queue = [] // { step, time }
let startedStep = -1

export const stepNow = () => {
  if (!B().playing) return -1
  const ctx = getEngine().ctx
  const t = ctx.currentTime - ((ctx.outputLatency || 0) + (ctx.baseLatency || 0))
  let cur = startedStep
  for (const q of queue) { if (q.time <= t) cur = q.step; else break }
  return cur
}

function pump() {
  const e = getEngine()
  const ctx = e.ctx
  const { bpm, swing, length, mutes } = B()
  const stepDur = 60 / bpm / 4
  const pat = B().patterns[B().active]
  while (nextT < ctx.currentTime + LOOKAHEAD) {
    const step = counter % length
    const when = nextT + (step % 2 === 1 ? swing * stepDur * 0.6 : 0)
    for (let r = 0; r < 16; r++) {
      const v = pat[r][step]
      if (v && !mutes[r]) trigger(r, v === 2 ? 1 : 0.75, { when, hold: stepDur * 0.95 })
    }
    queue.push({ step, time: when })
    while (queue.length > 64) queue.shift()
    nextT += stepDur
    counter++
  }
}

export async function startBeat() {
  if (B().playing) return
  const e = getEngine()
  await e.resume()
  counter = 0
  queue.length = 0
  startedStep = -1
  nextT = e.ctx.currentTime + 0.06
  set({ playing: true })
  pump()
  timer = window.setInterval(pump, 25)
}
export function stopBeat() {
  if (!B().playing) return
  clearInterval(timer)
  queue.length = 0
  set({ playing: false, recording: false })
}

/** Record what you play: while the beat runs, every pad hit lands on the nearest step of the pattern. */
export async function toggleRecord() {
  if (B().recording) { set({ recording: false }); return }
  set({ recording: true })
  if (!B().playing) await startBeat()
}
export function recordHit(row, vel = 0.8) {
  if (!B().recording || !B().playing || !queue.length) return -1
  const ctx = getEngine().ctx
  const t = ctx.currentTime - ((ctx.outputLatency || 0) + (ctx.baseLatency || 0))
  const stepDur = 60 / B().bpm / 4
  let i = 0
  for (let k = 0; k < queue.length; k++) { if (queue[k].time <= t) i = k; else break }
  const cur = queue[i], next = queue[i + 1]
  const span = next ? next.time - cur.time : stepDur
  const step = (t - cur.time) / span > 0.5 ? (cur.step + 1) % B().length : cur.step
  const value = vel > 0.92 ? 2 : 1
  if (getStep(row, step) < value) setStep(row, step, value)
  return step
}
export const toggleBeat = () => (B().playing ? stopBeat() : void startBeat())
export function stopEverything() { stopBeat(); stopAllVoices() }
