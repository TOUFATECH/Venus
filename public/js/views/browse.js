// Films, Séries, Animés, Clips, Ma liste
// Barre compacte : visionnage, tri (sens croissant / décroissant), filtres, affichage (affiches, vignettes, liste), au hasard.
// Séries et animés : onglet « À venir » (épisodes sortis ces derniers jours et prochains épisodes annoncés).
import { api } from '../api.js';
import { h, icon, img, fmtRuntime, fmtDate, ageBadge, toast } from '../ui.js';
import { card, playPath, RATING_SOURCES, framePoster } from '../components.js';
import { setQueue } from '../queue.js';
import { go } from '../app.js';

const TITLES = { movie: 'Films', show: 'Séries', anime: 'Animés', clip: 'Clips', mylist: 'Ma liste' };
const PATHS = { movie: '/films', show: '/series', anime: '/animes', clip: '/clips', mylist: '/liste' };
const rel = (i) => i.released || (i.year ? `${i.year}-01-01` : '');
const cmpTitle = (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true });
// [id, libellé, comparaison (ordre naturel), libellés du sens]
const SORTS = [
  ['added', 'Date d’ajout', (a, b) => (b.added || 0) - (a.added || 0), ['Plus récents', 'Plus anciens']],
  ['az', 'Titre', cmpTitle, ['A → Z', 'Z → A']],
  ['released', 'Date de sortie', (a, b) => rel(b).localeCompare(rel(a)), ['Plus récents', 'Plus anciens']],
  ['score', 'Note moyenne', (a, b) => norm(b) - norm(a), ['Mieux notés', 'Moins bien notés']],
  ['played', 'Date de lecture', (a, b) => (b.played || 0) - (a.played || 0), ['Vus récemment', 'Vus il y a longtemps']],
  ['popular', 'Popularité', (a, b) => (b.popularity || 0) - (a.popularity || 0) || (b.vote || 0) - (a.vote || 0), ['Plus populaires', 'Moins populaires']],
  ['runtime', 'Durée', (a, b) => (a.runtime || 1e9) - (b.runtime || 1e9), ['Plus courts', 'Plus longs']],
  ['age', 'Classification', (a, b) => (a.age ?? 99) - (b.age ?? 99), ['Tous publics d’abord', 'Adultes d’abord']],
  ['random', 'Aléatoire', null, ['Nouveau tirage', 'Nouveau tirage']],
];
const norm = (i, src) => {
  const r = i.ratings || {};
  if (!src) return r.score || (i.vote ? i.vote * 10 : 0);
  const x = r[src];
  return x && x.v ? (x.v / x.max) * 100 : -1;
};
const STATUS = [['all', 'Tous'], ['unseen', 'Non vus'], ['progress', 'En cours'], ['seen', 'Vus']];
const AGES = [['0', 'Tous publics', (a) => a == null || a <= 7], ['10', '10 ans et plus', (a) => a === 10], ['12', '12 ans et plus', (a) => a === 12], ['16', '16 ans et plus', (a) => a === 16], ['18', '18 ans et plus', (a) => a >= 18]];
const QUALITY = [['4K', '4K', (i) => i.res === '4K'], ['HDR', 'HDR', (i) => i.hdr], ['1080p', 'Full HD', (i) => i.res === '1080p'], ['SD', 'Basse définition', (i) => i.res === 'SD' || i.res === '720p']];
const SCORES = [['60', '6 et plus'], ['70', '7 et plus'], ['80', '8 et plus']];
const VIEWS = [['poster', 'Affiches', 'grid4'], ['wide', 'Vignettes', 'film'], ['list', 'Liste', 'rows']];

const store = {
  get(k, d, ls = false) { try { return JSON.parse((ls ? localStorage : sessionStorage).getItem(k)) ?? d; } catch { return d; } },
  set(k, v, ls = false) { try { (ls ? localStorage : sessionStorage).setItem(k, JSON.stringify(v)); } catch { /* */ } },
};
const shuffleSeed = (n) => { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export async function render(main, { kind, query }) {
  const upcomingTab = (kind === 'show' || kind === 'anime') && query && query.get('vue') === 'avenir';
  const wishTab = kind === 'mylist' && query && query.get('vue') === 'envies';
  const page = h('div', { class: 'page' });
  main.append(page);
  const tab = (on, label, path) => h('button', { class: `vt f${on ? ' on' : ''}`, role: 'tab', 'aria-selected': String(on), onclick: () => go(path, { replace: true }) }, label);
  const tabs = kind === 'show' || kind === 'anime'
    ? h('div', { class: 'view-tabs', role: 'tablist' }, tab(!upcomingTab, 'Bibliothèque', PATHS[kind]), tab(upcomingTab, 'À venir', `${PATHS[kind]}?vue=avenir`))
    : kind === 'mylist' ? h('div', { class: 'view-tabs', role: 'tablist' }, tab(!wishTab, 'Dans Venus', PATHS.mylist), tab(wishTab, 'Mes envies', `${PATHS.mylist}?vue=envies`)) : null;
  if (upcomingTab) return renderUpcoming(page, kind, tabs);
  if (wishTab) return renderWishes(page, tabs);

  const items = kind === 'mylist' ? await api('/api/mylist') : await api(`/api/library?type=${kind}`);
  const isClip = kind === 'clip';
  const key = `vn_filters_${kind}`;
  const sorts = [...SORTS, ...RATING_SOURCES.filter(([k]) => items.some((i) => i.ratings && i.ratings[k]))
    .map(([k, label]) => [`r-${k}`, `Note ${label}`, (a, b) => norm(b, k) - norm(a, k), ['Mieux notés', 'Moins bien notés']])]
    .filter(([id]) => !isClip || ['added', 'az', 'played', 'runtime', 'random'].includes(id))
    .filter(([id]) => id !== 'played' || items.some((i) => i.played))
    .filter(([id]) => id !== 'age' || items.some((i) => i.age != null));
  const f = { sort: kind === 'mylist' ? 'mine' : 'added', desc: false, status: 'all', genres: [], decades: [], ages: [], quality: [], studios: [], minScore: '', ...store.get(key, {}) };
  if (typeof f.genre === 'string') { f.genres = f.genre ? [f.genre] : []; delete f.genre; }
  if (f.sort === 'vote') f.sort = 'score';
  if (f.sort !== 'mine' && !sorts.some((x) => x[0] === f.sort)) f.sort = 'added';
  const wantGenre = query && query.get('genre');
  if (wantGenre) { Object.assign(f, { genres: [wantGenre], decades: [], ages: [], quality: [], studios: [], minScore: '', status: 'all' }); }
  let view = store.get(`vn_view_${kind}`, isClip ? 'wide' : 'poster', true);
  let order = shuffleSeed(items.length);
  const save = () => store.set(key, f);

  // Valeurs proposées dans les filtres, d'après ce qu'il y a vraiment dans la médiathèque
  const genres = [...new Set(items.flatMap((i) => i.genres || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  const decades = [...new Set(items.filter((i) => i.year).map((i) => Math.floor(i.year / 10) * 10))].sort((a, b) => b - a);
  const ages = AGES.filter(([, , test]) => items.some((i) => i.age != null && test(i.age)));
  const quality = QUALITY.filter(([, , test]) => items.some(test));
  const studioCount = new Map();
  for (const i of items) for (const s of i.studios || []) studioCount.set(s, (studioCount.get(s) || 0) + 1);
  const studios = [...studioCount].filter(([, n]) => n > 1 || studioCount.size < 16).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([s]) => s);
  const hasScores = items.some((i) => norm(i) > 0);

  const grid = h('div', { class: 'grid' });
  const count = h('p', { class: 'count', 'aria-live': 'polite' });
  const activeBar = h('div', { class: 'active-filters' });
  let shown = [];

  const filtersOn = () => f.genres.length + f.decades.length + f.ages.length + f.quality.length + f.studios.length + (f.minScore ? 1 : 0);
  const match = (i) => (f.status === 'all' || i.status === f.status)
    && (!f.genres.length || (i.genres || []).some((g) => f.genres.includes(g)))
    && (!f.decades.length || (i.year && f.decades.includes(Math.floor(i.year / 10) * 10)))
    && (!f.ages.length || AGES.some(([id, , test]) => f.ages.includes(id) && test(i.age)))
    && (!f.quality.length || QUALITY.some(([id, , test]) => f.quality.includes(id) && test(i)))
    && (!f.studios.length || (i.studios || []).some((s) => f.studios.includes(s)))
    && (!f.minScore || norm(i) >= Number(f.minScore));

  const paint = () => {
    let list = items.filter(match);
    if (f.sort === 'random') { const pos = new Map(items.map((it, k) => [it.id, order[k]])); list.sort((a, b) => pos.get(a.id) - pos.get(b.id)); }
    else if (f.sort !== 'mine') list.sort(sorts.find((s) => s[0] === f.sort)[2]);
    if (f.desc && f.sort !== 'random') list.reverse();
    shown = list;
    grid.className = `grid view-${view}${isClip && view !== 'list' ? ' grid-wide' : ''}${view === 'wide' ? ' grid-wide' : ''}`;
    if (view === 'list') grid.replaceChildren(...list.map(listRow));
    else grid.replaceChildren(...list.map((i) => card(i, { poster: view === 'poster' && !isClip, queue: isClip ? () => shown : null })));
    const word = isClip ? 'clip' : 'titre';
    count.textContent = `${list.length}${list.length !== items.length ? ` sur ${items.length}` : ''} ${word}${items.length > 1 ? 's' : ''}`;
    if (playAll) playAll.hidden = list.length < 1;
    randomBtn.disabled = !list.length;
    if (!list.length) {
      grid.replaceChildren(h('div', { class: 'grid-empty' },
        h('p', {}, !items.length
          ? kind === 'mylist' ? 'Votre liste est vide. Ajoutez des titres avec le bouton + sur leur fiche.' : 'Rien ici pour l’instant. Ajoutez une source dans les réglages.'
          : f.status === 'unseen' && !filtersOn() ? 'Vous avez tout vu ici. Bravo.' : 'Aucun titre ne correspond à ces filtres.'),
        items.length && (filtersOn() || f.status !== 'all') ? h('button', { class: 'btn btn-ghost btn-small f', onclick: resetAll }, 'Tout afficher') : null));
    }
    paintActive();
    paintButtons();
  };
  const resetAll = () => { Object.assign(f, { status: 'all', genres: [], decades: [], ages: [], quality: [], studios: [], minScore: '' }); save(); paintStatus(); paint(); };

  // Filtres actifs : petites étiquettes qu'on retire d'un clic
  const paintActive = () => {
    const tags = [];
    const add = (label, remove) => tags.push(h('button', { class: 'af f', 'aria-label': `Retirer le filtre ${label}`, onclick: () => { remove(); save(); paint(); } }, label, icon('close')));
    for (const g of f.genres) add(g, () => { f.genres = f.genres.filter((x) => x !== g); });
    for (const d of f.decades) add(`Années ${String(d).slice(2)}`, () => { f.decades = f.decades.filter((x) => x !== d); });
    for (const a of f.ages) add(AGES.find((x) => x[0] === a)[1], () => { f.ages = f.ages.filter((x) => x !== a); });
    for (const q of f.quality) add(QUALITY.find((x) => x[0] === q)[1], () => { f.quality = f.quality.filter((x) => x !== q); });
    for (const s of f.studios) add(s, () => { f.studios = f.studios.filter((x) => x !== s); });
    if (f.minScore) add(`Note ${SCORES.find((x) => x[0] === f.minScore)[1]}`, () => { f.minScore = ''; });
    if (tags.length > 1) tags.push(h('button', { class: 'linkish f', onclick: () => { Object.assign(f, { genres: [], decades: [], ages: [], quality: [], studios: [], minScore: '' }); save(); paint(); } }, 'Tout effacer'));
    activeBar.replaceChildren(...tags);
    activeBar.hidden = !tags.length;
  };

  // ---------------------------------------------------------------- barre d'outils
  const statusBox = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filtrer par visionnage' });
  const paintStatus = () => statusBox.replaceChildren(...STATUS.map(([id, label]) => h('button', { class: `seg-b f${f.status === id ? ' on' : ''}`, 'aria-pressed': String(f.status === id), onclick: () => { f.status = id; save(); paintStatus(); paint(); } }, label)));
  paintStatus();

  const sortBtn = h('button', { class: 'tool f', 'aria-haspopup': 'true' });
  const filterBtn = h('button', { class: 'tool f', 'aria-haspopup': 'true' });
  const viewBox = h('div', { class: 'seg icons', role: 'group', 'aria-label': 'Affichage' });
  const randomBtn = h('button', { class: 'tool f', title: 'Ouvrir un titre au hasard parmi ceux affichés', onclick: () => {
    if (!shown.length) return;
    const pick = shown[Math.floor(Math.random() * shown.length)];
    go(isClip ? playPath(pick.id) : `/titre/${pick.id}`);
  } }, icon('shuffle'), h('span', { class: 'lbl' }, 'Au hasard'));
  const paintButtons = () => {
    const s = f.sort === 'mine' ? null : sorts.find((x) => x[0] === f.sort);
    sortBtn.replaceChildren(...[icon('sort'), h('span', { class: 'lbl' }, s ? s[1] : 'Ordre de la liste'), f.desc && f.sort !== 'random' ? h('small', {}, '↑') : null].filter(Boolean));
    sortBtn.setAttribute('aria-label', `Trier : ${s ? `${s[1]}, ${s[3][f.desc ? 1 : 0]}` : 'ordre de la liste'}`);
    const n = filtersOn();
    filterBtn.replaceChildren(...[icon('filter'), h('span', { class: 'lbl' }, 'Filtres'), n ? h('b', { class: 'tool-n' }, String(n)) : null].filter(Boolean));
    filterBtn.classList.toggle('on', !!n);
    viewBox.replaceChildren(...VIEWS.filter(([id]) => !isClip || id !== 'poster').map(([id, label, ic]) => h('button', { class: `seg-b f${view === id ? ' on' : ''}`, title: label, 'aria-label': `Affichage : ${label}`, 'aria-pressed': String(view === id), onclick: () => { view = id; store.set(`vn_view_${kind}`, id, true); paint(); } }, icon(ic))));
  };

  sortBtn.onclick = () => dropdown(sortBtn, (close) => {
    const opts = (kind === 'mylist' ? [['mine', 'Ordre de la liste', null, ['Ajoutés récemment', 'Ajoutés il y a longtemps']]] : []).concat(sorts);
    const cur = opts.find((x) => x[0] === f.sort) || opts[0];
    return [
      h('p', { class: 'dd-title' }, 'Trier par'),
      h('div', { class: 'dd-list' }, opts.map(([id, label]) => h('button', { class: `dd-opt f${id === f.sort ? ' on' : ''}`, role: 'menuitemradio', 'aria-checked': String(id === f.sort), onclick: () => {
        if (id === 'random') order = shuffleSeed(items.length);
        if (id !== f.sort) f.desc = false; f.sort = id; save(); paint(); close();
      } }, icon(id === f.sort ? 'check' : 'dot'), label))),
      cur[0] !== 'random' ? h('div', { class: 'dd-seg' }, cur[3].map((lbl, k) => h('button', { class: `seg-b f${(k === 1) === !!f.desc ? ' on' : ''}`, onclick: () => { f.desc = k === 1; save(); paint(); close(); } }, lbl))) : null,
    ];
  });

  filterBtn.onclick = () => dropdown(filterBtn, (close, refresh) => {
    const group = (title, values, sel, labelOf = (v) => v) => (values.length < 2 && !sel.length ? null : h('div', { class: 'dd-group' },
      h('p', { class: 'dd-title' }, title),
      h('div', { class: 'dd-chips' }, values.map((v) => {
        const id = Array.isArray(v) ? v[0] : v;
        const on = sel.includes(id);
        return h('button', { class: `mini f${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: () => {
          const k = sel.indexOf(id); if (k >= 0) sel.splice(k, 1); else sel.push(id);
          save(); paint(); refresh();
        } }, Array.isArray(v) ? v[1] : labelOf(v));
      }))));
    return [
      group('Genres', genres, f.genres),
      group('Années', decades, f.decades, (d) => `${d}s`),
      hasScores ? h('div', { class: 'dd-group' }, h('p', { class: 'dd-title' }, 'Note minimale'),
        h('div', { class: 'dd-chips' }, [['', 'Toutes'], ...SCORES].map(([id, label]) => h('button', { class: `mini f${f.minScore === id ? ' on' : ''}`, onclick: () => { f.minScore = id; save(); paint(); refresh(); } }, label)))) : null,
      group('Classification', ages, f.ages),
      group('Qualité', quality, f.quality),
      group(kind === 'movie' ? 'Studios' : 'Studios et chaînes', studios, f.studios),
      h('div', { class: 'dd-foot' },
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => { Object.assign(f, { genres: [], decades: [], ages: [], quality: [], studios: [], minScore: '' }); save(); paint(); refresh(); } }, 'Réinitialiser'),
        h('button', { class: 'btn btn-small f', onclick: close }, 'Voir les résultats')),
    ];
  }, { wide: true });

  const playAll = isClip ? h('div', { class: 'actions play-all' },
    h('button', { class: 'btn btn-play btn-small f', onclick: () => { const q = setQueue(shown, { title: 'Clips' }); if (q) go(playPath(q.id)); } }, icon('play'), 'Tout lire'),
    h('button', { class: 'btn btn-ghost btn-small f', onclick: () => { const q = setQueue(shown, { shuffle: true, title: 'Clips' }); if (q) go(playPath(q.id)); } }, icon('shuffle'), 'Aléatoire')) : null;

  page.append(
    h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, TITLES[kind]), count), tabs || playAll),
    kind === 'mylist' ? h('p', { class: 'list-hint' }, 'Les séries de votre liste sont suivies : chaque nouvelle saison annoncée est demandée à Seerr automatiquement.') : null,
    h('div', { class: 'toolbar' }, statusBox, h('div', { class: 'tools' }, sortBtn, filterBtn, viewBox, randomBtn)),
    activeBar, grid);
  paint();
}

// Une ligne de la vue « Liste »
function listRow(i) {
  const pic = h('div', { class: 'lr-pic' }, i.poster ? h('img', { src: img(i.poster), alt: '', loading: 'lazy' }) : framePoster(i));
  const score = norm(i);
  const p = i.progress;
  const pct = p && p.duration && !p.watched ? Math.min(100, (p.position / p.duration) * 100) : 0;
  return h('div', { class: 'lib-row' },
    h('button', { class: 'lr-main f', onclick: () => go(i.type === 'clip' ? playPath(i.id) : `/titre/${i.id}`) }, pic,
      h('div', { class: 'lr-text' },
        h('b', {}, i.title),
        h('span', { class: 'lr-meta' }, [i.year, i.type === 'show' ? `${i.episodes || 0} épisodes` : i.runtime ? fmtRuntime(i.runtime) : null, (i.genres || []).slice(0, 3).join(', ')].filter(Boolean).join(' · '),
          ageBadge(i), i.res === '4K' ? h('span', { class: 'badge' }, '4K') : null, i.hdr ? h('span', { class: 'badge' }, 'HDR') : null),
        i.overview ? h('p', {}, i.overview) : null,
        pct ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null),
      score > 0 ? h('span', { class: 'lr-score' }, '★ ', (score / 10).toFixed(1).replace('.', ',')) : h('span'),
      i.status === 'seen' ? h('span', { class: 'lr-seen', title: 'Vu' }, icon('check')) : h('span')),
    h('button', { class: 'btn btn-ghost btn-icon f lr-play', 'aria-label': `Lire ${i.title}`, onclick: () => go(playPath(i.id)) }, icon('play')));
}

// Menu déroulant ancré sous un bouton (fermeture : clic à côté, Échap)
let openDropdown = null;
function dropdown(anchor, build, { wide = false } = {}) {
  if (anchor.__dd) { anchor.__dd(); return; }
  if (openDropdown) openDropdown();
  const box = h('div', { class: `dropdown${wide ? ' wide' : ''}`, role: 'menu' });
  const close = () => {
    box.remove(); document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true);
    anchor.__dd = null; anchor.setAttribute('aria-expanded', 'false');
    if (openDropdown === close) openDropdown = null;
    window.removeEventListener('hashchange', close);
  };
  const refresh = () => { box.replaceChildren(...build(close, refresh).filter(Boolean)); };
  const onDown = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'GoBack' || e.keyCode === 461) { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); } };
  refresh();
  anchor.__dd = close;
  openDropdown = close;
  window.addEventListener('hashchange', close);
  anchor.setAttribute('aria-expanded', 'true');
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  const w = Math.min(wide ? 560 : 300, innerWidth - 24);
  box.style.width = `${w}px`;
  box.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.right - w))}px`;
  box.style.top = `${r.bottom + 8}px`;
  box.style.maxHeight = `${Math.max(220, innerHeight - r.bottom - 24)}px`;
  setTimeout(() => { document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey, true); (box.querySelector('.on') || box.querySelector('button'))?.focus({ preventScroll: true }); }, 0);
}

// ---------------------------------------------------------------- À venir
async function renderUpcoming(page, kind, tabs) {
  const list = await api(`/api/upcoming?type=${kind}`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const label = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return 'Aujourd’hui';
    if (diff === -1) return 'Hier';
    if (diff === 1) return 'Demain';
    const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const groups = new Map();
  for (const e of list) { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); }
  const body = h('div', { class: 'upcoming' });
  if (!list.length) {
    body.append(h('div', { class: 'grid-empty' }, h('p', {}, 'Aucun épisode sorti ces deux dernières semaines, et aucun prochain épisode annoncé pour vos séries.'),
      h('p', { class: 'muted' }, 'Les dates des prochains épisodes viennent de TMDB : renseignez la clé dans Réglages, Sources des informations.')));
  }
  const todayIso = new Date(Date.now() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  for (const [date, eps] of groups) {
    const past = date < todayIso;
    body.append(h('section', { class: `up-day${past ? ' past' : ''}${date === todayIso ? ' today' : ''}` },
      h('h2', { class: 'section-title' }, label(date), h('small', {}, fmtDate(date))),
      h('div', { class: 'up-grid' }, eps.map((e) => upCard(e)))));
  }
  page.append(h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, TITLES[kind]), h('p', { class: 'count' }, `${list.length} épisode${list.length > 1 ? 's' : ''}`)), tabs), body);
  // On se place sur aujourd'hui
  const first = body.querySelector('.up-day:not(.past)');
  if (first && body.querySelector('.up-day.past')) requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, first.getBoundingClientRect().top + scrollY - 120) }));
}

function upCard(e) {
  const src = e.still || e.backdrop;
  const pic = h('div', { class: 'up-pic' }, src ? h('img', { src: img(src), alt: '', loading: 'lazy' }) : framePoster({ title: e.showTitle, id: e.showId }),
    e.inLibrary ? h('span', { class: 'up-badge in' }, e.progress && e.progress.watched ? 'Vu' : 'Dans Venus') : h('span', { class: 'up-badge' }, 'Annoncé'),
    e.inLibrary ? h('span', { class: 'ep-play' }, icon('play')) : null);
  return h('button', { class: 'up-card f', onclick: () => go(e.inLibrary ? playPath(e.id) : `/titre/${e.showId}`) }, pic,
    h('b', {}, e.showTitle),
    h('span', {}, `S${e.season} É${e.episode}${e.title ? ` · ${e.title}` : ''}`));
}

// ---------------------------------------------------------------- Mes envies (favoris pas encore dans Venus, suivis dans Seerr)
const WISH_STATE = { none: 'Pas encore demandé', pending: 'Demandé, en attente de validation', processing: 'Demandé : téléchargé dès sa sortie', partial: 'Disponible en partie', available: 'Disponible, arrive dans Venus', blocked: 'Bloqué dans Seerr', deleted: 'Supprimé de Seerr', error: 'Seerr injoignable' };
async function renderWishes(page, tabs) {
  const d = await api('/api/wishlist');
  const today = new Date().toISOString().slice(0, 10);
  const body = h('div', { class: 'wish-grid' });
  const intro = h('p', { class: 'list-hint' }, !d.seerr
    ? 'Ajoutez des films, séries et animés à vos envies depuis Nouveautés (bouton ♡). Reliez Seerr dans Réglages pour qu’ils soient téléchargés automatiquement.'
    : d.kids ? 'Vos envies sont visibles par les adultes de la maison, qui décident du téléchargement.'
      : d.auto ? 'Chaque envie est demandée à Seerr tout de suite : le téléchargement démarre dès que le titre sort. Une fois arrivé, il passe dans « Dans Venus ».'
        : 'Les demandes automatiques sont désactivées : un administrateur peut les activer dans Réglages, Seerr.');
  const paint = () => {
    if (!d.items.length) { body.replaceChildren(h('div', { class: 'grid-empty' }, h('p', {}, 'Aucune envie pour l’instant.'), h('button', { class: 'btn btn-small f', onclick: () => go('/nouveautes') }, icon('cal'), 'Voir les nouveautés'))); return; }
    body.replaceChildren(...d.items.map((w) => {
      const st = w.seerr || { state: w.requested ? 'processing' : 'none' };
      const future = w.date && w.date > today;
      const label = st.downloading && st.progress != null ? `Téléchargement ${st.progress} %` : st.state === 'processing' && !future ? 'Demandé, recherche en cours' : WISH_STATE[st.state] || 'Suivi';
      const del = h('button', { class: 'btn btn-ghost btn-icon btn-mini f', 'aria-label': `Retirer ${w.title} de mes envies`, title: 'Retirer', onclick: async () => {
        await api(`/api/wishlist/${w.type}/${w.tmdbId}`, { method: 'DELETE' });
        d.items = d.items.filter((x) => x !== w); paint(); toast('Retiré de mes envies');
      } }, icon('close'));
      return h('article', { class: 'wish' },
        h('div', { class: 'wish-pic' }, w.poster ? h('img', { src: w.poster, alt: '', loading: 'lazy' }) : h('span', {}, w.title),
          future ? h('span', { class: 'wish-date' }, `Sortie le ${fmtDate(w.date)}`) : null),
        h('div', { class: 'wish-body' },
          h('b', {}, w.title),
          h('span', { class: 'wish-meta' }, [w.type === 'movie' ? 'Film' : w.anime ? 'Animé' : 'Série', w.date ? w.date.slice(0, 4) : null].filter(Boolean).join(' · ')),
          h('span', { class: `wish-state st-${st.state}` }, label),
          st.downloading && st.progress != null ? h('div', { class: 'meter' }, h('i', { style: { width: `${st.progress}%` } })) : null,
          w.error && st.state !== 'processing' ? h('small', { class: 'error-text' }, w.error) : null),
        del);
    }));
  };
  paint();
  page.append(h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Ma liste'), h('p', { class: 'count' }, `${d.items.length} envie${d.items.length > 1 ? 's' : ''}`)), tabs), intro, body);
}
