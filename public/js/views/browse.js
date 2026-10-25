// Films, Séries, Animés, Clips, Ma liste : grille avec filtres (vu / non vu / en cours), tris et genres
import { api } from '../api.js';
import { h, icon } from '../ui.js';
import { card, playPath } from '../components.js';
import { setQueue } from '../queue.js';
import { go } from '../app.js';

const TITLES = { movie: 'Films', show: 'Séries', anime: 'Animés', clip: 'Clips', mylist: 'Ma liste' };
const rel = (i) => i.released || (i.year ? `${i.year}-01-01` : '');
const SORTS = [
  ['added', 'Date d’ajout', (a, b) => (b.added || 0) - (a.added || 0)],
  ['released', 'Date de sortie', (a, b) => rel(b).localeCompare(rel(a))],
  ['az', 'Titre (A à Z)', (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })],
  ['vote', 'Note', (a, b) => (b.vote || 0) - (a.vote || 0)],
  ['popular', 'Popularité', (a, b) => (b.popularity || 0) - (a.popularity || 0) || (b.vote || 0) - (a.vote || 0)],
];
const STATUS = [['all', 'Tous'], ['unseen', 'Non vus'], ['progress', 'En cours'], ['seen', 'Déjà vus']];

const store = {
  get(k, d) { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};

export async function render(main, { kind }) {
  const items = kind === 'mylist' ? await api('/api/mylist') : await api(`/api/library?type=${kind}`);
  const key = `vn_filters_${kind}`;
  const f = { sort: kind === 'mylist' ? null : 'added', status: 'all', genre: '', ...store.get(key, {}) };
  const save = () => store.set(key, f);
  const isClip = kind === 'clip';

  const grid = h('div', { class: `grid${isClip ? ' grid-wide' : ''}` });
  let shown = [];
  // Clips : tout lire dans l'ordre affiché, ou au hasard
  const playAll = isClip ? h('div', { class: 'actions play-all' },
    h('button', { class: 'btn btn-play f', onclick: () => { const q = setQueue(shown, { title: 'Clips' }); if (q) go(playPath(q.id)); } }, icon('play'), 'Tout lire'),
    h('button', { class: 'btn btn-ghost f', onclick: () => { const q = setQueue(shown, { shuffle: true, title: 'Clips' }); if (q) go(playPath(q.id)); } }, icon('shuffle'), 'Lecture aléatoire')) : null;
  const count = h('p', { class: 'count', 'aria-live': 'polite' });
  const genres = [...new Set(items.flatMap((i) => i.genres || []))].sort((a, b) => a.localeCompare(b, 'fr'));

  const paint = () => {
    let list = items.filter((i) => (f.status === 'all' || i.status === f.status) && (!f.genre || (i.genres || []).includes(f.genre)));
    if (f.sort) list.sort(SORTS.find((s) => s[0] === f.sort)[2]);
    shown = list;
    grid.replaceChildren(...list.map((i) => card(i, { poster: !isClip, queue: isClip ? () => shown : null })));
    if (playAll) playAll.hidden = list.length < 1;
    const word = isClip ? 'clip' : 'titre';
    count.textContent = `${list.length} ${word}${list.length > 1 ? 's' : ''}`;
    if (!list.length) {
      grid.replaceChildren(h('p', { class: 'grid-empty' },
        !items.length
          ? kind === 'mylist' ? 'Votre liste est vide. Ajoutez des titres avec le bouton + sur leur fiche.' : 'Rien ici pour l’instant. Ajoutez une source dans les réglages.'
          : f.status === 'unseen' ? 'Vous avez tout vu ici. Bravo.' : 'Aucun titre ne correspond à ces filtres.'));
    }
  };

  const statusChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer par visionnage' }, STATUS.map(([id, label]) => {
    const b = h('button', { class: `chip f${f.status === id ? ' on' : ''}`, 'aria-pressed': String(f.status === id), onclick: () => {
      f.status = id; save();
      [...statusChips.children].forEach((c) => { c.classList.toggle('on', c === b); c.setAttribute('aria-pressed', String(c === b)); });
      paint();
    } }, label);
    return b;
  }));
  const sortSel = f.sort ? h('select', { class: 'input pill-select f', id: `sort-${kind}`, 'aria-label': 'Trier par',
    onchange: (e) => { f.sort = e.target.value; save(); paint(); } },
  SORTS.filter(([id]) => !isClip || ['added', 'az'].includes(id)).map(([id, label]) => h('option', { value: id, selected: id === f.sort }, `Trier : ${label}`))) : null;
  const genreSel = genres.length > 1 ? h('select', { class: 'input pill-select f', id: `genre-${kind}`, 'aria-label': 'Genre',
    onchange: (e) => { f.genre = e.target.value; save(); paint(); } },
  h('option', { value: '' }, 'Tous les genres'), genres.map((g) => h('option', { value: g, selected: g === f.genre }, g))) : null;

  main.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, TITLES[kind]), count), playAll),
    h('div', { class: 'filters' }, statusChips, h('div', { class: 'chips' }, sortSel, genreSel)),
    grid));
  paint();
}
