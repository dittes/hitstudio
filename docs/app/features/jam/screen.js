// Jam page: pick a style, start the band, and play along. The band lives in ./engine.js.
import { $, $$, icon, escape } from '../../dom.js';
import { GENRES, MOODS } from '../../lib/songsmith.js';
import { NOTE_NAMES, SCALES, midiName } from '../create/theory.js';
import { INSTRUMENTS } from '../create/synth/instruments.js';
import { knob, attachControls } from '../../ui/controls.js';
import * as music from '../../media.js';
import { toast } from '../../core/toast.js';
import {
  useJam, MEMBERS, MEMBER_INFO, SECTIONS, ADVENTURE, YOU_INSTRUMENTS, DRUM_KEYS,
  startJam, stopJam, setPref, setMember, setYou, setBpm, cue, cueFill, newChords, newIdea, onTick, barsToPhrase,
  playYou, playMidi, youMidi, chordRows, toggleRecording,
} from './engine.js';

const LOW = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';']
const HIGH = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']
const DRUM_NAMES = { kick: 'Kick', snare: 'Snare', clap: 'Clap', chat: 'Hat', ohat: 'Open hat', tom: 'Tom', rim: 'Rim', perc: 'Perc' }
const J = () => useJam.getState();

async function start() {
  await music.claimSource('jam');
  await startJam();
}

export function mountJam(container) {
  const p = J();
  const chip = (attr, id, label, on, ic) => `<button class="jam-chip ${on ? 'on' : ''}" data-${attr}="${id}" aria-pressed="${on}">${ic ? icon(ic) : ''}<span>${escape(label)}</span></button>`;
  container.innerHTML = `<section class="jam-root hw">
    <header class="jam-head">
      <div class="jam-title"><span class="jam-eyebrow">${icon('guitar')} Jam</span><h1>Your <span class="grad-text">virtual band</span></h1><p>Pick a style and press play. The band keeps going and improvises, and you play along on the pads, your keyboard or a MIDI keyboard.</p></div>
      <div class="jam-transport">
        <button class="jam-rec" data-jam-rec aria-pressed="false" title="Record the jam onto your timeline">${icon('record')}<span>Record</span></button>
        <button class="jam-play" data-jam-play aria-label="Start the band">${icon('play')}</button>
      </div>
    </header>

    <div class="jam-card jam-setup">
      <div class="jam-row"><span class="jam-label">Style</span><div class="jam-chips">${Object.entries(GENRES).map(([id, g]) => chip('genre', id, g.name, id === p.genre, g.icon)).join('')}</div></div>
      <div class="jam-row"><span class="jam-label">Mood</span><div class="jam-chips">${Object.entries(MOODS).map(([id, m]) => chip('mood', id, m.name, id === p.mood, m.icon)).join('')}</div></div>
      <div class="jam-row jam-row-ctl">
        <span class="jam-label">Band</span>
        <div class="jam-seg" role="group" aria-label="How adventurous the band is">${Object.entries(ADVENTURE).map(([id, a]) => `<button data-adv="${id}" aria-pressed="${id === p.adventure}" title="${escape(a.hint)}">${a.name}</button>`).join('')}</div>
        ${knob({ label: 'Energy', unit: 'pct', cls: 'knob-sm jam-energy', input: `<input data-jam-busy data-default=".5" type="range" min="0" max="1" step=".01" value="${p.busy}" aria-label="Energy" />` })}
        <div class="jam-tempo"><span class="jam-label">Tempo</span><div class="jam-stepper"><button data-bpm="-2" aria-label="Slower">−</button><output class="jam-bpm mono">${p.bpm}</output><button data-bpm="2" aria-label="Faster">+</button></div></div>
        <label class="jam-key"><span class="jam-label">Key</span><select data-jam-key aria-label="Key"><option value="">Auto</option>${NOTE_NAMES.map((n, i) => `<option value="${i}" ${p.key === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
    </div>

    <div class="jam-card jam-stage">
      <div class="jam-stage-top">
        <div class="jam-now"><small class="jam-song"></small><b class="jam-section-name"></b><span class="jam-change"></span></div>
        <div class="jam-chord"><span class="jam-chord-now">–</span><span class="jam-chord-next"></span></div>
        <div class="jam-beats" aria-hidden="true">${Array.from({ length: 16 }, (_, i) => `<i data-beat="${i}"></i>`).join('')}</div>
      </div>
      <div class="jam-band">${MEMBERS.map((m) => { const info = MEMBER_INFO[m], st = p.members[m]; return `<div class="jam-member ${st.on ? '' : 'off'}" data-member="${m}" style="--deck:${info.color}">
          <button class="jam-avatar" data-member-toggle="${m}" aria-pressed="${st.on}" aria-label="${info.name}: ${st.on ? 'playing' : 'sitting out'}" title="Click to let ${info.name.toLowerCase()} sit in or sit out">${icon(info.icon)}</button>
          <div class="jam-member-text"><b>${info.name}</b><small class="jam-inst">${info.role}</small><span class="jam-state">${st.on ? 'Playing' : 'Sitting out'}</span></div>
          ${knob({ label: 'Vol', unit: 'pct', cls: 'knob-sm', input: `<input data-member-vol="${m}" data-default=".8" type="range" min="0" max="1" step=".01" value="${st.vol}" aria-label="${info.name} volume" />` })}
        </div>` }).join('')}</div>
      <div class="jam-sections">
        <div class="jam-section-row" role="group" aria-label="Song sections">${Object.entries(SECTIONS).map(([id, s]) => `<button class="jam-sec" data-cue="${id}" title="${escape(s.hint)}"><b>${s.name}</b><small>${escape(s.hint)}</small><i class="jam-sec-when"></i></button>`).join('')}</div>
        <div class="jam-actions">
          <button data-jam-fill>${icon('drum')}<span>Fill</span></button>
          <button data-jam-chords>${icon('piano')}<span>New chords</span></button>
          <button data-jam-idea>${icon('dice')}<span>New idea</span></button>
          <button data-cue="end">${icon('stop')}<span>Wrap it up</span></button>
          <span class="jam-sep"></span>
          <label class="jam-toggle" title="The band moves through Intro, Groove, Build, Peak and Break by itself"><input type="checkbox" data-jam-auto ${p.autoArrange ? 'checked' : ''}/><span class="st-switch" aria-hidden="true"></span>Auto-arrange</label>
          <label class="jam-toggle" title="The lead gives you the spotlight while you play and answers when you stop"><input type="checkbox" data-jam-follow ${p.followMe ? 'checked' : ''}/><span class="st-switch" aria-hidden="true"></span>Follow me</label>
        </div>
      </div>
    </div>

    <div class="jam-card jam-you" style="--deck:var(--accent-2)">
      <div class="jam-you-head">
        <div><h2>You</h2><p class="jam-you-hint">Every pad is in key. Lit pads fit the chord that's playing.</p></div>
        <div class="jam-you-ctl">
          <select data-you-inst aria-label="Your instrument">${YOU_INSTRUMENTS.map((id) => `<option value="${id}" ${p.you.inst === id ? 'selected' : ''}>${id === 'drums' ? 'Drum pads' : escape(INSTRUMENTS[id]?.name ?? id)}</option>`).join('')}</select>
          <div class="jam-stepper" title="Octave"><button data-oct="-1" aria-label="Octave down">−</button><output class="jam-oct mono">Oct 0</output><button data-oct="1" aria-label="Octave up">+</button></div>
          ${knob({ label: 'Vol', unit: 'pct', cls: 'knob-sm', input: `<input data-you-vol data-default=".9" type="range" min="0" max="1" step=".01" value="${p.you.vol}" aria-label="Your volume" />` })}
          <button data-midi>${icon('piano')}<span>Connect MIDI</span></button>
        </div>
      </div>
      <div class="jam-pads"></div>
      <p class="jam-keys-hint"><kbd>A</kbd>–<kbd>;</kbd> play · <kbd>Q</kbd>–<kbd>P</kbd> one octave up · <kbd>Space</kbd> start / stop the band</p>
    </div>
  </section>`;
  const root = container.firstElementChild;
  const ctl = attachControls(root);
  const ac = new AbortController();
  let padsKey = '';

  function renderPads() {
    const s = J(), drums = s.you.inst === 'drums';
    const key = `${drums}|${s.keyRoot}|${s.scale}|${s.you.octave}`;
    if (key === padsKey) return;
    padsKey = key;
    $('.jam-pads', root).innerHTML = (drums ? DRUM_KEYS : LOW.map((_, i) => i)).map((v, i) => `<button class="jam-pad" data-pad="${i}"><b>${drums ? DRUM_NAMES[v] : midiName(youMidi(i))}</b><kbd>${LOW[i].toUpperCase()}</kbd></button>`).join('');
    $('.jam-oct', root).textContent = `Oct ${s.you.octave > 0 ? '+' : ''}${s.you.octave}`;
  }
  function litPads() {
    const drums = J().you.inst === 'drums', rows = drums ? new Set() : chordRows();
    $$('.jam-pad', root).forEach((b) => b.classList.toggle('fit', rows.has(Number(b.dataset.pad))));
  }
  function update(s, prev) {
    const playBtn = $('[data-jam-play]', root);
    playBtn.innerHTML = icon(s.playing ? 'stop' : 'play');
    playBtn.setAttribute('aria-label', s.playing ? 'Stop the band' : 'Start the band');
    playBtn.classList.toggle('on', s.playing);
    root.classList.toggle('is-playing', s.playing);
    $('[data-jam-rec]', root).setAttribute('aria-pressed', String(s.recording));
    $('[data-jam-rec] span', root).textContent = s.recording ? `Recording ${Math.floor((performance.now() - s.recStart) / 1000)} s` : 'Record';
    $('.jam-bpm', root).textContent = s.bpm;
    $$('[data-genre]', root).forEach((b) => { const on = b.dataset.genre === s.genre; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on) });
    $$('[data-mood]', root).forEach((b) => { const on = b.dataset.mood === s.mood; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on) });
    $$('[data-adv]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.adv === s.adventure)));
    const sectionName = s.section === 'end' ? 'Ending' : SECTIONS[s.section]?.name ?? '';
    $('.jam-song', root).textContent = s.playing ? `${s.title} · ${NOTE_NAMES[s.keyRoot]} ${SCALES[s.scale]?.name ?? ''}` : 'Ready when you are';
    $('.jam-section-name', root).textContent = s.playing ? sectionName : 'Press play to start the band';
    $('.jam-change', root).textContent = s.playing && s.lastChange ? s.lastChange : '';
    $('.jam-chord-now', root).textContent = s.playing && s.chord ? s.chord.name : '–';
    $('.jam-chord-next', root).textContent = s.playing && s.nextChord ? `next ${s.nextChord.name}` : '';
    $$('[data-beat]', root).forEach((el, i) => el.classList.toggle('on', s.playing && i === s.phraseBar * 4 + s.beat));
    $$('.jam-sec', root).forEach((b) => {
      const id = b.dataset.cue, now = s.playing && s.section === id, queued = s.cue === id, auto = !s.cue && s.next === id;
      b.classList.toggle('now', now); b.classList.toggle('queued', queued || auto); b.setAttribute('aria-pressed', String(now));
      $('.jam-sec-when', b).textContent = now ? 'Now' : queued || auto ? `in ${barsToPhrase()} bar${barsToPhrase() === 1 ? '' : 's'}` : (!s.playing && s.section === id ? 'Start here' : '');
    });
    $('[data-cue="end"]', root).classList.toggle('queued', s.cue === 'end');
    MEMBERS.forEach((m) => {
      const card = $(`[data-member="${m}"]`, root), st = s.members[m];
      card.classList.toggle('off', !st.on);
      const lead = m === 'melody' && s.spotlight && st.on;
      card.classList.toggle('spot', lead);
      $('.jam-state', card).textContent = !st.on ? 'Sitting out' : lead ? 'Listening to you' : s.playing ? 'Playing' : 'Ready';
      $('.jam-inst', card).textContent = s.playing && s.insts[m] ? s.insts[m] : MEMBER_INFO[m].role;
      $('[data-member-toggle]', card).setAttribute('aria-pressed', String(st.on));
    });
    root.classList.toggle('spotlight', s.spotlight);
    if (!prev || s.chord !== prev.chord || s.keyRoot !== prev.keyRoot || s.you !== prev.you || s.scale !== prev.scale) { renderPads(); litPads() }
  }
  const unsub = useJam.subscribe(update);
  update(J());
  const recTimer = setInterval(() => { if (J().recording) update(J()) }, 500);

  // band members light up on their notes
  const offTick = onTick((ev) => {
    if (ev.stop) return;
    for (const m of MEMBERS) if (ev.hits?.[m]) $(`[data-member="${m}"] .jam-avatar`, root)?.animate([{ transform: 'scale(1.12)', boxShadow: '0 0 0 6px color-mix(in srgb, var(--deck) 35%, transparent), 0 0 30px var(--deck)' }, { transform: 'scale(1)', boxShadow: '0 0 0 0 transparent' }], { duration: 260, easing: 'ease-out' });
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    try {
      if ('jamPlay' in d) { J().playing ? stopJam() : await start(); return }
      if ('jamRec' in d) { if (!J().playing) await start(); toggleRecording(); return }
      if (d.genre) { const g = GENRES[d.genre]; setPref({ genre: d.genre, bpmSet: false }); if (!J().playing) useJam.setState({ bpm: Math.round((g.bpm[0] + g.bpm[1]) / 2) }) }
      if (d.mood) setPref({ mood: d.mood });
      if (d.adv) setPref({ adventure: d.adv });
      if (d.bpm) setBpm(J().bpm + Number(d.bpm));
      if (d.cue) cue(d.cue);
      if ('jamFill' in d) cueFill();
      if ('jamChords' in d) newChords();
      if ('jamIdea' in d) newIdea();
      if (d.memberToggle) setMember(d.memberToggle, { on: !J().members[d.memberToggle].on });
      if (d.oct) setYou({ octave: Math.max(-2, Math.min(2, J().you.octave + Number(d.oct))) });
      if ('midi' in d) await connectMidi(b);
    } catch (error) { toast({ title: 'That did not work', body: error.message || String(error), kind: 'error' }) }
  });
  root.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('[data-pad]');
    if (!pad) return;
    e.preventDefault();
    hitPad(Number(pad.dataset.pad));
  });
  root.addEventListener('input', (e) => {
    const d = e.target.dataset;
    if ('jamBusy' in d) setPref({ busy: Number(e.target.value) });
    if (d.memberVol) setMember(d.memberVol, { vol: Number(e.target.value) });
    if ('youVol' in d) setYou({ vol: Number(e.target.value) });
  });
  root.addEventListener('change', (e) => {
    const d = e.target.dataset;
    if ('jamKey' in d) setPref({ key: e.target.value === '' ? null : Number(e.target.value) });
    if ('youInst' in d) setYou({ inst: e.target.value });
    if ('jamAuto' in d) setPref({ autoArrange: e.target.checked });
    if ('jamFollow' in d) setPref({ followMe: e.target.checked });
  });

  function hitPad(i, upper = false) {
    const drums = J().you.inst === 'drums';
    const row = drums ? i : i + (upper ? SCALES[J().scale]?.intervals.length ?? 7 : 0);
    playYou(row);
    const pad = $(`[data-pad="${i}"]`, root);
    pad?.animate([{ transform: 'scale(.94)', filter: 'brightness(1.5)' }, { transform: 'scale(1)', filter: 'none' }], { duration: 180 });
  }
  // computer keyboard
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('input[type=text],input:not([type]),textarea,select,[contenteditable=true]')) return;
    if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); J().playing ? stopJam() : void start(); return }
    if (e.repeat) return;
    const k = e.key.toLowerCase(), lo = LOW.indexOf(k), hi = HIGH.indexOf(k);
    if (lo >= 0 || hi >= 0) { e.preventDefault(); e.stopImmediatePropagation(); hitPad(lo >= 0 ? lo : hi, hi >= 0) }
  }, { capture: true, signal: ac.signal });

  // MIDI keyboards
  let midi = null;
  async function connectMidi(btn) {
    if (!navigator.requestMIDIAccess) throw new Error('This browser does not support MIDI keyboards. Try Chrome or Edge.');
    midi = midi || await navigator.requestMIDIAccess();
    const hook = () => { let n = 0; midi.inputs.forEach((inp) => { n++; inp.onmidimessage = (m) => { const [st, note, vel] = m.data; if ((st & 0xf0) === 0x90 && vel > 0) playMidi(note, vel / 127) } }); $('span', btn).textContent = n ? `MIDI: ${n} connected` : 'No MIDI device found'; };
    hook();
    midi.onstatechange = hook;
  }

  return {
    onProject() { return true }, // the jam does not depend on the timeline (a recorded take must not rebuild the page)
    dispose() { ac.abort(); unsub(); offTick(); clearInterval(recTimer); if (midi) midi.inputs.forEach((i) => { i.onmidimessage = null }) },
  };
}
