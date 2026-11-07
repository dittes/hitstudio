// Karaoke / instrumental maker: remove the vocals (or keep only them), preview it, save it in one click.
import { buffers } from '../../core/buffers.js'
import { makeClip, makeTrack, useStore } from '../../core/store.js'
import { toast } from '../../core/toast.js'
import { icon, escape } from '../../dom.js'
import { showModal, closeModal } from '../../dialogs.js'
import { encode } from '../io/export/encode.js'
import { audioBufferToPcm } from '../io/export/loudness.js'
import { downloadBlob } from '../visualizer/recorder.js'
import { STEM_COLOR, decodeFile, splitWithProgress } from './stems.js'

/** sum several stereo buffers into one new buffer */
export function mixBuffers(list) {
  const first = list[0]
  const out = buffers.create(2, first.length, first.sampleRate)
  for (let c = 0; c < 2; c++) {
    const dst = new Float32Array(first.length)
    for (const b of list) {
      const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1))
      for (let i = 0; i < dst.length; i++) dst[i] += src[i]
    }
    out.copyToChannel(dst, c)
  }
  return out
}

const FILE_SAFE = (s) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim()

async function saveAs(buffer, name, format, button) {
  const old = button.innerHTML
  button.disabled = true
  button.innerHTML = `${icon('reroll')}<span>Saving…</span>`
  try {
    const pcm = audioBufferToPcm(buffer)
    const blob = await encode(pcm, format === 'mp3' ? { format: 'mp3', kbps: 192 } : { format: 'wav', bits: 16 }, { title: name })
    downloadBlob(blob, `${FILE_SAFE(name)}.${format}`)
    toast({ title: `Saved ${FILE_SAFE(name)}.${format}`, kind: 'success', ms: 4000 })
  } catch (error) {
    toast({ title: 'Could not save that file', body: String(error?.message || error), kind: 'error' })
  } finally {
    button.disabled = false
    button.innerHTML = old
  }
}

/** Result dialog: two cards, each with a preview and save buttons. */
function showResult({ name, instrumental, vocals }) {
  const items = [
    { id: 'inst', buffer: instrumental, title: 'Instrumental', sub: 'No vocals: drums, bass and everything else', ic: 'volume', color: STEM_COLOR.other },
    { id: 'vox', buffer: vocals, title: 'Vocals only', sub: 'The singing on its own (acapella)', ic: 'vocal', color: STEM_COLOR.vocals },
  ]
  let audio = null
  let playing = null
  const urls = new Map()
  const stop = () => {
    audio?.pause()
    audio = null
    playing = null
    document.querySelectorAll('#modal [data-kar-play]').forEach((b) => {
      b.innerHTML = `${icon('play')}<span>Preview</span>`
    })
  }
  showModal(
    'Your karaoke track is ready',
    `<div class="kar-modal"><p class="kar-song">${icon('song')}<b>${escape(name)}</b></p>
    <div class="kar-cards">${items
      .map(
        (it) => `<section class="kar-card" style="--c:${it.color}"><span class="kar-ic">${icon(it.ic)}</span><div class="kar-text"><b>${it.title}</b><small>${it.sub}</small></div>
        <div class="kar-btns"><button data-kar-play="${it.id}">${icon('play')}<span>Preview</span></button><button class="primary" data-kar-save="${it.id}:mp3">${icon('download')}<span>Save MP3</span></button><button data-kar-save="${it.id}:wav"><span>WAV</span></button></div></section>`,
      )
      .join('')}</div>
    <div class="row spread kar-foot"><span class="faint">Want to fine-tune it? Both tracks open in the editor.</span><button data-kar-edit>${icon('edit')}<span>Open in Edit</span></button></div>
    <p class="faint kar-note">Made on your device. Best on loop-based songs; live bands, heavy reverb or doubled vocals can leave a faint ghost of the singing.</p></div>`,
    () => {
      stop()
      urls.forEach((u) => URL.revokeObjectURL(u))
    },
  )
  const root = document.querySelector('#modal .kar-modal')
  root.addEventListener('click', async (e) => {
    const play = e.target.closest('[data-kar-play]')
    const save = e.target.closest('[data-kar-save]')
    const edit = e.target.closest('[data-kar-edit]')
    if (play) {
      const id = play.dataset.karPlay
      if (playing === id) return stop()
      stop()
      const it = items.find((x) => x.id === id)
      if (!urls.has(id)) {
        const { encodeWav } = await import('../io/export/wav.js')
        urls.set(id, URL.createObjectURL(encodeWav(audioBufferToPcm(it.buffer), 16)))
      }
      audio = new Audio(urls.get(id))
      audio.onended = stop
      playing = id
      play.innerHTML = `${icon('pause')}<span>Stop</span>`
      await audio.play().catch(() => stop())
    }
    if (save) {
      const [id, fmt] = save.dataset.karSave.split(':')
      const it = items.find((x) => x.id === id)
      await saveAs(it.buffer, `${name} – ${it.title}`, fmt, save)
    }
    if (edit) {
      stop()
      closeModal()
      const S = useStore.getState()
      const clipIds = []
      const trackIds = []
      S.mutate('Add karaoke tracks', (p) => {
        items.forEach((it, i) => {
          const entry = buffers.add(it.buffer, `${name} – ${it.title}`)
          const t = makeTrack(p, { name: it.title, color: it.color, mute: i === 1 })
          p.tracks.push(t)
          const c = makeClip({ trackId: t.id, bufferId: entry.id, duration: it.buffer.duration, name: `${name} – ${it.title}`, color: it.color })
          p.clips.push(c)
          trackIds.push(t.id)
          clipIds.push(c.id)
        })
      })
      S.setMode('edit')
      S.select({ clipIds, trackIds })
      toast({ title: 'Karaoke tracks added', body: 'The vocals track is muted. Unmute it (and mute the instrumental) to hear the acapella.', ms: 8000, kind: 'success' })
    }
  })
}

/** Split a song, then offer the instrumental and the vocals. */
export async function makeKaraoke(audio, name) {
  const stems = await splitWithProgress(audio, { name, title: 'Making your karaoke track' })
  if (!stems) return null
  const instrumental = mixBuffers([stems.drums, stems.bass, stems.other])
  showResult({ name, instrumental, vocals: stems.vocals })
  return { instrumental, vocals: stems.vocals }
}

export async function karaokeFile(file) {
  const song = await decodeFile(file)
  return song ? makeKaraoke(song.buffer, song.name) : null
}
