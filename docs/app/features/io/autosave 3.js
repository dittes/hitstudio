// Autosave to IndexedDB: project JSON (+ each audio buffer stored once per id), every 10 s after changes.
import { buffers } from '../../core/buffers.js'
import { getEngine } from '../../core/engine.js'
import { useStore } from '../../core/store.js'

import { isProjectEmpty, referencedBufferIds } from './project-file.js'

const DB = 'bloom-studio'
const META = 'meta'
const BUFS = 'buffers'

let dbp                              = null
function db()                       {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(META)
        req.result.createObjectStore(BUFS, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbp
}
const wrap =     (r               ) => new Promise   ((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))))
const txDone = (tx                ) => new Promise      ((res, rej) => ((tx.oncomplete = () => res()), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error))))

const stored = new Set        ()
let storedLoaded = false

export async function getAutosaveInfo()                               {
  try {
    const d = await db()
    const meta = (await wrap(d.transaction(META).objectStore(META).get('current')))
    if (!meta || !meta.project.clips.length) return null
    const seconds = meta.project.clips.reduce((a, c) => Math.max(a, c.start + c.duration / (c.rate || 1)), 0)
    return { name: meta.project.name, savedAt: meta.savedAt, clips: meta.project.clips.length, tracks: meta.project.tracks.length, seconds }
  } catch {
    return null
  }
}

export async function saveAutosave() {
  const project = useStore.getState().project
  if (isProjectEmpty(project)) return
  const d = await db()
  if (!storedLoaded) {
    const keys = (await wrap(d.transaction(BUFS).objectStore(BUFS).getAllKeys()))
    keys.forEach((k) => stored.add(k))
    storedLoaded = true
  }
  const ids = referencedBufferIds(project)
  const fresh                 = []
  for (const id of ids) {
    if (stored.has(id)) continue
    const e = buffers.get(id)
    const b = e.buffer
    fresh.push({
      id,
      name: e.name,
      sampleRate: b.sampleRate,
      length: b.length,
      channels: Array.from({ length: b.numberOfChannels }, (_, c) => new Float32Array(b.getChannelData(c))),
    })
  }
  const tx = d.transaction([META, BUFS], 'readwrite')
  const bs = tx.objectStore(BUFS)
  for (const f of fresh) bs.put(f)
  // drop buffers that are no longer part of the project
  const keep = new Set(ids)
  for (const k of [...stored]) if (!keep.has(k)) bs.delete(k)
  const meta             = { project, savedAt: Date.now(), bufferIds: ids }
  tx.objectStore(META).put(meta, 'current')
  await txDone(tx)
  fresh.forEach((f) => stored.add(f.id))
  for (const k of [...stored]) if (!keep.has(k)) stored.delete(k)
}

export async function restoreAutosave()                   {
  try {
    const d = await db()
    const meta = (await wrap(d.transaction(META).objectStore(META).get('current')))
    if (!meta) return false
    const store = d.transaction(BUFS).objectStore(BUFS)
    for (const id of meta.bufferIds) {
      const sb = (await wrap(store.get(id)))
      if (!sb) continue
      stored.add(id)
      const buf = new AudioBuffer({ numberOfChannels: sb.channels.length, length: Math.max(1, sb.length), sampleRate: sb.sampleRate })
      sb.channels.forEach((c, i) => buf.copyToChannel(c                             , i))
      buffers.add(buf, sb.name, id)
    }
    getEngine().stop(false)
    useStore.getState().loadProject(meta.project)
    getEngine().seek(0)
    return true
  } catch (e) {
    console.warn('restore failed', e)
    return false
  }
}

let started = false
export function startAutosave() {
  if (started || typeof indexedDB === 'undefined') return
  started = true
  let dirty = false
  let busy = false
  useStore.subscribe((s, prev) => {
    if (s.project !== prev.project) dirty = true
  })
  const flush = async () => {
    if (!dirty || busy || useStore.getState().transport.recording) return
    busy = true
    dirty = false
    try {
      await saveAutosave()
    } catch (e) {
      console.warn('autosave failed', e)
      dirty = true
    } finally {
      busy = false
    }
  }
  setInterval(flush, 10_000)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flush())
  window.addEventListener('pagehide', () => void flush())
}
