import { ICONS } from './ui/icons.js';
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const escape = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const paths = {
 jam: ICONS.guitar,
 eq:'<path d="M2 15c3 0 4-8 7-8s3 10 6 10 3-6 7-6"/><path d="M5 4v4M12 3v2M19 5v3M5 19v1M12 21v-1M19 18v2" opacity=".55"/>',
 record:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>', tools:'<path d="m14 6 3-3a5 5 0 0 0-6 6L3.5 16.5a2.1 2.1 0 0 0 3 3L14 12a5 5 0 0 0 6-6l-3 3Z"/><path d="m4 3 5 2 1 3-3 3-3-1-2-5Zm6 10 8 8 3-3-8-8"/>', play:'<path d="m9 5 11 7-11 7Z"/>', pause:'<path d="M8 5v14M16 5v14"/>', stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>', next:'<path d="M6 5.5a.8.8 0 0 1 1.2-.7l9 6.5a.85.85 0 0 1 0 1.4l-9 6.5a.8.8 0 0 1-1.2-.7Z" fill="currentColor" stroke="none"/><path d="M19 5v14" stroke-width="2.5"/>', previous:'<path d="M18 5.5a.8.8 0 0 0-1.2-.7l-9 6.5a.85.85 0 0 0 0 1.4l9 6.5a.8.8 0 0 0 1.2-.7Z" fill="currentColor" stroke="none"/><path d="M5 5v14" stroke-width="2.5"/>',
 volume:'<path d="m4 9 4 0 5-4v14l-5-4H4ZM17 8c3 2 3 6 0 8M20 5c5 4 5 10 0 14"/>', plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>', folder:'<path d="M3 7V5h7l2 3h9v12H3Z"/>',
 edit:'<path d="M3 12h3l2-7 4 14 4-14 2 7h3"/>', mix:'<path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 10h6"/>', create:'<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="5.5" cy="18" rx="3.5" ry="2.5"/><ellipse cx="16.5" cy="16" rx="3.5" ry="2.5"/>',
 dj:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 6a6 6 0 0 1 6 6"/>', visualize:'<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(35 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="2"/>',
 library:'<path d="M4 4v16M9 4v16M14 4v16m3-16 4 16"/>', expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>', shrink:'<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>', mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
 undo:'<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',redo:'<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>', save:'<path d="M4 3h14l3 3v15H3V3Zm3 0v6h10V3M7 21v-8h10v8"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',headphones:'<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="2" y="12" width="5" height="9" rx="2"/><rect x="17" y="12" width="5" height="9" rx="2"/>',shuffle:'<path d="m3 5 14 14h4m-4-4 4 4-4 4M3 19l6-6m5-5 3-3h4m-4-4 4 4-4 4"/>', repeat:'<path d="M4 7h15l-3-3m3 3-3 3M20 17H5l3 3m-3-3 3-3"/>', heart:'<path d="M12 21 3 12C-3 4 7-1 12 6c5-7 15-2 9 6Z"/>', radio:'<path d="M3 8 19 2M2 8h20v13H2Z"/><circle cx="8" cy="15" r="3"/><path d="M15 12h4m-4 5h4"/>', cut:'<circle cx="5" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><path d="m7 7 14 14M7 17 21 3"/>'
};
// Lucide icons first; the filled transport glyphs (record/next/previous) keep their custom paths.
const KEEP = new Set(['record', 'next', 'previous']);
export const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(!KEEP.has(name) && ICONS[name]) || paths[name] || ICONS.sparkle}</svg>`;
export const button = (label, action, glyph = '', cls = '') => `<button class="${cls}" data-action="${action}" ${glyph ? `aria-label="${escape(label)}" title="${escape(label)}"` : ''}>${glyph ? icon(glyph) : ''}<span>${escape(label)}</span></button>`;

/** One empty-state card shared by Edit, Mix and Visualize. `title` may contain <span class="grad-text">. */
export const emptyState = ({ title, sub, actions = '', steps = [] }) => `<div class="tl-empty-card"><div class="tl-empty-orb" aria-hidden="true"></div><div class="tl-empty-wave" aria-hidden="true">${Array.from({ length: 48 }, (_, i) => `<span style="height:${18 + Math.round(Math.abs(Math.sin(i * .55) * Math.cos(i * .21)) * 62)}%;animation-delay:${-(i * .07).toFixed(2)}s"></span>`).join('')}</div><h1 class="tl-empty-title">${title}</h1><p class="tl-empty-sub muted">${sub}</p><div class="tl-empty-actions">${actions}</div>${steps.length ? `<div class="tl-empty-steps">${steps.map(([t, d], i) => `<div class="tl-empty-step"><span class="tl-empty-step-n">${i + 1}</span><div><div class="tl-empty-step-t">${t}</div><div class="tl-empty-step-d faint">${d}</div></div></div>`).join('')}</div>` : ''}</div>`;
