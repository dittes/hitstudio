// Destructive "processes" that rewrite the audio of the current selection.
//
// Selection semantics
//   • selection.range + selection.trackIds → every clip on those tracks that
//     intersects the range is split at the range edges and only the middle piece
//     is processed (left/right pieces keep the original audio).
//   • else selection.clipIds → whole clips (their played portion).
//   • else → toast "Select a clip first".
// Each run builds new AudioBuffers (buffers are immutable), registers them and
// then commits everything in ONE mutate() so a single ⌘Z undoes the process.
import { create } from '../../lib/state.js'
import { buffers, sliceBuffer } from '../../core/buffers.js'
import { registerCommands } from '../../core/commands.js'
import { getEffect } from '../../core/effects/registry.js'
import { uid } from '../../core/ids.js'
import { useStore } from '../../core/store.js'
import { toast } from '../../core/toast.js'

import { audioLength, fromBuffer, peakOf, toBuffer, db,            } from './dsp/audio.js'
import { amplify, fade, FADE_SHAPES, invert, limitPeaks, normalize, removeClicks, reverse, toMono, truncateSilence } from './dsp/basic.js'
import { integratedLoudness } from './dsp/loudness.js'
import { learnNoise, reduceNoise,                   } from './dsp/noise.js'
import { paulstretch, pitchShift, resample, wsola } from './dsp/stretch.js'

import { mountProcessDialogs } from './ProcessDialogs.js'

// ── definitions ───────────────────────────────────────────────

let learnedNoise                      = null
export const noiseState = create                                          (() => ({ learned: false, learnedSec: 0 }))

export const PROCESSES               = [
  {
    id: 'normalize',
    label: 'Normalize',
    verb: 'Normalized',
    icon: 'normalize',
    description: 'Turns the volume up (or down) so the loudest moment hits exactly the level you choose.',
    params: [
      { key: 'target', label: 'Peak level', min: -12, max: 0, default: -1, step: 0.1, unit: 'dB', hint: 'Loudest point after normalizing. -1 dB leaves a little safety room.' },
      { key: 'dc', label: 'Remove DC offset', min: 0, max: 1, default: 1, step: 1, toggle: true, hint: 'Re-centres the waveform (fixes a lop-sided recording)' },
      { key: 'independent', label: 'Left & right separately', min: 0, max: 1, default: 0, step: 1, toggle: true, hint: 'Balances a recording where one side is quieter' },
    ],
    presets: { 'Loud (-1 dB)': { target: -1 }, 'Safe (-3 dB)': { target: -3 }, 'Quiet (-6 dB)': { target: -6 } },
    run: (a, p) => normalize(a, p.target, p.dc >= 0.5, p.independent >= 0.5),
  },
  {
    id: 'amplify',
    label: 'Amplify',
    verb: 'Amplified',
    icon: 'amplify',
    description: 'Make it louder or quieter by a fixed amount.',
    params: [
      { key: 'gain', label: 'Change', min: -24, max: 24, default: 3, step: 0.1, unit: 'dB', hint: '+6 dB ≈ twice as loud in level, -6 dB ≈ half' },
      { key: 'clip', label: 'Allow clipping', min: 0, max: 1, default: 0, step: 1, toggle: true, hint: 'Off = never boost past the point where it distorts' },
    ],
    presets: { 'A bit louder': { gain: 3 }, 'Much louder': { gain: 9 }, 'A bit quieter': { gain: -3 }, 'Half volume': { gain: -6 } },
    run: (a, p, ctx) => {
      let g = p.gain
      if (p.clip < 0.5) {
        const room = -db(peakOf(a))
        if (g > room) {
          g = room
          ctx.note(`Limited to +${room.toFixed(1)} dB so it won't distort`)
        }
      }
      return amplify(a, g)
    },
  },
  {
    id: 'reverse',
    label: 'Reverse',
    verb: 'Reversed',
    icon: 'reverse',
    description: 'Plays the sound backwards – great for spooky swells and transitions.',
    run: (a) => reverse(a),
  },
  {
    id: 'fadeIn',
    label: 'Fade in',
    verb: 'Faded in',
    icon: 'fadeIn',
    description: 'Smoothly rises from silence. With a time range selected, the whole range becomes the fade.',
    params: [
      { key: 'shape', label: 'Curve', min: 0, max: 3, default: 1, step: 1, options: FADE_SHAPES },
      { key: 'length', label: 'Length', min: 0.1, max: 30, default: 3, step: 0.1, unit: 's', hideWhenRange: true, hint: 'How long the fade takes' },
    ],
    run: (a, p, ctx) => fade(a, 'in', p.shape, ctx.hasRange ? 0 : p.length),
  },
  {
    id: 'fadeOut',
    label: 'Fade out',
    verb: 'Faded out',
    icon: 'fadeOut',
    description: 'Smoothly sinks into silence. With a time range selected, the whole range becomes the fade.',
    params: [
      { key: 'shape', label: 'Curve', min: 0, max: 3, default: 1, step: 1, options: FADE_SHAPES },
      { key: 'length', label: 'Length', min: 0.1, max: 30, default: 3, step: 0.1, unit: 's', hideWhenRange: true, hint: 'How long the fade takes' },
    ],
    run: (a, p, ctx) => fade(a, 'out', p.shape, ctx.hasRange ? 0 : p.length),
  },
  {
    id: 'noiseReduce',
    label: 'Remove noise',
    verb: 'Cleaned',
    icon: 'noise',
    heavy: true,
    description: 'Removes steady background noise like hiss, hum, fans or air-con. It learns what the noise sounds like from the quietest moments.',
    params: [
      { key: 'reduction', label: 'Noise reduction', min: 0, max: 40, default: 12, step: 0.5, unit: 'dB', hint: 'How much quieter the noise gets. Too much can sound watery.' },
      { key: 'sensitivity', label: 'Sensitivity', min: 0, max: 24, default: 6, step: 0.5, unit: 'dB', hint: 'Higher removes more, but may eat quiet details' },
      { key: 'smoothing', label: 'Smoothing', min: 0, max: 12, default: 3, step: 1, hint: 'Avoids chirpy "musical noise" artefacts' },
      { key: 'useLearned', label: 'Use my noise sample', min: 0, max: 1, default: 0, step: 1, toggle: true, hint: 'Use the noise you captured with "Learn noise"' },
    ],
    presets: {
      Gentle: { reduction: 8, sensitivity: 4, smoothing: 3 },
      Standard: { reduction: 12, sensitivity: 6, smoothing: 3 },
      Strong: { reduction: 22, sensitivity: 9, smoothing: 5 },
    },
    prepare: (a, p) => (p.useLearned >= 0.5 && learnedNoise ? learnedNoise : learnNoise(a)),
    run: async (a, p, ctx) => {
      const prof = (ctx.prep                            ) ?? (p.useLearned >= 0.5 && learnedNoise ? learnedNoise : learnNoise(a))
      return reduceNoise(a, prof, { reductionDb: p.reduction, sensitivity: p.sensitivity, smoothing: p.smoothing }, ctx.progress)
    },
  },
  {
    id: 'silenceTrim',
    label: 'Shorten silences',
    verb: 'Tightened',
    icon: 'silence',
    description: 'Finds long pauses and shortens them – perfect for tightening up podcasts and voice-overs.',
    params: [
      { key: 'threshold', label: 'Silence is below', min: -80, max: -20, default: -45, step: 0.5, unit: 'dB', hint: 'Anything quieter than this counts as silence' },
      { key: 'min', label: 'Longer than', min: 0.05, max: 5, default: 0.5, step: 0.05, unit: 's', hint: 'Only pauses at least this long are touched' },
      { key: 'keep', label: 'Shorten to', min: 0, max: 2, default: 0.3, step: 0.05, unit: 's', hint: 'How much pause to keep' },
    ],
    presets: { 'Podcast tidy': { threshold: -45, min: 0.6, keep: 0.35 }, 'Tight & snappy': { threshold: -40, min: 0.3, keep: 0.15 }, 'Remove all gaps': { threshold: -50, min: 0.15, keep: 0.02 } },
    run: (a, p, ctx) => {
      const r = truncateSilence(a, p.threshold, p.min, p.keep)
      ctx.note(r.removed > 0 ? `Removed ${r.removed.toFixed(1)} s of silence` : 'No long silences found')
      return r.audio
    },
  },
  {
    id: 'speed',
    label: 'Change speed',
    verb: 'Speed changed',
    icon: 'speed',
    heavy: true,
    description: 'Like a record player: faster = higher pitch and shorter, slower = deeper and longer.',
    params: [{ key: 'speed', label: 'Speed', min: 25, max: 400, default: 100, step: 1, unit: '%', curve: 'log', hint: '100% = unchanged' }],
    presets: { 'Nightcore (+25%)': { speed: 125 }, 'Slowed (-15%)': { speed: 85 }, 'Half speed': { speed: 50 }, 'Double speed': { speed: 200 } },
    run: (a, p, ctx) => resample(a, p.speed / 100, ctx.progress),
  },
  {
    id: 'tempo',
    label: 'Change tempo',
    verb: 'Tempo changed',
    icon: 'tempo',
    heavy: true,
    description: 'Faster or slower WITHOUT changing the pitch – practise a song slowly or fit a voice-over.',
    params: [{ key: 'tempo', label: 'Tempo', min: 50, max: 200, default: 100, step: 1, unit: '%', curve: 'log', hint: '100% = unchanged' }],
    presets: { 'Practice (75%)': { tempo: 75 }, 'A bit faster': { tempo: 110 }, 'A bit slower': { tempo: 90 } },
    run: (a, p, ctx) => (Math.abs(p.tempo - 100) < 0.01 ? a : wsola(a, 100 / p.tempo, ctx.progress)),
  },
  {
    id: 'pitch',
    label: 'Change pitch',
    verb: 'Pitch shifted',
    icon: 'pitch',
    heavy: true,
    description: 'Higher or lower pitch while keeping the same length and tempo.',
    params: [
      { key: 'semitones', label: 'Semitones', min: -12, max: 12, default: 0, step: 1, hint: '12 semitones = one octave' },
      { key: 'cents', label: 'Fine tune', min: -100, max: 100, default: 0, step: 1, unit: 'ct', hint: 'Tiny adjustments (100 cents = 1 semitone)' },
    ],
    presets: { 'Octave up': { semitones: 12, cents: 0 }, 'Octave down': { semitones: -12, cents: 0 }, 'Chipmunk': { semitones: 7, cents: 0 }, 'Deep voice': { semitones: -5, cents: 0 } },
    run: (a, p, ctx) => pitchShift(a, p.semitones + p.cents / 100, ctx.progress),
  },
  {
    id: 'removeClicks',
    label: 'Remove clicks',
    verb: 'De-clicked',
    icon: 'clicks',
    description: 'Finds tiny clicks and pops (like vinyl crackle or mouth clicks) and smooths them away.',
    params: [
      { key: 'sensitivity', label: 'Sensitivity', min: 0, max: 100, default: 60, step: 1, unit: '%', hint: 'Higher finds quieter clicks' },
      { key: 'width', label: 'Max click length', min: 0.5, max: 20, default: 4, step: 0.5, unit: 'ms' },
    ],
    run: (a, p, ctx) => {
      const r = removeClicks(a, p.sensitivity, p.width)
      ctx.note(r.count ? `Fixed ${r.count} click${r.count === 1 ? '' : 's'}` : 'No clicks found')
      return r.audio
    },
  },
  {
    id: 'loudness',
    label: 'Loudness match',
    verb: 'Loudness matched',
    icon: 'loudness',
    description: 'Sets how loud it FEELS (in LUFS), the way Spotify, YouTube and podcast apps measure it.',
    params: [
      { key: 'target', label: 'Target', min: -30, max: -6, default: -14, step: 0.5, unit: 'LUFS', hint: 'Streaming services play everything at about -14 LUFS' },
      { key: 'ceiling', label: 'Peak ceiling', min: -6, max: 0, default: -1, step: 0.1, unit: 'dB', hint: 'Peaks are gently limited below this' },
    ],
    presets: { 'Spotify -14 LUFS': { target: -14 }, 'YouTube -14 LUFS': { target: -14 }, 'Podcast -16 LUFS': { target: -16 }, 'Apple -16 LUFS': { target: -16 }, 'Broadcast -23 LUFS': { target: -23 } },
    run: (a, p, ctx) => {
      const L = integratedLoudness(a)
      if (!isFinite(L)) {
        ctx.note('Too quiet to measure')
        return a
      }
      let out = amplify(a, p.target - L)
      if (peakOf(out) > Math.pow(10, p.ceiling / 20)) out = limitPeaks(out, p.ceiling)
      ctx.note(`Was ${L.toFixed(1)} LUFS → now ${p.target.toFixed(1)} LUFS`)
      return out
    },
  },
  { id: 'invert', label: 'Invert', verb: 'Inverted', icon: 'invert', description: 'Flips the waveform upside down (fixes phase problems between two mics).', run: (a) => invert(a) },
  { id: 'mono', label: 'Make mono', verb: 'Made mono', icon: 'mono', description: 'Combines left and right into one centred channel.', run: (a) => toMono(a) },
  {
    id: 'paulstretch',
    label: 'Ambient stretch',
    verb: 'Stretched',
    icon: 'paulstretch',
    heavy: true,
    description: 'Paulstretch: stretches sound 2–50× into a dreamy, floating ambient pad. Magic on vocals and chords.',
    params: [
      { key: 'stretch', label: 'Stretch', min: 2, max: 50, default: 8, step: 0.5, unit: '×', curve: 'log', hint: 'How many times longer the result is' },
      { key: 'window', label: 'Smear', min: 0.05, max: 2, default: 0.25, step: 0.01, unit: 's', curve: 'log', hint: 'Bigger = smoother & blurrier, smaller = more detail' },
    ],
    presets: { 'Dreamy (8×)': { stretch: 8, window: 0.25 }, 'Glacier (30×)': { stretch: 30, window: 0.5 }, 'Shimmer (3×)': { stretch: 3, window: 0.12 } },
    run: (a, p, ctx) => paulstretch(a, p.stretch, p.window, ctx.progress),
  },
  {
    id: 'applyEffect',
    label: 'Apply effect to clip',
    verb: 'Effect applied',
    icon: 'applyEffect',
    custom: true,
    heavy: true,
    description: 'Permanently "print" any effect into the audio of the selected clip.',
    run: (a, _p, ctx) => renderEffect(a, String(ctx.extra?.type ?? ''), (ctx.extra?.params                          ) ?? {}, ctx.canGrow),
  },
]

export const getProcess = (id        ) => PROCESSES.find((p) => p.id === id)

// ── apply an insert effect offline ────────────────────────────
const STEREO_FX = new Set(['reverb', 'echo', 'width', 'chorus', 'flanger', 'tremolo', 'phaser'])

function tailFor(type        , p                        , sr        ) {
  if (type === 'reverb') return Math.min(12, (p.decay ?? 2) * 1.1 + (p.predelay ?? 0) / 1000 + 0.1)
  if (type === 'echo') {
    const fb = Math.max(0.01, Math.min(0.95, (p.feedback ?? 40) / 100))
    const t = (p.sync ?? 0) >= 0.5 ? 0.5 : (p.time ?? 350) / 1000
    return Math.min(10, t * (Math.log(0.001) / Math.log(fb) + 1))
  }
  if (['chorus', 'flanger', 'phaser'].includes(type)) return 0.1
  return 64 / sr
}

export async function renderEffect(a       , type        , params                        , allowTail         )                 {
  const def = getEffect(type)
  if (!def) return a
  const n = audioLength(a)
  const tail = allowTail ? Math.round(tailFor(type, params, a.sr) * a.sr) : 0
  const chans = STEREO_FX.has(type) ? Math.max(2, a.ch.length) : a.ch.length
  const off = new OfflineAudioContext(chans, Math.max(1, n + tail), a.sr)
  const src = off.createBufferSource()
  src.buffer = toBuffer(a)
  const node = def.create(off, { ...Object.fromEntries(def.params.map((x) => [x.key, x.default])), ...params })
  src.connect(node.input)
  node.output.connect(off.destination)
  src.start(0)
  const res = await off.startRendering()
  node.dispose()
  const out = fromBuffer(res)
  if (tail > 0) {
    // trim the silent end of the tail
    let end = audioLength(out)
    const thr = 0.0003
    outer: while (end > n) {
      for (const d of out.ch) if (Math.abs(d[end - 1]) > thr) break outer
      end--
    }
    const fadeN = Math.min(256, end - n)
    out.ch = out.ch.map((d) => {
      const r = d.slice(0, end)
      for (let i = 0; i < fadeN; i++) r[end - 1 - i] *= i / fadeN
      return r
    })
  }
  return out
}

// ── selection → targets ───────────────────────────────────────

const EPS = 0.002

export function collectTargets()           {
  const { project, selection } = useStore.getState()
  const out           = []
  const mk = (c      , r0               , r1               )                => {
    const rate = c.rate || 1
    const cs = c.start
    const ce = c.start + c.duration / rate
    const t0 = r0 === null ? cs : Math.max(cs, r0)
    const t1 = r1 === null ? ce : Math.min(ce, r1)
    if (t1 - t0 < 0.01) return null
    return {
      clipId: c.id,
      t0,
      t1,
      b0: c.offset + (t0 - cs) * rate,
      b1: c.offset + (t1 - cs) * rate,
      splitLeft: t0 > cs + EPS,
      splitRight: t1 < ce - EPS,
      snap: { bufferId: c.bufferId, offset: c.offset, duration: c.duration, start: c.start, rate: c.rate },
    }
  }
  const range = selection.range && selection.range.end - selection.range.start > 0.01 ? selection.range : null
  if (range && selection.trackIds.length) {
    for (const c of project.clips) {
      if (!selection.trackIds.includes(c.trackId)) continue
      const t = mk(c, range.start, range.end)
      if (t) out.push(t)
    }
    if (out.length) return out
  }
  for (const id of selection.clipIds) {
    const c = project.clips.find((x) => x.id === id)
    if (!c) continue
    const t = range ? mk(c, range.start, range.end) ?? mk(c, null, null) : mk(c, null, null)
    if (t) out.push(t)
  }
  return out
}

export function selectionHasRange() {
  const t = collectTargets()
  return t.some((x) => x.splitLeft || x.splitRight) || !!useStore.getState().selection.range
}

function targetAudio(t        , maxSec = Infinity)               {
  const entry = buffers.get(t.snap.bufferId)
  if (!entry) return null
  return fromBuffer(sliceBuffer(entry.buffer, t.b0, Math.min(t.b1, t.b0 + maxSec)))
}

/** Peak (dBFS) over everything that would be processed – for the Amplify dialog. */
export function selectionPeakDb()         {
  let pk = 0
  for (const t of collectTargets()) {
    const a = targetAudio(t)
    if (a) pk = Math.max(pk, peakOf(a))
  }
  return db(pk)
}

/** Integrated loudness of the first target – shown in the loudness dialog. */
export function selectionLoudness()         {
  const t = collectTargets()[0]
  const a = t && targetAudio(t)
  return a ? integratedLoudness(a) : -Infinity
}

/** Learn a noise profile from the current selection (the "noise only" part). */
export function learnNoiseFromSelection()          {
  const t = collectTargets()[0]
  const a = t && targetAudio(t)
  if (!a) {
    toast({ title: 'Select a bit of pure noise first', body: 'Drag over a moment where nobody talks or plays.', kind: 'info' })
    return false
  }
  learnedNoise = learnNoise(a, true)
  noiseState.setState({ learned: true, learnedSec: audioLength(a) / a.sr })
  toast({ title: 'Noise sample learned', body: `${(audioLength(a) / a.sr).toFixed(1)} s of noise captured. Now select the whole clip and remove noise.`, kind: 'success' })
  return true
}

// ── job progress (shown by ProcessDialogs' progress pill) ─────
export const useJob = create                                            (() => ({ label: null, progress: 0 }))

let busy = false

function baseName(n        ) {
  return n.replace(/ · .*$/, '')
}

/** Run a process on the selection and commit it as one undo step. */
export async function runProcess(id        , params                         = {}, extra                          )                   {
  const def = getProcess(id)
  if (!def) return false
  if (busy) {
    toast('Hang on – still working on the last one…')
    return false
  }
  const targets = collectTargets()
  if (!targets.length) {
    toast({ title: 'Select a clip first', body: 'Click a clip, or drag across the timeline to pick a time range.', kind: 'info' })
    return false
  }
  const full                         = {}
  def.params?.forEach((p) => (full[p.key] = params[p.key] ?? p.default))
  ensureMounted()
  busy = true
  const notes           = []
  const results                                                                      = []
  useJob.setState({ label: `${def.label}…`, progress: 0 })
  try {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      const a = targetAudio(t)
      if (!a) continue
      const progress           = (f) => useJob.setState({ progress: (i + Math.min(1, Math.max(0, f))) / targets.length })
      const ctx         = {
        progress,
        canGrow: !t.splitRight,
        hasRange: t.splitLeft || t.splitRight || !!useStore.getState().selection.range,
        extra,
        note: (m) => notes.includes(m) || notes.push(m),
      }
      if (def.prepare) ctx.prep = await def.prepare(a, full)
      await new Promise((r) => setTimeout(r, 0))
      const out = await def.run(a, full, ctx)
      progress(1)
      const entry = buffers.get(t.snap.bufferId)
      const nb = buffers.add(toBuffer(out), `${baseName(entry.name)} · ${def.verb}`)
      results.push({ t, bufferId: nb.id, lenSec: audioLength(out) / out.sr, channels: out.ch.length })
    }
  } catch (e) {
    console.error(e)
    toast({ title: `${def.label} failed`, body: String((e         )?.message ?? e), kind: 'error' })
    busy = false
    useJob.setState({ label: null, progress: 0 })
    return false
  }
  busy = false
  useJob.setState({ label: null, progress: 0 })
  if (!results.length) return false

  const middleIds           = []
  let skipped = 0
  useStore.getState().mutate(def.verb === 'Effect applied' ? `Apply ${getEffect(String(extra?.type))?.name ?? 'effect'}` : def.label, (p) => {
    for (const { t, bufferId, lenSec } of results) {
      const c = p.clips.find((x) => x.id === t.clipId)
      if (!c || c.bufferId !== t.snap.bufferId || c.offset !== t.snap.offset || c.duration !== t.snap.duration || c.start !== t.snap.start) {
        skipped++
        continue
      }
      const rate = c.rate || 1
      const orig = { ...c }
      const oldLen = t.b1 - t.b0
      const deltaTl = (lenSec - oldLen) / rate
      if (t.splitLeft) {
        p.clips.push({ ...orig, id: uid('clp'), duration: (t.t0 - orig.start) * rate, fadeOut: 0 })
      }
      if (t.splitRight) {
        const rStartBuf = t.b1
        p.clips.push({
          ...orig,
          id: uid('clp'),
          start: t.t1 + deltaTl,
          offset: rStartBuf,
          duration: orig.offset + orig.duration - rStartBuf,
          fadeIn: 0,
        })
      }
      c.start = t.t0
      c.bufferId = bufferId
      c.offset = 0
      c.duration = lenSec
      const tlDur = lenSec / rate
      c.fadeIn = t.splitLeft ? 0 : Math.min(c.fadeIn, tlDur / 2)
      c.fadeOut = t.splitRight ? 0 : Math.min(c.fadeOut, tlDur / 2)
      middleIds.push(c.id)
    }
  })
  if (middleIds.length) useStore.getState().select({ clipIds: middleIds })
  if (skipped && !middleIds.length) {
    toast({ title: 'The clip changed while processing', body: 'Nothing was applied – try again.', kind: 'error' })
    return false
  }
  toast({
    title: `${def.verb}!`,
    body: [notes.join(' · '), `${middleIds.length} clip${middleIds.length === 1 ? '' : 's'} · ⌘Z to undo`].filter(Boolean).join(' — '),
    kind: 'success',
  })
  return true
}

/** Process a short excerpt of the selection for previewing. */
export async function renderPreview(id        , params                        , extra                          , maxSec = 12)                              {
  const def = getProcess(id)
  const t = collectTargets()[0]
  if (!def || !t) return null
  const a = targetAudio(t, maxSec)
  if (!a) return null
  const full                         = {}
  def.params?.forEach((p) => (full[p.key] = params[p.key] ?? p.default))
  const ctx         = {
    progress: () => {},
    canGrow: true,
    hasRange: t.splitLeft || t.splitRight || !!useStore.getState().selection.range,
    extra,
    note: () => {},
  }
  if (def.prepare) {
    const whole = id === 'noiseReduce' ? targetAudio(t, 120) : a
    ctx.prep = await def.prepare(whole ?? a, full)
  }
  let out = await def.run(a, full, ctx)
  // keep previews short even for paulstretch
  if (audioLength(out) > out.sr * 30) out = { sr: out.sr, ch: out.ch.map((d) => d.slice(0, out.sr * 30)) }
  return toBuffer(out)
}

// ── dialog state + commands ───────────────────────────────────
export const useProcDialog = create                                                          (() => ({ open: null }))

// The dialogs mount themselves into document.body on first use (see ProcessDialogs.tsx).
// Imported lazily-at-call-time; the circular import is safe because it's only used inside functions.
const ensureMounted = () => mountProcessDialogs()

export function openProcess(id        , extra                          ) {
  const def = getProcess(id)
  if (!def) return
  if (!collectTargets().length) {
    toast({ title: 'Select a clip first', body: 'Click a clip, or drag across the timeline to pick a time range.', kind: 'info' })
    return
  }
  if (!def.params && !def.custom) {
    void runProcess(id)
    return
  }
  ensureMounted()
  useProcDialog.setState({ open: id, extra })
}

registerCommands(
  PROCESSES.map((d) => ({
    id: `process.${d.id}`,
    label: `${d.label}${d.params || d.custom ? '…' : ''}`,
    group: 'Process',
    keywords: `${d.description} ${d.id} selection clip destructive`,
    run: () => openProcess(d.id),
  })),
)
