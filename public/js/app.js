// Venus — démarrage, routage et coque de l'application
import { api, auth } from './api.js';
import { h, icon, avatar, toast, logoMark, brand, sheet } from './ui.js';
import { initNav, focusFirst } from './nav.js';

export const state = { status: null, profile: null, categories: null };
const app = document.getElementById('app');
let current = null;

const ROUTES = [
  [/^\/$/, () => import('./views/home.js')],
  [/^\/films$/, () => import('./views/browse.js'), { kind: 'movie' }],
  [/^\/series$/, () => import('./views/browse.js'), { kind: 'show' }],
  [/^\/liste$/, () => import('./views/browse.js'), { kind: 'mylist' }],
  [/^\/animes$/, () => import('./views/browse.js'), { kind: 'anime' }],
  [/^\/clips$/, () => import('./views/browse.js'), { kind: 'clip' }],
  [/^\/tv$/, () => import('./views/tv.js')],
  [/^\/ajouter$/, () => import('./views/add.js')],
  [/^\/recherche$/, () => import('./views/search.js')],
  [/^\/titre\/(\d+)$/, () => import('./views/details.js'), (m) => ({ id: Number(m[1]) })],
  [/^\/lecture\/(\d+)$/, () => import('./views/player.js'), (m) => ({ id: Number(m[1]) })],
  [/^\/reglages$/, () => import('./views/settings.js')],
  [/^\/cesoir$/, () => import('./views/cesoir.js')],
  [/^\/seance$/, () => import('./views/seance.js')],
  [/^\/telecommande$/, () => import('./views/telecommande.js')],
];
// Écrans plein écran, sans navigation
const BARE = ['/lecture', '/telecommande'];

// Routeur : adresse (#/films…) par défaut, ou pile en mémoire quand l'adresse n'est pas modifiable (démo intégrée)
const memory = !!window.__VN_MEMORY_ROUTER;
const stack = ['/'];
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };
const notify = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

export function go(path, { replace = false } = {}) {
  if (memory) { if (replace) stack[stack.length - 1] = path; else stack.push(path); notify(); return; }
  const target = '#' + path;
  if (replace) location.replace(target); else location.hash = target;
}
export function back(fallback = '/') {
  if (memory) { if (stack.length > 1) stack.pop(); else stack[0] = fallback; notify(); return; }
  if (history.length > 1 && ss.get('vn_nav')) history.back();
  else go(fallback, { replace: true });
}
export const currentPath = () => parseHash().path;

function parseHash() {
  const raw = memory ? stack[stack.length - 1] : location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

function navLink(href, label, ic, path) {
  const active = href === '/' ? path === '/' : path.startsWith(href);
  return h('a', { href: '#' + href, class: `f${active ? ' active' : ''}`, 'aria-current': active ? 'page' : null }, ic ? icon(ic) : null, h('span', {}, label));
}

// Sources affichées dans la navigation, selon ce que contient le serveur
const SOURCES = [
  ['/films', 'Films', 'film', 'movie'], ['/series', 'Séries', 'tv', 'show'], ['/animes', 'Animés', 'spark', 'anime'],
  ['/clips', 'Clips', 'note', 'clip'], ['/tv', 'TV', 'live', 'channel'],
];
function hasCat(cat) {
  const c = state.categories;
  if (!c || !Object.keys(c).length) return cat === 'movie' || cat === 'show';
  return (c[cat] || 0) > 0;
}
export async function refreshCategories() {
  try { state.categories = await api('/api/categories'); } catch { /* garde l'ancienne liste */ }
}

// Rail à gauche (ordinateur, TV) + barre du haut et onglets en bas (mobile)
function shell(path) {
  const p = state.profile;
  const sources = SOURCES.filter(([, , , cat]) => hasCat(cat));
  const rail = h('nav', { class: 'rail', 'aria-label': 'Navigation principale' },
    h('a', { href: '#/', class: 'home-link f', 'aria-label': 'Venus, accueil' }, logoMark()),
    navLink('/', 'Accueil', 'home', path),
    navLink('/cesoir', 'Ce soir', 'moon', path),
    sources.map(([href, label, ic]) => navLink(href, label, ic, path)),
    navLink('/liste', 'Ma liste', 'list', path),
    navLink('/recherche', 'Recherche', 'search', path),
    h('div', { class: 'spacer' }),
    navLink('/seance', 'Séance', 'people', path),
    h('button', { class: 'rail-item f', onclick: openRemote }, icon('remote'), h('span', {}, 'Télécommande')),
    p.isAdmin ? navLink('/ajouter', 'Ajouter', 'add', path) : null,
    navLink('/reglages', 'Réglages', 'gear', path),
    h('button', { class: 'rail-item f', 'aria-label': `Changer de profil (${p.name})`, onclick: switchProfile }, avatar(p, 'sm'), h('span', {}, p.name)));
  const top = h('header', { class: 'mobile-top' },
    h('a', { href: '#/', class: 'f', 'aria-label': 'Accueil' }, brand()),
    h('div', { style: { display: 'flex', gap: '4px' } },
      h('a', { href: '#/reglages', class: 'icon-btn f', 'aria-label': 'Réglages' }, icon('gear')),
      h('button', { class: 'icon-btn f', 'aria-label': `Changer de profil (${p.name})`, onclick: switchProfile }, avatar(p, 'sm'))));
  // Mobile : 4 onglets + « Plus » pour les autres sources
  const mainTabs = [['/cesoir', 'Ce soir', 'moon'], ...sources.slice(0, 1)];
  const extra = [...sources.slice(1), ['/liste', 'Ma liste', 'list'], ['/seance', 'Séance à plusieurs', 'people'], ['/telecommande', 'Télécommande', 'remote'],
    ...(p.isAdmin ? [['/ajouter', 'Ajouter des vidéos', 'add']] : []), ['/reglages', 'Réglages', 'gear']];
  const moreActive = extra.some(([href]) => path.startsWith(href));
  const tabs = h('nav', { class: 'tabbar' },
    navLink('/', 'Accueil', 'home', path),
    mainTabs.map(([href, label, ic]) => navLink(href, label, ic, path)),
    navLink('/recherche', 'Recherche', 'search', path),
    h('a', { href: '#', class: `f${moreActive ? ' active' : ''}`, onclick: (e) => {
      e.preventDefault();
      const s = sheet('Plus', h('div', { class: 'more-list' }, extra.map(([href, label, ic]) => h('button', { class: 'opt f', onclick: () => { s.close(); go(href); } }, icon(ic), label))));
    } }, icon('more'), h('span', {}, 'Plus')));
  const onScroll = () => top.classList.toggle('solid', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return { before: [rail, top], after: [tabs], cleanup: () => removeEventListener('scroll', onScroll) };
}

// Écran de chargement : présent dans index.html, retiré une fois le premier écran prêt
const bootStarted = performance.now();
let bootDone = false;
function hideBoot() {
  if (bootDone) return;
  bootDone = true;
  const el = document.querySelector('.boot');
  if (!el) return;
  const wait = Math.max(0, 700 - (performance.now() - bootStarted));
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, wait);
}
export function bootNote(text) { const n = document.querySelector('.boot-note'); if (n) n.textContent = text; }

// Nouveautés en temps réel : le serveur prévient dès qu'un média est détecté
let events = null;
function listenEvents() {
  if (events || !window.EventSource || window.__VN_MEMORY_ROUTER) return;
  events = new EventSource(`/api/events?token=${encodeURIComponent(auth.token || '')}`);
  events.addEventListener('library', (e) => { try { onLibrary(JSON.parse(e.data)); } catch { /* message illisible */ } });
  events.onerror = () => { /* le navigateur se reconnecte tout seul */ };
}
window.addEventListener('vn:library', (e) => onLibrary(e.detail));
async function onLibrary(d) {
  {
    if (!state.profile || !d || !d.added || !d.added.length) return;
    const names = d.added.slice(0, 3).join(', ') + (d.added.length > 3 ? ` et ${d.added.length - 3} autres` : '');
    toast(`Nouveau dans Venus : ${names}`);
    await refreshCategories();
    const { path } = parseHash();
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '') || document.querySelector('.sheet-wrap');
    if (!typing && ['/', '/films', '/series', '/animes', '/clips', '/tv', '/liste'].includes(path)) {
      const y = scrollY; await route(); window.scrollTo(0, y);
    }
  }
}
export function stopEvents() { if (events) { events.close(); events = null; } }

// Télécommande : sur un téléphone, on ouvre la télécommande ; sur un écran, on affiche son QR code
export async function openRemote() {
  const phone = document.documentElement.classList.contains('touch') && innerWidth < 900;
  if (phone) return go('/telecommande');
  const m = await import('./remote-screen.js');
  m.showPairing();
}

export async function switchProfile() {
  await api('/api/profiles/leave', { method: 'POST' }).catch(() => {});
  state.profile = null;
  showGate('profiles');
}

function swap(fn) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce && !document.hidden) return document.startViewTransition(fn).updateCallbackDone;
  return fn();
}

async function mount(viewModule, params, { withNav, path }) {
  const bare = !withNav;
  const ticket = ++mountTicket;
  // Barre de chargement fine en haut de l'écran pendant la préparation de la page suivante
  const bar = document.querySelector('.route-bar') || document.body.appendChild(h('div', { class: 'route-bar', 'aria-hidden': 'true' }));
  bar.classList.add('on');
  const mod = await viewModule;
  const main = h('main', { class: withNav ? 'with-nav' : '' });
  const chrome = withNav ? shell(path) : null;
  const nodes = [...(chrome ? chrome.before : []), main, ...(chrome ? chrome.after : [])];
  const finish = (view) => {
    bar.classList.remove('on');
    hideBoot();
    current = { destroy: () => { view && view.destroy && view.destroy(); chrome && chrome.cleanup(); } };
    if (document.documentElement.classList.contains('keys') || document.documentElement.classList.contains('tv')) requestAnimationFrame(() => focusFirst());
  };
  const showError = (e) => {
    if (e.status === 401 || e.message === 'Choisissez un profil') return;
    main.append(h('div', { class: 'empty' }, h('h2', {}, 'Impossible d’afficher cette page'), h('p', {}, e.message),
      h('button', { class: 'btn f', onclick: () => route() }, 'Réessayer')));
  };
  const dropOld = () => { if (current) { try { current.destroy && current.destroy(); } catch { /* */ } current = null; } };

  if (bare) {
    // Lecteur et télécommande : affichage immédiat
    dropOld();
    app.replaceChildren(...nodes);
    try { finish(await mod.render(main, params)); } catch (e) { finish(null); showError(e); }
    return;
  }
  // Autres pages : préparées hors écran, puis transition fluide
  let view = null, failed = null;
  try { view = await mod.render(main, params); } catch (e) { failed = e; }
  if (ticket !== mountTicket) { view && view.destroy && view.destroy(); chrome && chrome.cleanup(); return; }
  dropOld();
  await swap(() => { app.replaceChildren(...nodes); window.scrollTo(0, 0); });
  finish(view);
  if (failed) showError(failed);
}
let mountTicket = 0;

// Lueur d'ambiance : prend la couleur du titre en cours (voir ambiance.js)
if (!document.querySelector('.tint-glow')) document.body.prepend(h('div', { class: 'tint-glow', 'aria-hidden': 'true' }));

async function route() {
  if (!state.profile) return;
  listenEvents();
  // Sur une TV, la télécommande-téléphone est prête dès l'ouverture
  if (document.documentElement.classList.contains('tv') && !window.__vnPairing) {
    window.__vnPairing = true;
    import('./remote-screen.js').then((m) => m.startPairing()).catch(() => {});
  }
  if (!state.categories || parseHash().path === '/') await refreshCategories();
  const { path, query } = parseHash();
  for (const [re, loader, extra] of ROUTES) {
    const m = re.exec(path);
    if (!m) continue;
    const params = { ...(typeof extra === 'function' ? extra(m) : extra || {}), query };
    const isPlayer = BARE.some((b) => path.startsWith(b));
    return mount(loader(), params, { withNav: !isPlayer, path });
  }
  go('/', { replace: true });
}

async function showGate(kind) {
  if (current) { try { current.destroy && current.destroy(); } catch { /* */ } current = null; }
  app.replaceChildren();
  const main = h('main');
  app.append(main);
  const mod = await import(`./views/${kind}.js`);
  const view = await mod.render(main, {
    done: async (profile) => {
      if (profile) { state.profile = profile; route(); }
      else boot();
    },
  });
  current = view;
  hideBoot();
  requestAnimationFrame(() => focusFirst());
}

async function boot() {
  try {
    state.status = await api('/api/status');
  } catch (e) {
    app.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'panel' }, brand(), h('h2', {}, 'Serveur injoignable'), h('p', {}, e.message),
      h('button', { class: 'btn btn-play f', onclick: boot }, 'Réessayer'))));
    hideBoot();
    return;
  }
  document.title = state.status.name || 'Venus';
  if (!state.status.setup) return showGate('setup');
  if (!state.status.authenticated) return showGate('login');
  if (!state.status.profile) return showGate('profiles');
  state.profile = state.status.profile;
  route();
}

window.addEventListener('hashchange', () => { ss.set('vn_nav', '1'); route(); });
window.addEventListener('vn:reboot', () => boot());
if (memory) {
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (a) { e.preventDefault(); go(a.getAttribute('href').slice(1)); }
  });
}
window.addEventListener('vn:unauth', () => { stopEvents(); auth.token = null; state.profile = null; showGate('login'); });
window.addEventListener('vn:noprofile', () => { state.profile = null; showGate('profiles'); });

initNav({
  onBack: () => {
    const { path } = parseHash();
    if (!state.profile) return;
    if (path === '/') return; // accueil : rien à faire
    back();
  },
});

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !memory) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.status === 401) return;
  console.error(e.reason);
  if (e.reason && e.reason.message && e.reason.name !== 'AbortError') toast(e.reason.message, true);
});

boot();
