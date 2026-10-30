// Petits outils d'interface (sans framework)
import { planetMarkup, brandName } from './themes.js';
// Garde-fou : un élément absent (null / undefined / false) passé à append() s'affichait en toutes lettres
// (« null »). On l'ignore partout dans l'appli.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ['append', 'prepend', 'replaceChildren']) {
    const orig = proto[name];
    if (!orig || orig.__vnSafe) continue;
    const safe = function (...nodes) { return orig.apply(this, nodes.filter((n) => n != null && n !== false)); };
    safe.__vnSafe = true;
    proto[name] = safe;
  }
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const P = {
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.6 15.5a5 5 0 0 1 6.8 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="1.8" stroke="currentColor" stroke-width="2" fill="none"/><rect x="3.5" y="13" width="17" height="7" rx="1.8" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="7.5" cy="7.5" r="1.1" fill="currentColor"/><circle cx="7.5" cy="16.5" r="1.1" fill="currentColor"/>',
  people: '<circle cx="9" cy="8.5" r="3.2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="16.5" cy="9.5" r="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M15.5 14.2c2.6-.3 4.5 1.3 5 4.3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  glow: '<rect x="6" y="7.5" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3 5l2 1.5M21 5l-2 1.5M3 19l2-1.5M21 19l-2-1.5M12 3v2M12 19v2M2 12h2M20 12h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  chat: '<path d="M4 5.5h16v10H9l-5 4z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  send: '<path d="M4 12l16-7-6 16-2.5-6.5z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  remote: '<rect x="7" y="2.5" width="10" height="19" rx="3" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="9" r="2.2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M10 15h4M10 18h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><path d="M17 3.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" fill="currentColor"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" stroke="currentColor" stroke-width="2" fill="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  add: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  more: '<circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/>',
  spark: '<path d="M12 3.5l2.1 5.7 5.9.4-4.6 3.8 1.5 5.8L12 16l-4.9 3.2 1.5-5.8L4 9.6l5.9-.4z" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linejoin="round"/>',
  note: '<path d="M9 18V6l10-2v12" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.6" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="16.5" cy="16" r="2.6" stroke="currentColor" stroke-width="2" fill="none"/>',
  live: '<rect x="3" y="7" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 3l4 4 4-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="13" r="2" fill="currentColor"/>',
  shuffle: '<path d="M4 7h3.5c2 0 3.2 1 4.3 2.7l.4.6M4 17h3.5c2 0 3.2-1 4.3-2.7l2.4-3.6C15.3 9 16.5 8 18.5 8H20M17 5l3 3-3 3M17 13l3 3-3 3M20 16h-1.5c-1.6 0-2.7-.6-3.6-1.7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  up: '<path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  dot: '<circle cx="12" cy="12" r="2.2" fill="currentColor" opacity=".35"/>',
  grid4: '<rect x="4" y="4" width="6.5" height="9" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><rect x="13.5" y="4" width="6.5" height="9" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 17h6.5M13.5 17H20M4 20h6.5M13.5 20H20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  rows: '<rect x="3.5" y="5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.9" fill="none"/><rect x="3.5" y="14" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.9" fill="none"/><path d="M11.5 6.5H20M11.5 9H17M11.5 15.5H20M11.5 18H17" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  gauge: '<path d="M4.5 17a8 8 0 1 1 15 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 13.5l4-4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="14" r="1.6" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  power: '<path d="M12 3.5v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7.2 6.8a7 7 0 1 0 9.6 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 11v6M12 7.5v.1" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12.6l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" fill="currentColor"/>',
  prev: '<path d="M18 5.5v13a1 1 0 0 1-1.5.86L7 13.5V18.5H5v-13h2v5l9.5-5.86A1 1 0 0 1 18 5.5z" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  skip: '<path d="M5 6.2v11.6a.8.8 0 0 0 1.2.7l8.6-5.8a.8.8 0 0 0 0-1.4L6.2 5.5A.8.8 0 0 0 5 6.2z" fill="currentColor"/><rect x="16.5" y="5.5" width="2.5" height="13" rx="1" fill="currentColor"/>',
  grip: '<circle cx="9" cy="7" r="1.5" fill="currentColor"/><circle cx="15" cy="7" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="17" r="1.5" fill="currentColor"/><circle cx="15" cy="17" r="1.5" fill="currentColor"/>',
  fwd: '<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  vol: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  vollow: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  eps: '<rect x="3.5" y="5" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M18 7v8.5a1.5 1.5 0 0 1-1.5 1.5H7M21 10v8.5a1.5 1.5 0 0 1-1.5 1.5H10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  back: '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2.2" fill="none"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" fill="currentColor"/>',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 5v14M16 5v14M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5" stroke="currentColor" stroke-width="1.8"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 20h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  list: '<path d="M6 4.5h12a1 1 0 0 1 1 1V20l-7-4-7 4V5.5a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  gear: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" stroke="currentColor" stroke-width="2" fill="none"/><path d="M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.4 7.4 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7.4 7.4 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7.6 7.6 0 0 1 0-2.4L4.6 9.9l2-3.4 1.9.7a7.4 7.4 0 0 1 2-1.2L10.8 3h4l.3 2.4a7.4 7.4 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7.6 7.6 0 0 1 0 2.4z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  subs: '<rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M7 12h4M13 12h4M7 15.5h7M16 15.5h1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  fs: '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  next: '<path d="M6 5.5v13a1 1 0 0 0 1.5.86L17 13.5V18.5h2v-13h-2v5L7.5 4.64A1 1 0 0 0 6 5.5z" fill="currentColor"/>',
  r10: '<path d="M12 5a7 7 0 1 1-6.6 4.7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 2L8.5 5 12 8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.6" text-anchor="middle" font-size="7" font-weight="800" fill="currentColor" font-family="system-ui">10</text>',
  f10: '<path d="M12 5a7 7 0 1 0 6.6 4.7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 2l3.5 3L12 8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.6" text-anchor="middle" font-size="7" font-weight="800" fill="currentColor" font-family="system-ui">10</text>',
  cast: '<path d="M3 8V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M3 12a7 7 0 0 1 7 7M3 15.5A3.5 3.5 0 0 1 6.5 19" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="3.5" cy="18.5" r="1.2" fill="currentColor"/>',
  airplay: '<path d="M6 17H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 14l5 6H7z" fill="currentColor"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  pip: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5" stroke="currentColor" stroke-width="2" fill="none"/><rect x="11.5" y="11.5" width="7.5" height="5.5" rx="1.2" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="2" fill="none"/>',
  exit: '<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  folder: '<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z" fill="currentColor" opacity=".8"/>',
  restart: '<path d="M5 12a7 7 0 1 0 2.1-5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M5 4v4h4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
};
export function icon(name) {
  const span = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  span.setAttribute('viewBox', '0 0 24 24');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = P[name] || '';
  return span;
}

// Logo : la planète du thème choisi, dont la surface tourne (voir themes.js)
export function logoMark() { const t = document.createElement('template'); t.innerHTML = planetMarkup().trim(); return t.content.firstChild; }
export function brand(cls = '') { return h('span', { class: `brand ${cls}` }, logoMark(), h('span', { class: 'brand-name' }, brandName())); }

// Image du serveur ; w = largeur voulue (342 affiches, 780 vignettes) : le serveur l'envoie déjà réduite, bien plus légère
export const img = (name, w) => (!name ? null : /^(data:|blob:|https?:)/.test(name) ? name : `/img/${encodeURIComponent(name)}${w ? `?w=${w}` : ''}`);
export const hueOf = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };

export function placeholder(title, cls = 'ph') {
  return h('div', { class: cls, style: { '--h': hueOf(title) } }, title);
}

// Image avec repli élégant si absente ou en erreur
// Fondu à l'arrivée de l'image (immédiat si elle est déjà en cache)
export function fadeIn(el) {
  const ok = () => el.classList.add('ok');
  if (el.complete && el.naturalWidth) ok(); else el.addEventListener('load', ok, { once: true });
  requestAnimationFrame(() => { if (el.complete && el.naturalWidth) ok(); });
}
export function picture(src, title, { cls = '', lazy = true } = {}) {
  if (!src) return placeholder(title);
  const el = h('img', { src, alt: '', class: lazy ? `${cls} fade`.trim() : cls, loading: lazy ? 'lazy' : 'eager', decoding: 'async' });
  el.addEventListener('error', () => el.replaceWith(placeholder(title)), { once: true });
  if (lazy) fadeIn(el);
  return el;
}

export const AVATAR_HUES = [12, 38, 145, 190, 215, 265, 300, 340];
export function avatar(profile, cls = '') {
  const el = h('div', { class: `avatar ${cls}` }, (profile.name || '?').trim().charAt(0).toUpperCase());
  el.style.setProperty('--hue', AVATAR_HUES[(profile.avatar || 0) % AVATAR_HUES.length]);
  return el;
}

// Notification : une seule à la fois. Une nouvelle remplace la précédente (avec un petit rebond),
// avec une icône selon le type, une barre de temps, un bouton d'action (ex. « Annuler »),
// et on peut la fermer d'un geste (glisser) ou d'un appui.
// toast('Texte'), toast('Erreur', true), toast('Texte', { type: 'success'|'info'|'error', action: { label, onClick }, duration })
let toastEl = null, toastTimer = null, toastLeft = 0, toastStart = 0;
const TOAST_ICON = { success: 'check', error: 'info', info: 'info' };
function toastType(msg) {
  const m = String(msg);
  if (/erreur|impossible|refus|introuvable|injoignable|échec|invalide|trop de/i.test(m)) return 'error';
  if (/^(ajouté|marqué|enregistr|bienvenue|relié|copié|code copié|nouveau code|message envoyé|lecture arrêtée|téléphone relié|préférence|seerr relié|fiche mise à jour|appareil déconnecté)|vue? en entier|est dans vos envies|demandé à seerr| vu$/i.test(m)) return 'success';
  return 'info';
}
function dismissToast() {
  clearTimeout(toastTimer);
  const el = toastEl;
  if (!el) return;
  toastEl = null;
  el.classList.add('leave');
  setTimeout(() => el.remove(), 260);
}
export function toast(msg, opt = false) {
  const o = opt && typeof opt === 'object' ? opt : { type: opt ? 'error' : null };
  const type = o.type || toastType(msg);
  const duration = o.duration || (o.action ? 6000 : type === 'error' ? 5200 : 3400);
  const host = overlayHost();
  let el = toastEl;
  const fresh = !el || !el.isConnected || el.parentNode !== host;
  if (fresh) {
    if (el) el.remove();
    el = h('div', { class: 'toast', role: type === 'error' ? 'alert' : 'status', 'aria-live': type === 'error' ? 'assertive' : 'polite' });
    // Glisser pour fermer (tactile et souris)
    let x0 = null, dx = 0;
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; x0 = e.clientX; dx = 0; el.setPointerCapture(e.pointerId); el.classList.add('drag'); clearTimeout(toastTimer); });
    el.addEventListener('pointermove', (e) => { if (x0 == null) return; dx = e.clientX - x0; el.style.transform = `translateX(calc(-50% + ${dx}px))`; el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 220)); });
    const end = () => {
      if (x0 == null) return;
      x0 = null; el.classList.remove('drag');
      if (Math.abs(dx) > 70 || Math.abs(dx) < 4) { el.style.transform = ''; el.style.opacity = ''; dismissToast(); return; }
      el.style.transform = ''; el.style.opacity = '';
      toastTimer = setTimeout(dismissToast, 1800);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    host.append(el);
    toastEl = el;
  }
  const bar = h('i', { class: 'toast-time' });
  bar.style.animationDuration = `${duration}ms`;
  el.className = `toast t-${type}${fresh ? ' enter' : ' swap'}`;
  el.replaceChildren(...[
    h('span', { class: 'toast-ic' }, icon(TOAST_ICON[type] || 'info')),
    h('span', { class: 'toast-msg' }, msg),
    o.action ? h('button', { class: 'toast-act', type: 'button', onclick: () => { dismissToast(); o.action.onClick(); } }, o.action.label) : null,
    bar].filter(Boolean));
  if (!fresh) { void el.offsetWidth; }
  clearTimeout(toastTimer);
  toastStart = Date.now(); toastLeft = duration;
  toastTimer = setTimeout(dismissToast, duration);
  // Survol : la notification reste le temps de la lire
  el.onpointerenter = (e) => { if (e.pointerType !== 'mouse') return; clearTimeout(toastTimer); toastLeft -= Date.now() - toastStart; el.classList.add('hold'); };
  el.onpointerleave = (e) => { if (e.pointerType !== 'mouse') return; el.classList.remove('hold'); toastStart = Date.now(); toastTimer = setTimeout(dismissToast, Math.max(1200, toastLeft)); };
}

// Feuille modale (menus) — se ferme avec Retour / Échap / clic à l'extérieur
// En plein écran, seul l'élément plein écran est visible : les fenêtres et messages s'y affichent
export const overlayHost = () => { const f = document.fullscreenElement || document.webkitFullscreenElement; return f && f !== document.documentElement ? f : document.body; };

export function sheet(title, content, { onClose, keepBackspace = false, wide = false } = {}) {
  const prevFocus = document.activeElement;
  const box = h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, title ? h('h2', {}, title) : null, content);
  const wrap = h('div', { class: 'sheet-wrap' }, box);
  const close = () => {
    wrap.remove(); document.removeEventListener('keydown', onKey, true);
    onClose && onClose(); prevFocus && prevFocus.focus && prevFocus.focus();
  };
  const onKey = (e) => { if (keepBackspace && e.key === 'Backspace') return; if (isBack(e)) { e.preventDefault(); e.stopPropagation(); close(); } };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', onKey, true);
  // Tactile : glisser la fenêtre vers le bas pour la fermer (depuis le haut, quand elle n'est pas défilée)
  let y0 = null, dy = 0;
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || box.scrollTop > 0 || e.clientY - box.getBoundingClientRect().top > 90 || e.target.closest('input, textarea, select')) return;
    y0 = e.clientY; dy = 0;
  });
  box.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    if (dy > 4) { box.style.transition = 'none'; box.style.transform = `translateY(${dy}px)`; wrap.style.background = `rgba(0,0,0,${Math.max(0.1, 0.55 - dy / 600)})`; }
  });
  const endDrag = () => {
    if (y0 == null) return;
    y0 = null; box.style.transition = '';
    if (dy > 110) { box.style.transform = 'translateY(100%)'; setTimeout(close, 180); }
    else { box.style.transform = ''; wrap.style.background = ''; }
  };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);
  box.prepend(h('span', { class: 'sheet-grab', 'aria-hidden': 'true' }));
  overlayHost().append(wrap);
  requestAnimationFrame(() => (box.querySelector('.opt.on, .f, input, button') || box).focus());
  return { close, box };
}

export function isBack(e) {
  return e.key === 'Escape' || e.key === 'Backspace' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '') ||
    e.key === 'GoBack' || e.key === 'BrowserBack' || e.keyCode === 10009 || e.keyCode === 461;
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
export function fmtRuntime(min) {
  if (!min) return '';
  const hh = Math.floor(min / 60), mm = Math.round(min % 60);
  return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm} min`;
}

const LANG3 = { fre: 'fr', fra: 'fr', eng: 'en', spa: 'es', ger: 'de', deu: 'de', ita: 'it', por: 'pt', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', ara: 'ar', rus: 'ru', dut: 'nl', nld: 'nl', pol: 'pl', tur: 'tr', hin: 'hi', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', heb: 'he', gre: 'el', ell: 'el' };
let dn;
export function langName(code) {
  if (!code || code === 'und') return 'Inconnue';
  const c = LANG3[code] || code;
  try { dn = dn || new Intl.DisplayNames(['fr'], { type: 'language' }); const n = dn.of(c); return n.charAt(0).toUpperCase() + n.slice(1); }
  catch { return code; }
}

export function ageBadge(item) {
  if (item.age == null && !item.cert) return null;
  const label = item.age === 0 ? 'Tous publics' : item.age != null ? `${item.age}+` : item.cert;
  return h('span', { class: 'badge age' }, label);
}

// Confirmation dans la page (les fenêtres confirm() du navigateur sont bloquées dans certains contextes)
export function confirmSheet(message, actionLabel = 'Confirmer') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
    const content = h('div', {}, h('p', { style: { color: 'var(--mist)', margin: '0 0 20px' } }, message),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn f', onclick: () => finish(false) }, 'Annuler'),
        h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => finish(true) }, actionLabel)));
    const s = sheet('Confirmer', content, { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

// Dates de sortie en français ("12 oct. 2025") et ancienneté en jours
export function fmtDate(iso, withYear = true) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('fr-FR', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}
export function daysSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(`${iso.slice(0, 10)}T12:00:00`).getTime()) / 864e5);
}

// QR code en SVG (lien d'invitation, appairage de la télécommande)
import qrcode from './qrcode.mjs';
export function qrSvg(text, size = 220) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', `0 0 ${n + 4} ${n + 4}`);
  el.setAttribute('width', size); el.setAttribute('height', size);
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'QR code');
  el.classList.add('qr');
  el.innerHTML = `<rect width="${n + 4}" height="${n + 4}" fill="#eceae4"/><path d="${d}" fill="#0d1016"/>`;
  return el;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Lien copié'); return true; }
  catch { toast('Copiez le lien affiché à la main'); return false; }
}

// Mot de passe : mêmes règles que le serveur (vérifiées des deux côtés), avec une jauge de solidité
const COMMON_PW = ['password', 'motdepasse', 'azerty', 'azertyuiop', 'qwerty', '123456', '12345678', '123456789', '1234567890', 'admin', 'venus', 'soleil', 'bonjour', 'iloveyou', 'jetaime', 'famille', 'netflix'];
export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 10) return '10 caractères minimum';
  if (COMMON_PW.includes(s.toLowerCase()) || COMMON_PW.includes(s.toLowerCase().replace(/\d+$/, ''))) return 'Trop courant, choisissez-en un autre';
  if (/^(.)\1+$/.test(s)) return 'Trop simple';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(s)).length;
  if (kinds < 2 && s.length < 16) return 'Mélangez lettres et chiffres (ou une phrase de 16 caractères et plus)';
  return '';
}
export function passwordMeter(input) {
  const bar = h('i');
  const txt = h('small', { class: 'pw-text' });
  const el = h('div', { class: 'pw-meter', 'aria-live': 'polite' }, h('span', { class: 'pw-bar' }, bar), txt);
  const paint = () => {
    const s = input.value;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(s)).length;
    const score = !s ? 0 : passwordProblem(s) ? 1 : Math.min(4, 1 + kinds + (s.length >= 14 ? 1 : 0) - 1);
    bar.style.width = `${score * 25}%`;
    el.dataset.level = String(score);
    txt.textContent = !s ? '10 caractères minimum, lettres et chiffres' : passwordProblem(s) || ['', 'Faible', 'Correct', 'Solide', 'Très solide'][score];
  };
  input.addEventListener('input', paint);
  paint();
  return el;
}
