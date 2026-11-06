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
import { NOTE_NAMES, SCALES, chordFor, midiName, voiceChords } from './theory.js'
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

const LOOP = 64 // four bars of sixteenth notes
const PART_COLOR = { drums: '#fb923c', melody: '#a78bfa', chords: '#38bdf8', bass: '#4ade80' }
const chordHue = (i) => `hsl(${i * 47 + 255} 80% 68%)`

/** One-line visual of a part across the 4-bar loop. Each is a button that opens that part in the editor. */
function drumsVis(d) {
  const steps = d.drums.long ? 32 : 16
  const lanes = LANES.filter((l) => d.drums.grid[l].slice(0, steps).some((v) => v > 0))
  return `<div class="gv-drums" style="--rows:${Math.max(1, lanes.length)}">${lanes
    .map((l) => `<div class="gv-dl" style="--c:${LANE_COLORS[l]}">${Array.from({ length: LOOP }, (_, i) => {
      const v = d.drums.grid[l][i % steps]
      return `<i class="${v > 0 ? 'on' : ''}" ${v > 0 ? `style="--v:${(0.4 + v * 0.6).toFixed(2)}"` : ''}></i>`
    }).join('')}</div>`)
    .join('')}</div>`
}
function melodyVis(d) {
  return `<div class="gv-melody">${d.melody.notes
    .map((n) => [0, 1].map((rep) => `<span class="gv-note" style="left:${((rep * 32 + n.step) / LOOP) * 100}%;width:${(n.len / LOOP) * 100}%;bottom:${(n.row / 9) * 78 + 4}%;--h:${n.row * 28 + 250}"></span>`).join(''))
    .join('')}</div>`
}
function chordsVis(d) {
  const vc = voiceChords(d.key, d.scale, d.chords.prog, d.chords.ext ?? 'triad')
  return `<div class="gv-blocks">${[0, 1, 2, 3]
    .map((i) => {
      const idx = d.chords.prog[i] ?? 0
      const c = vc[i]
      return `<div class="gv-block" data-bar="${i}" style="--c:${chordHue(idx)}"><b>${esc(c.name)}</b><small>${c.roman}</small></div>`
    })
    .join('')}</div>`
}
function bassVis(d) {
  const pat = BASS_PATTERNS[d.bass.pattern] ?? BASS_PATTERNS.root8
  const hits = pat.followKick ? d.drums.grid.kick.slice(0, 16).map((v, s) => (v > 0 ? [s, 1, 0] : null)).filter(Boolean) : pat.hits
  return `<div class="gv-blocks ${d.bass.on ? '' : 'off'}">${[0, 1, 2, 3]
    .map((i) => {
      const c = chordFor(d.key, d.scale, d.chords.prog[i] ?? 0)
      return `<div class="gv-block gv-bass" data-bar="${i}" style="--c:${PART_COLOR.bass}"><small>${midiName(c.bassMidi)}</small>${hits.map((h) => `<i style="left:${(h[0] / 16) * 100}%;width:${(Math.max(h[1], 1) / 16) * 100}%;bottom:${h[2] ? 52 : 12}%"></i>`).join('')}</div>`
    })
    .join('')}</div>`
}

/** Four part lanes: this is the "your song is made of parts you can adjust" view. */
function lanesHTML(d, empty) {
  const defs = [
    ['drums', 'drum', 'Drums', `${KITS[d.drums.kit]?.name ?? d.drums.kit} kit`, 'beat', drumsVis],
    ['melody', 'melody', 'Melody', INSTRUMENTS[d.melody.inst]?.name ?? d.melody.inst, 'melody', melodyVis],
    ['chords', 'piano', 'Chords', `${INSTRUMENTS[d.chords.inst]?.name ?? d.chords.inst} · ${d.chords.style}`, 'chords', chordsVis],
    ['bass', 'bass', 'Bass', d.bass.on ? `${INSTRUMENTS[d.bass.inst]?.name ?? 'Synth Bass'} · ${BASS_PATTERNS[d.bass.pattern]?.name ?? d.bass.pattern}` : 'Off', 'bass', bassVis],
  ]
  return `<div class="gl ${empty ? 'is-empty' : ''}">${defs
    .map(
      ([part, ic, name, sub, tab, vis]) => `<div class="gl-lane" style="--pc:${PART_COLOR[part]}">
      <div class="gl-label"><span class="gl-ic">${icon(ic)}</span><span class="gl-text"><b>${name}</b><small>${esc(sub)}</small></span></div>
      <button class="gl-vis" ${empty ? 'disabled' : `data-create-tab="${tab}" aria-label="Adjust ${name.toLowerCase()}"`}>${empty ? '<div class="gv-ghost"></div>' : vis(d)}<span class="gl-head" data-gl-head></span><span class="gl-hint">${icon('pen')} Adjust</span></button>
      <div class="gl-actions"><button class="gen-mini" ${empty ? 'disabled' : `data-gen-reroll="${part}"`} title="New ${name.toLowerCase()} only">${icon('reroll')}<span>Re-roll</span></button></div>
    </div>`,
    )
    .join('')}</div>`
}

/** Called by the Create view's step subscription to animate the lane playheads. */
export function highlightGenerateStep(container, step) {
  const col = step < 0 ? -1 : step % LOOP
  container.querySelectorAll('[data-gl-head]').forEach((head) => {
    head.style.opacity = col < 0 ? '0' : '1'
    head.style.left = `${(Math.max(0, col) / LOOP) * 100}%`
  })
  const bar = col < 0 ? -1 : Math.floor(col / 16)
  container.querySelectorAll('.gl .gv-block').forEach((x) => x.classList.toggle('now', Number(x.dataset.bar) === bar))
}

function resultHTML(cur) {
  const d = useCreate.getState()
  const g = GENRES[cur.genre]
  const m = MOODS[cur.mood]
  const busy = gen.busy_
  return `<section class="gr" data-gen-key="${esc(cur.code)}">
    <header class="gr-head">
      <div class="gr-art gen-art-${cur.genre}">${icon(g.icon)}</div>
      <div class="gr-title">
        <span class="gr-eyebrow">Your idea</span>
        <h2>${esc(cur.title)}</h2>
        <div class="gen-tags">
          <span class="gen-tag">${icon(g.icon)}${esc(g.name)}</span>
          <span class="gen-tag">${icon(m.icon)}${esc(m.name)}</span>
          <span class="gen-tag">${icon('timer')}${useStore.getState().project.bpm} BPM</span>
          <span class="gen-tag">${icon('keys')}${NOTE_NAMES[d.key]} ${esc(SCALES[d.scale].name)}</span>
          <button class="gen-code" data-gen-copy title="Copy this idea's code">${icon('copy')}<span>${esc(cur.code.split('~')[0])}</span></button>
        </div>
      </div>
      <div class="gr-cta">
        <button class="gr-adjust" data-create-tab="beat"><span class="gr-adjust-ic">${icon('pen')}</span><span class="gr-adjust-text"><b>Adjust this idea</b></span>${icon('arrow')}</button>
      </div>
    </header>
    ${lanesHTML(d, false)}
    <footer class="gr-foot">
      <span class="gr-spacer"></span>
      <label class="gr-form"><span class="cr-label">Song shape</span><select id="gen-form">${Object.keys(FORMS).map((f) => `<option value="${f}" ${gen.form === f ? 'selected' : ''}>${FORM_LABEL[f]}</option>`).join('')}</select></label>
      <button class="gr-song ${busy === 'song' ? 'busy' : ''}" data-gen-song>${icon(busy === 'song' ? 'reroll' : 'song')}<span>${busy === 'song' ? 'Building your song…' : 'Turn into a full song'}</span></button>
    </footer>
  </section>`
}

function emptyResultHTML() {
  return `<section class="gr gr-empty">
    <header class="gr-head">
      <div class="gr-art gr-art-empty">${icon('sparkles')}</div>
      <div class="gr-title"><span class="gr-eyebrow">Your idea</span><h2>Press Generate to hear it</h2></div>
    </header>
    ${lanesHTML(useCreate.getState(), true)}
  </section>`
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
  <section class="gx">
    <div class="gx-top">
      <div class="gx-text">
        <h2>Create your instant hit</h2>
      </div>
      <div class="gx-go">
        <button class="gen-go" data-gen-go aria-label="Generate a new idea" title="Generate (G)"><span class="gen-go-spark">${icon('sparkles')}</span><span>${cur ? 'Generate another' : 'Generate'}</span><kbd>G</kbd></button>
        <div class="gen-code-load"><input id="gen-code-input" class="gen-input" placeholder="Have a code? lofi-chill-7" spellcheck="false" aria-label="Idea code" /><button data-gen-load-code title="Load an idea from its code">${icon('arrow')}</button></div>
      </div>
    </div>
    <div class="gx-controls">
      <div class="gen-row"><span class="cr-label">Style</span><div class="gen-chips">${genreChips}</div></div>
      <div class="gen-row"><span class="cr-label">Mood</span><div class="gen-chips">${moodChips}</div></div>
      <div class="gen-row"><span class="cr-label">Energy</span>
        <div class="gen-busy"><span class="faint">Simple</span><input id="gen-busy" type="range" min="0" max="1" step="0.05" value="${gen.busy}" aria-label="How busy the idea should be"/><span class="faint">Busy</span><b class="gen-busy-val">${busyLabel(gen.busy)}</b></div>
      </div>
      ${gen.history.length > 1 ? `<div class="gen-row"><span class="cr-label">${icon('history')} Recent</span><div class="gen-chips">${gen.history.map((h, i) => `<button class="gen-hist ${cur && h.code === cur.code ? 'on' : ''}" data-gen-history="${i}" title="${esc(h.code)}">${icon(GENRES[h.genre]?.icon ?? 'sparkle')}<span>${esc(h.title)}</span></button>`).join('')}</div></div>` : ''}
    </div>
  </section>
  ${cur ? resultHTML(cur) : emptyResultHTML()}
  <section class="gd">
    <div class="gd-head"><h3>${icon('song')} Or start from a demo</h3></div>
    <div class="gd-grid">${DEMO_SETS.map((dm, i) => {
      const g = GENRES[dm.genre]
      const m = MOODS[dm.mood]
      return `<div class="gd-card" style="--i:${i}">
        <div class="gd-art gen-art-${dm.genre}">${icon(g.icon)}</div>
        <div class="gd-body"><b>${esc(dm.title)}</b><small class="muted">${esc(g.name)} · ${esc(m.name)}</small></div>
        <div class="gd-actions"><button class="${busy === dm.id ? 'busy' : ''}" data-gen-demo="${dm.id}" title="Open as a full song" aria-label="Open ${esc(dm.title)} as a full song">${icon(busy === dm.id ? 'reroll' : 'song')}</button><button data-gen-demo-loop="${dm.id}" title="Load the loop to adjust it" aria-label="Adjust the loop of ${esc(dm.title)}">${icon('pen')}</button></div>
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
  const el = container?.querySelector?.('.gr')
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
  const { edit, undo, redo, resetAll, ...data } = st
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
