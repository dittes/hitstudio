// "Add to my song": render each section offline with the same synth code → tracks + clips.
import { buffers } from '../../core/buffers.js'
import { TRACK_COLORS } from '../../core/ids.js'
import { makeClip, makeTrack, useStore } from '../../core/store.js'

import { useCreate } from './state.js'
import { configureAll, createBuses, dims, scheduleStep, swingOffset } from './synth/mix.js'

const NAMES                          = { drums: 'Drums', melody: 'Melody', chords: 'Chords', bass: 'Bass' }
const COLOR                          = { drums: TRACK_COLORS[2], melody: TRACK_COLORS[0], chords: TRACK_COLORS[6], bass: TRACK_COLORS[4] }

export function activeSections()            {
  const d = useCreate.getState()
  const out            = []
  if (!d.sections.drums.mute && Object.values(d.drums.grid).some((g) => g.some((v) => v > 0))) out.push('drums')
  if (!d.sections.melody.mute && d.melody.notes.length) out.push('melody')
  if (!d.sections.chords.mute) out.push('chords')
  if (!d.sections.bass.mute && d.bass.on) out.push('bass')
  return out
}

async function renderSection(sec         , bars        )                       {
  const d = useCreate.getState()
  const p = useStore.getState().project
  const dm = dims(p.timeSig, d.drums.long, p.bpm)
  const sr = p.sampleRate
  const total = bars * dm.barSteps
  const dur = total * dm.stepDur
  const tail = 2.5
  const ctx = new OfflineAudioContext(2, Math.ceil((dur + tail) * sr), sr)
  const buses = createBuses(ctx, ctx.destination, [sec])
  configureAll(buses, ctx, d, p.bpm, true)
  for (let s = 0; s < total; s++) {
    const loop = s % dm.loopLen
    scheduleStep(ctx, buses, d, dm, loop, 0.01 + s * dm.stepDur + swingOffset(loop, dm.stepDur, d.drums.swing))
  }
  const rendered = await ctx.startRendering()
  // fold the reverb/release tail back onto the start so the clip loops seamlessly
  const len = Math.round(dur * sr)
  const out = buffers.create(2, len, sr)
  for (let c = 0; c < 2; c++) {
    const src = rendered.getChannelData(c)
    const dst = new Float32Array(len)
    for (let i = 0; i < src.length; i++) dst[i % len] += src[i]
    out.copyToChannel(dst, c)
  }
  return out
}

/** Returns the number of tracks added. */
export async function bounceToSong(bars        )                  {
  const secs = activeSections()
  if (!secs.length) return 0
  const results                                                   = []
  for (const sec of secs) {
    const buf = await renderSection(sec, bars)
    const entry = buffers.add(buf, `${NAMES[sec]} (${bars} bars)`)
    results.push({ sec, buf, id: entry.id })
  }
  const at = Math.max(0, useStore.getState().transport.position || 0)
  useStore.getState().mutate('Add beat to song', (draft) => {
    for (const r of results) {
      const t = makeTrack(draft           , { name: NAMES[r.sec], kind: 'instrument', color: COLOR[r.sec] })
      draft.tracks.push(t)
      draft.clips.push(makeClip({ trackId: t.id, bufferId: r.id, duration: r.buf.duration, start: at, name: `${NAMES[r.sec]} loop`, color: COLOR[r.sec] }))
    }
  })
  return results.length
}
