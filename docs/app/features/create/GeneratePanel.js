// Create → "Generate" tab: one button that makes an idea that just sounds good,
// a Simple↔Busy control, re-rolls per part, a live pattern preview, full-song
// arrangement and curated demo sets. Every generated idea is written into the
// normal Create state, so it stays editable in the Beat / Melody / Chords tabs.
// Rendering is string-based like the rest of the plain-JS Create view (studio.js).
import { registerCommand } from '../../core/commands.js'
import { useStore } from '../../core/store.js'
import { toast } from '../../core/toast.js'
import { icon } from '../../dom.js'
import { DEMO_SETS, demoSetup, FORMS, generateSetup, GENRES, LANES, MOODS, parseSetupCode, rerollPart } from '../../lib/songsmith.js'
import { BASS_PATTERNS } from './patterns.js'
import { useCreate } from './state.js'
import { NOTE_NAMES, SCALES } from './theory.js'
import { INSTRUMENTS } from './synth/instruments.js'
import { KITS } from './synth/drums.js'
import { applySetup, songToProject } from './songgen.js'

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const LANE_COLORS = { kick: '#fb923c', snare: '#f472b6', clap: '#a78bfa', chat: '#facc15', ohat: '#4ade80', tom: '#38bdf8', rim: '#2dd4bf', perc: '#818cf8' }
const FORM_LABEL = { loop: 'Just the loop · 8 bars', short: 'Short song · 24 bars', full: 'Full song · 48 bars' }

const LS = 'hitstudio.generate.v2'
const gen = (() => {
  const base = { genre: null, mood: null, busy: 0.5, form: 'full', current: null, history: [], busy_: null }
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(LS) || '{}'), busy_: null }
  } catch {
    return base
  }
})()
const save = () => {
  try {
    const { busy_, ...rest } = gen
    localStorage.setItem(LS, JSON.stringify(rest))
  } catch {}
}

// G = generate (only while the Generate tab is on screen)
registerCommand({
  id: 'create.generate',
  label: 'Generate a new song idea',
  group: 'Create',
  shortcut: 'G',
  keywords: 'random idea beat song make',
  enabled: () => !!document.querySelector('[data-gen-go]'),
  run: () => document.querySelector('[data-gen-go]')?.click(),
})

const busyLabel = (b) => (b < 0.25 ? 'Simple' : b < 0.45 ? 'Relaxed' : b < 0.6 ? 'Balanced' : b < 0.8 ? 'Lively' : 'Busy')

/** Mini pattern: 8 drum lanes + melody dots over the loop; columns light up while playing. */
function previewHTML(d) {
  const steps = d.drums.long ? 32 : 16
  const cols = 32
  const lanes = LANES.filter((l) => d.drums.grid[l].slice(0, steps).some((v) => v > 0))
  const drum = lanes
    .map((l) => `<div class="gp-lane" style="--c:${LANE_COLORS[l]}">${Array.from({ length: cols }, (_, i) => {
      const v = d.drums.grid[l][i % steps]
      return `<i data-gp-col="${i}" class="${v > 0 ? 'on' : ''}" style="${v > 0 ? `--v:${(0.35 + v * 0.65).toFixed(2)}` : ''}"></i>`
    }).join('')}</div>`)
    .join('')
  const notes = d.melody.notes
    .map((n) => `<span class="gp-note" style="left:${(n.step / 32) * 100}%;width:${(n.len / 32) * 100}%;bottom:${(n.row / 9) * 80 + 5}%"></span>`)
    .join('')
  return `<div class="gp"><div class="gp-drums">${drum}</div><div class="gp-mel">${notes}<div class="gp-head" data-gp-head></div></div></div>`
}

/** Called by the Create view's step subscription to animate the preview. */
export function highlightGenerateStep(container, step) {
  const head = container.querySelector('[data-gp-head]')
  if (!head) return
  const d = useCreate.getState()
  const col = step < 0 ? -1 : step % 32
  head.style.opacity = step < 0 ? '0' : '1'
  head.style.left = `${(Math.max(0, col) / 32) * 100}%`
  container.querySelectorAll('.gp i.now').forEach((x) => x.classList.remove('now'))
  if (col >= 0) container.querySelectorAll(`.gp i[data-gp-col="${col}"]`).forEach((x) => x.classList.add('now'))
  void d
}

function ideaCard(cur) {
  const d = useCreate.getState()
  const g = GENRES[cur.genre]
  const m = MOODS[cur.mood]
  const st = d
  const busy = gen.busy_
  return `<div class="gen-idea" data-gen-key="${esc(cur.code)}">
    <div class="gen-idea-head">
      <div class="gen-idea-art gen-art-${cur.genre}">${icon(g.icon)}</div>
      <div class="gen-idea-title">
        <b>${esc(cur.title)}</b>
        <button class="gen-code" data-gen-copy title="Copy this idea's code">${icon('copy')}<span>${esc(cur.code.split('~')[0])}</span></button>
      </div>
    </div>
    <div class="gen-tags">
      <span class="gen-tag">${icon(g.icon)}${esc(g.name)}</span>
      <span class="gen-tag">${icon(m.icon)}${esc(m.name)}</span>
      <span class="gen-tag">${icon('timer')}${useStore.getState().project.bpm} BPM</span>
      <span class="gen-tag">${icon('keys')}${NOTE_NAMES[st.key]} ${esc(SCALES[st.scale].name)}</span>
    </div>
    ${previewHTML(d)}
    <div class="gen-parts">
      ${[
        ['drums', 'drum', 'Drums', `${esc(KITS[st.drums.kit]?.name ?? st.drums.kit)} kit`, 'beat'],
        ['melody', 'melody', 'Melody', esc(INSTRUMENTS[st.melody.inst]?.name ?? st.melody.inst), 'melody'],
        ['chords', 'piano', 'Chords', `${esc(INSTRUMENTS[st.chords.inst]?.name ?? st.chords.inst)} · ${esc(st.chords.style)}`, 'chords'],
        ['bass', 'bass', 'Bass', st.bass.on ? `${esc(INSTRUMENTS[st.bass.inst]?.name ?? 'Synth Bass')} · ${esc(BASS_PATTERNS[st.bass.pattern]?.name ?? st.bass.pattern)}` : 'off', 'chords'],
      ]
        .map(
          ([part, ic, name, sub, tab]) => `<div class="gen-part">
        <span class="gen-part-ic">${icon(ic)}</span>
        <span class="gen-part-text"><b>${name}</b><small>${sub}</small></span>
        <button class="gen-mini" data-gen-reroll="${part}" title="New ${name.toLowerCase()} only">${icon('reroll')}</button>
        <button class="gen-mini" data-create-tab="${tab}" title="Edit ${name.toLowerCase()}">${icon('pen')}</button>
      </div>`,
        )
        .join('')}
    </div>
    <button class="gen-adjust" data-create-tab="beat">${icon('pen')}<span>Adjust this idea</span><small>Fine-tune beat, melody &amp; chords</small>${icon('arrow')}</button>
    <div class="gen-song">
      <label class="gen-form"><span class="cr-label">Song shape</span><select id="gen-form">${Object.keys(FORMS).map((f) => `<option value="${f}" ${gen.form === f ? 'selected' : ''}>${FORM_LABEL[f]}</option>`).join('')}</select></label>
      <button class="primary gen-song-btn ${busy === 'song' ? 'busy' : ''}" data-gen-song>${icon(busy === 'song' ? 'reroll' : 'song')}<span>${busy === 'song' ? 'Building your song…' : 'Turn into a full song'}</span></button>
    </div>
  </div>`
}

export function generateHTML() {
  const cur = gen.current
  const busy = gen.busy_
  const chip = (attr, val, on, ic, label, title = '') =>
    `<button class="gen-chip ${on ? 'on' : ''}" ${attr}="${val}" ${title ? `title="${esc(title)}"` : ''}>${icon(ic)}<span>${esc(label)}</span></button>`
  const genreChips = [chip('data-gen-genre', '', !gen.genre, 'dice', 'Surprise me')]
    .concat(Object.entries(GENRES).map(([id, g]) => chip('data-gen-genre', id, gen.genre === id, g.icon, g.name, g.blurb)))
    .join('')
  const moods = gen.genre ? GENRES[gen.genre].moods : Object.keys(MOODS)
  const moodChips = [chip('data-gen-mood', '', !gen.mood, 'dice', 'Any mood')].concat(moods.map((id) => chip('data-gen-mood', id, gen.mood === id, MOODS[id].icon, MOODS[id].name))).join('')
  return `<div class="gen-root">
  <div class="gen-top ${cur ? 'has-idea' : ''}">
    <section class="gen-hero panel">
      <div class="gen-hero-text">
        <h2>Make something that sounds good — instantly</h2>
        <p class="muted">Pick a style, press the button and HitStudio writes drums, chords, bass and a melody that fit together. It plays right away, and every part stays editable.</p>
      </div>
      <div class="gen-row"><span class="cr-label">Style</span><div class="gen-chips">${genreChips}</div></div>
      <div class="gen-row"><span class="cr-label">Mood</span><div class="gen-chips">${moodChips}</div></div>
      <div class="gen-row"><span class="cr-label">Energy</span>
        <div class="gen-busy"><span class="faint">Simple</span><input id="gen-busy" type="range" min="0" max="1" step="0.05" value="${gen.busy}" aria-label="How busy the idea should be"/><span class="faint">Busy</span><b class="gen-busy-val">${busyLabel(gen.busy)}</b></div>
      </div>
      <div class="gen-actions">
        <button class="gen-go" data-gen-go aria-label="Generate a new idea" title="Generate (G)"><span class="gen-go-spark">${icon('sparkles')}</span><span>${cur ? 'Generate another' : 'Generate'}</span><kbd>G</kbd></button>
        <div class="gen-code-load"><input id="gen-code-input" class="gen-input" placeholder="Have a code? lofi-chill-7" spellcheck="false" aria-label="Idea code" /><button data-gen-load-code title="Load an idea from its code">${icon('arrow')}</button></div>
      </div>
      ${gen.history.length > 1 ? `<div class="gen-history"><span class="cr-label">${icon('history')} Recent</span>${gen.history.map((h, i) => `<button class="gen-hist ${cur && h.code === cur.code ? 'on' : ''}" data-gen-history="${i}" title="${esc(h.code)}">${icon(GENRES[h.genre]?.icon ?? 'sparkle')}<span>${esc(h.title)}</span></button>`).join('')}</div>` : ''}
    </section>
    ${cur ? ideaCard(cur) : `<div class="gen-idea gen-idea-empty"><div class="gen-empty-orb">${icon('sparkles')}</div><b>Your idea appears here</b><span class="muted">Press Generate and listen. When you like it, choose Adjust this idea to fine-tune it, then send it to Edit, Mix, DJ or Export.</span></div>`}
  </div>
  <section class="gen-demos">
    <div class="gen-demos-head"><h3>${icon('song')} Demo songs</h3><span class="muted">Ready-made songs in different styles. Open one as a multi-track song, or load its loop to edit it.</span></div>
    <div class="gen-demo-grid">${DEMO_SETS.map((dm, i) => {
      const g = GENRES[dm.genre]
      const m = MOODS[dm.mood]
      return `<div class="gen-demo" style="--i:${i}">
        <div class="gen-demo-art gen-art-${dm.genre}">${icon(g.icon)}<span class="gen-demo-eq"><i></i><i></i><i></i><i></i></span></div>
        <div class="gen-demo-body"><b>${esc(dm.title)}</b><small class="muted">${esc(g.name)} · ${esc(m.name)}</small></div>
        <div class="gen-demo-actions"><button class="primary ${busy === dm.id ? 'busy' : ''}" data-gen-demo="${dm.id}">${icon(busy === dm.id ? 'reroll' : 'song')}<span>${busy === dm.id ? 'Building…' : 'Open song'}</span></button><button data-gen-demo-loop="${dm.id}" title="Load this demo's loop into the Beat Maker to edit it">${icon('pen')}<span>Edit loop</span></button></div>
      </div>`
    }).join('')}</div>
  </section>
</div>`
}

function remember(setup) {
  gen.current = setup
  gen.history = [setup, ...gen.history.filter((h) => h.code !== setup.code)].slice(0, 8)
  save()
}

function pop(container) {
  const el = container?.querySelector?.('.gen-idea')
  if (el) {
    el.classList.remove('pop')
    void el.offsetWidth
    el.classList.add('pop')
  }
}

/**
 * Handle a click inside the Create view. Returns true if it was a generator control.
 * @param {DOMStringMap} d  dataset of the clicked button
 * @param {{ render: () => void, play: () => Promise<void>, toSong: () => Promise<void>, container?: Element }} hooks
 */
export async function handleGenerateClick(d, hooks) {
  const load = async (setup, keep = true) => {
    if (keep) remember(setup)
    else {
      gen.current = setup
      save()
    }
    applySetup(setup)
    hooks.render()
    pop(hooks.container)
    await hooks.play()
  }
  if ('genGenre' in d) {
    gen.genre = d.genGenre || null
    if (gen.genre && gen.mood && !GENRES[gen.genre].moods.includes(gen.mood)) gen.mood = null
    save()
    hooks.render()
    return true
  }
  if ('genMood' in d) {
    gen.mood = d.genMood || null
    save()
    hooks.render()
    return true
  }
  if ('genGo' in d) {
    await load(generateSetup({ genre: gen.genre ?? undefined, mood: gen.mood ?? undefined, busy: gen.busy }))
    return true
  }
  if ('genReroll' in d && gen.current) {
    const setup = rerollPart({ ...gen.current, state: structuredClone(stripFns(useCreate.getState())) }, d.genReroll)
    setup.code = `${gen.current.code.split('~')[0]}~${d.genReroll[0]}`
    await load(setup, false)
    return true
  }
  if ('genHistory' in d) {
    const setup = gen.history[Number(d.genHistory)]
    if (setup) await load(setup, false)
    return true
  }
  if ('genCopy' in d && gen.current) {
    const code = gen.current.code.split('~')[0]
    try {
      await navigator.clipboard.writeText(code)
      toast({ title: 'Code copied', body: `“${code}” brings this idea back (before any re-rolls or edits).` })
    } catch {
      toast(code)
    }
    return true
  }
  if ('genLoadCode' in d) {
    const input = document.getElementById('gen-code-input')
    const parsed = parseSetupCode(input?.value ?? '')
    if (!parsed) {
      toast({ title: 'That code doesn’t look right', body: 'Codes look like “lofi-chill-7”.', kind: 'error' })
      return true
    }
    await load(generateSetup(parsed))
    return true
  }
  if ('genSong' in d && gen.current && !gen.busy_) {
    gen.busy_ = 'song'
    hooks.render()
    try {
      // use the CURRENT (possibly hand-edited) Create state, not the original idea
      const setup = { ...gen.current, bpm: useStore.getState().project.bpm, state: structuredClone(stripFns(useCreate.getState())) }
      const ok = await songToProject(setup, gen.form)
      if (ok) await hooks.toSong()
    } finally {
      gen.busy_ = null
      hooks.render()
    }
    return true
  }
  if (('genDemo' in d || 'genDemoLoop' in d) && !gen.busy_) {
    const demo = DEMO_SETS.find((x) => x.id === (d.genDemo || d.genDemoLoop))
    if (!demo) return true
    const setup = demoSetup(demo)
    if ('genDemoLoop' in d) {
      await load(setup)
      return true
    }
    gen.busy_ = demo.id
    hooks.render()
    try {
      const ok = await songToProject(setup, 'full')
      if (ok) await hooks.toSong()
    } finally {
      gen.busy_ = null
      hooks.render()
    }
    return true
  }
  return false
}

function stripFns(st) {
  const { edit, resetAll, ...data } = st
  return data
}

export function handleGenerateChange(target) {
  if (target.id === 'gen-form') {
    gen.form = target.value
    save()
    return true
  }
  if (target.id === 'gen-busy') {
    gen.busy = Number(target.value)
    save()
    return true
  }
  return false
}

/** live label update while dragging the Energy slider (no full re-render) */
export function handleGenerateInput(target) {
  if (target.id !== 'gen-busy') return false
  gen.busy = Number(target.value)
  const lab = target.closest('.gen-busy')?.querySelector('.gen-busy-val')
  if (lab) lab.textContent = busyLabel(gen.busy)
  return true
}

export function currentGenerated() {
  return gen.current
}
