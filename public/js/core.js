// Venus — cœur partagé par l'interface Next.js (web/) et l'interface classique (app.js) :
// état, adresses et navigation, titre de l'onglet, mode léger, nouveautés en temps réel, changement de profil.
// Aucun affichage de page ici : l'interface qui affiche les pages se déclare avec setHost().
import { api, auth, clearApiCache, prefs } from './api.js';
import { h, icon, toast, logoMark, sheet, overlayHost } from './ui.js';
import { initNav } from './nav.js';
import './gamepad.js';
import './screensaver.js';
import { labelOf, iconOf, sections } from './menu.js';
import { applyTheme, planet } from './themes.js';
applyTheme();

export const state = { status: null, profile: null, categories: null };

// Interface hôte : navigation (Next.js : son routeur), actualisation de la page, écrans d'entrée, redémarrage,
// et quelques fenêtres qu'elle sait mieux afficher (ajout à une liste, téléchargement)
const host = { next: false, go: null, refresh: () => {}, gate: () => {}, reboot: () => {}, addToList: null, download: null };
export function setHost(impl) { Object.assign(host, impl); }
export const hostHooks = host;

// ---------------------------------------------------------------- adresses
// Chaque adresse correspond à une vue ; l'interface hôte choisit comment l'afficher
const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
// Adresses lisibles : /lecture/Breaking.Bad.S01E02, /titre/Inception.2010 (le numéro marche aussi)
function idOrSlug(raw) {
  const v = dec(raw);
  return /^\d+$/.test(v) ? { id: Number(v) } : { slug: v };
}
export const playingHere = () => (!window.__VN_MEMORY_ROUTER && history.state && history.state.vnPlay) || null;
export const ROUTES = [
  [/^\/$/, 'home'],
  [/^\/films$/, 'browse', { kind: 'movie' }],
  [/^\/series$/, 'browse', { kind: 'show' }],
  [/^\/liste$/, 'browse', { kind: 'mylist' }],
  [/^\/animes$/, 'browse', { kind: 'anime' }],
  [/^\/clips$/, 'browse', { kind: 'clip' }],
  [/^\/tv$/, 'tv'],
  // Chaîne en lecture : /tv/10-telepace-2 (numéro et nom de la chaîne)
  [/^\/tv\/\d+-([^/]+)$/, 'player', (m) => idOrSlug(m[1])],
  [/^\/nouveau$/, 'request'],
  [/^\/nouveautes$/, 'nouveautes'],
  [/^\/recherche$/, 'search'],
  [/^\/titre\/([^/]+)$/, 'details', (m) => idOrSlug(m[1])],
  // Adresses rangées comme les dossiers : /films/Titre, /series/Titre/S01E02, /animes/Titre/S01E02, /clips/Titre
  [/^\/(?:films|clips)\/([^/]+)\/lecture$/, 'player', (m) => idOrSlug(m[1])],
  [/^\/(?:series|animes)\/([^/]+)\/(S\d{1,3}E\d{1,4}(?:-E\d{1,4})?)$/i, 'player', (m) => ({ slug: dec(m[1]), ep: m[2] })],
  // Films et clips : même adresse pour la fiche et la lecture ; la lecture est notée dans l'historique
  // du navigateur (elle reprend donc après un rechargement), un lien partagé ouvre la fiche
  [/^\/(?:films|clips)\/([^/]+)$/, () => (playingHere() ? 'player' : 'details'), (m) => (playingHere() ? { id: playingHere() } : idOrSlug(m[1]))],
  [/^\/(?:series|animes)\/([^/]+)$/, 'details', (m) => idOrSlug(m[1])],
  [/^\/lecture\/([^/]+)$/, 'player', (m) => idOrSlug(m[1])],
  [/^\/reglages$/, 'settings'],
  [/^\/dashboard$/, 'dashboard'],
  [/^\/qualite$/, 'quality'],
  [/^\/securite$/, 'security'],
  [/^\/serveur$/, 'server'],
  [/^\/stats$/, 'stats'],
  [/^\/retrospective$/, 'recap'],
  [/^\/vote$/, 'vote'],
  [/^\/telechargements$/, 'downloads'],
  [/^\/collections$/, 'collections', { view: 'all' }],
  [/^\/musique$/, 'music', { view: 'home' }],
  [/^\/musique\/album\/([^/]+)$/, 'music', (m) => ({ view: 'album', name: dec(m[1]) })],
  [/^\/musique\/artiste\/([^/]+)$/, 'music', (m) => ({ view: 'artist', name: dec(m[1]) })],
  [/^\/photos$/, 'photos', { view: 'albums' }],
  [/^\/photos\/([^/]+)$/, 'photos', (m) => ({ view: 'album', name: dec(m[1]) })],
  [/^\/livres$/, 'books', { view: 'all' }],
  [/^\/lire\/([^/]+)$/, 'books', (m) => ({ view: 'read', ...idOrSlug(m[1]) })],
  [/^\/collection\/(s?\d+)$/, 'collections', (m) => ({ view: 'collection', id: m[1] })],
  [/^\/liste-lecture\/(\d+)$/, 'collections', (m) => ({ view: 'playlist', id: m[1] })],
  [/^\/cesoir$/, 'cesoir'],
  [/^\/seance$/, 'seance'],
  [/^\/telecommande$/, 'telecommande'],
];
// Vue et paramètres d'une adresse ; bare : plein écran, sans menu
export function matchRoute(path) {
  for (const [re, view, extra] of ROUTES) {
    const m = re.exec(path);
    if (m) return { view: typeof view === 'function' ? view() : view, params: typeof extra === 'function' ? extra(m) : { ...(extra || {}) }, bare: isBare(path) };
  }
  return null;
}
const slugIds = new Map();
export async function resolveParams(params) {
  if (params.id || !params.slug) return params;
  const k = `${params.slug}|${params.ep || ''}`.toLowerCase();
  let id = slugIds.get(k);
  if (!id) { id = (await api(`/api/resolve?slug=${encodeURIComponent(params.slug)}${params.ep ? `&ep=${encodeURIComponent(params.ep)}` : ''}`)).id; slugIds.set(k, id); }
  return { ...params, id };
}
// Écrans plein écran, sans navigation
const BARE = ['/lecture', '/telecommande', '/vote'];
export const isBare = (p) => BARE.some((b) => p.startsWith(b)) || (!!playingHere() && /^\/(films|clips)\/[^/]+$/.test(p)) || /^\/(films|clips)\/[^/]+\/lecture$/.test(p) || /^\/(series|animes)\/[^/]+\/S\d+E\d+/i.test(p);

// ---------------------------------------------------------------- navigation
// Routeur : adresse du navigateur par défaut, ou pile en mémoire quand l'adresse n'est pas modifiable (démo intégrée)
export const memory = !!window.__VN_MEMORY_ROUTER;
const stack = ['/'];
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };
export const notify = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
// Les anciens liens en « #/… » (favoris, QR codes, notifications) sont convertis au chargement
if (!memory && location.hash.startsWith('#/')) history.replaceState(history.state, '', location.hash.slice(1));
const here = () => `${location.pathname}${location.search}`;
export function parseHash() {
  const raw = memory ? stack[stack.length - 1] : here() || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}
export const currentPath = () => parseHash().path;
export const currentUrl = () => (memory ? stack[stack.length - 1] : here());

// Plein écran au lancement d'une vidéo (Réglages → Cet appareil) : demandé pendant le clic sur « Lecture »,
// seul moment où le navigateur l'accepte (après le changement de page, il le refuserait)
const isPlayerPath = (p) => /^\/(lecture|tv\/\d+-)/.test(p) || /^\/(films|clips)\/[^/]+\/lecture$/.test(p) || /\/S\d{1,3}E\d{1,4}$/i.test(p.split('?')[0]);
function fullscreenForPlayer(path) {
  if (!isPlayerPath(path) || !prefs.get('fullscreenOnPlay') || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  window.__vnFsAt = Date.now();
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
}
export function go(path, { replace = false } = {}) {
  ss.set('vn_nav', '1');
  fullscreenForPlayer(path);
  if (host.go) { window.__vnSilent = null; if (path === here() && !replace) host.refresh(); else host.go(path, { replace }); return; }
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
// Adresse propre sans recharger la page : le numéro remplacé par le nom (/titre/12 → /films/Inception.2010).
// window.__vnSilent prévient l'interface hôte que ce n'est pas une nouvelle page.
const encSeg = (s) => s.split('').map((c) => (/[\p{L}\p{N}.~-]/u.test(c) ? c : encodeURIComponent(c))).join('');
export function showSlug(kind, slug, keep = []) {
  if (memory || !slug) return;
  const { path, query } = parseHash();
  if (!path.startsWith(`/${kind}/`)) return;
  const q = new URLSearchParams();
  for (const k of keep) if (query.get(k) != null) q.set(k, query.get(k));
  const qs = q.toString();
  const target = `/${kind}/${encSeg(slug)}${qs ? `?${qs}` : ''}`;
  if (here() !== target) { window.__vnSilent = target; history.replaceState(history.state, '', target); }
}
// Adresse donnée par le serveur (/films/Inception.2010, /series/Breaking.Bad/S01E02…), seulement si l'on est
// toujours sur la page qui l'a demandée
export function showPath(target, keep = [], from = null, st = null) {
  if (memory || !target) return;
  if (from && currentUrl() !== from && !currentUrl().startsWith(target)) return;
  const { query } = parseHash();
  const q = new URLSearchParams();
  for (const k of keep) if (query.get(k) != null) q.set(k, query.get(k));
  const full = `${target.split('/').map(encSeg).join('/')}${q.toString() ? `?${q}` : ''}`;
  if (currentUrl() !== full || st) { window.__vnSilent = full; history.replaceState(st || history.state, '', full); }
}
// Liens internes : navigation sans recharger la page (Ctrl / Cmd + clic ouvre toujours un nouvel onglet)
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (href.startsWith('#/')) { e.preventDefault(); go(href.slice(1)); return; }
  if (href.startsWith('/') && !href.startsWith('//') && !/^\/(api|img|b|custom\.css)\b/.test(href)) { e.preventDefault(); go(href); }
});

// ---------------------------------------------------------------- sections du menu
export function hasCat(cat) {
  const c = state.categories;
  if (!c || !Object.keys(c).length) return cat === 'movie' || cat === 'show';
  return (c[cat] || 0) > 0 || (c[`${cat}_lib`] || 0) > 0;
}
export async function refreshCategories() {
  try { state.categories = await api('/api/categories'); } catch { /* garde l'ancienne liste */ }
}
const isActive = (href, path) => (href === '/' ? path === '/' : path.startsWith(href));
// Grille « Tout » : toutes les sections en grandes tuiles (avec le nombre de titres), puis les outils
export function openAll(extra = []) {
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

// ---------------------------------------------------------------- titre de l'onglet, thème
// Nom du serveur dans l'onglet : celui choisi par l'administrateur, sinon le nom de la planète
export function setTitle(prefix) {
  const custom = state.status && state.status.name && state.status.name !== 'Venus' ? state.status.name : planet().name;
  document.title = prefix ? `${prefix} — ${custom}` : custom;
}
// Nouveau thème : logos, nom et menu redessinés sur place
window.addEventListener('vn:theme', () => {
  document.querySelectorAll('svg.mark').forEach((m) => m.replaceWith(logoMark()));
  document.querySelectorAll('.brand-name').forEach((e) => { e.textContent = planet().name.toUpperCase(); });
  setTitle();
  window.dispatchEvent(new CustomEvent('vn:menu'));
});

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
// Lueur d'ambiance : prend la couleur du titre en cours (voir ambiance.js)
if (!document.querySelector('.tint-glow')) document.body.prepend(h('div', { class: 'tint-glow', 'aria-hidden': 'true' }));

// ---------------------------------------------------------------- écran de chargement
// Présent dès le HTML ; masqué une fois le premier écran prêt (Next.js le garde dans sa page, l'interface
// classique le retire)
let bootDone = false;
export function hideBoot() {
  if (bootDone) return;
  bootDone = true;
  window.__vnBooted = true;
  const el = document.querySelector('.boot');
  if (!el) return;
  // Première ouverture de la session : l'intro « VENUS », le temps de l'apercevoir ; ensuite, la page dès qu'elle est prête
  const first = document.documentElement.classList.contains('first-open');
  const wait = first ? Math.max(1300 - performance.now(), 500) : 0;
  setTimeout(() => {
    if (!first) el.classList.add('quick');
    el.classList.add('out');
    setTimeout(() => { if (host.next) el.style.display = 'none'; else el.remove(); document.documentElement.classList.remove('first-open'); }, first ? 500 : 200);
  }, wait);
}
export const isBooted = () => bootDone;
export function bootNote(text) { const n = document.querySelector('.boot-note'); if (n) n.textContent = text; }

// ---------------------------------------------------------------- nouveautés et messages en temps réel
let events = null;
export function listenEvents() {
  if (events || !window.EventSource || window.__VN_MEMORY_ROUTER) return;
  events = new EventSource('/api/events'); // session : cookie protégé (jamais le jeton dans l'adresse)
  events.addEventListener('library', (e) => { try { onLibrary(JSON.parse(e.data)); } catch { /* message illisible */ } });
  // Commandes de l'administrateur : message affiché, ou pause / reprise / arrêt (gérés par le lecteur)
  events.addEventListener('control', (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.cmd === 'message') adminMessage(d);
    // Vidéo envoyée depuis un autre appareil (« Envoyer vers la télé ») : elle s'ouvre ici tout de suite
    if (d.cmd === 'open' && d.url) { toast(`${d.from || 'Quelqu’un'} vous envoie ${d.text ? `« ${d.text} »` : 'une vidéo'}`, { type: 'success' }); if (/^\/[a-z]/i.test(d.url)) go(d.url); return; }
    if (d.cmd === 'notify') toast(`${d.title} : ${d.text}`, { type: 'success', duration: 7000, action: d.url && /^\/[a-z]/i.test(d.url) ? { label: 'Voir', onClick: () => go(d.url) } : null });
    window.dispatchEvent(new CustomEvent('vn:control', { detail: d }));
  });
  events.onerror = () => { /* le navigateur se reconnecte tout seul */ };
}
export function stopEvents() { if (events) { events.close(); events = null; } }
window.addEventListener('vn:library', (e) => onLibrary(e.detail));
async function onLibrary(d) {
  if (!state.profile || !d || !d.added || !d.added.length) return;
  clearApiCache();
  const names = d.added.slice(0, 3).join(', ') + (d.added.length > 3 ? ` et ${d.added.length - 3} autres` : '');
  toast(`Nouveau dans Venus : ${names}`);
  await refreshCategories();
  window.dispatchEvent(new CustomEvent('vn:menu'));
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '') || document.querySelector('.sheet-wrap');
  // Pendant une analyse, des titres arrivent sans cesse : ré-afficher la page à chaque fois la faisait clignoter.
  // On ne rafraîchit tout seul que l'accueil, en haut de page, au plus une fois par minute.
  if (!typing && parseHash().path === '/' && scrollY < 80 && Date.now() - (onLibrary.last || 0) > 60000) {
    onLibrary.last = Date.now();
    host.refresh();
  }
}
// Message d'un autre utilisateur : petite notification en bas à droite (empilées, la plus récente en bas),
// qui disparaît seule ; survol ou toucher la garde ; × la ferme. Même en plein écran, sans gêner l'image.
function adminMessage(d) {
  const ov = overlayHost();
  let st = ov.querySelector(':scope > .msg-stack');
  if (!st) { st = h('div', { class: 'msg-stack', 'aria-live': 'polite' }); ov.append(st); }
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
  st.append(card);
  while (st.children.length > 4) st.firstElementChild.remove();
  arm(Math.min(20000, 8000 + String(d.text || '').length * 60));
}

// ---------------------------------------------------------------- profil, télécommande, session
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
  host.gate('profiles');
}
window.addEventListener('vn:reboot', () => host.reboot());
window.addEventListener('vn:unauth', () => { stopEvents(); auth.token = null; state.profile = null; host.gate('login'); });
window.addEventListener('vn:noprofile', () => { state.profile = null; host.gate('profiles'); });

// Télécommande, flèches du clavier, manette : touche Retour = page précédente (sauf à l'accueil)
initNav({
  onBack: () => {
    if (!state.profile || parseHash().path === '/') return;
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
    const pulled = Math.min(110, dy * 0.5) >= 64;
    y0 = null;
    if (!pulled) { ind.style.transform = ''; ind.classList.remove('on', 'ready'); return; }
    busy = true;
    ind.classList.add('spin');
    ind.style.transform = 'translate(-50%, 70px)';
    clearApiCache();
    try { await host.refresh(); } catch { /* */ }
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
  // Animation de transition interrompue par le navigateur : purement visuelle, rien à signaler
  if (e.reason && /view.?transition|transition was skipped/i.test(String(e.reason.message || ''))) { e.preventDefault(); return; }
  console.error(e.reason);
  if (e.reason && e.reason.message && e.reason.name !== 'AbortError') toast(e.reason.message, true);
});
