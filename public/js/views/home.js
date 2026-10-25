// Accueil : grande affiche + rangées. L'affiche suit la carte sélectionnée (télécommande ou souris).
import { api } from '../api.js';
import { h, icon, img, picture, placeholder, ageBadge, fmtRuntime } from '../ui.js';
import { row, playPath, metaLine, frameImage } from '../components.js';
import { go, state, currentPath } from '../app.js';
import { tintFrom } from '../ambiance.js';

export async function render(main) {
  const data = await api('/api/home');
  if (data.empty) return renderEmpty(main, data);

  const ROTATE_MS = 8000;
  const bg = h('div', { class: 'hero-bg' });
  const body = h('div', { class: 'hero-body' });
  const many = data.hero.length > 1;
  const dots = h('div', { class: 'hero-dots', role: 'tablist', 'aria-label': 'À la une' },
    data.hero.map((it, i) => h('button', { type: 'button', role: 'tab', tabindex: '-1', 'aria-label': it.title, onclick: () => { goTo(i); restart(); } }, h('i'))));
  const arrow = (dir) => h('button', { type: 'button', class: `hero-arrow ${dir < 0 ? 'prev' : 'next'}`, tabindex: '-1', 'aria-label': dir < 0 ? 'Titre précédent' : 'Titre suivant',
    onclick: () => { goTo(heroIdx + dir); restart(); } }, icon(dir < 0 ? 'back' : 'fwd'));
  const hero = h('section', { class: 'hero', style: { '--rotate': `${ROTATE_MS}ms` } }, bg, body, many ? arrow(-1) : null, many ? arrow(1) : null, many ? dots : null);
  const layers = new Map();
  let shown = null, heroIdx = 0, timer = null, keyboardInRows = false, hovering = false;

  function setBackground(item) {
    const key = item.backdrop ? item.backdrop : `th:${item.id}`;
    let layer = layers.get(key);
    if (!layer) {
      layer = item.backdrop ? picture(img(item.backdrop), item.title, { lazy: false }) : frameImage(item.id, item.title);
      layers.set(key, layer);
      bg.append(layer);
    }
    requestAnimationFrame(() => {
      for (const l of bg.children) l.classList.toggle('on', l === layer);
    });
  }

  function show(item) {
    if (shown && shown.id === item.id) return;
    shown = item;
    const hadFocus = body.contains(document.activeElement);
    setBackground(item);
    tintFrom(img(item.backdrop || item.poster));
    const isShow = item.type === 'show';
    const meta = metaLine(item, [
      ageBadge(item),
      item.type === 'movie' && item.runtime ? h('span', {}, fmtRuntime(item.runtime)) : null,
      isShow ? h('span', {}, item.category === 'anime' ? 'Animé' : 'Série') : null,
      item.genres && item.genres.length ? h('span', {}, item.genres.slice(0, 2).join(', ')) : null,
    ].filter(Boolean));
    const playBtn = h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => playItem(item) }, icon('play'), 'Lecture');
    body.replaceChildren(...[
      item.logo ? h('img', { class: 'hero-logo', src: img(item.logo), alt: item.title }) : h('h1', { class: 'hero-title' }, item.title),
      h('div', { class: 'meta' }, meta),
      item.overview ? h('p', { class: 'hero-overview' }, item.overview) : null,
      h('div', { class: 'actions' }, playBtn,
        h('button', { class: 'btn btn-ghost f', onclick: () => go(`/titre/${item.id}`) }, icon('info'), 'Plus d’infos'),
        h('button', { class: 'btn btn-ghost btn-tonight f', onclick: () => go('/cesoir') }, icon('moon'), 'Que regarder ce soir ?')),
    ].filter(Boolean));
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    if (hadFocus) playBtn.focus({ preventScroll: true }); // la télécommande ne perd pas sa place
  }

  function goTo(i) {
    if (!data.hero.length) return;
    heroIdx = (i + data.hero.length) % data.hero.length;
    [...dots.children].forEach((d, j) => { d.classList.toggle('on', j === heroIdx); d.setAttribute('aria-selected', String(j === heroIdx)); });
    show(data.hero[heroIdx]);
  }
  // Défilement automatique, en pause quand la souris est sur l'affiche, quand on navigue dans les rangées
  // à la télécommande, ou quand l'onglet est caché
  const paused = () => hovering || keyboardInRows || document.hidden;
  function restart() {
    clearTimeout(timer);
    hero.classList.toggle('paused', paused());
    const dot = dots.children[heroIdx];
    if (dot) { dot.classList.remove('on'); void dot.offsetWidth; dot.classList.add('on'); }
    if (!many || paused()) return;
    timer = setTimeout(() => { goTo(heroIdx + 1); restart(); }, ROTATE_MS);
  }

  // À la télécommande, la carte sélectionnée éclaire l'affiche (comme un projecteur qui suit le regard)
  const onFocus = (item) => {
    if (item.type === 'episode' || !document.documentElement.classList.contains('keys')) return;
    keyboardInRows = true; restart();
    setBackground(item);
    tintFrom(img(item.backdrop || item.poster || item.still));
  };

  const rows = h('div', { class: 'rows' }, data.rows.map((r) => row(r, { onFocus })));
  rows.addEventListener('focusout', (e) => { if (!rows.contains(e.relatedTarget)) { keyboardInRows = false; restart(); } });
  hero.addEventListener('focusin', () => { if (shown) setBackground(shown); });
  hero.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hovering = true; restart(); } });
  hero.addEventListener('pointerleave', () => { hovering = false; restart(); });
  const onVis = () => restart();
  document.addEventListener('visibilitychange', onVis);

  main.classList.add('home');
  main.append(hero, rows);
  if (data.hero.length) { goTo(0); restart(); }
  else hero.remove();

  // Balayage horizontal de l'affiche au doigt
  let tx = null, ty = null;
  hero.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (tx == null) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { goTo(heroIdx + (dx < 0 ? 1 : -1)); restart(); }
    tx = null;
  });

  return { destroy: () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); } };
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
