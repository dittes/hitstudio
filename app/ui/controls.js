// Hardware-style controls (rotary knobs and faders) that wrap a native <input type="range">.
// The input stays in the DOM, invisible but focusable, so keyboard arrows, screen readers and any
// existing `input` listeners keep working; the visual control just reads and drives it.
//
//   knob({ label, input, unit })      → rotary knob, 270° sweep
//   fader({ label, input, axis })     → 'v' (channel / tempo) or 'h' (crossfader)
//   attachControls(root)              → wire every control under root; returns { sync() }
//
// A control is "bipolar" when its input carries data-default strictly between min and max
// (EQ, trim, filter, tempo): the default sits at 12 o'clock / the centre, and each half of the
// travel maps to its own side of the range (so a −26…+6 dB EQ still centres on 0 dB).

import { posToGain, fmtDb } from '../features/mixer/faderLaw.js'

const FMT = {
  mixdb: (v) => `${fmtDb(posToGain(v))} dB`,
  db: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dB`,
  pct: (v, min, max) => `${Math.round(((v - min) / (max - min)) * 100)}%`,
  filter: (v) => (Math.abs(v) < 0.02 ? 'Off' : v < 0 ? `Low-pass ${Math.round(-v * 100)}%` : `High-pass ${Math.round(v * 100)}%`),
  tempo: (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(1)}%`,
  level: (v) => `${Math.round(v * 100)}%`,
  semi: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v * 10) / 10)} st`,
  sec: (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`),
  pan: (v) => (Math.abs(v) < 0.03 ? 'Centre' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`),
  cutoff: (v) => (v > 0.985 ? 'Open' : `${Math.round(120 * Math.pow(20000 / 120, v))} Hz`),
  xf: (v) => (Math.abs(v - 0.5) < 0.02 ? 'Centre' : v < 0.5 ? `A ${Math.round((0.5 - v) * 200)}%` : `B ${Math.round((v - 0.5) * 200)}%`),
}

export const knob = ({ label, input, unit = 'pct', cls = '' }) =>
  `<div class="ctl knob ${cls}" data-unit="${unit}"><div class="knob-body" aria-hidden="true"><span class="knob-arc"></span><span class="knob-cap"><i></i></span></div>${input}<span class="ctl-label">${label}</span><output class="ctl-val" aria-hidden="true"></output></div>`

export const fader = ({ label = '', input, axis = 'v', unit = 'level', cls = '' }) =>
  `<div class="ctl fader fader-${axis} ${cls}" data-unit="${unit}"><div class="fader-slot" aria-hidden="true"><span class="fader-fill"></span><span class="fader-cap"></span></div>${input}${label ? `<span class="ctl-label">${label}</span>` : ''}<output class="ctl-val" aria-hidden="true"></output></div>`

function model(input) {
  const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 0.01
  const def = input.dataset.default != null ? Number(input.dataset.default) : min
  const bipolar = def > min && def < max
  const reset = input.dataset.reset != null ? Number(input.dataset.reset) : def // value a double-click goes back to
  const toPos = (v) => (bipolar ? (v <= def ? 0.5 * ((v - min) / (def - min)) : 0.5 + 0.5 * ((v - def) / (max - def))) : (v - min) / (max - min))
  const fromPos = (p) => {
    p = Math.max(0, Math.min(1, p))
    const v = bipolar ? (p <= 0.5 ? min + (p / 0.5) * (def - min) : def + ((p - 0.5) / 0.5) * (max - def)) : min + p * (max - min)
    return Math.round(v / step) * step
  }
  return { min, max, def, reset, bipolar, toPos, fromPos }
}

export function attachControls(root) {
  const items = [...root.querySelectorAll('.ctl')].map((el) => {
    const input = el.querySelector('input[type=range]'), m = model(input), out = el.querySelector('.ctl-val')
    const fmt = FMT[el.dataset.unit] || FMT.pct
    let last = NaN
    const render = (force) => {
      const v = Number(input.value)
      if (!force && v === last) return
      last = v
      const p = m.toPos(v)
      el.style.setProperty('--p', p.toFixed(4))
      if (el.classList.contains('knob')) {
        const angle = -135 + 270 * p, start = m.bipolar ? 0 : -135
        el.style.setProperty('--angle', `${angle}deg`)
        el.style.setProperty('--from', `${Math.min(start, angle)}deg`)
        el.style.setProperty('--sweep', `${Math.abs(angle - start)}deg`)
      } else {
        const start = m.bipolar ? 0.5 : 0
        el.style.setProperty('--f0', Math.min(start, p).toFixed(4))
        el.style.setProperty('--f1', Math.max(start, p).toFixed(4))
      }
      el.classList.toggle('at-default', Math.abs(v - m.def) < 1e-6)
      const text = fmt(v, m.min, m.max)
      out.textContent = text
      input.setAttribute('aria-valuetext', text)
    }
    const set = (v) => {
      v = Math.max(m.min, Math.min(m.max, v))
      if (Number(input.value) === v) return
      input.value = String(v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      render()
    }
    const grab = el.querySelector('.knob-body, .fader-slot')
    grab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      try { grab.setPointerCapture(e.pointerId) } catch { /* pointer already gone; listeners below still work */ }
      input.focus({ preventScroll: true })
      el.classList.add('is-dragging')
      const startP = m.toPos(Number(input.value)), y0 = e.clientY
      const slot = el.classList.contains('fader') ? grab.getBoundingClientRect() : null
      const fromPointer = (ev) => {
        if (!slot) return startP + ((y0 - ev.clientY) / 180) * (ev.shiftKey ? 0.2 : 1) // knob: drag up/down
        const cap = 22 // keep the cap's centre under the pointer
        return el.classList.contains('fader-h') ? (ev.clientX - slot.left - cap / 2) / (slot.width - cap) : 1 - (ev.clientY - slot.top - cap / 2) / (slot.height - cap)
      }
      const move = (ev) => set(m.fromPos(fromPointer(ev)))
      if (slot) move(e)
      const up = () => { el.classList.remove('is-dragging'); grab.removeEventListener('pointermove', move) }
      grab.addEventListener('pointermove', move)
      grab.addEventListener('pointerup', up, { once: true })
      grab.addEventListener('pointercancel', up, { once: true })
    })
    grab.addEventListener('dblclick', () => set(m.reset))
    grab.addEventListener('wheel', (e) => { e.preventDefault(); set(m.fromPos(m.toPos(Number(input.value)) - Math.sign(e.deltaY) * (e.shiftKey ? 0.01 : 0.04))) }, { passive: false })
    input.addEventListener('input', () => render())
    el.title = 'Drag, scroll or use the arrow keys · double-click to reset'
    render(true)
    return { el, input, render }
  })
  return {
    /** Re-read every input (call after code changes input.value directly). */
    sync() { for (const it of items) it.render() },
    /** True while the user is dragging this input's control (don't overwrite it from state then). */
    isBusy: (input) => !!input.closest('.ctl')?.classList.contains('is-dragging'),
  }
}
