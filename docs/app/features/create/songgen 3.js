// Bridges lib/songsmith.js (pure music generation) to audio + the app:
//   • applySetup(setup)            → load a generated setup into Create mode
//   • songToProject(setup, form)   → render a full multi-track song into the timeline
//   • renderSongMix(setup, form)   → one stereo AudioBuffer of the whole song (library demos)
// Rendering reuses the exact Create synth code (synth/mix.js), so what you hear in
// Create is what lands in the song.
import { buffers } from '../../core/buffers.js'
import { makeClip, makeTrack, newProject, useStore } from '../../core/store.js'
import { arrangeSong, demoSetup, DEMO_SETS, kickOnly, liteDrums, totalBars } from '../../lib/songsmith.js'
import { askConfirm } from '../io/state.js'
import { createEdit } from './state.js'
import { configureAll, createBuses, dims, scheduleStep, swingOffset } from './synth/mix.js'

const SR = 44100
const TS = [4, 4]
const COLORS = { drums: '#fb923c', bass: '#4ade80', chords: '#38bdf8', melody: '#a78bfa' }
const NAMES = { drums: 'Drums', bass: 'Bass', chords: 'Chords', melody: 'Melody' }

/** Put a generated setup into the Create editor (and set the project tempo). */
export function applySetup(setup) {
  const s = structuredClone(setup.state)
  createEdit((d) => {
    d.key = s.key
    d.scale = s.scale
    d.octave = s.octave
    d.drums = s.drums
    d.melody = s.melody
    d.chords = s.chords
    d.bass = s.bass
    d.sections = s.sections
    d.space = s.space ?? 1
    d.origin = { title: setup.title, code: setup.code }
  })
  useStore.getState().mutate('Generate song idea', (p) => {
    p.bpm = setup.bpm
  })
}

/** Render one section of a state as a seamless 4-bar loop (tail folded onto the start). */
async function renderLoop(state, sec, bpm) {
  const dm = dims(TS, state.drums.long, bpm)
  const total = dm.loopLen // 4 bars
  const dur = total * dm.stepDur
  const tail = 2.5
  const ctx = new OfflineAudioContext(2, Math.ceil((dur + tail) * SR), SR)
  const buses = createBuses(ctx, ctx.destination, [sec])
  configureAll(buses, ctx, state, bpm, true)
  for (let s = 0; s < total; s++) scheduleStep(ctx, buses, state, dm, s, 0.005 + s * dm.stepDur + swingOffset(s, dm.stepDur, state.drums.swing))
  const rendered = await ctx.startRendering()
  const len = Math.round(dur * SR)
  const out = buffers.create(2, len, SR)
  for (let c = 0; c < 2; c++) {
    const src = rendered.getChannelData(c)
    const dst = new Float32Array(len)
    for (let i = 0; i < src.length; i++) dst[i % len] += src[i]
    out.copyToChannel(dst, c)
  }
  return out
}

const withDrums = (state, grid) => ({ ...state, drums: { ...state.drums, grid } })

/** Render every loop variant the arrangement needs: { 'drums:full': AudioBuffer, … } */
async function renderParts(setup, arrangement) {
  const st = setup.state
  const need = new Set()
  for (const b of arrangement) {
    if (b.parts.drums) need.add(`drums:${b.parts.drums}`)
    for (const k of ['melody', 'chords', 'bass']) if (b.parts[k]) need.add(k)
  }
  const out = {}
  for (const key of need) {
    const [sec, variant] = key.split(':')
    let state = st
    if (variant === 'lite') state = withDrums(st, liteDrums(st.drums.grid))
    if (variant === 'kick') state = withDrums(st, kickOnly(st.drums.grid))
    out[key] = await renderLoop(state, sec, setup.bpm)
    await new Promise((r) => setTimeout(r)) // keep the UI breathing
  }
  return out
}

const partKey = (sec, b) => (sec === 'drums' ? (b.parts.drums ? `drums:${b.parts.drums}` : null) : b.parts[sec] ? sec : null)

/** Render the full song into a brand-new multi-track project (replaces the current song after asking). */
export async function songToProject(setup, form = 'full', { confirm = true } = {}) {
  const st = useStore.getState()
  const p0 = st.project
  if (confirm && (p0.tracks.length || p0.clips.length)) {
    const ok = await askConfirm(`Replace your song with “${setup.title}”?`, 'Your current timeline will be replaced. Save it first (⌘S) if you want to keep it.', 'Make the song')
    if (!ok) return false
  }
  const arrangement = arrangeSong(setup, form)
  const parts = await renderParts(setup, arrangement)
  const barSec = (60 / setup.bpm) * 4
  const proj = newProject(setup.title)
  proj.bpm = setup.bpm
  proj.sampleRate = SR
  proj.markers = arrangement.map((b, i) => ({ id: `mk${i}_${Date.now().toString(36)}`, time: b.startBar * barSec, label: b.name }))
  const ids = {}
  for (const [k, buf] of Object.entries(parts)) ids[k] = buffers.add(buf, `${setup.title} – ${k.replace(':', ' ')}`).id
  for (const sec of ['drums', 'bass', 'chords', 'melody']) {
    if (!arrangement.some((b) => partKey(sec, b))) continue
    const tr = makeTrack(proj, { name: NAMES[sec], color: COLORS[sec], kind: 'instrument', pan: sec === 'chords' ? -0.12 : sec === 'melody' ? 0.12 : 0 })
    proj.tracks.push(tr)
    for (const b of arrangement) {
      const k = partKey(sec, b)
      if (!k) continue
      for (let bar = 0; bar < b.bars; bar += 4) {
        const buf = parts[k]
        const dur = Math.min(buf.duration, (b.bars - bar) * barSec)
        proj.clips.push(makeClip({ trackId: tr.id, bufferId: ids[k], duration: dur, start: (b.startBar + bar) * barSec, name: `${NAMES[sec]} · ${b.name}`, color: COLORS[sec] }))
      }
    }
  }
  proj.loop = { enabled: false, start: 0, end: totalBars(arrangement) * barSec }
  useStore.getState().loadProject(proj)
  return true
}

/** Mix the whole arrangement down to one stereo buffer (used for library demo songs). */
export async function renderSongMix(setup, form = 'full') {
  const arrangement = arrangeSong(setup, form)
  const parts = await renderParts(setup, arrangement)
  const barSec = (60 / setup.bpm) * 4
  const total = Math.ceil(totalBars(arrangement) * barSec * SR)
  const L = new Float32Array(total)
  const R = new Float32Array(total)
  for (const b of arrangement) {
    for (const sec of ['drums', 'bass', 'chords', 'melody']) {
      const k = partKey(sec, b)
      if (!k) continue
      const buf = parts[k]
      const a = buf.getChannelData(0)
      const c = buf.getChannelData(1)
      const pan = sec === 'chords' ? -0.12 : sec === 'melody' ? 0.12 : 0
      const gl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2
      const gr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2
      for (let bar = 0; bar < b.bars; bar += 4) {
        const off = Math.round((b.startBar + bar) * barSec * SR)
        const n = Math.min(buf.length, Math.round((b.bars - bar) * barSec * SR), total - off)
        for (let i = 0; i < n; i++) {
          L[off + i] += a[i] * gl
          R[off + i] += c[i] * gr
        }
      }
    }
  }
  // gentle master: normalise to -1 dBFS with a soft-knee saturator for the peaks, fade the end
  let peak = 0
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  const g = peak > 0 ? 0.89 / Math.min(peak, 1.6) : 1
  const soft = (x) => (Math.abs(x) < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((Math.abs(x) - 0.8) / 0.2)))
  const fade = Math.round(barSec * 2 * SR)
  for (let i = 0; i < total; i++) {
    const f = i > total - fade ? (total - i) / fade : 1
    L[i] = soft(L[i] * g) * f
    R[i] = soft(R[i] * g) * f
  }
  const out = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: SR })
  out.copyToChannel(L, 0)
  out.copyToChannel(R, 1)
  return out
}

// ── generated demo songs for the library / welcome ──────────
const mixCache = new Map()
export const GENERATED_DEMOS = DEMO_SETS.map((d) => ({
  ...d,
  render() {
    if (!mixCache.has(d.id)) mixCache.set(d.id, renderSongMix(demoSetup(d), 'short'))
    return mixCache.get(d.id)
  },
}))
