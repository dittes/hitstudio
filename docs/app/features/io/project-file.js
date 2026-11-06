// .hitstudio project files (legacy .bloom projects remain readable) = store-only ZIP of project.json + one 32-bit float WAV per audio buffer.
import { buffers } from '../../core/buffers.js'
import { getEngine } from '../../core/engine.js'
import { useStore } from '../../core/store.js'
import { toast } from '../../core/toast.js'

import { audioBufferToPcm } from './export/loudness.js'
import { decodeWav, encodeWav } from './export/wav.js'
import { readZip, writeZip } from './export/zip.js'
import { askConfirm, download, safeName } from './state.js'

export function referencedBufferIds(p         )           {
  return [...new Set(p.clips.map((c) => c.bufferId))].filter((id) => buffers.has(id))
}

export const isProjectEmpty = (p         ) => p.clips.length === 0 && p.tracks.length === 0

export async function bufferToWavBytes(b             )                      {
  return new Uint8Array(await encodeWav(audioBufferToPcm(b), 32).arrayBuffer())
}

export function wavBytesToBuffer(bytes            )              {
  const pcm = decodeWav(bytes)
  const buf = new AudioBuffer({ numberOfChannels: pcm.channels.length, length: Math.max(1, pcm.channels[0].length), sampleRate: pcm.sampleRate })
  pcm.channels.forEach((c, i) => buf.copyToChannel(c                             , i))
  return buf
}

export async function saveProjectFile() {
  const project = useStore.getState().project
  if (isProjectEmpty(project)) {
    toast({ title: 'Nothing to save yet', body: 'Add or record some audio first.' })
    return
  }
  toast({ title: 'Packing your project…', ms: 1500 })
  const ids = referencedBufferIds(project)
  const entries = []
  const manifest                    = { app: 'hitstudio', version: 1, savedAt: new Date().toISOString(), project, buffers: [] }
  for (const id of ids) {
    const e = buffers.get(id)
    const file = `audio/${id}.wav`
    manifest.buffers.push({ id, name: e.name, file })
    entries.push({ name: file, data: await bufferToWavBytes(e.buffer) })
    await new Promise((r) => setTimeout(r, 0))
  }
  entries.unshift({ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(manifest)) })
  const blob = writeZip(entries)
  download(blob, `${safeName(project.name)}.hitstudio`)
  toast({ title: 'Project saved 💾', body: `“${project.name}.hitstudio” is in your downloads. Open it any time with ⌘O.`, kind: 'success' })
}

export async function loadManifest(manifest                   , files                         ) {
  for (const b of manifest.buffers) {
    const bytes = files.get(b.file)
    if (!bytes) continue
    buffers.add(wavBytesToBuffer(bytes), b.name, b.id)
  }
  getEngine().stop(false)
  useStore.getState().loadProject(manifest.project)
  getEngine().seek(0)
}

export async function openProjectFile(file      ) {
  try {
    if (!isProjectEmpty(useStore.getState().project)) {
      const ok = await askConfirm('Open this project?', 'The song you’re working on will be replaced. (It’s kept in autosave until you change something new.)', 'Open it')
      if (!ok) return
    }
    const files = readZip(new Uint8Array(await file.arrayBuffer()))
    const raw = files.get('project.json')
    if (!raw) throw new Error('This doesn’t look like a HitStudio project file.')
    const manifest = JSON.parse(new TextDecoder().decode(raw))
    if (manifest.app !== 'hitstudio' && manifest.app !== 'bloom-studio') throw new Error('This doesn’t look like a HitStudio project file.')
    await loadManifest(manifest, files)
    toast({ title: `Opened “${manifest.project.name}” 📂`, kind: 'success' })
  } catch (e) {
    toast({ title: 'Couldn’t open that file', body: (e         ).message, kind: 'error', ms: 5000 })
  }
}
