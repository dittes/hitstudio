// Tools page: a hero, two featured tools, then grouped task cards. Each card gets its own colour and a
// tiny drawing of what the tool does. The task list itself comes from QUICK_TASKS (quicktasks.js), so a
// new task shows up automatically (in "More tools" until it is given a group here).
import { icon, escape } from '../../dom.js';

const META = {
  karaoke: { hue: '#f472b6', icon: 'mic', group: 'featured', blurb: 'Pull the vocals out of any song. Get a clean instrumental to sing over, plus the isolated vocal.' },
  stems: { hue: '#a78bfa', icon: 'layers', group: 'featured', blurb: 'Separate a mix into drums, bass, vocals and the rest, each on its own track, ready to remix.' },
  cut: { hue: '#fb923c', icon: 'cut', group: 'edit' },
  join: { hue: '#38bdf8', icon: 'plus', group: 'edit' },
  ringtone: { hue: '#facc15', icon: 'song', group: 'edit' },
  speed: { hue: '#f87171', icon: 'zap', group: 'edit' },
  noise: { hue: '#4ade80', icon: 'wand', group: 'clean' },
  convert: { hue: '#2dd4bf', icon: 'download', group: 'clean' },
  bpm: { hue: '#c084fc', icon: 'timer', group: 'clean' },
};
const GROUPS = [
  { id: 'edit', title: 'Edit & shape', sub: 'Trim, combine and bend your audio' },
  { id: 'clean', title: 'Clean & analyse', sub: 'Tidy up, convert and measure' },
  { id: 'more', title: 'More tools', sub: '' },
];

// deterministic pseudo-waveform heights (0..1)
const wave = (n, seed = 1) => Array.from({ length: n }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 0.9 + seed) * Math.cos(i * 0.37 + seed * 2)));
const bars = (hs, { x0 = 0, w = 120, h = 36, gap = 1.2, cls = '', mod } = {}) => {
  const bw = w / hs.length;
  return hs.map((v, i) => { const m = mod ? mod(i, hs.length) : 1, bh = Math.max(1.5, v * m * (h - 4)); return `<rect class="${cls}" x="${(x0 + i * bw).toFixed(1)}" y="${((h - bh) / 2).toFixed(1)}" width="${Math.max(0.8, bw - gap).toFixed(1)}" height="${bh.toFixed(1)}" rx="1"/>` }).join('');
};

/** Small drawings of what each tool does. */
const ART = {
  cut: () => `${bars(wave(30, 1), { cls: 'dim' })}<rect class="sel" x="39" y="1" width="45" height="34" rx="3"/>${bars(wave(30, 1).slice(10, 21), { x0: 40, w: 44 })}<path class="line" d="M39 0v36M84 0v36"/>`,
  join: () => `${bars(wave(12, 2), { w: 52 })}<path class="line plus" d="M60 12v12M54 18h12"/>${bars(wave(12, 5), { x0: 68, w: 52 })}`,
  ringtone: () => `${bars(wave(30, 3), { mod: (i, n) => Math.min(1, i / 6, (n - 1 - i) / 6) })}<path class="line env" d="M0 34 L22 4 L98 4 L120 34"/>`,
  speed: () => `${bars(wave(10, 4), { w: 46 })}<path class="line" d="M52 18h12m-4-4 4 4-4 4"/>${bars(wave(20, 4), { x0: 70, w: 50, gap: 0.6 })}`,
  noise: () => `<path class="line noisy" d="${Array.from({ length: 25 }, (_, i) => `${i ? 'L' : 'M'}${(i * 2.4).toFixed(1)} ${(18 + Math.sin(i * 7.3) * 9).toFixed(1)}`).join(' ')}"/><path class="line" d="M64 18 C76 4 88 4 98 18 S112 32 120 18"/><path class="line arrow" d="M58 18h4"/>`,
  convert: () => `<rect class="chip" x="2" y="7" width="40" height="22" rx="5"/><text x="22" y="22">MP3</text><path class="line" d="M48 18h22m-5-5 5 5-5 5"/><rect class="chip on" x="76" y="7" width="42" height="22" rx="5"/><text class="on" x="97" y="22">WAV</text>`,
  bpm: () => `${Array.from({ length: 8 }, (_, i) => `<circle class="${i % 4 === 0 ? 'beat on' : 'beat'}" cx="${8 + i * 9}" cy="18" r="${i % 4 === 0 ? 4 : 2.6}"/>`).join('')}<text class="big" x="118" y="24" text-anchor="end">128</text>`,
  karaoke: () => `${bars(wave(44, 6), { w: 220, h: 64, mod: (i, n) => (i > n * 0.3 && i < n * 0.7 ? 0.28 : 1) })}<path class="line vox" d="M66 32 C80 6 96 58 110 32 S140 6 154 32"/>`,
  stems: () => ['#fb923c', '#38bdf8', '#f472b6', '#4ade80'].map((c, k) => `<g style="--c:${c}" class="stem" transform="translate(0 ${k * 16})">${bars(wave(44, k + 2), { w: 220, h: 14, gap: 1.6, cls: 'c' })}</g>`).join(''),
};
const art = (id, big) => ART[id] ? `<svg class="tool-art" viewBox="0 0 ${big ? '220 64' : '120 36'}" preserveAspectRatio="${big ? 'xMidYMid meet' : 'xMinYMid meet'}" aria-hidden="true">${ART[id]()}</svg>` : '';

const card = (t, m) => `<button class="tool-card" data-action="task:${t.id}" style="--hue:${m.hue}"><span class="tool-icon">${icon(m.icon)}</span><span class="tool-text"><b>${escape(t.label)}</b><small>${escape(t.sub)}</small></span>${art(t.id)}<span class="tool-go" aria-hidden="true">→</span></button>`;
const feature = (t, m) => `<button class="tool-feature" data-action="task:${t.id}" style="--hue:${m.hue}"><span class="tool-feature-art">${art(t.id, true)}</span><span class="tool-feature-body"><span class="tool-icon">${icon(m.icon)}</span><b>${escape(t.label)}</b><small>${escape(m.blurb || t.sub)}</small><span class="tool-cta">Choose a song ${icon('arrow')}</span></span></button>`;

export function toolsHTML(tasks) {
  const meta = (t) => META[t.id] || { hue: '#a78bfa', icon: 'sparkle', group: 'more' };
  const featured = tasks.filter((t) => meta(t).group === 'featured');
  const hero = `<header class="tools-hero"><div class="tools-hero-text"><span class="tools-eyebrow">${icon('wand')} Tools</span><h1>One click to the <span class="grad-text">right tool</span></h1><p>Pick a task, choose your audio, and HitStudio takes you straight there.</p><span class="tools-private">${icon('check')} Private: everything runs on your computer, nothing is uploaded.</span></div><div class="tools-hero-wave" aria-hidden="true">${Array.from({ length: 40 }, (_, i) => `<i style="--h:${Math.round(20 + 80 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21)))}%;--d:${(-i * 0.08).toFixed(2)}s"></i>`).join('')}</div></header>`;
  const groups = GROUPS.map((g) => { const list = tasks.filter((t) => meta(t).group === g.id); return list.length ? `<section class="tools-group"><div class="tools-group-head"><h2>${g.title}</h2>${g.sub ? `<span>${g.sub}</span>` : ''}</div><div class="tools-cards">${list.map((t) => card(t, meta(t))).join('')}</div></section>` : '' }).join('');
  return `<section class="tools-root tools-v2">${hero}${featured.length ? `<div class="tools-featured">${featured.map((t) => feature(t, meta(t))).join('')}</div>` : ''}${groups}</section>`;
}
