// AIFF (big-endian PCM 16/24-bit) with NAME/AUTH text chunks.
import type { Meta, PCM } from './types'
import { writeInterleaved } from './wav'

/** IEEE 754 80-bit extended float (used for the sample rate in COMM). */
function writeExtended(dv: DataView, off: number, value: number) {
  let exp = Math.floor(Math.log2(value))
  let mant = value / Math.pow(2, exp) // 1 <= m < 2
  if (mant >= 2) {
    mant /= 2
    exp++
  }
  const e = exp + 16383
  dv.setUint16(off, e, false)
  // 64-bit mantissa with explicit integer bit: mant * 2^63
  const hi = Math.floor(mant * 2 ** 31) // top 32 bits (includes the leading 1 at bit 31)
  const lo = Math.floor((mant * 2 ** 31 - hi) * 2 ** 32)
  dv.setUint32(off + 2, hi >>> 0, false)
  dv.setUint32(off + 6, lo >>> 0, false)
}

function textChunk(id: string, text: string): Uint8Array {
  const b = new TextEncoder().encode(text)
  const padded = b.length + (b.length & 1)
  const out = new Uint8Array(8 + padded)
  const dv = new DataView(out.buffer)
  for (let i = 0; i < 4; i++) dv.setUint8(i, id.charCodeAt(i))
  dv.setUint32(4, b.length, false)
  out.set(b, 8)
  return out
}

export function encodeAiff(pcm: PCM, bits: 16 | 24 = 16, meta?: Meta): Blob {
  const nch = pcm.channels.length
  const n = pcm.channels[0].length
  const bytes = bits / 8
  const dataLen = n * nch * bytes
  const extra: Uint8Array[] = []
  if (meta?.title) extra.push(textChunk('NAME', meta.title))
  if (meta?.artist) extra.push(textChunk('AUTH', meta.artist))
  const extraLen = extra.reduce((a, b) => a + b.length, 0)
  const commLen = 18
  const ssndLen = 8 + dataLen
  const total = 12 + 8 + commLen + extraLen + 8 + ssndLen + (ssndLen & 1)
  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  const s = (o: number, t: string) => {
    for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i))
  }
  s(0, 'FORM')
  dv.setUint32(4, total - 8, false)
  s(8, 'AIFF')
  s(12, 'COMM')
  dv.setUint32(16, commLen, false)
  dv.setInt16(20, nch, false)
  dv.setUint32(22, n, false)
  dv.setInt16(26, bits, false)
  writeExtended(dv, 28, pcm.sampleRate)
  let o = 38
  for (const e of extra) {
    u8.set(e, o)
    o += e.length
  }
  s(o, 'SSND')
  dv.setUint32(o + 4, ssndLen, false)
  dv.setUint32(o + 8, 0, false) // offset
  dv.setUint32(o + 12, 0, false) // block size
  writeInterleaved(dv, o + 16, pcm.channels, bits, false)
  return new Blob([buf], { type: 'audio/aiff' })
}
