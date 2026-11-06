// MP3 via lamejs (loaded on demand), encoded in slices so the UI stays responsive. Adds an ID3v2.3 tag.
import { yieldIf, type Ctl, type Meta, type PCM } from './types'

function utf16(s: string): Uint8Array {
  const out = new Uint8Array(2 + s.length * 2)
  out[0] = 0xff
  out[1] = 0xfe
  for (let i = 0; i < s.length; i++) {
    out[2 + i * 2] = s.charCodeAt(i) & 255
    out[3 + i * 2] = s.charCodeAt(i) >> 8
  }
  return out
}

function id3(meta?: Meta): Uint8Array | null {
  const frames: Uint8Array[] = []
  const frame = (id: string, text: string) => {
    const body = utf16(text)
    const f = new Uint8Array(10 + 1 + body.length)
    for (let i = 0; i < 4; i++) f[i] = id.charCodeAt(i)
    const size = 1 + body.length
    f[4] = (size >>> 24) & 255
    f[5] = (size >>> 16) & 255
    f[6] = (size >>> 8) & 255
    f[7] = size & 255
    f[10] = 1 // UTF-16 with BOM
    f.set(body, 11)
    frames.push(f)
  }
  if (meta?.title) frame('TIT2', meta.title)
  if (meta?.artist) frame('TPE1', meta.artist)
  frame('TSSE', 'HitStudio')
  const size = frames.reduce((a, f) => a + f.length, 0)
  const out = new Uint8Array(10 + size)
  out.set([0x49, 0x44, 0x33, 3, 0, 0])
  out[6] = (size >> 21) & 0x7f
  out[7] = (size >> 14) & 0x7f
  out[8] = (size >> 7) & 0x7f
  out[9] = size & 0x7f
  let o = 10
  for (const f of frames) {
    out.set(f, o)
    o += f.length
  }
  return out
}

function toInt16(src: Float32Array, start: number, end: number): Int16Array {
  const out = new Int16Array(end - start)
  for (let i = start; i < end; i++) {
    const v = src[i] * 32767
    out[i - start] = v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v)
  }
  return out
}

export async function encodeMp3(pcm: PCM, kbps: number, meta?: Meta, ctl?: Ctl): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const nch = Math.min(2, pcm.channels.length)
  const enc = new Mp3Encoder(nch, pcm.sampleRate, kbps)
  const n = pcm.channels[0].length
  const SLICE = 1152 * 40
  const parts: BlobPart[] = []
  const tag = id3(meta)
  if (tag) parts.push(tag as BlobPart)
  for (let s = 0; s < n; s += SLICE) {
    const e = Math.min(n, s + SLICE)
    const l = toInt16(pcm.channels[0], s, e)
    const out = nch === 2 ? enc.encodeBuffer(l, toInt16(pcm.channels[1], s, e)) : enc.encodeBuffer(l)
    if (out.length) parts.push(new Uint8Array(out) as BlobPart)
    await yieldIf(ctl, e / n)
  }
  const tail = enc.flush()
  if (tail.length) parts.push(new Uint8Array(tail) as BlobPart)
  return new Blob(parts, { type: 'audio/mpeg' })
}
