// Opus in an Ogg container. Uses WebCodecs AudioEncoder when available (Chrome, Edge, Safari 26+);
// otherwise falls back to a real-time MediaRecorder capture (WebM/Opus).
import { crcOgg } from './crc.js'
import { yieldIf,                               } from './types.js'

export function opusSupported()          {
  return typeof (globalThis       ).AudioEncoder !== 'undefined'
}
export function realtimeOpusSupported()          {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')
}

const te = new TextEncoder()

class OggWriter {
  parts               = []
  serial = (Math.random() * 0xffffffff) >>> 0
  seq = 0
  page(packets              , granule        , flags        ) {
    const lacing           = []
    for (const p of packets) {
      let len = p.length
      while (len >= 255) {
        lacing.push(255)
        len -= 255
      }
      lacing.push(len)
    }
    const dataLen = packets.reduce((a, p) => a + p.length, 0)
    const out = new Uint8Array(27 + lacing.length + dataLen)
    const dv = new DataView(out.buffer)
    out.set([0x4f, 0x67, 0x67, 0x53]) // OggS
    out[5] = flags
    dv.setUint32(6, granule % 4294967296 >>> 0, true)
    dv.setUint32(10, Math.floor(granule / 4294967296), true)
    dv.setUint32(14, this.serial, true)
    dv.setUint32(18, this.seq++, true)
    out[26] = lacing.length
    out.set(lacing, 27)
    let o = 27 + lacing.length
    for (const p of packets) {
      out.set(p, o)
      o += p.length
    }
    dv.setUint32(22, crcOgg(out), true)
    this.parts.push(out)
  }
}

function opusHead(channels        , inputRate        , preSkip        )             {
  const h = new Uint8Array(19)
  const dv = new DataView(h.buffer)
  h.set(te.encode('OpusHead'))
  h[8] = 1
  h[9] = channels
  dv.setUint16(10, preSkip, true)
  dv.setUint32(12, inputRate, true)
  dv.setInt16(16, 0, true)
  h[18] = 0
  return h
}

function opusTags(meta       )             {
  const vendor = te.encode('HitStudio')
  const comments               = []
  if (meta?.title) comments.push(te.encode('TITLE=' + meta.title))
  if (meta?.artist) comments.push(te.encode('ARTIST=' + meta.artist))
  const len = 8 + 4 + vendor.length + 4 + comments.reduce((a, c) => a + 4 + c.length, 0)
  const out = new Uint8Array(len)
  const dv = new DataView(out.buffer)
  out.set(te.encode('OpusTags'))
  dv.setUint32(8, vendor.length, true)
  out.set(vendor, 12)
  let p = 12 + vendor.length
  dv.setUint32(p, comments.length, true)
  p += 4
  for (const c of comments) {
    dv.setUint32(p, c.length, true)
    out.set(c, p + 4)
    p += 4 + c.length
  }
  return out
}

/** `pcm` must be 48 kHz. Resolves to an .opus (Ogg Opus) blob. */
export async function encodeOpus(pcm     , kbps        , meta       , ctl      )                {
  const AE = (globalThis       ).AudioEncoder
  const AD = (globalThis       ).AudioData
  const nch = Math.min(2, pcm.channels.length)
  const sr = 48000
  const cfg = { codec: 'opus', sampleRate: sr, numberOfChannels: nch, bitrate: kbps * 1000 }
  const sup = await AE.isConfigSupported(cfg)
  if (!sup?.supported) throw new Error('This browser cannot encode Opus.')
  const packets                                          = []
  let head                    = null
  let error      = null
  const encoder = new AE({
    output: (chunk     , md     ) => {
      const d = new Uint8Array(chunk.byteLength)
      chunk.copyTo(d)
      const desc = md?.decoderConfig?.description
      if (!head && desc) head = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc                   ).buffer.slice((desc                   ).byteOffset, (desc                   ).byteOffset + (desc                   ).byteLength))
      packets.push({ data: d, samples: Math.round(((chunk.duration || 20000) / 1e6) * sr) })
    },
    error: (e     ) => (error = e),
  })
  encoder.configure(cfg)
  const n = pcm.channels[0].length
  const FR = 960 * 4
  for (let s = 0; s < n; s += FR) {
    const len = Math.min(FR, n - s)
    const data = new Float32Array(len * nch)
    for (let c = 0; c < nch; c++) data.set(pcm.channels[c].subarray(s, s + len), c * len)
    const ad = new AD({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: nch, timestamp: Math.round((s / sr) * 1e6), data })
    encoder.encode(ad)
    ad.close()
    if (error) throw error
    if ((s / FR) % 40 === 0) {
      await yieldIf(ctl, (s / n) * 0.9)
      // keep the encoder queue from ballooning
      while (encoder.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 4))
    }
  }
  await encoder.flush()
  encoder.close()
  if (error) throw error
  const preSkip = head ? new DataView((head              ).buffer, (head              ).byteOffset).getUint16(10, true) : 312
  const headPkt = head && (head              ).length >= 19 ? (head              ) : opusHead(nch, sr, preSkip)
  const ogg = new OggWriter()
  ogg.page([headPkt], 0, 0x02)
  ogg.page([opusTags(meta)], 0, 0)
  // group packets into pages (<= 40 packets each); granule = pre-skip + samples so far
  let granule = preSkip
  const wantTotal = preSkip + n
  let i = 0
  while (i < packets.length) {
    const group               = []
    let segs = 0
    let gran = granule
    while (i < packets.length && group.length < 40 && segs + Math.floor(packets[i].data.length / 255) + 1 <= 250) {
      segs += Math.floor(packets[i].data.length / 255) + 1
      group.push(packets[i].data)
      gran += packets[i].samples
      i++
    }
    const last = i >= packets.length
    ogg.page(group, last ? Math.min(gran, wantTotal) : gran, last ? 0x04 : 0)
    granule = gran
  }
  ctl?.onProgress?.(1)
  return new Blob(ogg.parts              , { type: 'audio/ogg' })
}

/** Fallback: play the buffer through MediaRecorder in real time (takes as long as the audio). */
export async function encodeOpusRealtime(pcm     , kbps        , ctl      )                {
  const ctx = new AudioContext({ sampleRate: pcm.sampleRate })
  const buf = ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate)
  pcm.channels.forEach((c, i) => buf.copyToChannel(c                             , i))
  const dest = ctx.createMediaStreamDestination()
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(dest)
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: kbps * 1000 })
  const chunks             = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise      ((r) => (rec.onstop = () => r()))
  rec.start(500)
  src.start()
  const t0 = performance.now()
  const dur = buf.duration
  await new Promise      ((resolve) => {
    src.onended = () => resolve()
    const iv = setInterval(() => {
      ctl?.onProgress?.(Math.min(0.99, (performance.now() - t0) / 1000 / dur))
      if (ctl?.cancelled) {
        clearInterval(iv)
        try { src.stop() } catch {}
        resolve()
      }
    }, 200)
    src.addEventListener('ended', () => clearInterval(iv))
  })
  rec.stop()
  await done
  ctx.close()
  return new Blob(chunks, { type: 'audio/webm' })
}
