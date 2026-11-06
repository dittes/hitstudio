// WAV writer (16/24-bit PCM, 32-bit float) with LIST/INFO metadata, and a small reader.
import type { Meta, PCM } from './types'

export type WavBits = 16 | 24 | 32

const enc = new TextEncoder()
function str(dv: DataView, off: number, s: string) {
  for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
}

function infoChunk(meta?: Meta): Uint8Array {
  const items: [string, string][] = []
  if (meta?.title) items.push(['INAM', meta.title])
  if (meta?.artist) items.push(['IART', meta.artist])
  items.push(['ISFT', 'HitStudio'])
  const parts = items.map(([id, v]) => {
    const b = enc.encode(v + '\0')
    const padded = b.length + (b.length & 1)
    const out = new Uint8Array(8 + padded)
    const dv = new DataView(out.buffer)
    str(dv, 0, id)
    dv.setUint32(4, b.length, true)
    out.set(b, 8)
    return out
  })
  const size = 4 + parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(8 + size)
  const dv = new DataView(out.buffer)
  str(dv, 0, 'LIST')
  dv.setUint32(4, size, true)
  str(dv, 8, 'INFO')
  let o = 12
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Encode to a WAV file. 16-bit gets light TPDF dither so quiet tails stay smooth. */
export function encodeWav(pcm: PCM, bits: WavBits = 16, meta?: Meta): Blob {
  const nch = pcm.channels.length
  const n = pcm.channels[0].length
  const bytes = bits / 8
  const dataLen = n * nch * bytes
  const info = infoChunk(meta)
  const isFloat = bits === 32
  const fmtLen = 16
  const factLen = isFloat ? 12 : 0
  const headLen = 12 + 8 + fmtLen + factLen
  const total = headLen + info.length + 8 + dataLen + (dataLen & 1)
  const buf = new ArrayBuffer(total)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  str(dv, 0, 'RIFF')
  dv.setUint32(4, total - 8, true)
  str(dv, 8, 'WAVE')
  str(dv, 12, 'fmt ')
  dv.setUint32(16, fmtLen, true)
  dv.setUint16(20, isFloat ? 3 : 1, true)
  dv.setUint16(22, nch, true)
  dv.setUint32(24, pcm.sampleRate, true)
  dv.setUint32(28, pcm.sampleRate * nch * bytes, true)
  dv.setUint16(32, nch * bytes, true)
  dv.setUint16(34, bits, true)
  let o = 36
  if (isFloat) {
    str(dv, o, 'fact')
    dv.setUint32(o + 4, 4, true)
    dv.setUint32(o + 8, n, true)
    o += 12
  }
  u8.set(info, o)
  o += info.length
  str(dv, o, 'data')
  dv.setUint32(o + 4, dataLen, true)
  o += 8
  writeInterleaved(dv, o, pcm.channels, bits, true)
  return new Blob([buf], { type: 'audio/wav' })
}

/** interleave + quantise into a DataView (shared by WAV and AIFF) */
export function writeInterleaved(dv: DataView, offset: number, ch: Float32Array[], bits: WavBits, little: boolean) {
  const nch = ch.length
  const n = ch[0].length
  let o = offset
  if (bits === 32) {
    for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++, o += 4) dv.setFloat32(o, ch[c][i], little)
    return
  }
  const max = bits === 16 ? 32767 : 8388607
  const scale = max + 1
  const dither = bits === 16
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      let x = ch[c][i] * scale
      if (dither) x += Math.random() - Math.random()
      let v = Math.round(x)
      if (v > max) v = max
      else if (v < -max - 1) v = -max - 1
      if (bits === 16) {
        dv.setInt16(o, v, little)
        o += 2
      } else if (little) {
        dv.setUint8(o, v & 255)
        dv.setUint8(o + 1, (v >> 8) & 255)
        dv.setUint8(o + 2, (v >> 16) & 255)
        o += 3
      } else {
        dv.setUint8(o, (v >> 16) & 255)
        dv.setUint8(o + 1, (v >> 8) & 255)
        dv.setUint8(o + 2, v & 255)
        o += 3
      }
    }
  }
}

/** Parse PCM16/24/32 or float32/64 WAV into planar floats (used by .bloom project files). */
export function decodeWav(bytes: Uint8Array): PCM {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')
  let o = 12
  let fmt = 1,
    nch = 1,
    sr = 44100,
    bits = 16,
    dataOff = -1,
    dataLen = 0
  while (o + 8 <= bytes.length) {
    const id = tag(o)
    const len = dv.getUint32(o + 4, true)
    if (id === 'fmt ') {
      fmt = dv.getUint16(o + 8, true)
      nch = dv.getUint16(o + 10, true)
      sr = dv.getUint32(o + 12, true)
      bits = dv.getUint16(o + 22, true)
      if (fmt === 0xfffe && len >= 26) fmt = dv.getUint16(o + 8 + 24, true)
    } else if (id === 'data') {
      dataOff = o + 8
      dataLen = Math.min(len, bytes.length - dataOff)
      break
    }
    o += 8 + len + (len & 1)
  }
  if (dataOff < 0) throw new Error('WAV has no audio data')
  const bps = bits / 8
  const n = Math.floor(dataLen / (bps * nch))
  const out = Array.from({ length: nch }, () => new Float32Array(n))
  let p = dataOff
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++, p += bps) {
      let v: number
      if (fmt === 3) v = bits === 64 ? dv.getFloat64(p, true) : dv.getFloat32(p, true)
      else if (bits === 16) v = dv.getInt16(p, true) / 32768
      else if (bits === 24) v = (((dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16)) | 0) / 8388608)
      else if (bits === 32) v = dv.getInt32(p, true) / 2147483648
      else v = (dv.getUint8(p) - 128) / 128
      out[c][i] = v
    }
  }
  return { channels: out, sampleRate: sr }
}
