// Keeps the lit part of every range slider in step with its value (CSS reads --p). Works for sliders added later
// and for values that code sets directly, which do not fire an input event.
const upd = (el) => {
  const min = el.min === '' ? 0 : Number(el.min), max = el.max === '' ? 100 : Number(el.max)
  const p = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0
  el.style.setProperty('--p', `${Math.max(0, Math.min(100, p)).toFixed(2)}%`)
}
const scan = (root) => {
  if (root.nodeType !== 1) return
  if (root.matches('input[type=range]')) upd(root)
  root.querySelectorAll?.('input[type=range]').forEach(upd)
}
export function initRangeFill() {
  const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  Object.defineProperty(HTMLInputElement.prototype, 'value', { ...d, set(v) { d.set.call(this, v); if (this.type === 'range') upd(this) } })
  document.addEventListener('input', (e) => { if (e.target instanceof HTMLInputElement && e.target.type === 'range') upd(e.target) }, true)
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach(scan) }).observe(document.documentElement, { childList: true, subtree: true })
  scan(document.documentElement)
}
