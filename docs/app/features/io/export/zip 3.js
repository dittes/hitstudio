// Tiny store-only (no compression) ZIP writer + reader. Used for stems and .bloom project files.
import { crc32 } from './crc.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

export function writeZip(entries            )       {
  const { time, date } = dosDateTime()
  const parts                            = []
  const central                            = []
  let offset = 0
  for (const e of entries) {
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const lh = new Uint8Array(30 + name.length)
    const v = new DataView(lh.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 0x0800, true) // utf-8 names
    v.setUint16(8, 0, true) // stored
    v.setUint16(10, time, true)
    v.setUint16(12, date, true)
    v.setUint32(14, crc, true)
    v.setUint32(18, e.data.length, true)
    v.setUint32(22, e.data.length, true)
    v.setUint16(26, name.length, true)
    v.setUint16(28, 0, true)
    lh.set(name, 30)
    parts.push(lh, e.data                           )

    const ch = new Uint8Array(46 + name.length)
    const c = new DataView(ch.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, e.data.length, true)
    c.setUint32(24, e.data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    ch.set(name, 46)
    central.push(ch)
    offset += lh.length + e.data.length
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end], { type: 'application/zip' })
}

/** Read a store-only zip (what writeZip produces) – returns name → bytes. */
export function readZip(bytes            )                          {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let e = bytes.length - 22
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--
  if (e < 0) throw new Error('This file is not a HitStudio project (no zip directory found).')
  const count = dv.getUint16(e + 10, true)
  let p = dv.getUint32(e + 16, true)
  const out = new Map                    ()
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt project file.')
    const method = dv.getUint16(p + 10, true)
    const csize = dv.getUint32(p + 20, true)
    const nlen = dv.getUint16(p + 28, true)
    const xlen = dv.getUint16(p + 30, true)
    const clen = dv.getUint16(p + 32, true)
    const lho = dv.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen))
    if (method !== 0) throw new Error('Unsupported compression in project file.')
    const lnlen = dv.getUint16(lho + 26, true)
    const lxlen = dv.getUint16(lho + 28, true)
    const start = lho + 30 + lnlen + lxlen
    out.set(name, bytes.subarray(start, start + csize))
    p += 46 + nlen + xlen + clen
  }
  return out
}
