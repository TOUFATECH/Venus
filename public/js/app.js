// Venus — démarrage, routage et coque de l'application
import { api, auth } from './api.js';
import { h, icon, avatar, toast, logoMark, brand, sheet } from './ui.js';
import { initNav, focusFirst } from './nav.js';
import { menuItems, menuPrefs, labelOf, iconOf, dayPart } from './menu.js';
import { applyTheme, currentPlanet, planet } from './themes.js';
applyTheme();

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
  [/^\/nouveautes$/, () => import('./views/nouveautes.js')],
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
  const active = isActive(href, path);
  return h('a', { href: '#' + href, class: `f${active ? ' active' : ''}`, 'aria-current': active ? 'page' : null }, ic ? icon(ic) : null, h('span', {}, label));
}
const isActive = (href, path) => (href === '/' ? path === '/' : path.startsWith(href));

function hasCat(cat) {
  const c = state.categories;
  if (!c || !Object.keys(c).length) return cat === 'movie' || cat === 'show';
  return (c[cat] || 0) > 0;
}
export async function refreshCategories() {
  try { state.categories = await api('/api/categories'); } catch { /* garde l'ancienne liste */ }
}

const itemLink = (it, path) => (it.action === 'remote'
  ? h('button', { class: 'rail-item f', onclick: openRemote }, icon(iconOf(it)), h('span', {}, labelOf(it)))
  : navLink(it.href, labelOf(it), iconOf(it), path));

function openMore(items) {
  const s = sheet('Plus', h('div', { class: 'more-list' }, items.map((it) => h('button', { class: 'opt f', onclick: () => {
    s.close();
    if (it.action === 'remote') openRemote(); else go(it.href);
  } }, icon(iconOf(it)), labelOf(it), it.hint ? h('small', {}, it.hint) : null)),
  h('button', { class: 'opt f more-edit', onclick: () => { s.close(); go('/reglages?section=menu'); } }, icon('gear'), 'Personnaliser le menu')));
}

// Rail à gauche (ordinateur, TV) + barre du haut et onglets en bas (mobile)
function shell(path) {
  const p = state.profile;
  const { shown, more } = menuItems(p, hasCat);
  const moreBtn = (cls) => h('button', { class: cls, 'aria-label': 'Plus', 'data-more': '1', onclick: () => openMore(more) }, icon('more'), h('span', {}, 'Plus'));
  const rail = h('nav', { class: 'rail', 'aria-label': 'Navigation principale' },
    h('a', { href: '#/', class: 'home-link f', 'aria-label': 'Venus, accueil' }, logoMark()),
    shown.map((it) => itemLink(it, path)),
    more.length ? moreBtn('rail-item f') : null,
    h('div', { class: 'spacer' }),
    navLink('/reglages', 'Réglages', 'gear', path),
    h('button', { class: 'rail-item f', 'aria-label': `Changer de profil (${p.name})`, onclick: switchProfile }, avatar(p, 'sm'), h('span', {}, p.name)));
  const top = h('header', { class: 'mobile-top' },
    h('a', { href: '#/', class: 'f', 'aria-label': 'Accueil' }, brand()),
    h('div', { style: { display: 'flex', gap: '4px' } },
      h('a', { href: '#/reglages', class: 'icon-btn f', 'aria-label': 'Réglages' }, icon('gear')),
      h('button', { class: 'icon-btn f', 'aria-label': `Changer de profil (${p.name})`, onclick: switchProfile }, avatar(p, 'sm'))));
  // Mobile : les 4 premiers éléments du menu, le reste dans « Plus »
  const tabItems = shown.filter((it) => !it.action).slice(0, 4);
  const extra = [...shown.filter((it) => !tabItems.includes(it)), ...more];
  const tabs = h('nav', { class: 'tabbar' }, tabItems.map((it) => itemLink(it, path)), extra.length ? moreBtn('f tab-more') : null);
  const onScroll = () => top.classList.toggle('solid', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return { rail, top, tabs, cleanup: () => removeEventListener('scroll', onScroll) };
}

// La coque (menu) reste en place d'une page à l'autre : seul le contenu change, sans clignotement
let chrome = null;
const shellSig = () => JSON.stringify([currentPlanet(), state.profile.id, state.profile.isAdmin, state.profile.name, state.profile.avatar, state.categories, menuPrefs(state.profile.id), dayPart()]);
function ensureShell(path) {
  const sig = shellSig();
  if (!chrome || chrome.sig !== sig || !app.contains(chrome.rail)) {
    if (chrome) chrome.cleanup();
    chrome = { sig, ...shell(path) };
  }
  for (const a of [...chrome.rail.querySelectorAll('a[href^="#/"]'), ...chrome.tabs.querySelectorAll('a[href^="#/"]')]) {
    const on = isActive(a.getAttribute('href').slice(1), path) && !a.classList.contains('home-link');
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  return chrome;
}
function dropShell() { if (chrome) { chrome.cleanup(); chrome = null; } }
// Nouveau thème : logos, nom et menu redessinés sur place
window.addEventListener('vn:theme', () => {
  document.querySelectorAll('svg.mark').forEach((m) => m.replaceWith(logoMark()));
  document.querySelectorAll('.brand-name').forEach((e) => { e.textContent = planet().name.toUpperCase(); });
  setTitle();
  window.dispatchEvent(new CustomEvent('vn:menu'));
});
// Nom du serveur dans l'onglet : celui choisi par l'administrateur, sinon le nom de la planète
export function setTitle(prefix) {
  const custom = state.status && state.status.name && state.status.name !== 'Venus' ? state.status.name : planet().name;
  document.title = prefix ? `${prefix} — ${custom}` : custom;
}
window.addEventListener('vn:menu', () => {
  if (!chrome || !state.profile) return;
  const { path } = parseHash();
  const old = chrome;
  chrome = null;
  const fresh = ensureShell(path);
  old.rail.replaceWith(fresh.rail); old.top.replaceWith(fresh.top); old.tabs.replaceWith(fresh.tabs);
  old.cleanup();
});

// Squelette affiché pendant le chargement d'une page (au-delà de quelques dixièmes de seconde)
function skeleton(path) {
  const bar = (w, hgt = 14) => h('i', { class: 'sk', style: { width: w, height: `${hgt}px` } });
  const cards = (n, cls) => h('div', { class: `sk-row ${cls}` }, Array.from({ length: n }, () => h('i', { class: 'sk' })));
  let body;
  if (path === '/') {
    body = [h('div', { class: 'sk-hero' }, h('div', {}, bar('46%', 54), bar('28%'), bar('52%'), bar('40%'), h('div', { class: 'sk-actions' }, bar('150px', 48), bar('150px', 48)))),
      h('div', { class: 'sk-rows' }, bar('180px', 18), cards(6, 'land'), bar('220px', 18), cards(6, 'land'))];
  } else if (/^\/(films|series|animes|liste)$/.test(path)) {
    body = [h('div', { class: 'page' }, bar('220px', 48), h('div', { class: 'sk-chips' }, bar('80px', 38), bar('90px', 38), bar('90px', 38)), h('div', { class: 'sk-grid' }, Array.from({ length: 14 }, () => h('i', { class: 'sk' }))))];
  } else if (/^\/titre\//.test(path)) {
    body = [h('div', { class: 'page sk-details' }, h('i', { class: 'sk sk-poster' }), h('div', {}, bar('60%', 56), bar('30%'), bar('80%'), bar('70%'), h('div', { class: 'sk-actions' }, bar('170px', 48), bar('48px', 48))))];
  } else {
    body = [h('div', { class: 'page' }, bar('260px', 48), bar('70%'), bar('60%'), cards(5, 'land'))];
  }
  return h('main', { class: 'with-nav sk-page', 'aria-busy': 'true', 'aria-label': 'Chargement' }, body);
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

async function mount(viewModule, params, { withNav, path }) {
  const ticket = ++mountTicket;
  // Barre de chargement fine en haut de l'écran pendant la préparation de la page suivante
  const bar = document.querySelector('.route-bar') || document.body.appendChild(h('div', { class: 'route-bar', 'aria-hidden': 'true' }));
  bar.classList.add('on');
  let mod;
  try { mod = await viewModule; } catch (e) {
    // Code de la page introuvable ou d'une autre version (mise à jour en cours) : on recharge une fois
    let again = false;
    try { again = !sessionStorage.getItem('vn_reloaded'); sessionStorage.setItem('vn_reloaded', '1'); } catch { /* */ }
    if (again) { location.reload(); return; }
    throw e;
  }
  try { sessionStorage.removeItem('vn_reloaded'); } catch { /* */ }
  const main = h('main', { class: withNav ? 'with-nav' : '' });
  const finish = (view) => {
    bar.classList.remove('on');
    hideBoot();
    current = { destroy: () => { view && view.destroy && view.destroy(); } };
    if (document.documentElement.classList.contains('keys') || document.documentElement.classList.contains('tv')) requestAnimationFrame(() => focusFirst());
  };
  const showError = (e) => {
    if (e.status === 401 || e.message === 'Choisissez un profil') return;
    main.append(h('div', { class: 'empty' }, h('h2', {}, 'Impossible d’afficher cette page'), h('p', {}, e.message),
      h('button', { class: 'btn f', onclick: () => route() }, 'Réessayer')));
  };
  const dropOld = () => { if (current) { try { current.destroy && current.destroy(); } catch { /* */ } current = null; } };

  if (!withNav) {
    // Lecteur et télécommande : affichage immédiat, sans menu
    dropOld(); dropShell();
    app.replaceChildren(main);
    try { finish(await mod.render(main, params)); } catch (e) { finish(null); showError(e); }
    return;
  }
  const sh = ensureShell(path);
  const place = (el) => {
    const cur = app.querySelector(':scope > main');
    if (cur && app.contains(sh.rail)) cur.replaceWith(el);
    else app.replaceChildren(sh.rail, sh.top, el, sh.tabs);
  };
  // Si la page tarde, on montre tout de suite sa silhouette plutôt que de laisser l'ancienne figée
  const skTimer = setTimeout(() => {
    if (ticket !== mountTicket) return;
    dropOld();
    place(skeleton(path)); window.scrollTo(0, 0);
  }, 140);
  let view = null, failed = null;
  try { view = await mod.render(main, params); } catch (e) { failed = e; }
  clearTimeout(skTimer);
  if (ticket !== mountTicket) { view && view.destroy && view.destroy(); return; }
  dropOld();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) main.classList.add('page-in');
  place(main);
  window.scrollTo(0, 0);
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
  dropShell();
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
  setTitle();
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
