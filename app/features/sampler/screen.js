// Sampler page: 16 pads (computer keyboard 1-4 / Q-R / A-F / Z-V), a waveform editor for the selected pad,
// and everything to replace a sound: pick a file, drop one on a pad, or record with the microphone.
import { $, $$, icon, escape } from '../../dom.js'
import { knob, attachControls } from '../../ui/controls.js'
import { toast } from '../../core/toast.js'
import { GROUPS, PAD_KEYS, DEFAULT_KIT, SOUND_MIME } from './kit.js'
import {
  useSampler, initSampler, trigger, release, stopAllVoices, setParam, setName, select, padView, playhead, onVoice,
  loadFileToPad, resetPad, resetKit, padToTimeline, startPadRecording, stopPadRecording, isRecordingPad,
  loadManifest, libraryBuffer, assignLibrarySound, previewBuffer, stopPreview,
} from './engine.js'

const st = () => useSampler.getState()
const colorOf = (i) => GROUPS[DEFAULT_KIT[i].group].color
const AUDIO_FILE = (f) => f.type.startsWith('audio/') || /\.(wav|mp3|flac|ogg|m4a|aac|aiff?)$/i.test(f.name)

/** min/max peaks per pixel column, cached per buffer + width */
const peakCache = new WeakMap()
function peaksOf(buffer, cols) {
  const key = `${cols}`
  let m = peakCache.get(buffer)
  if (!m) peakCache.set(buffer, (m = new Map()))
  if (m.has(key)) return m.get(key)
  const ch = buffer.getChannelData(0)
  const out = new Float32Array(cols * 2)
  const step = ch.length / cols
  for (let x = 0; x < cols; x++) {
    let lo = 0, hi = 0
    const a = Math.floor(x * step), b = Math.max(a + 1, Math.floor((x + 1) * step))
    for (let i = a; i < b; i += Math.max(1, Math.floor((b - a) / 24))) {
      const v = ch[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    out[x * 2] = lo
    out[x * 2 + 1] = hi
  }
  m.set(key, out)
  return out
}

function drawWave(canvas, buffer, color, p, head, mini = false) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (!w || !h) return
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr) }
  const g = canvas.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const mid = h / 2
  g.fillStyle = 'rgba(255,255,255,.04)'
  g.fillRect(0, mid - 0.5, w, 1)
  if (!buffer) return
  const cols = Math.max(1, Math.floor(w))
  const pk = peaksOf(buffer, cols)
  const x0 = p.start * w, x1 = p.end * w
  for (let x = 0; x < cols; x++) {
    const inside = x >= x0 && x <= x1
    g.fillStyle = inside ? color : 'rgba(255,255,255,.18)'
    const lo = pk[x * 2], hi = pk[x * 2 + 1]
    const a = mid - Math.max(1, hi * (mid - 6)), b = mid - Math.min(-1, lo * (mid - 6))
    g.fillRect(x, a, 1, Math.max(1, b - a))
  }
  if (!mini) {
  // trimmed-away parts are dimmed, handles sit at the cut points
    g.fillStyle = 'rgba(8,8,14,.55)'
    g.fillRect(0, 0, x0, h)
    g.fillRect(x1, 0, w - x1, h)
    for (const [x, left] of [[x0, true], [x1, false]]) {
      g.fillStyle = color
      g.fillRect(x - 1, 0, 2, h)
      g.beginPath()
      g.roundRect(left ? x - 1 : x - 13, h / 2 - 14, 14, 28, 5)
      g.fill()
      g.fillStyle = 'rgba(0,0,0,.45)'
      g.fillRect((left ? x + 4 : x - 8), h / 2 - 7, 1.5, 14)
      g.fillRect((left ? x + 7 : x - 5), h / 2 - 7, 1.5, 14)
    }
  }
  if (head >= 0) {
    g.fillStyle = '#fff'
    g.shadowColor = '#fff'
    g.shadowBlur = 8
    g.fillRect(head * w - 1, 0, 2, h)
    g.shadowBlur = 0
  }
}

export function mountSampler(container) {
  const ac = new AbortController()
  const { signal } = ac
  const heldKeys = new Map() // key → pad index (for gate release)
  let raf = 0

  const padHTML = (i) => {
    const pad = st().pads[i]
    return `<button class="sp-pad" data-pad="${i}" style="--c:${colorOf(i)}" aria-label="${escape(pad.name)} pad, key ${PAD_KEYS[i].toUpperCase()}">
      <span class="sp-pad-top"><kbd>${PAD_KEYS[i].toUpperCase()}</kbd><i class="sp-dot" title="Your own sound"></i></span>
      <canvas class="sp-thumb" aria-hidden="true"></canvas>
      <b class="sp-pad-name">${escape(pad.name)}</b>
    </button>`
  }

  container.innerHTML = `<section class="sp-root hw">
    <header class="sp-head">
      <div class="sp-title"><span class="sp-eyebrow">${icon('sampler')} Sampler</span><h1>Play your <span class="grad-text">sounds</span></h1><p>Tap the pads or use your keyboard. Every pad can hold your own sound: drop a file on it, or record one.</p></div>
      <div class="sp-head-actions"><button class="sp-btn" data-sp-full aria-pressed="false" title="Fullscreen">${icon('maximize')}<span>Fullscreen</span></button><button class="sp-btn" data-sp-stop>${icon('stop')}<span>Stop all</span></button><button class="sp-btn" data-sp-resetkit>${icon('history')}<span>Reset kit</span></button></div>
    </header>
    <div class="sp-main">
      <div class="sp-deck">
        <div class="sp-pads" role="group" aria-label="Sampler pads">${Array.from({ length: 16 }, (_, i) => padHTML(i)).join('')}</div>
        <div class="sp-legend">${GROUPS.map((g) => `<span style="--c:${g.color}"><i></i>${g.name}</span>`).join('')}</div>
      </div>
      <aside class="sp-editor" aria-label="Edit the selected pad"></aside>
    </div>
  </section>`

  const padEls = $$('.sp-pad', container)
  const editor = $('.sp-editor', container)
  let controls = null

  // ── editor: two tabs, Edit (waveform, knobs) and Sounds (the library) ──
  let tab = 'edit'
  let manifest = null
  let sbCat = 'suggested'
  let sbQuery = ''
  let listening = null // library sound id being previewed
  const kitRow = (i) => Math.floor(i / 4)
  const entryById = (id) => manifest?.sounds.find((x) => x.id === id)

  function headHTML(i, pad, c) {
    const kind = pad.custom ? ['mine', 'Your sound'] : pad.src ? ['lib', 'Library sound'] : ['', 'Factory sound']
    return `<div class="sp-ed-head">
        <span class="sp-ed-chip" style="--c:${c}">${PAD_KEYS[i].toUpperCase()}</span>
        <input class="sp-name" data-sp-name value="${escape(pad.name)}" maxlength="24" aria-label="Pad name" spellcheck="false" />
        <span class="sp-badge ${kind[0]}">${kind[1]}</span>
      </div>
      <div class="sp-tabs" role="tablist"><button role="tab" data-sp-tab="edit" aria-selected="${tab === 'edit'}" class="${tab === 'edit' ? 'on' : ''}">${icon('edit')}<span>Edit</span></button><button role="tab" data-sp-tab="sounds" aria-selected="${tab === 'sounds'}" class="${tab === 'sounds' ? 'on' : ''}">${icon('library')}<span>Sounds</span>${manifest ? `<em>${manifest.sounds.length}</em>` : ''}</button></div>`
  }

  function soundsHTML(i) {
    return `<div class="sp-sb">
      <label class="sp-sb-search">${icon('search')}<input data-sp-search type="search" placeholder="${manifest ? `Search ${manifest.sounds.length} sounds` : 'Loading sounds…'}" value="${escape(sbQuery)}" autocomplete="off" aria-label="Search sounds" /></label>
      <div class="sp-sb-cats" data-sp-cats></div>
      <div class="sp-sb-list" data-sp-list role="list"></div>
      <div class="sp-sb-foot"><button class="primary" data-sp-load>${icon('folder')}<span>Your own file…</span></button><span class="sp-hint">Drag a sound onto any pad, or double-click to put it on pad ${PAD_KEYS[i].toUpperCase()}</span></div>
    </div>`
  }

  function renderSoundList() {
    const list = $('[data-sp-list]', editor)
    const cats = $('[data-sp-cats]', editor)
    if (!list || !cats) return
    const i = st().selected
    if (!manifest) { list.innerHTML = '<div class="sp-sb-empty">Loading the sound library…</div>'; return }
    const row = kitRow(i)
    const q = sbQuery.trim().toLowerCase()
    const inCat = (x) => sbCat === 'all' ? true : sbCat === 'suggested' ? manifest.categories.find((c) => c.id === x.cat)?.row === row : x.cat === sbCat
    const items = manifest.sounds.filter((x) => inCat(x) && (!q || `${x.name} ${manifest.categories.find((c) => c.id === x.cat)?.name}`.toLowerCase().includes(q)))
    const count = (fn) => manifest.sounds.filter(fn).length
    cats.innerHTML = [['suggested', 'For this pad', count((x) => manifest.categories.find((c) => c.id === x.cat)?.row === row)], ['all', 'All', manifest.sounds.length], ...manifest.categories.map((c) => [c.id, c.name, count((x) => x.cat === c.id)])]
      .map(([id, name, n]) => `<button data-sp-cat="${id}" class="${sbCat === id ? 'on' : ''}" aria-pressed="${sbCat === id}">${escape(name)}<em>${n}</em></button>`).join('')
    const current = st().pads[i].src
    list.innerHTML = items.map((x) => `<div class="sp-sound ${listening === x.id ? 'on' : ''} ${current === `lib:${x.id}` ? 'cur' : ''}" draggable="true" data-sound="${x.id}" role="listitem">
        <button class="sp-sound-play" data-sp-listen="${x.id}" aria-label="${listening === x.id ? 'Stop' : 'Listen to'} ${escape(x.name)}">${icon(listening === x.id ? 'stop' : 'play')}</button>
        <span class="sp-sound-name">${escape(x.name)}</span>
        <em class="sp-sound-cat">${escape(manifest.categories.find((c) => c.id === x.cat)?.name ?? '')}</em>
        <span class="sp-sound-dur">${x.dur.toFixed(x.dur < 10 ? 1 : 0)} s</span>
        <button class="sp-sound-use" data-sp-use="${x.id}">Use</button>
      </div>`).join('') || '<div class="sp-sb-empty">No sounds match.</div>'
  }

  function renderEditor() {
    const i = st().selected
    const pad = st().pads[i]
    const p = pad.params
    const c = colorOf(i)
    const range = (attr, min, max, step, value, def, label) => `<input data-k="${attr}" data-default="${def}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}" />`
    editor.style.setProperty('--c', c)
    if (tab === 'sounds') {
      editor.innerHTML = headHTML(i, pad, c) + soundsHTML(i)
      renderSoundList()
      return
    }
    editor.innerHTML = headHTML(i, pad, c) + `
      <div class="sp-wave" data-sp-wave><canvas></canvas>${padView(i) ? '' : '<span class="sp-wave-empty">Loading…</span>'}<div class="sp-wave-drop">${icon('download')}<span>Drop a sound here</span></div></div>
      <div class="sp-wave-meta"><span data-sp-time></span><span class="sp-hint">Drag the handles to trim · double-click to reset</span></div>
      <div class="sp-row">
        <div class="sp-seg" role="group" aria-label="Playback mode">${[['oneshot', 'One-shot', 'Plays to the end'], ['gate', 'Hold', 'Plays while you hold the pad'], ['loop', 'Loop', 'Repeats while you hold the pad']].map(([id, label, tip]) => `<button data-sp-mode="${id}" class="${p.mode === id ? 'on' : ''}" aria-pressed="${p.mode === id}" title="${tip}">${label}</button>`).join('')}</div>
        <button class="sp-toggle ${p.reverse ? 'on' : ''}" data-sp-reverse aria-pressed="${p.reverse}">${icon('previous')}<span>Reverse</span></button>
        <label class="sp-select"><span>Choke</span><select data-k="choke" aria-label="Choke group"><option value="0" ${p.choke === 0 ? 'selected' : ''}>Off</option>${[1, 2, 3, 4].map((n) => `<option value="${n}" ${p.choke === n ? 'selected' : ''}>Group ${n}</option>`).join('')}</select></label>
      </div>
      <div class="sp-knobs">
        ${knob({ label: 'Volume', unit: 'pct', cls: 'knob-sm', input: range('vol', 0, 1.2, 0.01, p.vol, 0.9, 'Volume') })}
        ${knob({ label: 'Pan', unit: 'pan', cls: 'knob-sm', input: range('pan', -1, 1, 0.01, p.pan, 0, 'Pan') })}
        ${knob({ label: 'Pitch', unit: 'semi', cls: 'knob-sm', input: range('pitch', -12, 12, 0.5, p.pitch, 0, 'Pitch in semitones') })}
        ${knob({ label: 'Attack', unit: 'sec', cls: 'knob-sm', input: range('attack', 0.002, 1, 0.002, p.attack, 0.002, 'Attack') })}
        ${knob({ label: 'Release', unit: 'sec', cls: 'knob-sm', input: range('release', 0.005, 2, 0.005, p.release, 0.08, 'Release') })}
        ${knob({ label: 'Filter', unit: 'cutoff', cls: 'knob-sm', input: range('cutoff', 0, 1, 0.01, p.cutoff, 1, 'Low-pass filter') })}
        ${knob({ label: 'Reverb', unit: 'pct', cls: 'knob-sm', input: range('reverb', 0, 1, 0.01, p.reverb, 0.06, 'Reverb send') })}
      </div>
      <div class="sp-actions">
        <button class="primary" data-sp-tab="sounds">${icon('library')}<span>Browse sounds</span></button>
        <button data-sp-load>${icon('folder')}<span>Your file…</span></button>
        <button data-sp-rec class="${isRecordingPad() ? 'on rec' : ''}">${icon('mic')}<span>${isRecordingPad() ? 'Stop recording' : 'Record'}</span></button>
        <button data-sp-timeline title="Put this sound on a new track in the editor">${icon('edit')}<span>To timeline</span></button>
        <button data-sp-reset ${pad.custom || pad.src ? '' : 'disabled'} title="Bring back this pad's factory sound">${icon('history')}<span>Factory sound</span></button>
      </div>`
    controls = attachControls(editor)
    drawEditor()
  }

  // ── pad thumbnails and the big waveform ──
  function drawThumbs() {
    padEls.forEach((el, i) => {
      el.classList.toggle('custom', st().pads[i].custom)
      el.classList.toggle('selected', st().selected === i)
      $('.sp-pad-name', el).textContent = st().pads[i].name
      const canvas = $('.sp-thumb', el)
      const b = padView(i)
      if (b) drawWave(canvas, b, colorOf(i), st().pads[i].params, -1, true)
    })
  }
  function drawEditor(head = -1) {
    const i = st().selected
    const wave = $('[data-sp-wave]', editor)
    if (!wave) return
    const b = padView(i)
    wave.classList.toggle('empty', !b)
    if (b) drawWave($('canvas', wave), b, colorOf(i), st().pads[i].params, head)
    const p = st().pads[i].params
    const t = $('[data-sp-time]', editor)
    if (b && t) {
      const len = Math.max(0, (p.end - p.start) * b.duration)
      t.textContent = `${len.toFixed(2)} s of ${b.duration.toFixed(2)} s`
    }
  }

  // ── playing ──
  function hit(i, vel = 0.85, select_ = true) {
    if (select_ && st().selected !== i) { select(i); renderEditor(); drawThumbs() }
    return trigger(i, vel)
  }
  const flash = (i) => {
    const el = padEls[i]
    el.classList.remove('hit')
    void el.offsetWidth
    el.classList.add('hit')
  }
  const offVoice = onVoice((type, i) => { if (type === 'hit') flash(i) })
  const pointerHolds = new Map() // pointerId → pad index
  container.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.sp-pad')
    if (!el || e.button !== 0) return
    const i = Number(el.dataset.pad)
    // a hit in the lower part of the pad is softer, in the upper part harder (like pressing near the edge of a real pad)
    const r = el.getBoundingClientRect()
    const vel = e.shiftKey ? 0.5 : Math.min(1, 0.55 + 0.45 * (1 - (e.clientY - r.top) / r.height))
    pointerHolds.set(e.pointerId, i)
    hit(i, vel)
  }, { signal })
  const up = (e) => {
    const i = pointerHolds.get(e.pointerId)
    if (i === undefined) return
    pointerHolds.delete(e.pointerId)
    release(i)
  }
  window.addEventListener('pointerup', up, { signal })
  window.addEventListener('pointercancel', up, { signal })

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return
    if (e.target.closest?.('input[type=text],input:not([type]),input[type=search],textarea,select,[contenteditable=true]')) return
    if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); stopAllVoices(); return }
    if (e.repeat) return
    const i = PAD_KEYS.indexOf(e.key.toLowerCase())
    if (i < 0) return
    e.preventDefault()
    e.stopImmediatePropagation()
    heldKeys.set(e.key.toLowerCase(), i)
    hit(i, e.shiftKey ? 0.5 : 0.9, false)
  }, { capture: true, signal })
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase()
    if (heldKeys.has(k)) { release(heldKeys.get(k)); heldKeys.delete(k) }
  }, { capture: true, signal })

  // ── listening to and using library sounds ──
  async function toggleListen(id) {
    const entry = entryById(id)
    if (!entry) return
    if (listening === id) { stopPreview(); listening = null; renderSoundList(); return }
    listening = id
    renderSoundList()
    try {
      const v = previewBuffer(await libraryBuffer(entry))
      if (listening !== id) { stopPreview(); return }
      v.onend = () => { if (listening === id) { listening = null; renderSoundList() } }
    } catch {
      listening = null; renderSoundList()
      toast({ title: 'That sound could not be loaded', kind: 'error' })
    }
  }
  async function useSound(id, padIndex) {
    const entry = entryById(id)
    if (!entry) return
    stopPreview(); listening = null
    try { await assignLibrarySound(padIndex, entry) } catch { return toast({ title: 'That sound could not be loaded', kind: 'error' }) }
    select(padIndex)
    renderEditor(); drawThumbs()
    hit(padIndex, 0.85, false)
  }
  editor.addEventListener('input', (e) => {
    if (e.target.dataset?.spSearch !== undefined) { sbQuery = e.target.value; renderSoundList() }
  }, { signal })
  editor.addEventListener('dblclick', (e) => {
    const row = e.target.closest('[data-sound]')
    if (row) void useSound(row.dataset.sound, st().selected)
  }, { signal })
  editor.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('[data-sound]')
    if (!row) return
    e.dataTransfer.setData(SOUND_MIME, row.dataset.sound)
    e.dataTransfer.setData('text/plain', entryById(row.dataset.sound)?.name ?? '')
    e.dataTransfer.effectAllowed = 'copy'
  }, { signal })

  // ── editing ──
  editor.addEventListener('input', (e) => {
    const k = e.target.dataset?.k
    if (!k) return
    const i = st().selected
    const v = e.target.tagName === 'SELECT' ? Number(e.target.value) : Number(e.target.value)
    setParam(i, { [k]: v })
    drawThumbs()
  }, { signal })
  editor.addEventListener('change', (e) => {
    if (e.target.dataset?.spName !== undefined) { setName(st().selected, e.target.value || DEFAULT_KIT[st().selected].name); drawThumbs() }
  }, { signal })
  editor.addEventListener('input', (e) => {
    if (e.target.dataset?.spName !== undefined) setName(st().selected, e.target.value)
  }, { signal })
  editor.addEventListener('keydown', (e) => { if (e.target.dataset?.spName !== undefined && e.key === 'Enter') e.target.blur() }, { signal })

  async function loadInto(i, file) {
    if (!AUDIO_FILE(file)) return toast({ title: 'That is not an audio file', body: 'Try a WAV, MP3, FLAC, OGG or M4A file.', kind: 'error' })
    await initSampler()
    if (await loadFileToPad(i, file)) { select(i); renderEditor(); drawThumbs(); hit(i, 0.85, false); toast({ title: `Loaded “${st().pads[i].name}” on pad ${PAD_KEYS[i].toUpperCase()}`, kind: 'success', ms: 3000 }) }
  }
  function pickFile(i) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.aiff'
    input.onchange = () => input.files[0] && loadInto(i, input.files[0])
    input.click()
  }

  container.addEventListener('click', async (e) => {
    const b = e.target.closest('button')
    if (!b) return
    const i = st().selected
    if ('spStop' in b.dataset) stopAllVoices()
    if ('spFull' in b.dataset) toggleFull()
    if ('spResetkit' in b.dataset) {
      if (!confirm('Bring back all 16 factory sounds and settings? Your own sounds on the pads will be removed.')) return
      await resetKit(); renderEditor(); drawThumbs(); toast({ title: 'Factory kit restored', kind: 'success', ms: 3000 })
    }
    if (b.dataset.spMode) { setParam(i, { mode: b.dataset.spMode }); renderEditor() }
    if ('spReverse' in b.dataset) { const q = st().pads[i].params; setParam(i, { reverse: !q.reverse, start: 1 - q.end, end: 1 - q.start }); renderEditor(); drawThumbs() }
    if (b.dataset.spTab) { tab = b.dataset.spTab; if (tab !== 'sounds') { stopPreview(); listening = null } renderEditor(); return }
    if (b.dataset.spCat) { sbCat = b.dataset.spCat; renderSoundList(); return }
    if (b.dataset.spListen) { void toggleListen(b.dataset.spListen); return }
    if (b.dataset.spUse) { void useSound(b.dataset.spUse, i); return }
    if ('spLoad' in b.dataset) pickFile(i)
    if ('spTimeline' in b.dataset) padToTimeline(i)
    if ('spReset' in b.dataset) { await resetPad(i); renderEditor(); drawThumbs() }
    if ('spRec' in b.dataset) {
      if (isRecordingPad()) stopPadRecording()
      else if (await startPadRecording(i, () => { renderEditor(); drawThumbs() })) { renderEditor(); toast({ title: 'Recording… press again to stop', ms: 2500 }) }
    }
  }, { signal })

  // ── drag handles on the waveform ──
  editor.addEventListener('pointerdown', (e) => {
    const wave = e.target.closest('[data-sp-wave]')
    if (!wave || e.button !== 0 || !padView(st().selected)) return
    const rect = wave.getBoundingClientRect()
    const i = st().selected
    const p = st().pads[i].params
    const x = (e.clientX - rect.left) / rect.width
    const handle = Math.abs(x - p.start) <= Math.abs(x - p.end) ? 'start' : 'end'
    e.preventDefault()
    const move = (ev) => {
      const v = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
      const q = st().pads[i].params
      setParam(i, handle === 'start' ? { start: Math.min(v, q.end - 0.01) } : { end: Math.max(v, q.start + 0.01) })
      drawEditor(); drawThumbs()
    }
    const upH = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', upH) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', upH)
    move(e)
  }, { signal })
  editor.addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-sp-wave]')) { setParam(st().selected, { start: 0, end: 1 }); drawEditor(); drawThumbs() }
  }, { signal })

  // ── drag & drop onto a pad: audio files from your computer, or a sound dragged out of the Sounds tab ──
  const dropTarget = (e) => e.target.closest('.sp-pad') || e.target.closest('.sp-editor')
  const accepts = (e) => { const t = e.dataTransfer?.types; return !!t && (t.includes('Files') || t.includes(SOUND_MIME)) }
  container.addEventListener('dragenter', (e) => { if (accepts(e)) { e.preventDefault(); dropTarget(e)?.classList.add('drop') } }, { signal })
  container.addEventListener('dragover', (e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $$('.drop', container).forEach((x) => x.classList.remove('drop')); dropTarget(e)?.classList.add('drop') } }, { signal })
  container.addEventListener('dragleave', (e) => { if (!container.contains(e.relatedTarget)) $$('.drop', container).forEach((x) => x.classList.remove('drop')) }, { signal })
  container.addEventListener('drop', (e) => {
    $$('.drop', container).forEach((x) => x.classList.remove('drop'))
    const padEl = e.target.closest('.sp-pad')
    const target = padEl ? Number(padEl.dataset.pad) : st().selected
    const soundId = e.dataTransfer?.getData(SOUND_MIME)
    if (soundId) {
      e.preventDefault(); e.stopPropagation()
      void useSound(soundId, target)
      return
    }
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    e.preventDefault()
    e.stopPropagation()
    void loadInto(target, file)
  }, { signal, capture: true })

  // ── fullscreen: the browser's own fullscreen on the sampler when it can, a full-window overlay on iPad and friends ──
  const root = $('.sp-root', container)
  const nativeFull = () => document.fullscreenElement === root || document.webkitFullscreenElement === root
  const isFull = () => nativeFull() || root.classList.contains('is-full')
  const syncFull = () => {
    const on = isFull()
    const b = $('[data-sp-full]', container)
    if (b) { b.setAttribute('aria-pressed', String(on)); b.innerHTML = `${icon(on ? 'minimize' : 'maximize')}<span>${on ? 'Exit fullscreen' : 'Fullscreen'}</span>` }
    document.documentElement.classList.toggle('sp-locked', root.classList.contains('is-full'))
    drawThumbs(); drawEditor()
  }
  async function toggleFull() {
    if (isFull()) {
      root.classList.remove('is-full')
      try { if (nativeFull()) await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.()) } catch { /* already out */ }
    } else {
      const req = root.requestFullscreen ?? root.webkitRequestFullscreen
      if (req) { try { await req.call(root) } catch { root.classList.add('is-full') } } else root.classList.add('is-full')
    }
    syncFull()
  }
  document.addEventListener('fullscreenchange', syncFull, { signal })
  document.addEventListener('webkitfullscreenchange', syncFull, { signal })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-full') && !document.querySelector('dialog[open]')) { e.preventDefault(); e.stopImmediatePropagation(); toggleFull() }
  }, { capture: true, signal })
  // Safari on iPad: no pinch-zoom of the page while you play
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { signal })

  // ── animation: waveform playhead, pad glow ──
  const loop = () => {
    raf = requestAnimationFrame(loop)
    const i = st().selected
    const h = playhead(i)
    if (h >= 0 || container.__wasPlaying) drawEditor(h)
    container.__wasPlaying = h >= 0
    padEls.forEach((el, k) => el.classList.toggle('playing', playhead(k) >= 0))
  }
  raf = requestAnimationFrame(loop)
  const resize = new ResizeObserver(() => { drawThumbs(); drawEditor() })
  resize.observe(container)

  renderEditor()
  drawThumbs()
  void loadManifest().then((m) => { manifest = m; renderEditor() }).catch(() => {})
  void initSampler().then(() => { drawThumbs(); drawEditor(); const e = $('.sp-wave-empty', editor); if (e) e.remove() })

  return {
    onProject() { return true }, // the sampler does not depend on the timeline
    dispose() {
      ac.abort()
      cancelAnimationFrame(raf)
      offVoice()
      resize.disconnect()
      heldKeys.forEach((i) => release(i))
      stopAllVoices()
      stopPreview()
      if (document.fullscreenElement === root) void document.exitFullscreen?.()
      document.documentElement.classList.remove('sp-locked')
    },
  }
}
