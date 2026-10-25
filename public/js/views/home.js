// Accueil : grande affiche + rangées. L'affiche suit la carte sélectionnée (télécommande ou souris).
import { api } from '../api.js';
import { h, icon, img, picture, placeholder, ageBadge, fmtRuntime } from '../ui.js';
import { row, playPath, metaLine } from '../components.js';
import { go, state, currentPath } from '../app.js';
import { tintFrom } from '../ambiance.js';

export async function render(main) {
  const data = await api('/api/home');
  if (data.empty) return renderEmpty(main, data);

  const bg = h('div', { class: 'hero-bg' });
  const body = h('div', { class: 'hero-body' });
  const dots = h('div', { class: 'hero-dots' }, data.hero.map(() => h('span')));
  const hero = h('section', { class: 'hero' }, bg, body, data.hero.length > 1 ? dots : null);
  const layers = new Map();
  let shown = null, heroIdx = 0, timer = null, focusedInRows = false;

  function setBackground(item) {
    const key = item.backdrop || `ph:${item.title}`;
    let layer = layers.get(key);
    if (!layer) {
      layer = item.backdrop ? picture(img(item.backdrop), item.title, { lazy: false }) : placeholder(item.title);
      layers.set(key, layer);
      bg.append(layer);
    }
    requestAnimationFrame(() => {
      for (const l of bg.children) l.classList.toggle('on', l === layer);
    });
  }

  function show(item, { withActions = true } = {}) {
    if (shown && shown.id === item.id) return;
    shown = item;
    setBackground(item);
    tintFrom(img(item.backdrop || item.poster));
    const isShow = item.type === 'show';
    const meta = metaLine(item, [
      ageBadge(item),
      item.type === 'movie' && item.runtime ? h('span', {}, fmtRuntime(item.runtime)) : null,
      isShow ? h('span', {}, 'Série') : null,
      item.genres && item.genres.length ? h('span', {}, item.genres.slice(0, 2).join(', ')) : null,
    ].filter(Boolean));
    const playBtn = h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => playItem(item) }, icon('play'), 'Lecture');
    body.replaceChildren(...[
      item.logo ? h('img', { class: 'hero-logo', src: img(item.logo), alt: item.title }) : h('h1', { class: 'hero-title' }, item.title),
      h('div', { class: 'meta' }, meta),
      item.overview ? h('p', { class: 'hero-overview' }, item.overview) : null,
      withActions ? h('div', { class: 'actions' }, playBtn,
        h('button', { class: 'btn btn-ghost f', onclick: () => go(`/titre/${item.id}`) }, icon('info'), 'Plus d’infos'),
        h('button', { class: 'btn btn-ghost btn-tonight f', onclick: () => go('/cesoir') }, icon('moon'), 'Que regarder ce soir ?')) : null,
    ].filter(Boolean));
  }

  function rotate(step = 1) {
    if (!data.hero.length) return;
    heroIdx = (heroIdx + step + data.hero.length) % data.hero.length;
    [...dots.children].forEach((d, i) => d.classList.toggle('on', i === heroIdx));
    show(data.hero[heroIdx]);
  }
  const startTimer = () => { clearInterval(timer); timer = setInterval(() => { if (!focusedInRows && !hero.contains(document.activeElement)) rotate(); }, 9000); };

  // Quand une carte est sélectionnée, l'affiche se met à jour (comme un projecteur qui suit le regard)
  const onFocus = (item) => {
    if (item.type === 'episode') return;
    focusedInRows = true;
    setBackground(item);
    tintFrom(img(item.backdrop || item.poster || item.still));
  };

  const rows = h('div', { class: 'rows' }, data.rows.map((r) => row(r, { onFocus })));
  rows.addEventListener('focusout', () => { focusedInRows = false; });
  hero.addEventListener('focusin', () => { if (shown) setBackground(shown); });

  main.classList.add('home');
  main.append(hero, rows);
  if (data.hero.length) { rotate(0); startTimer(); }
  else hero.remove();

  // Balayage horizontal du héros sur mobile
  let tx = null;
  hero.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (tx == null) return;
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) { rotate(dx < 0 ? 1 : -1); startTimer(); }
    tx = null;
  });

  return { destroy: () => clearInterval(timer) };
}

export async function playItem(item) {
  if (item.type === 'movie') return go(playPath(item.id));
  const d = await api(`/api/items/${item.id}`);
  if (d.nextUp) go(playPath(d.nextUp.id));
  else go(`/titre/${item.id}`);
}

function renderEmpty(main, data) {
  const admin = state.profile && state.profile.isAdmin;
  main.append(h('div', { class: 'page' }, h('div', { class: 'empty' },
    h('h2', {}, data.scanning ? 'Analyse de vos vidéos…' : 'Aucune vidéo pour le moment'),
    data.scanning
      ? h('p', {}, 'Venus découvre vos films et séries. Ils apparaîtront ici dans quelques instants.')
      : state.profile.maxAge != null
        ? h('p', {}, 'Aucun titre n’est autorisé pour ce profil. Un administrateur peut ajuster le contrôle parental.')
        : h('p', {}, 'Placez vos films dans ', h('code', {}, '/media/films'), ' et vos séries dans ', h('code', {}, '/media/series'),
          ' (un dossier par série), ou ajoutez une bibliothèque dans les réglages.'),
    admin ? h('div', { class: 'actions', style: { marginTop: '24px', justifyContent: 'center' } }, h('button', { class: 'btn btn-play f', onclick: () => go('/ajouter') }, 'Ajouter des vidéos'), h('button', { class: 'btn f', onclick: () => go('/reglages') }, 'Bibliothèques')) : null)));
  if (data.scanning) {
    const t = setTimeout(() => { if (currentPath() === '/') window.dispatchEvent(new HashChangeEvent('hashchange')); }, 5000);
    return { destroy: () => clearTimeout(t) };
  }
}
