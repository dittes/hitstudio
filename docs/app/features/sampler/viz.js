// Sampler visuals: stereo VU meters reading the master output.
import { getMeter } from './engine.js'

const dpr = () => Math.min(2, window.devicePixelRatio || 1)
function fit(canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight, r = dpr()
  if (!w || !h) return null
  if (canvas.width !== Math.round(w * r)) { canvas.width = Math.round(w * r); canvas.height = Math.round(h * r) }
  const g = canvas.getContext('2d')
  g.setTransform(r, 0, 0, r, 0, 0)
  return { g, w, h }
}
const css = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback

/** Stereo VU meters: two horizontal LED bars with peak hold, a dB scale and a clip lamp. */
export function createVU(root) {
  const canvas = root.querySelector('canvas')
  const clipEl = root.querySelector('.vu-clip')
  const MIN = -48, MAX = 3
  const level = [-96, -96], peak = [-96, -96], hold = [0, 0]
  let td = null
  let clipUntil = 0
  const readDb = (an, i, now) => {
    if (!td || td.length !== an.fftSize) td = new Float32Array(an.fftSize)
    an.getFloatTimeDomainData(td)
    let s = 0, pk = 0
    for (let k = 0; k < td.length; k++) { const v = td[k]; s += v * v; if (Math.abs(v) > pk) pk = Math.abs(v) }
    const rms = 20 * Math.log10(Math.sqrt(s / td.length) + 1e-6)
    const peakDb = 20 * Math.log10(pk + 1e-6)
    // VU ballistics: quick to rise, slow to fall
    level[i] += (rms - level[i]) * (rms > level[i] ? 0.5 : 0.09)
    if (peakDb >= peak[i]) { peak[i] = peakDb; hold[i] = now + 900 } else if (now > hold[i]) peak[i] -= 0.7
    if (pk >= 0.985) clipUntil = now + 2500
  }
  clipEl?.addEventListener('click', () => { clipUntil = 0 })
  return {
    draw() {
      const m = getMeter()
      const now = performance.now()
      readDb(m.l, 0, now)
      readDb(m.r, 1, now)
      clipEl?.classList.toggle('on', now < clipUntil)
      const view = fit(canvas)
      if (!view) return
      const { g, w, h } = view
      g.clearRect(0, 0, w, h)
      const rowH = Math.floor((h - 12) / 2), segs = 30, gap = 1.5, sw = (w - 14 - gap * (segs - 1)) / segs
      const pos = (db) => Math.max(0, Math.min(1, (db - MIN) / (MAX - MIN)))
      const colorAt = (t) => { const db = MIN + t * (MAX - MIN); return db > -3 ? '#f87171' : db > -12 ? '#facc15' : '#4ade80' }
      for (let ch = 0; ch < 2; ch++) {
        const y = ch * (rowH + 3)
        g.fillStyle = 'rgba(255,255,255,.7)'
        g.font = '600 9px system-ui,sans-serif'
        g.textBaseline = 'middle'
        g.fillText(ch ? 'R' : 'L', 0, y + rowH / 2 + 0.5)
        const lit = pos(level[ch]) * segs, pkSeg = Math.round(pos(peak[ch]) * segs) - 1
        for (let s = 0; s < segs; s++) {
          const x = 14 + s * (sw + gap)
          const on = s < lit || s === pkSeg
          g.fillStyle = on ? colorAt((s + 0.5) / segs) : 'rgba(255,255,255,.08)'
          g.globalAlpha = on ? (s === pkSeg && s >= lit ? 0.9 : 1) : 1
          g.fillRect(x, y, sw, rowH)
        }
      }
      g.globalAlpha = 1
      // dB scale
      g.fillStyle = 'rgba(255,255,255,.45)'
      g.font = '500 8px system-ui,sans-serif'
      g.textBaseline = 'alphabetic'
      for (const db of [-48, -24, -12, -6, 0]) {
        const x = 14 + pos(db) * (w - 14 - 2)
        g.textAlign = db === 0 ? 'right' : db === -48 ? 'left' : 'center'
        g.fillText(db === 0 ? '0' : String(db), db === 0 ? w : x, h - 1)
      }
      g.textAlign = 'left'
    },
  }
}
