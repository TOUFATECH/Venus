// Venus — interface classique (sans Next.js) : coque de navigation, affichage des pages et démarrage.
// Elle sert quand l'interface Next.js n'est pas construite, avec VENUS_UI=classic, et pour la démo.
// L'état, les adresses et la navigation sont dans core.js, partagé avec l'interface Next.js.
import { api } from './api.js';
import { h, icon, avatar, toast, logoMark, brand } from './ui.js';
import { focusFirst } from './nav.js';
import { menuItems, menuPrefs, labelOf, iconOf, dayPart, RAIL_MAX } from './menu.js';
import { currentPlanet } from './themes.js';
import {
  state, setHost, matchRoute, resolveParams, parseHash, go, hasCat, openAll, openRemote, switchProfile,
  setTitle, refreshCategories, hideBoot, isBooted, listenEvents, memory, notify,
} from './core.js';

export * from './core.js';

const app = document.getElementById('app');
let current = null;

// Code de chaque vue, chargé à la demande
const VIEWS = {
  home: () => import('./views/home.js'), browse: () => import('./views/browse.js'), tv: () => import('./views/tv.js'),
  player: () => import('./views/player.js'), request: () => import('./views/request.js'), nouveautes: () => import('./views/nouveautes.js'),
  search: () => import('./views/search.js'), details: () => import('./views/details.js'), settings: () => import('./views/settings.js'),
  dashboard: () => import('./views/dashboard.js'), quality: () => import('./views/quality.js'), security: () => import('./views/security.js'),
  server: () => import('./views/server.js'), stats: () => import('./views/stats.js'), vote: () => import('./views/vote.js'),
  downloads: () => import('./views/downloads.js'), collections: () => import('./views/collections.js'), music: () => import('./views/music.js'),
  photos: () => import('./views/photos.js'), books: () => import('./views/books.js'), cesoir: () => import('./views/cesoir.js'),
  seance: () => import('./views/seance.js'), telecommande: () => import('./views/telecommande.js'),
};
const GATES = {
  setup: () => import('./views/setup.js'), login: () => import('./views/login.js'),
  profiles: () => import('./views/profiles.js'), invitation: () => import('./views/invitation.js'),
};

function navLink(href, label, ic, path) {
  const active = isActive(href, path);
  return h('a', { href, class: `f${active ? ' active' : ''}`, 'aria-current': active ? 'page' : null }, ic ? icon(ic) : null, h('span', {}, label));
}

const isActive = (href, path) => (href === '/' ? path === '/' : path.startsWith(href));

const itemLink = (it, path) => (it.action === 'remote'
  ? h('button', { class: 'rail-item f', onclick: openRemote }, icon(iconOf(it)), h('span', {}, labelOf(it)))
  : navLink(it.href, labelOf(it), iconOf(it), path));

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
    // Le nom n'est posé que sur les deux affiches concernées, le temps de l'animation (jamais deux à la fois)
    const vt = document.startViewTransition(() => {
      from.style.viewTransitionName = '';
      place(main); window.scrollTo(0, 0);
      const to = main.querySelector('.details-poster');
      if (to) to.style.viewTransitionName = 'vt-poster';
    });
    vt.finished.finally(() => { const to = main.querySelector('.details-poster'); if (to) to.style.viewTransitionName = ''; }).catch(() => {});
    vt.ready.catch(() => {});
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

// Une erreur pendant l'affichage ne doit jamais laisser l'écran figé sur le logo
async function route() {
  try { return await showRoute(); } catch (e) { startFailed(e); }
}
function startFailed(e) {
  console.error(e);
  if (isBooted() && app.querySelector(':scope > main')) { toast(e && e.message ? e.message : 'Erreur inattendue', true); return; }
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
  const r = matchRoute(path);
  if (!r) { go('/', { replace: true }); return; }
  let params = { ...r.params, query };
  if (params.slug) {
    try { params = await resolveParams(params); }
    catch (e) { toast(e.message, true); go('/', { replace: true }); return; }
  }
  return mount(VIEWS[r.view](), params, { withNav: !r.bare, path });
}

async function showGate(kind) {
  if (current) { try { current.destroy && current.destroy(); } catch { /* */ } current = null; }
  dropShell();
  app.replaceChildren();
  const main = h('main');
  app.append(main);
  const mod = await GATES[kind]();
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

const ss = { set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };
window.addEventListener('hashchange', () => { ss.set('vn_nav', '1'); route(); });
// Retour / avance du navigateur ; et liens « #/… » encore présents (anciens favoris)
window.addEventListener('popstate', () => { if (!memory) { if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1)); notify(); } });

// L'interface classique affiche les pages : actualisation, écrans d'entrée et redémarrage passent par elle
setHost({ refresh: () => route(), gate: (kind) => showGate(kind), reboot: () => boot() });
boot();
