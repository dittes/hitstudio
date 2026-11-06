// Autosave to IndexedDB: project JSON (+ each audio buffer stored once per id), every 10 s after changes.
import { buffers } from '../../core/buffers'
import { getEngine } from '../../core/engine'
import { useStore } from '../../core/store'
import type { Project } from '../../core/types'
import { isProjectEmpty, referencedBufferIds } from './project-file'

const DB = 'bloom-studio'
const META = 'meta'
const BUFS = 'buffers'

interface StoredBuffer {
  id: string
  name: string
  sampleRate: number
  length: number
  channels: Float32Array[]
}
interface StoredMeta {
  project: Project
  savedAt: number
  bufferIds: string[]
}

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
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
const wrap = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))))
const txDone = (tx: IDBTransaction) => new Promise<void>((res, rej) => ((tx.oncomplete = () => res()), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error))))

const stored = new Set<string>()
let storedLoaded = false

export interface AutosaveInfo {
  name: string
  savedAt: number
  clips: number
  tracks: number
  seconds: number
}

export async function getAutosaveInfo(): Promise<AutosaveInfo | null> {
  try {
    const d = await db()
    const meta = (await wrap(d.transaction(META).objectStore(META).get('current'))) as StoredMeta | undefined
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
    const keys = (await wrap(d.transaction(BUFS).objectStore(BUFS).getAllKeys())) as string[]
    keys.forEach((k) => stored.add(k))
    storedLoaded = true
  }
  const ids = referencedBufferIds(project)
  const fresh: StoredBuffer[] = []
  for (const id of ids) {
    if (stored.has(id)) continue
    const e = buffers.get(id)!
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
  const meta: StoredMeta = { project, savedAt: Date.now(), bufferIds: ids }
  tx.objectStore(META).put(meta, 'current')
  await txDone(tx)
  fresh.forEach((f) => stored.add(f.id))
  for (const k of [...stored]) if (!keep.has(k)) stored.delete(k)
}

export async function restoreAutosave(): Promise<boolean> {
  try {
    const d = await db()
    const meta = (await wrap(d.transaction(META).objectStore(META).get('current'))) as StoredMeta | undefined
    if (!meta) return false
    const store = d.transaction(BUFS).objectStore(BUFS)
    for (const id of meta.bufferIds) {
      const sb = (await wrap(store.get(id))) as StoredBuffer | undefined
      if (!sb) continue
      stored.add(id)
      const buf = new AudioBuffer({ numberOfChannels: sb.channels.length, length: Math.max(1, sb.length), sampleRate: sb.sampleRate })
      sb.channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i))
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
