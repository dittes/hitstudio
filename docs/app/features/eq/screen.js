// Equalizer screen: response graph over the live spectrum, 10 band sliders, on/off and presets.
import { $, $$, icon, escape } from '../../dom.js';
import { useStore } from '../../core/store.js';
import { getEngine } from '../../core/engine.js';
import { toast } from '../../core/toast.js';
import { EQ_BANDS, EQ_PRESETS, EQ_RANGE, FLAT_EQ, eqOf, eqActive, eqLabel, eqHeadroomDb, makeEqFilters } from './eq.js';

const S = () => useStore.getState();
const fmtDb = (g) => (g > 0 ? '+' : g < 0 ? '−' : '') + Math.abs(g).toFixed(Math.abs(g) % 1 ? 1 : 0);
const fmtHz = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));
const matchPreset = (gains) => EQ_PRESETS.find((p) => p.gains.every((g, i) => g === gains[i]))?.id ?? 'custom';

/** One-button reset, also used from the Mix screen. */
export function resetEq() {
  if (!eqActive(eqOf(S().project)) && eqOf(S().project).preset === 'flat') return;
  S().mutate('Reset EQ', (p) => { p.master.eq = { ...FLAT_EQ, gains: [...FLAT_EQ.gains] } });
  toast('Equalizer reset to flat.');
}
function setGains(gains, label, coalesce) {
  S().mutate(label, (p) => { p.master.eq = { enabled: true, gains, preset: matchPreset(gains) } }, coalesce ? { coalesce } : undefined);
}

/** Tiny inline curve for preset cards. */
function miniCurve(gains) {
  const pts = gains.map((g, i) => `${(i / (gains.length - 1)) * 100},${20 - (g / EQ_RANGE) * 16}`).join(' ');
  return `<svg class="eq-mini" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="20" x2="100" y2="20"/><polyline points="${pts}"/></svg>`;
}

export function mountEq(container) {
  let raf = 0, disposed = false, drag = null;
  const eq0 = eqOf(S().project);
  container.innerHTML = `<section class="eq-root">
    <header class="eq-head">
      <div><h1>Equalizer</h1><p>Shapes everything you hear: songs, beats, the DJ decks and your mix. It is also applied when you export.</p></div>
      <div class="eq-head-actions">
        <label class="eq-power"><input type="checkbox" data-eq-enabled ${eq0.enabled ? 'checked' : ''} /><span class="eq-switch" aria-hidden="true"></span><span class="eq-power-label">${eq0.enabled ? 'On' : 'Off'}</span></label>
        <button data-action="eq-reset">${icon('undo')}<span>Reset to flat</span></button>
      </div>
    </header>
    <div class="eq-card eq-main">
      <div class="eq-graph-head"><span class="eq-status"></span><span class="eq-headroom"></span></div>
      <div class="eq-graph-wrap"><canvas class="eq-graph" aria-label="Equalizer curve. Drag a dot up or down to change a band."></canvas></div>
      <div class="eq-bands">${EQ_BANDS.map((b, i) => `<div class="eq-band"><output data-band-out="${i}">0</output><input type="range" data-band="${i}" min="${-EQ_RANGE}" max="${EQ_RANGE}" step="0.5" value="0" aria-label="${fmtHz(b.f)} hertz band, in decibels" title="Double-click to reset" /><span>${b.label}<small>Hz</small></span></div>`).join('')}</div>
    </div>
    <div class="eq-card"><h2>Presets</h2><div class="eq-presets">${EQ_PRESETS.map((p) => `<button class="eq-preset" data-eq-preset="${p.id}" aria-pressed="false">${miniCurve(p.gains)}<b>${escape(p.name)}</b><small>${escape(p.hint)}</small></button>`).join('')}</div></div>
  </section>`;
  const root = container.firstElementChild, canvas = $('.eq-graph', root);

  // response maths on a throwaway offline context (works even while the EQ is switched off)
  const off = new OfflineAudioContext(1, 1, 48000), probe = makeEqFilters(off);
  const N = 256, freqs = new Float32Array(N).map((_, i) => 20 * Math.pow(1000, i / (N - 1)));
  const mag = new Float32Array(N), phase = new Float32Array(N), total = new Float32Array(N);
  function response(gains) {
    total.fill(0);
    probe.forEach((f, i) => { f.gain.value = gains[i]; f.getFrequencyResponse(freqs, mag, phase); for (let k = 0; k < N; k++) total[k] += 20 * Math.log10(Math.max(1e-6, mag[k])) });
    return total;
  }

  const xOf = (f, w) => (Math.log10(f / 20) / 3) * w;
  const yOf = (db, h) => h / 2 - (db / (EQ_RANGE + 3)) * (h / 2);
  let spec = null;
  function draw() {
    if (disposed) return;
    raf = requestAnimationFrame(draw);
    const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr) }
    const g = canvas.getContext('2d'), cs = getComputedStyle(root), eq = eqOf(S().project);
    const ink = cs.getPropertyValue('--text').trim() || '#eee', faint = cs.getPropertyValue('--grid-strong').trim() || 'rgba(255,255,255,.1)', accent = cs.getPropertyValue('--accent').trim() || '#a78bfa', accent2 = cs.getPropertyValue('--accent-2').trim() || '#f472b6';
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    // grid
    g.strokeStyle = faint; g.lineWidth = 1; g.font = '10px system-ui'; g.fillStyle = cs.getPropertyValue('--text-3').trim() || '#888';
    for (const db of [-12, -6, 0, 6, 12]) { const y = Math.round(yOf(db, h)) + .5; g.globalAlpha = db === 0 ? 1 : .55; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.globalAlpha = 1; g.fillText(db ? fmtDb(db) + ' dB' : '0 dB', 6, y - 4) }
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = Math.round(xOf(f, w)) + .5; g.globalAlpha = .4; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.globalAlpha = 1; g.fillText(fmtHz(f), x + 4, h - 6) }
    // live spectrum (after the EQ, so you see what you hear)
    const an = getEngine().masterAnalyser;
    if (!spec || spec.length !== an.frequencyBinCount) spec = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(spec);
    const nyq = getEngine().ctx.sampleRate / 2;
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 2) { const f = 20 * Math.pow(1000, x / w), bin = Math.min(spec.length - 1, Math.round((f / nyq) * spec.length)), v = Math.max(0, Math.min(1, (spec[bin] + 100) / 80)); g.lineTo(x, h - v * h * .9) }
    g.lineTo(w, h); g.closePath();
    const sg = g.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, accent2 + '55'); sg.addColorStop(1, accent + '08'); g.fillStyle = sg; g.fill();
    // curve
    const gains = drag ? drag.gains : eq.gains, r = response(gains), on = eq.enabled;
    g.beginPath(); for (let k = 0; k < N; k++) { const x = xOf(freqs[k], w), y = yOf(r[k], h); k ? g.lineTo(x, y) : g.moveTo(x, y) }
    g.setLineDash(on ? [] : [6, 5]); g.lineWidth = 2.5; g.strokeStyle = on ? accent : ink + '66'; g.shadowColor = accent; g.shadowBlur = on ? 12 : 0; g.stroke(); g.shadowBlur = 0; g.setLineDash([]);
    if (on) { g.lineTo(w, yOf(0, h)); g.lineTo(0, yOf(0, h)); g.closePath(); g.fillStyle = accent + '1f'; g.fill() }
    // band handles
    EQ_BANDS.forEach((b, i) => { const x = xOf(b.f, w), k = Math.round((Math.log10(b.f / 20) / 3) * (N - 1)), y = yOf(r[Math.max(0, Math.min(N - 1, k))], h); g.beginPath(); g.arc(x, y, drag?.i === i ? 7 : 5, 0, Math.PI * 2); g.fillStyle = on ? '#fff' : ink + '88'; g.fill(); g.lineWidth = 2; g.strokeStyle = on ? accent : 'transparent'; g.stroke() });
  }

  function syncUI() {
    const eq = eqOf(S().project);
    $$('[data-band]', root).forEach((input) => { const i = Number(input.dataset.band); if (document.activeElement !== input || !drag) input.value = eq.gains[i]; $(`[data-band-out="${i}"]`, root).textContent = fmtDb(eq.gains[i]) });
    $$('[data-eq-preset]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.eqPreset === eq.preset)));
    $('[data-eq-enabled]', root).checked = eq.enabled;
    $('.eq-power-label', root).textContent = eq.enabled ? 'On' : 'Off';
    root.classList.toggle('eq-off', !eq.enabled);
    $('.eq-status', root).innerHTML = !eq.enabled ? 'Equalizer is <b>off</b>' : eqActive(eq) ? `Preset: <b>${escape(eqLabel(eq))}</b>` : '<b>Flat</b> · no change to the sound';
    const head = eqHeadroomDb(eq);
    $('.eq-headroom', root).textContent = head < -0.05 ? `Auto headroom ${fmtDb(Math.round(head * 10) / 10)} dB` : '';
    $('[data-action=eq-reset]', root).disabled = !eqActive(eq) && eq.preset === 'flat';
  }

  root.addEventListener('input', (e) => {
    const i = e.target.dataset.band;
    if (i == null) return;
    const gains = [...eqOf(S().project).gains]; gains[Number(i)] = Number(e.target.value);
    setGains(gains, 'Adjust EQ', 'eq-band-' + i);
  });
  root.addEventListener('dblclick', (e) => {
    const i = e.target.dataset?.band;
    if (i == null) return;
    const gains = [...eqOf(S().project).gains]; gains[Number(i)] = 0; setGains(gains, 'Reset EQ band');
  });
  root.addEventListener('change', (e) => {
    if (!('eqEnabled' in e.target.dataset)) return;
    const on = e.target.checked;
    S().mutate(on ? 'Turn EQ on' : 'Turn EQ off', (p) => { p.master.eq = { ...eqOf(p), gains: [...eqOf(p).gains], enabled: on } });
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-eq-preset]');
    if (!b) return;
    const preset = EQ_PRESETS.find((p) => p.id === b.dataset.eqPreset);
    S().mutate(`EQ preset: ${preset.name}`, (p) => { p.master.eq = { enabled: true, gains: [...preset.gains], preset: preset.id } });
  });
  // drag the dots on the graph
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect(), w = r.width, x = e.clientX - r.left;
    let i = 0, best = Infinity;
    EQ_BANDS.forEach((b, k) => { const d = Math.abs(xOf(b.f, w) - x); if (d < best) { best = d; i = k } });
    if (best > 36) return;
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    drag = { i, gains: [...eqOf(S().project).gains] };
    const startY = e.clientY, startGain = drag.gains[i], pxPerDb = r.height / 2 / (EQ_RANGE + 3);
    const move = (ev) => {
      const db = Math.round((startGain + (startY - ev.clientY) / pxPerDb) * 2) / 2;
      const next = Math.max(-EQ_RANGE, Math.min(EQ_RANGE, db));
      if (next === drag.gains[i]) return;
      drag.gains[i] = next;
      setGains([...drag.gains], 'Adjust EQ', 'eq-drag-' + i);
    };
    const up = () => { drag = null; canvas.removeEventListener('pointermove', move); syncUI() };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up, { once: true });
    canvas.addEventListener('pointercancel', up, { once: true });
  });

  syncUI(); draw();
  return {
    /** The EQ screen only depends on master.eq, so never rebuild it for project changes. */
    onProject(p, prev) { if (p.master?.eq !== prev.master?.eq) syncUI(); return true },
    dispose() { disposed = true; cancelAnimationFrame(raf) },
  };
}
