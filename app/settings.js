// Settings dialog: appearance, sound, visualizer defaults, shortcuts and data. Everything lives in localStorage.
import { $, $$, icon, escape } from './dom.js';
import { showModal, closeModal } from './dialogs.js';
import { useStore } from './core/store.js';
import { toast } from './core/toast.js';
import { PALETTES } from './features/visualizer/scenes/types.js';

const read = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : v } catch { return fallback } };
const write = (key, value) => { try { localStorage.setItem(key, value) } catch { /* private mode */ } };
const viz = (key, fallback) => { try { return JSON.parse(localStorage.getItem('bloom.viz.' + key)) ?? fallback } catch { return fallback } };
const setViz = (key, value) => write('bloom.viz.' + key, JSON.stringify(value));

export const settingEnabled = (key) => read('hitstudio.' + key, '1') !== '0';

const SHORTCUTS = [
  ['Space', 'Play / pause'], ['Shift + Space', 'Play / stop the beat'], ['⌘ K', 'Search actions'], ['⌘ ,', 'Settings'],
  ['⌘ 1 – 7', 'Switch section'], ['⌘ Z / ⌘ ⇧ Z', 'Undo / redo'], ['S', 'Split clip at playhead'], ['A – K', 'Play notes in Create'],
  ['G', 'Generate a new idea'], ['Esc', 'Leave immersive view / stop'],
  ['← / →', 'Visualizer: previous / next scene'], ['C', 'Visualizer: customize'], ['F', 'Visualizer: fullscreen'], ['H', 'Visualizer: hide the controls'],
];

const toggle = (id, label, hint, on) => `<label class="st-row st-toggle"><span class="st-text"><b>${label}</b><small>${hint}</small></span><input type="checkbox" id="${id}" ${on ? 'checked' : ''} /><span class="st-switch" aria-hidden="true"></span></label>`;
const range = (id, label, min, max, step, value) => `<label class="st-row"><span class="st-text"><b>${label}</b></span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" /></label>`;

export function showSettings() {
  const theme = useStore.getState().ui.theme;
  const palette = viz('palette', 'bloom');
  showModal('Settings', `<div class="st-root">
    <nav class="st-nav" aria-label="Settings sections">${[['appearance', 'sun', 'Appearance'], ['sound', 'volume', 'Sound'], ['visuals', 'visualize', 'Visualizer'], ['keys', 'keys', 'Shortcuts'], ['data', 'settings', 'Data']].map(([id, ic, label], i) => `<button data-st-tab="${id}" class="${i ? '' : 'on'}">${icon(ic)}<span>${label}</span></button>`).join('')}</nav>
    <div class="st-body">
      <section data-st-panel="appearance">
        <h3>Appearance</h3>
        <div class="st-row"><span class="st-text"><b>Theme</b><small>Dark is easiest on the eyes in a studio.</small></span><div class="st-seg">${['dark', 'light'].map((t) => `<button data-st-theme="${t}" class="${t === theme ? 'on' : ''}">${icon(t === 'dark' ? 'moon' : 'sun')}<span>${t[0].toUpperCase() + t.slice(1)}</span></button>`).join('')}</div></div>
        ${toggle('st-welcome', 'Welcome screen on start', 'Show the quick-start dialog when HitStudio opens.', read('bloom.welcome.dismissed', '0') !== '1')}
        <div class="st-row"><span class="st-text"><b>Tips</b><small>Bring back the hints you have dismissed.</small></span><button data-st-tips>Show tips again</button></div>
      </section>
      <section data-st-panel="sound" hidden>
        <h3>Sound</h3>
        ${toggle('st-chime', 'Opening ident', 'Play the short HitStudio sound when the app opens.', settingEnabled('chime'))}
        ${toggle('st-uisounds', 'Section sounds', 'A very quiet tick when you switch between sections. Never part of exports.', settingEnabled('uisounds'))}
      </section>
      <section data-st-panel="visuals" hidden>
        <h3>Visualizer defaults</h3>
        <div class="st-row"><span class="st-text"><b>Colours</b></span><div class="st-palettes">${Object.entries(PALETTES).map(([id, p]) => `<button data-st-palette="${id}" class="palette ${id === palette ? 'active' : ''}" style="background:${p.chip}" aria-label="${escape(p.label)}" title="${escape(p.label)}"></button>`).join('')}</div></div>
        ${range('st-sens', 'Reactivity', 0.4, 2.5, 0.01, viz('sens', 1))}
        ${range('st-speed', 'Animation speed', 0.25, 2.5, 0.05, viz('speed', 1))}
        ${range('st-glow', 'Glow', 0, 2, 0.05, viz('glow', 1))}
        ${toggle('st-particles', 'Floating particles', 'Soft particles behind the 3D scenes.', viz('particles', true) !== false)}
        ${toggle('st-auto', 'Shuffle scenes', 'Move to a new scene on big moments in the music.', !!viz('auto', false))}
        <div class="st-row"><span class="st-text"><b>Renderer</b><small>Use Compatibility if 3D is slow on your device.</small></span><select id="st-renderer">${[['webgl', '3D'], ['canvas', 'Compatibility']].map(([v, l]) => `<option value="${v}" ${viz('renderer', 'webgl') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <p class="st-note">Visualizer changes apply the next time you open the Visualize screen. While watching, press C or use Customize for scenes, colours and intensity.</p>
      </section>
      <section data-st-panel="keys" hidden>
        <h3>Keyboard shortcuts</h3>
        <div class="st-keys">${SHORTCUTS.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>
      </section>
      <section data-st-panel="data" hidden>
        <h3>Data</h3>
        <p class="st-note">HitStudio runs in your browser. Projects, songs and settings stay on this device; nothing is uploaded.</p>
        <div class="st-row"><span class="st-text"><b>Reset all settings</b><small>Theme, welcome screen, sound and visualizer defaults go back to normal. Your projects and songs are not touched.</small></span><button data-st-reset class="danger">Reset</button></div>
        <p class="st-note">HitStudio 0.2 · Made with Web Audio and Three.js</p>
      </section>
    </div></div>`);
  const root = $('#modal .st-root');
  const tab = (id) => { $$('[data-st-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.stTab === id)); $$('[data-st-panel]', root).forEach((p) => { p.hidden = p.dataset.stPanel !== id }) };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.stTab) tab(b.dataset.stTab);
    if (b.dataset.stTheme) { useStore.getState().setUI({ theme: b.dataset.stTheme }); document.documentElement.dataset.theme = b.dataset.stTheme; $$('[data-st-theme]', root).forEach((x) => x.classList.toggle('on', x === b)) }
    if ('stTips' in b.dataset) { localStorage.setItem('hitstudio.dismissedTips', '[]'); toast('Tips will show again after a reload.') }
    if (b.dataset.stPalette) { setViz('palette', b.dataset.stPalette); $$('[data-st-palette]', root).forEach((x) => x.classList.toggle('active', x === b)) }
    if ('stReset' in b.dataset && confirm('Reset all HitStudio settings?')) {
      for (const key of Object.keys(localStorage)) if (key.startsWith('bloom.viz.') || key.startsWith('hitstudio.') && key !== 'hitstudio.autosave' || key === 'bloom.welcome.dismissed' || key === 'bloom.theme') localStorage.removeItem(key);
      document.documentElement.dataset.theme = 'dark'; useStore.getState().setUI({ theme: 'dark' }); closeModal(); toast('Settings reset.');
    }
  });
  root.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'st-sens') setViz('sens', Number(e.target.value));
    if (id === 'st-speed') setViz('speed', Number(e.target.value));
    if (id === 'st-glow') setViz('glow', Number(e.target.value));
  });
  root.addEventListener('change', (e) => {
    const id = e.target.id, on = e.target.checked;
    if (id === 'st-welcome') write('bloom.welcome.dismissed', on ? '0' : '1');
    if (id === 'st-chime') write('hitstudio.chime', on ? '1' : '0');
    if (id === 'st-uisounds') write('hitstudio.uisounds', on ? '1' : '0');
    if (id === 'st-particles') setViz('particles', on);
    if (id === 'st-auto') setViz('auto', on);
    if (id === 'st-renderer') setViz('renderer', e.target.value);
  });
}
