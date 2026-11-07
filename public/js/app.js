// Venus — démarrage, routage et coque de l'application
import { api, auth, clearApiCache } from './api.js';
import { h, icon, avatar, toast, logoMark, brand, sheet, overlayHost } from './ui.js';
import { initNav, focusFirst } from './nav.js';
import { menuItems, menuPrefs, labelOf, iconOf, dayPart, sections, RAIL_MAX } from './menu.js';
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
  // Chaîne en lecture : /tv/10-telepace-2 (numéro et nom de la chaîne)
  [/^\/tv\/\d+-([^/]+)$/, () => import('./views/player.js'), (m) => idOrSlug(dec(m[1]))],
  [/^\/nouveau$/, () => import('./views/request.js')],
  [/^\/nouveautes$/, () => import('./views/nouveautes.js')],
  [/^\/recherche$/, () => import('./views/search.js')],
  [/^\/titre\/([^/]+)$/, () => import('./views/details.js'), (m) => idOrSlug(m[1])],
  // Adresses rangées comme les dossiers : /films/Titre, /series/Titre/S01E02, /animes/Titre/S01E02, /clips/Titre
  [/^\/(?:films|clips)\/([^/]+)\/lecture$/, () => import('./views/player.js'), (m) => idOrSlug(m[1])],
  [/^\/(?:series|animes)\/([^/]+)\/(S\d{1,3}E\d{1,4}(?:-E\d{1,4})?)$/i, () => import('./views/player.js'), (m) => ({ slug: dec(m[1]), ep: m[2] })],
  // Films et clips : même adresse pour la fiche et la lecture ; la lecture est notée dans l'historique
  // du navigateur (elle reprend donc après un rechargement), un lien partagé ouvre la fiche
  [/^\/(?:films|clips)\/([^/]+)$/, () => (playingHere() ? import('./views/player.js') : import('./views/details.js')), (m) => (playingHere() ? { id: playingHere() } : idOrSlug(m[1]))],
  [/^\/(?:series|animes)\/([^/]+)$/, () => import('./views/details.js'), (m) => idOrSlug(m[1])],
  [/^\/lecture\/([^/]+)$/, () => import('./views/player.js'), (m) => idOrSlug(m[1])],
  [/^\/reglages$/, () => import('./views/settings.js')],
  [/^\/dashboard$/, () => import('./views/dashboard.js')],
  [/^\/qualite$/, () => import('./views/quality.js')],
  [/^\/securite$/, () => import('./views/security.js')],
  [/^\/serveur$/, () => import('./views/server.js')],
  [/^\/stats$/, () => import('./views/stats.js')],
  [/^\/vote$/, () => import('./views/vote.js')],
  [/^\/telechargements$/, () => import('./views/downloads.js')],
  [/^\/collections$/, () => import('./views/collections.js'), { view: 'all' }],
  [/^\/musique$/, () => import('./views/music.js'), { view: 'home' }],
  [/^\/musique\/album\/([^/]+)$/, () => import('./views/music.js'), (m) => ({ view: 'album', name: dec(m[1]) })],
  [/^\/musique\/artiste\/([^/]+)$/, () => import('./views/music.js'), (m) => ({ view: 'artist', name: dec(m[1]) })],
  [/^\/photos$/, () => import('./views/photos.js'), { view: 'albums' }],
  [/^\/photos\/([^/]+)$/, () => import('./views/photos.js'), (m) => ({ view: 'album', name: dec(m[1]) })],
  [/^\/livres$/, () => import('./views/books.js'), { view: 'all' }],
  [/^\/lire\/([^/]+)$/, () => import('./views/books.js'), (m) => ({ view: 'read', ...idOrSlug(m[1]) })],
  [/^\/collection\/(s?\d+)$/, () => import('./views/collections.js'), (m) => ({ view: 'collection', id: m[1] })],
  [/^\/liste-lecture\/(\d+)$/, () => import('./views/collections.js'), (m) => ({ view: 'playlist', id: m[1] })],
  [/^\/cesoir$/, () => import('./views/cesoir.js')],
  [/^\/seance$/, () => import('./views/seance.js')],
  [/^\/telecommande$/, () => import('./views/telecommande.js')],
];
const playingHere = () => (!window.__VN_MEMORY_ROUTER && history.state && history.state.vnPlay) || null;
const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
// Adresses lisibles : /lecture/Breaking.Bad.S01E02, #/titre/Inception.2010 (le numéro marche aussi)
function idOrSlug(raw) {
  let v = raw; try { v = decodeURIComponent(raw); } catch { /* */ }
  return /^\d+$/.test(v) ? { id: Number(v) } : { slug: v };
}
const slugIds = new Map();
async function resolveParams(params) {
  if (params.id || !params.slug) return params;
  const k = `${params.slug}|${params.ep || ''}`.toLowerCase();
  let id = slugIds.get(k);
  if (!id) { id = (await api(`/api/resolve?slug=${encodeURIComponent(params.slug)}${params.ep ? `&ep=${encodeURIComponent(params.ep)}` : ''}`)).id; slugIds.set(k, id); }
  return { ...params, id };
}
// Remplace le numéro par le nom dans la barre d'adresse, sans recharger la page
export function showSlug(kind, slug, keep = []) {
  if (memory || !slug) return;
  const { path, query } = parseHash();
  if (!path.startsWith(`/${kind}/`)) return;
  const q = new URLSearchParams();
  for (const k of keep) if (query.get(k) != null) q.set(k, query.get(k));
  const qs = q.toString();
  const enc = slug.split('').map((c) => (/[\p{L}\p{N}.~-]/u.test(c) ? c : encodeURIComponent(c))).join('');
  const target = `/${kind}/${enc}${qs ? `?${qs}` : ''}`;
  if (here() !== target) history.replaceState(history.state, '', target);
}
// Adresse « propre » donnée par le serveur (/films/Inception.2010, /series/Breaking.Bad/S01E02…),
// seulement si l'on est toujours sur la page qui l'a demandée
export const currentUrl = () => (memory ? stack[stack.length - 1] : `${location.pathname}${location.search}`);
export function showPath(target, keep = [], from = null, state = null) {
  if (memory || !target) return;
  if (from && currentUrl() !== from && !currentUrl().startsWith(target)) return;
  const { query } = parseHash();
  const q = new URLSearchParams();
  for (const k of keep) if (query.get(k) != null) q.set(k, query.get(k));
  const enc = target.split('/').map((seg) => seg.split('').map((c) => (/[\p{L}\p{N}.~-]/u.test(c) ? c : encodeURIComponent(c))).join('')).join('/');
  const full = `${enc}${q.toString() ? `?${q}` : ''}`;
  if (currentUrl() !== full || state) history.replaceState(state || history.state, '', full);
}
// Écrans plein écran, sans navigation
const BARE = ['/lecture', '/telecommande', '/vote'];
const isBare = (p) => BARE.some((b) => p.startsWith(b)) || (!!playingHere() && /^\/(films|clips)\/[^/]+$/.test(p)) || /^\/(films|clips)\/[^/]+\/lecture$/.test(p) || /^\/(series|animes)\/[^/]+\/S\d+E\d+/i.test(p);

// Routeur : adresse (#/films…) par défaut, ou pile en mémoire quand l'adresse n'est pas modifiable (démo intégrée)
const memory = !!window.__VN_MEMORY_ROUTER;
const stack = ['/'];
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };
const notify = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
// Adresses propres, avec le nom du titre : /titre/Inception.2010, /lecture/Breaking.Bad.S01E02, /tv…
// Les anciens liens en « #/… » (favoris, QR codes, notifications) sont convertis au chargement.
if (!memory && location.hash.startsWith('#/')) history.replaceState(history.state, '', location.hash.slice(1));
const here = () => `${location.pathname}${location.search}`;

export function go(path, { replace = false } = {}) {
  if (memory) { if (replace) stack[stack.length - 1] = path; else stack.push(path); notify(); return; }
  if (path === here() && !replace) { notify(); return; }
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  notify();
}
let lastBack = 0;
export function back(fallback = '/') {
  // Une seule touche Retour = un seul pas en arrière (le lecteur et la navigation peuvent la recevoir tous les deux)
  if (Date.now() - lastBack < 500) return;
  lastBack = Date.now();
  if (memory) { if (stack.length > 1) stack.pop(); else stack[0] = fallback; notify(); return; }
  if (history.length > 1 && ss.get('vn_nav')) history.back();
  else go(fallback, { replace: true });
}
export const currentPath = () => parseHash().path;

function parseHash() {
  const raw = memory ? stack[stack.length - 1] : here() || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

function navLink(href, label, ic, path) {
  const active = isActive(href, path);
  return h('a', { href, class: `f${active ? ' active' : ''}`, 'aria-current': active ? 'page' : null }, ic ? icon(ic) : null, h('span', {}, label));
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

// Grille « Tout » : toutes les sections en grandes tuiles (avec le nombre de titres), puis les outils
function openAll(extra = []) {
  const p = state.profile;
  const secs = sections(p, hasCat, state.categories || {});
  const ids = new Set(secs.map((x) => x.id));
  const tools = extra.filter((it) => !ids.has(it.id) && it.id !== 'home');
  const open = (it) => { s.close(); if (it.action === 'remote') openRemote(); else go(it.href); };
  const tile = (it) => h('button', { class: `all-tile f${isActive(it.href || '#', parseHash().path) ? ' on' : ''}`, onclick: () => open(it) },
    h('span', { class: 'all-ic' }, icon(it.icon)), h('span', { class: 'all-txt' }, h('b', {}, it.label), it.sub ? h('small', {}, it.sub) : null));
  const s = sheet('Tout Venus', h('div', { class: 'all-sheet' },
    h('div', { class: 'all-grid' }, secs.map(tile)),
    tools.length ? h('h3', { class: 'all-h' }, 'Outils') : null,
    tools.length ? h('div', { class: 'all-tools' }, tools.map((it) => tile({ ...it, label: labelOf(it), icon: iconOf(it), sub: it.hint || '' }))) : null,
    h('button', { class: 'opt f more-edit', onclick: () => { s.close(); go('/reglages?section=menu'); } }, icon('gear'), 'Personnaliser le menu')));
}
export { openAll, hasCat };

// Badge de l'administrateur : lectures en cours sur le serveur, rafraîchi toutes les 30 s (caché quand personne ne regarde)
let liveTimer = null;
function liveBadge(cls) {
  const el = h('a', { href: '/dashboard', class: `${cls} f`, hidden: true, title: 'Lectures en cours' }, icon('play'), h('span', {}, ''));
  const tick = async () => {
    if (!el.isConnected) { clearInterval(liveTimer); liveTimer = null; return; }
    try { const r = await api('/api/admin/live'); const n = r.playing || 0; el.hidden = !n; el.querySelector('span').textContent = n === 1 ? '1 lecture' : `${n} lectures`; } catch { /* */ }
  };
  clearInterval(liveTimer); liveTimer = setInterval(tick, 30000); setTimeout(tick, 1500);
  return el;
}

// Rail à gauche (ordinateur, TV) + barre du haut et onglets en bas (mobile)
function shell(path) {
  const p = state.profile;
  const { shown, more } = menuItems(p, hasCat);
  const moreBtn = (cls, label = 'Plus', ic = 'more', list = more) => h('button', { class: cls, 'aria-label': label === 'Plus' ? 'Plus' : 'Toutes les sections', 'data-more': '1', onclick: () => openAll(list) }, icon(ic), h('span', {}, label));
  const rail = h('nav', { class: 'rail', 'aria-label': 'Navigation principale' },
    h('a', { href: '/', class: 'home-link f', 'aria-label': 'Venus, accueil' }, logoMark()),
    // Sections : la liste défile si elle dépasse la hauteur de l'écran ; Réglages et profil restent en bas
    // Ordinateur : 4 sections seulement, tout le reste dans « Plus » (réglable dans Réglages → Menu)
    h('div', { class: 'rail-scroll' }, shown.slice(0, RAIL_MAX).map((it) => itemLink(it, path)), shown.length > RAIL_MAX || more.length ? moreBtn('rail-item f', 'Plus', 'more', [...shown.slice(RAIL_MAX), ...more]) : null),
    p.isAdmin ? liveBadge('rail-item live-badge') : null,
    p.dailyLeft != null ? h('span', { class: `rail-item time-left${p.dailyLeft <= 10 ? ' low' : ''}`, title: 'Temps d’écran restant aujourd’hui' }, icon('clock'), h('span', {}, p.dailyLeft ? `${p.dailyLeft} min` : 'Fini')) : null,
    p.isKids ? null : navLink('/reglages', 'Réglages', 'gear', path),
    h('button', { class: 'rail-item f', 'aria-label': `Changer de profil (${p.name})`, onclick: switchProfile }, avatar(p, 'sm'), h('span', {}, p.name)));
  const top = h('header', { class: 'mobile-top' },
    h('a', { href: '/', class: 'f', 'aria-label': 'Accueil' }, brand()),
    h('div', { style: { display: 'flex', gap: '4px' } },
      p.isAdmin ? liveBadge('icon-btn live-badge top') : null,
      p.dailyLeft != null ? h('span', { class: `time-left pill${p.dailyLeft <= 10 ? ' low' : ''}` }, icon('clock'), p.dailyLeft ? `${p.dailyLeft} min` : 'Fini') : null,
      p.isKids ? null : h('a', { href: '/reglages', class: 'icon-btn f', 'aria-label': 'Réglages' }, icon('gear')),
      h('button', { class: 'icon-btn f', 'aria-label': `Changer de profil (${p.name})`, onclick: switchProfile }, avatar(p, 'sm'))));
  // Mobile : Accueil, les deux premières sections du menu, Recherche, et « Tout » (toutes les sections en tuiles)
  const all = [...shown, ...more];
  const pick = (id) => all.find((it) => it.id === id);
  const firstTwo = shown.filter((it) => !it.action && !['home', 'today', 'search'].includes(it.id)).slice(0, 2);
  const tabItems = [pick('home'), ...firstTwo, pick('search')].filter(Boolean);
  const tabs = h('nav', { class: 'tabbar' }, tabItems.map((it) => itemLink(it, path)), moreBtn('f tab-more', 'Tout', 'apps', all.filter((it) => !tabItems.includes(it))));
  const onScroll = () => top.classList.toggle('solid', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return { rail, top, tabs, cleanup: () => removeEventListener('scroll', onScroll) };
}

// La coque (menu) reste en place d'une page à l'autre : seul le contenu change, sans clignotement
let chrome = null;
const shellSig = () => JSON.stringify([currentPlanet(), state.profile.id, state.profile.isAdmin, state.profile.name, state.profile.avatar, state.profile.dailyLeft, state.profile.isKids, state.categories, menuPrefs(state.profile.id), dayPart()]);
function ensureShell(path) {
  const sig = shellSig();
  if (!chrome || chrome.sig !== sig || !app.contains(chrome.rail)) {
    if (chrome) chrome.cleanup();
    chrome = { sig, ...shell(path) };
  } else chrome.rail.classList.remove('no-anim');
  for (const a of [...chrome.rail.querySelectorAll('a[href^="/"]'), ...chrome.tabs.querySelectorAll('a[href^="/"]')]) {
    const on = isActive(a.getAttribute('href'), path) && !a.classList.contains('home-link');
    if (on && !a.classList.contains('active') && chrome.rail.isConnected && !chrome.rail.classList.contains('no-anim')) { a.classList.add('pop'); a.addEventListener('animationend', () => a.classList.remove('pop'), { once: true }); }
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
// Menu en haut (thème Cinéma) : transparent en haut de page, fond plein dès qu'on fait défiler
// ---------------------------------------------------------------- préchargement au survol
// La souris s'arrête sur une affiche : la fiche (données et image de fond) est chargée tout de suite,
// pour s'ouvrir instantanément au clic. Rien sur écran tactile (pas de survol) ni en économie de données.
let preTimer = 0;
const preDone = new Set();
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const c = e.target.closest && e.target.closest('[data-pre]');
  if (!c || preDone.has(c.dataset.pre) || (navigator.connection && navigator.connection.saveData)) return;
  clearTimeout(preTimer);
  preTimer = setTimeout(() => {
    const id = c.dataset.pre;
    if (!id || preDone.has(id) || !c.matches(':hover')) return;
    preDone.add(id);
    api(`/api/items/${id}`).catch(() => preDone.delete(id));
    if (c.dataset.bg) { const im = new Image(); im.decoding = 'async'; im.src = /^(https?:|data:)/.test(c.dataset.bg) ? c.dataset.bg : `/img/${encodeURIComponent(c.dataset.bg)}?w=1280`; }
  }, 140);
}, { passive: true });

// ---------------------------------------------------------------- mode léger (appareils modestes)
// Auto : télé, box, vieux téléphone, économie de données ou animations réduites → flous et effets coupés.
// Sinon on mesure la fluidité réelle quelques secondes après l'ouverture : si les images sautent, mode léger.
export function liteSetting() { try { return localStorage.getItem('vn_lite') || 'auto'; } catch { return 'auto'; } }
export function applyLite() {
  const set = liteSetting();
  let on = set === 'on';
  if (set === 'auto') {
    const ua = navigator.userAgent;
    const tv = /SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|AFT[A-Z]|BRAVIA|Android TV|CrKey|HbbTV|PlayStation|Xbox/i.test(ua);
    const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
    const save = navigator.connection && navigator.connection.saveData;
    let measured = null; try { measured = localStorage.getItem('vn_lite_auto'); } catch { /* */ }
    on = tv || weak || save || matchMedia('(prefers-reduced-motion: reduce)').matches || measured === '1';
  }
  document.documentElement.classList.toggle('lite', !!on);
  return on;
}
applyLite();
setTimeout(() => {
  if (liteSetting() !== 'auto' || document.documentElement.classList.contains('lite') || document.hidden) return;
  try { if (localStorage.getItem('vn_lite_auto') === '0') return; } catch { /* */ }
  const times = []; let last = performance.now(), n = 0;
  const tick = (t) => {
    times.push(t - last); last = t;
    if (++n < 90 && !document.hidden) return requestAnimationFrame(tick);
    if (document.hidden || times.length < 60) return;
    times.sort((a, b) => a - b);
    const slow = times[Math.floor(times.length * 0.5)] > 30 && times[Math.floor(times.length * 0.9)] > 50; // moins de ~30 images/s
    try { localStorage.setItem('vn_lite_auto', slow ? '1' : '0'); } catch { /* */ }
    if (slow) applyLite();
  };
  requestAnimationFrame(tick);
}, 6000);

let scrolledOn = false;
addEventListener('scroll', () => { const on = scrollY > 12; if (on !== scrolledOn) { scrolledOn = on; document.documentElement.classList.toggle('scrolled', on); } }, { passive: true });

// Menu modifié : redessiné une seule fois par image (plusieurs interrupteurs basculés vite = un seul rendu),
// sans rejouer les animations d'entrée (sinon tout le menu clignote)
let menuFrame = 0;
window.addEventListener('vn:menu', () => {
  if (!chrome || !state.profile || menuFrame) return;
  menuFrame = requestAnimationFrame(() => {
    menuFrame = 0;
    if (!chrome) return;
    const { path } = parseHash();
    const old = chrome;
    chrome = null;
    const fresh = ensureShell(path);
    for (const el of [fresh.rail, fresh.top, fresh.tabs]) el.classList.add('no-anim');
    old.rail.replaceWith(fresh.rail); old.top.replaceWith(fresh.top); old.tabs.replaceWith(fresh.tabs);
    old.cleanup();
  });
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
  window.__vnBooted = true;
  const el = document.querySelector('.boot');
  if (!el) return;
  // Écran de chargement : seulement « VENUS », le temps de l'apercevoir (un peu plus à la première ouverture)
  const first = document.documentElement.classList.contains('first-open');
  const wait = Math.max(first ? 1300 - performance.now() : 0, first ? 500 : 250);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { el.remove(); document.documentElement.classList.remove('first-open'); }, 500);
  }, wait);
}
export function bootNote(text) { const n = document.querySelector('.boot-note'); if (n) n.textContent = text; }

// Nouveautés en temps réel : le serveur prévient dès qu'un média est détecté
let events = null;
function listenEvents() {
  if (events || !window.EventSource || window.__VN_MEMORY_ROUTER) return;
  events = new EventSource(`/api/events?token=${encodeURIComponent(auth.token || '')}`);
  events.addEventListener('library', (e) => { try { onLibrary(JSON.parse(e.data)); } catch { /* message illisible */ } });
  // Commandes de l'administrateur : message affiché, ou pause / reprise / arrêt (gérés par le lecteur)
  events.addEventListener('control', (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.cmd === 'message') adminMessage(d);
    // Vidéo envoyée depuis un autre appareil (« Envoyer vers la télé ») : elle s'ouvre ici tout de suite
    if (d.cmd === 'open' && d.url) { toast(`${d.from || 'Quelqu’un'} vous envoie ${d.text ? `« ${d.text} »` : 'une vidéo'}`, { type: 'success' }); if (/^\/[a-z]/i.test(d.url)) go(d.url); return; }
    if (d.cmd === 'notify') toast(`${d.title} : ${d.text}`, { type: 'success', duration: 7000, action: d.url ? { label: 'Voir', onClick: () => go(d.url) } : null });
    window.dispatchEvent(new CustomEvent('vn:control', { detail: d }));
  });
  events.onerror = () => { /* le navigateur se reconnecte tout seul */ };
}
window.addEventListener('vn:library', (e) => onLibrary(e.detail));
async function onLibrary(d) {
  {
    if (!state.profile || !d || !d.added || !d.added.length) return;
    clearApiCache();
    const names = d.added.slice(0, 3).join(', ') + (d.added.length > 3 ? ` et ${d.added.length - 3} autres` : '');
    toast(`Nouveau dans Venus : ${names}`);
    await refreshCategories();
    const { path } = parseHash();
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '') || document.querySelector('.sheet-wrap');
    // Pendant une analyse, des titres arrivent sans cesse : ré-afficher la page à chaque fois la faisait clignoter.
    // On ne rafraîchit tout seul que l'accueil, en haut de page, au plus une fois par minute.
    if (!typing && path === '/' && scrollY < 80 && Date.now() - (onLibrary.last || 0) > 60000) {
      onLibrary.last = Date.now();
      await route();
    }
  }
}
// Message d'un autre utilisateur : petite notification en bas à droite (empilées, la plus récente en bas),
// qui disparaît seule ; survol ou toucher la garde ; × la ferme. Même en plein écran, sans gêner l'image.
function adminMessage(d) {
  const host = overlayHost();
  let stack = host.querySelector(':scope > .msg-stack');
  if (!stack) { stack = h('div', { class: 'msg-stack', 'aria-live': 'polite' }); host.append(stack); }
  const who = String(d.from || 'Administrateur');
  const time = new Date(d.at || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  let timer = 0;
  const close = () => { clearTimeout(timer); card.classList.add('out'); setTimeout(() => card.remove(), 260); };
  const card = h('div', { class: 'msg-note', role: 'status' },
    h('span', { class: 'msg-av', 'aria-hidden': 'true' }, who.trim().charAt(0).toUpperCase()),
    h('div', { class: 'msg-body' }, h('div', { class: 'msg-head' }, h('b', {}, who), h('span', { class: 'msg-time' }, time)), h('p', {}, d.text)),
    h('button', { class: 'msg-x', type: 'button', 'aria-label': 'Fermer le message', onclick: close }, '×'));
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(close, ms); };
  card.addEventListener('pointerenter', () => clearTimeout(timer));
  card.addEventListener('pointerleave', () => arm(4000));
  stack.append(card);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  arm(Math.min(20000, 8000 + String(d.text || '').length * 60));
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
  // L'affiche touchée s'agrandit jusqu'à devenir celle de la fiche (navigateurs récents)
  const from = window.__vtFrom; window.__vtFrom = null;
  if (from && from.isConnected && document.startViewTransition && !reduce && /^\/titre\//.test(path)) {
    from.style.viewTransitionName = 'vt-poster';
    document.startViewTransition(() => { from.style.viewTransitionName = ''; place(main); window.scrollTo(0, 0); });
  } else {
    if (!reduce) {
      main.classList.add('page-in');
      // L'animation d'arrivée ne vaut que pour l'ouverture de la page : ensuite, les blocs mis à jour
      // (tableau de bord, réglages, listes) ne doivent pas se rejouer, sinon la page clignote
      setTimeout(() => main.classList.remove('page-in'), 900);
    }
    place(main);
    window.scrollTo(0, 0);
  }
  finish(view);
  if (failed) showError(failed);
}
let mountTicket = 0;

// Lueur d'ambiance : prend la couleur du titre en cours (voir ambiance.js)
if (!document.querySelector('.tint-glow')) document.body.prepend(h('div', { class: 'tint-glow', 'aria-hidden': 'true' }));

// Une erreur pendant l'affichage ne doit jamais laisser l'écran figé sur le logo
async function route() {
  try { return await showRoute(); } catch (e) { startFailed(e); }
}
function startFailed(e) {
  console.error(e);
  if (bootDone && app.querySelector(':scope > main')) { toast(e && e.message ? e.message : 'Erreur inattendue', true); return; }
  document.querySelector('.route-bar')?.classList.remove('on');
  dropShell();
  app.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'panel' }, brand(), h('h2', {}, 'Impossible d’afficher Venus'),
    h('p', {}, (e && e.message) || 'Erreur inattendue'),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', onclick: () => location.reload() }, 'Recharger'),
      h('button', { class: 'btn btn-ghost f', onclick: () => repairAndReload() }, 'Réparer (vider le cache)')))));
  hideBoot();
}
// Service worker et caches retirés, puis rechargement : utile après une mise à jour qui coince
async function repairAndReload() {
  try { const l = await navigator.serviceWorker?.getRegistrations(); await Promise.all((l || []).map((r) => r.unregister())); } catch { /* */ }
  try { const k = await caches.keys(); await Promise.all(k.map((n) => caches.delete(n))); } catch { /* */ }
  try { sessionStorage.clear(); } catch { /* */ }
  location.replace('/');
}
async function showRoute() {
  if (!state.profile) return;
  // Profil enfant : interface simplifiée (grandes tuiles, menu réduit) ; temps d'écran restant affiché
  document.documentElement.classList.toggle('kids', !!state.profile.isKids);
  listenEvents();
  // Sur une TV, la télécommande-téléphone est prête dès l'ouverture
  if (document.documentElement.classList.contains('tv') && !window.__vnPairing) {
    window.__vnPairing = true;
    import('./remote-screen.js').then((m) => m.startPairing()).catch(() => {});
  }
  if (!state.categories || parseHash().path === '/') await refreshCategories();
  // Accueil : état frais (lecture en cours ailleurs, temps d'écran restant) avant d'afficher
  if (parseHash().path === '/' || state.profile.dailyLeft != null) {
    const upd = api('/api/status').then((st) => { if (!st) return; if (state.status) state.status.elsewhere = st.elsewhere; if (st.profile && state.profile && st.profile.id === state.profile.id) state.profile.dailyLeft = st.profile.dailyLeft; }).catch(() => {});
    if (parseHash().path === '/') await upd;
  }
  // Ancienne adresse du tableau de bord : on garde les favoris
  if (parseHash().path === '/tableau-de-bord') { go('/dashboard', { replace: true }); return; }
  const { path, query } = parseHash();
  for (const [re, loader, extra] of ROUTES) {
    const m = re.exec(path);
    if (!m) continue;
    let params = { ...(typeof extra === 'function' ? extra(m) : extra || {}), query };
    if (params.slug) {
      try { params = await resolveParams(params); }
      catch (e) { toast(e.message, true); go('/', { replace: true }); return; }
    }
    const isPlayer = isBare(path);
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
  try { await startApp(); } catch (e) { startFailed(e); }
}
async function startApp() {
  try {
    state.status = await api('/api/status');
  } catch (e) {
    app.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'panel' }, brand(), h('h2', {}, 'Serveur injoignable'), h('p', {}, e.message),
      h('button', { class: 'btn btn-play f', onclick: boot }, 'Réessayer'))));
    hideBoot();
    return;
  }
  setTitle();
  // Lien d'invitation reçu par e-mail : préparation du compte, avant tout le reste
  if (/^\/invitation\/[A-Za-z0-9_-]+$/.test(location.pathname) && state.status.setup) return showGate('invitation');
  if (!state.status.setup) return showGate('setup');
  if (!state.status.authenticated) return showGate('login');
  if (!state.status.profile) return showGate('profiles');
  state.profile = state.status.profile;
  route();
  // Mini-lecteur laissé ouvert avant un rechargement : il reprend
  if (!/^\/(lecture|films|clips|series|animes)\//.test(location.pathname) || !/\/(lecture|S\d+E\d+)$/i.test(location.pathname)) import('./mini.js').then((m) => m.resumeMini()).catch(() => {});
}

window.addEventListener('hashchange', () => { ss.set('vn_nav', '1'); route(); });
// Retour / avance du navigateur ; et liens « #/… » encore présents (anciens favoris)
window.addEventListener('popstate', () => { if (!memory) { if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1)); notify(); } });
window.addEventListener('vn:reboot', () => boot());
// Liens internes : navigation sans recharger la page (Ctrl / Cmd + clic ouvre toujours un nouvel onglet)
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (href.startsWith('#/')) { e.preventDefault(); go(href.slice(1)); return; }
  if (href.startsWith('/') && !href.startsWith('//') && !/^\/(api|img|b|custom\.css)\b/.test(href)) { e.preventDefault(); go(href); }
});
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
// ---------------------------------------------------------------- tactile : tirer vers le bas pour actualiser
(() => {
  if (!document.documentElement.classList.contains('touch')) return;
  const ind = h('div', { class: 'ptr', 'aria-hidden': 'true' }, icon('refresh'));
  document.body.append(ind);
  let y0 = null, dy = 0, busy = false;
  const usable = () => state.profile && !isBare(parseHash().path) && !document.querySelector('.sheet-wrap, .player, .mini-player.drag');
  document.addEventListener('touchstart', (e) => { if (busy || window.scrollY > 0 || !usable() || e.touches.length > 1) { y0 = null; return; } y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { ind.style.transform = ''; ind.classList.remove('on', 'ready'); return; }
    const d = Math.min(110, dy * 0.5);
    ind.classList.add('on');
    ind.classList.toggle('ready', d >= 64);
    ind.style.transform = `translate(-50%, ${d}px) rotate(${d * 3}deg)`;
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (y0 == null) return;
    const go2 = Math.min(110, dy * 0.5) >= 64;
    y0 = null;
    if (!go2) { ind.style.transform = ''; ind.classList.remove('on', 'ready'); return; }
    busy = true;
    ind.classList.add('spin');
    ind.style.transform = 'translate(-50%, 70px)';
    clearApiCache();
    try { await route(); } catch { /* */ }
    setTimeout(() => { ind.classList.remove('on', 'ready', 'spin'); ind.style.transform = ''; busy = false; }, 350);
  });
})();

// ---------------------------------------------------------------- installer Venus sur l'écran d'accueil
(() => {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || memory) return;
  let promptEvt = null;
  const dismissedAt = () => { try { return Number(localStorage.getItem('vn_install_dismissed')) || 0; } catch { return 0; } };
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
  const show = () => {
    if (document.querySelector('.install-bar') || Date.now() - dismissedAt() < 30 * 864e5 || !state.profile) return;
    if (!promptEvt && !isIOS) return;
    const bar = h('div', { class: 'install-bar', role: 'dialog', 'aria-label': 'Installer Venus' },
      h('span', { class: 'ib-ic' }, logoMark()),
      h('div', { class: 'ib-text' }, h('b', {}, 'Installer Venus'), h('small', {}, isIOS && !promptEvt ? 'Plein écran, icône sur l’écran d’accueil' : 'Comme une vraie appli, en plein écran')),
      h('button', { class: 'btn btn-small f', onclick: async () => {
        if (promptEvt) { promptEvt.prompt(); const r = await promptEvt.userChoice.catch(() => null); if (r && r.outcome === 'accepted') toast('Venus est installé', { type: 'success' }); promptEvt = null; bar.remove(); return; }
        sheet('Installer sur iPhone / iPad', h('ol', { class: 'ios-steps' },
          h('li', {}, 'Touchez le bouton Partager ', h('b', {}, '⬆'), ' en bas de Safari.'),
          h('li', {}, 'Choisissez ', h('b', {}, '« Sur l’écran d’accueil »'), '.'),
          h('li', {}, 'Touchez ', h('b', {}, 'Ajouter'), ' : Venus s’ouvre ensuite en plein écran, comme une appli.')));
      } }, 'Installer'),
      h('button', { class: 'ib-x', 'aria-label': 'Plus tard', onclick: () => { try { localStorage.setItem('vn_install_dismissed', String(Date.now())); } catch { /* */ } bar.remove(); } }, icon('close')));
    document.body.append(bar);
  };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptEvt = e; setTimeout(show, 15000); });
  if (isIOS && document.documentElement.classList.contains('touch')) setTimeout(show, 25000);
})();

// Aide des raccourcis clavier : touche « ? » (hors champs de saisie)
document.addEventListener('keydown', (e) => {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
  e.preventDefault();
  const row = (k, l) => h('div', { class: 'kb-row' }, h('span', { class: 'kb' }, ...k.map((x) => h('kbd', {}, x))), h('span', {}, l));
  sheet('Raccourcis clavier', h('div', { class: 'kb-list' },
    h('h3', {}, 'Partout'), row(['/'], 'Rechercher'), row(['?'], 'Cette aide'), row(['Échap'], 'Retour, fermer'), row(['Flèches', 'Entrée'], 'Se déplacer et ouvrir (télécommande)'),
    h('h3', {}, 'Lecteur'), row(['Espace', 'K'], 'Lecture / pause'), row(['←', '→'], '10 s en arrière / en avant'), row(['J', 'L'], '10 s (ou 1 min avec Maj)'), row(['↑', '↓'], 'Volume'), row(['M'], 'Couper le son'), row(['F'], 'Plein écran'), row(['C'], 'Sous-titres'), row(['<', '>'], 'Vitesse'), row(['N'], 'Épisode suivant'), row(['S'], 'Passer l’intro'), row(['P'], 'Mini-lecteur')));
});
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.status === 401) return;
  console.error(e.reason);
  if (e.reason && e.reason.message && e.reason.name !== 'AbortError') toast(e.reason.message, true);
});

boot();
