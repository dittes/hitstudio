// FLAC encoder written from the spec (https://xiph.org/flac/format.html):
//  - fixed block size (4096), fixed linear predictors of order 0-4, CONSTANT / VERBATIM fallbacks
//  - Rice coding with partitioned residuals (partition order chosen per subframe)
//  - stereo decorrelation (L/R, L/S, S/R, M/S) picked per frame
//  - STREAMINFO (MD5 left zero = "not computed"), VORBIS_COMMENT, CRC-8 headers, CRC-16 frames
import { crc16, crc8 } from './crc'
import { yieldIf, type Ctl, type Meta, type PCM } from './types'

const BLOCK = 4096

class BitWriter {
  buf: Uint8Array
  pos = 0
  acc = 0
  nacc = 0
  constructor(size: number) {
    this.buf = new Uint8Array(size)
  }
  reset() {
    this.pos = 0
    this.acc = 0
    this.nacc = 0
  }
  private ensure(extra: number) {
    if (this.pos + extra >= this.buf.length) {
      const nb = new Uint8Array(Math.max(this.buf.length * 2, this.pos + extra + 1024))
      nb.set(this.buf)
      this.buf = nb
    }
  }
  /** write the low n bits of v (v is a non-negative number < 2^n, n <= 32) */
  write(v: number, n: number) {
    if (n > 16) {
      this.write(Math.floor(v / 65536), n - 16)
      this.write(v & 0xffff, 16)
      return
    }
    this.ensure(4)
    this.acc = (this.acc << n) | (v & ((1 << n) - 1))
    this.nacc += n
    while (this.nacc >= 8) {
      this.nacc -= 8
      this.buf[this.pos++] = (this.acc >>> this.nacc) & 0xff
    }
    this.acc &= (1 << this.nacc) - 1
  }
  /** signed value as two's complement in n bits */
  writeSigned(v: number, n: number) {
    this.write(v < 0 ? v + Math.pow(2, n) : v, n)
  }
  /** q zero bits followed by a one */
  unary(q: number) {
    while (q >= 16) {
      this.write(0, 16)
      q -= 16
    }
    this.write(1, q + 1)
  }
  align() {
    if (this.nacc > 0) this.write(0, 8 - this.nacc)
  }
}

function utf8Number(n: number): number[] {
  if (n < 0x80) return [n]
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 63)]
  if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)]
  if (n < 0x200000) return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 63), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)]
  if (n < 0x4000000)
    return [0xf8 | (n >> 24), 0x80 | ((n >> 18) & 63), 0x80 | ((n >> 12) & 63), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)]
  return [0xfc | (n >> 30), 0x80 | ((n >> 24) & 63), 0x80 | ((n >> 18) & 63), 0x80 | ((n >> 12) & 63), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63)]
}

/** residual of the fixed predictor of the given order, into `out` (length n-order) */
function fixedResidual(x: Int32Array, n: number, order: number, out: Int32Array) {
  switch (order) {
    case 0:
      for (let i = 0; i < n; i++) out[i] = x[i]
      break
    case 1:
      for (let i = 1; i < n; i++) out[i - 1] = x[i] - x[i - 1]
      break
    case 2:
      for (let i = 2; i < n; i++) out[i - 2] = x[i] - 2 * x[i - 1] + x[i - 2]
      break
    case 3:
      for (let i = 3; i < n; i++) out[i - 3] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]
      break
    default:
      for (let i = 4; i < n; i++) out[i - 4] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4]
  }
}

function sumAbs(r: Int32Array, len: number) {
  let s = 0
  for (let i = 0; i < len; i++) s += r[i] < 0 ? -r[i] : r[i]
  return s
}

const tmpRes: Int32Array[] = Array.from({ length: 5 }, () => new Int32Array(BLOCK))

/** cheap estimate: best fixed order and its sum(|residual|) */
function estimate(x: Int32Array, n: number): { order: number; cost: number } {
  let best = { order: 0, cost: Infinity }
  const maxOrder = Math.min(4, n - 1)
  for (let o = 0; o <= maxOrder; o++) {
    fixedResidual(x, n, o, tmpRes[o])
    // include warm-up samples roughly (they cost `bps` bits each in the real stream)
    const c = sumAbs(tmpRes[o], n - o)
    if (c < best.cost) best = { order: o, cost: c }
  }
  return best
}

const sumsBuf = new Float64Array(1 << 9)

/** Write one subframe. `bps` is the sample width of this channel (side channel gets +1). */
function writeSubframe(bw: BitWriter, x: Int32Array, n: number, bps: number, order: number) {
  // CONSTANT?
  let constant = true
  for (let i = 1; i < n; i++)
    if (x[i] !== x[0]) {
      constant = false
      break
    }
  if (constant) {
    bw.write(0, 8) // pad 0, type 000000, no wasted bits
    bw.writeSigned(x[0], bps)
    return
  }
  order = Math.min(order, n - 1)
  const res = tmpRes[order]
  fixedResidual(x, n, order, res)
  const nres = n - order

  // choose partition order and Rice parameters
  let maxPO = 0
  while (maxPO < 8 && n % (1 << (maxPO + 1)) === 0 && n >> (maxPO + 1) > order) maxPO++
  // sums of zig-zagged residuals at the finest partitioning
  const finest = 1 << maxPO
  const sums = sumsBuf.length >= finest ? sumsBuf : new Float64Array(finest)
  const psize = n >> maxPO
  for (let p = 0; p < finest; p++) {
    const s = p === 0 ? 0 : p * psize - order
    const e = (p + 1) * psize - order
    let t = 0
    for (let i = s; i < e; i++) {
      const r = res[i]
      t += r < 0 ? -2 * r - 1 : 2 * r
    }
    sums[p] = t
  }
  const paramFor = (sum: number, count: number) => {
    if (count <= 0 || sum <= 0) return { k: 0, bits: count }
    const mean = sum / count
    let k = mean < 1 ? 0 : Math.min(14, Math.floor(Math.log2(mean)))
    let bits = count * (k + 1) + (sum / Math.pow(2, k) - count / 2)
    if (k < 14) {
      const b2 = count * (k + 2) + (sum / Math.pow(2, k + 1) - count / 2)
      if (b2 < bits) {
        bits = b2
        k++
      }
    }
    return { k, bits }
  }
  let bestPO = 0
  let bestBits = Infinity
  const levelSums: Float64Array[] = [] // levelSums[po] = sums at partition order po
  levelSums[maxPO] = Float64Array.from(sums.subarray(0, finest))
  for (let po = maxPO - 1; po >= 0; po--) {
    const prev = levelSums[po + 1]
    const cur = new Float64Array(1 << po)
    for (let i = 0; i < cur.length; i++) cur[i] = prev[2 * i] + prev[2 * i + 1]
    levelSums[po] = cur
  }
  for (let po = 0; po <= maxPO; po++) {
    const parts = 1 << po
    const sz = n >> po
    let bits = 6
    for (let p = 0; p < parts; p++) bits += 4 + paramFor(levelSums[po][p], p === 0 ? sz - order : sz).bits
    if (bits < bestBits) {
      bestBits = bits
      bestPO = po
    }
  }
  const verbatimBits = n * bps
  const fixedBits = order * bps + bestBits
  if (verbatimBits <= fixedBits) {
    bw.write(1 << 1, 8) // type 000001 = verbatim
    for (let i = 0; i < n; i++) bw.writeSigned(x[i], bps)
    return
  }
  bw.write(0x10 | (order << 1), 8) // 001xxx fixed: bits = 0 | 001ooo | 0
  for (let i = 0; i < order; i++) bw.writeSigned(x[i], bps)
  bw.write(0, 2) // Rice, 4-bit parameters
  bw.write(bestPO, 4)
  const parts = 1 << bestPO
  const sz = n >> bestPO
  let idx = 0
  for (let p = 0; p < parts; p++) {
    const count = p === 0 ? sz - order : sz
    const { k } = paramFor(levelSums[bestPO][p], count)
    bw.write(k, 4)
    for (let i = 0; i < count; i++, idx++) {
      const r = res[idx]
      const u = r < 0 ? -2 * r - 1 : 2 * r
      bw.unary(u >>> k)
      if (k) bw.write(u & ((1 << k) - 1), k)
    }
  }
}

export async function encodeFlac(pcm: PCM, bps: 16 | 24 = 16, meta?: Meta, ctl?: Ctl): Promise<Blob> {
  const nch = Math.min(2, pcm.channels.length) // mono or stereo
  const total = pcm.channels[0].length
  const scale = Math.pow(2, bps - 1)
  const maxV = scale - 1
  const toInt = (src: Float32Array, off: number, n: number, dst: Int32Array) => {
    for (let i = 0; i < n; i++) {
      let v = Math.round(src[off + i] * scale)
      dst[i] = v > maxV ? maxV : v < -scale ? -scale : v
    }
  }
  const L = new Int32Array(BLOCK)
  const R = new Int32Array(BLOCK)
  const M = new Int32Array(BLOCK)
  const S = new Int32Array(BLOCK)
  const bw = new BitWriter(BLOCK * 4 * 2 + 64)
  const frames: Uint8Array[] = []
  let minFrame = Infinity
  let maxFrame = 0
  let frameNo = 0
  for (let off = 0; off < total || (total === 0 && frameNo === 0); off += BLOCK) {
    const n = Math.min(BLOCK, total - off)
    if (n <= 0) break
    toInt(pcm.channels[0], off, n, L)
    if (nch === 2) toInt(pcm.channels[1], off, n, R)
    let mode = 0 // 0 mono, 1 LR, 8 LS, 9 SR, 10 MS
    let first: Int32Array = L
    let second: Int32Array | null = null
    let ord1 = 0
    let ord2 = 0
    let bps1 = bps
    let bps2 = bps
    if (nch === 1) {
      ord1 = estimate(L, n).order
    } else {
      for (let i = 0; i < n; i++) {
        M[i] = (L[i] + R[i]) >> 1
        S[i] = L[i] - R[i]
      }
      const eL = estimate(L, n)
      const eR = estimate(R, n)
      const eM = estimate(M, n)
      const eS = estimate(S, n)
      const costs = [eL.cost + eR.cost, eL.cost + eS.cost, eS.cost + eR.cost, eM.cost + eS.cost]
      const bi = costs.indexOf(Math.min(...costs))
      if (bi === 0) {
        mode = 1; first = L; second = R; ord1 = eL.order; ord2 = eR.order
      } else if (bi === 1) {
        mode = 8; first = L; second = S; ord1 = eL.order; ord2 = eS.order; bps2 = bps + 1
      } else if (bi === 2) {
        mode = 9; first = S; second = R; ord1 = eS.order; ord2 = eR.order; bps1 = bps + 1
      } else {
        mode = 10; first = M; second = S; ord1 = eM.order; ord2 = eS.order; bps2 = bps + 1
      }
    }
    // ── frame header ──
    const hdr: number[] = [0xff, 0xf8]
    const bsCode = n === BLOCK ? 0b1100 : n <= 256 ? 0b0110 : 0b0111
    hdr.push((bsCode << 4) | 0) // sample rate from STREAMINFO
    const szCode = bps === 16 ? 4 : 6
    hdr.push((mode << 4) | (szCode << 1))
    hdr.push(...utf8Number(frameNo))
    if (bsCode === 0b0110) hdr.push(n - 1)
    else if (bsCode === 0b0111) hdr.push((n - 1) >> 8, (n - 1) & 255)
    const hb = Uint8Array.from(hdr)
    bw.reset()
    for (const b of hb) bw.write(b, 8)
    bw.write(crc8(hb), 8)
    writeSubframe(bw, first, n, bps1, ord1)
    if (second) writeSubframe(bw, second, n, bps2, ord2)
    bw.align()
    const body = bw.buf.subarray(0, bw.pos)
    const c16 = crc16(body)
    const frame = new Uint8Array(body.length + 2)
    frame.set(body)
    frame[body.length] = c16 >> 8
    frame[body.length + 1] = c16 & 255
    frames.push(frame)
    if (frame.length < minFrame) minFrame = frame.length
    if (frame.length > maxFrame) maxFrame = frame.length
    frameNo++
    if (frameNo % 24 === 0) await yieldIf(ctl, off / total)
  }
  if (!frames.length) {
    minFrame = 0
  }

  // ── metadata ──
  const si = new Uint8Array(34)
  const dv = new DataView(si.buffer)
  const bsz = total > 0 && total < BLOCK ? total : BLOCK
  dv.setUint16(0, bsz, false)
  dv.setUint16(2, bsz, false)
  dv.setUint8(4, (minFrame >> 16) & 255)
  dv.setUint16(5, minFrame & 0xffff, false)
  dv.setUint8(7, (maxFrame >> 16) & 255)
  dv.setUint16(8, maxFrame & 0xffff, false)
  // 20 bits sample rate | 3 bits channels-1 | 5 bits bps-1 | 36 bits total samples
  const sr = pcm.sampleRate
  dv.setUint8(10, (sr >> 12) & 255)
  dv.setUint8(11, (sr >> 4) & 255)
  dv.setUint8(12, ((sr & 15) << 4) | ((nch - 1) << 1) | (((bps - 1) >> 4) & 1))
  const totHi = Math.floor(total / 4294967296) & 15
  dv.setUint8(13, (((bps - 1) & 15) << 4) | totHi)
  dv.setUint32(14, total >>> 0, false)
  // bytes 18..33 MD5 stay zero
  const te = new TextEncoder()
  const comments: Uint8Array[] = []
  if (meta?.title) comments.push(te.encode('TITLE=' + meta.title))
  if (meta?.artist) comments.push(te.encode('ARTIST=' + meta.artist))
  const vendor = te.encode('HitStudio')
  const vcLen = 4 + vendor.length + 4 + comments.reduce((a, c) => a + 4 + c.length, 0)
  const vc = new Uint8Array(vcLen)
  const vdv = new DataView(vc.buffer)
  vdv.setUint32(0, vendor.length, true)
  vc.set(vendor, 4)
  let p = 4 + vendor.length
  vdv.setUint32(p, comments.length, true)
  p += 4
  for (const c of comments) {
    vdv.setUint32(p, c.length, true)
    vc.set(c, p + 4)
    p += 4 + c.length
  }
  const head = new Uint8Array(4 + 4 + 34 + 4 + vcLen)
  head.set([0x66, 0x4c, 0x61, 0x43]) // fLaC
  head.set([0x00, 0, 0, 34], 4) // STREAMINFO, not last
  head.set(si, 8)
  head.set([0x84, (vcLen >> 16) & 255, (vcLen >> 8) & 255, vcLen & 255], 42) // VORBIS_COMMENT, last
  head.set(vc, 46)
  return new Blob([head, ...frames] as BlobPart[], { type: 'audio/flac' })
}
