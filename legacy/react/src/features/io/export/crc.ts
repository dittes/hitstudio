// CRC helpers: CRC32 (zip, ogg uses its own poly), CRC8 / CRC16 (FLAC frames).
const T32 = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array, start = 0, end = data.length): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = T32[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const T8 = (() => {
  const t = new Uint8Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff
    t[n] = c
  }
  return t
})()
/** FLAC CRC-8: poly x^8+x^2+x+1, init 0 */
export function crc8(data: Uint8Array, start = 0, end = data.length): number {
  let c = 0
  for (let i = start; i < end; i++) c = T8[c ^ data[i]]
  return c
}

const T16 = (() => {
  const t = new Uint16Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n << 8
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff
    t[n] = c
  }
  return t
})()
/** FLAC CRC-16: poly x^16+x^15+x^2+1, init 0 */
export function crc16(data: Uint8Array, start = 0, end = data.length): number {
  let c = 0
  for (let i = start; i < end; i++) c = ((c << 8) & 0xffff) ^ T16[((c >> 8) ^ data[i]) & 0xff]
  return c
}

/** Ogg CRC: poly 0x04c11db7, init 0, no reflection, no final xor */
const TOGG = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n << 24
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1
    t[n] = c >>> 0
  }
  return t
})()
export function crcOgg(data: Uint8Array): number {
  let c = 0
  for (let i = 0; i < data.length; i++) c = ((c << 8) ^ TOGG[((c >>> 24) ^ data[i]) & 0xff]) >>> 0
  return c >>> 0
}
