// Musique : albums, artistes, titres ; la lecture continue pendant la navigation (lecteur en bas de l'écran)
import { api } from '../api.js';
import { h, icon, img, placeholder } from '../ui.js';
import { go, setTitle } from '../core.js';
import { playList, addToQueue, onAudioChange, nowPlaying } from '../audio.js';

// Durée lisible (« 3:07 »)
const fmt = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// Durée totale lisible (« 1 h 05 »)
const total = (s) => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
// Pochette (ou image de remplacement)
const cover = (c, title, w = 342) => (c ? h('img', { src: img(c, w), alt: '', loading: 'lazy' }) : placeholder(title));
// Tuile d'un album
const albumTile = (a) => h('button', { class: 'm-tile f', onclick: () => go(`/musique/album/${encodeURIComponent(a.slug)}`) },
  h('span', { class: 'm-cover' }, cover(a.cover, a.album)), h('b', {}, a.album), h('small', {}, [a.artist, a.year].filter(Boolean).join(' · ')));

// Liste de morceaux cliquables
function trackList(tracks, { showAlbum = false, showArtist = false } = {}) {
  const rows = tracks.map((t, i) => h('div', { class: 'tr-row', 'data-id': t.id },
    h('button', { class: 'tr-main f', onclick: () => playList(tracks, i) },
      h('span', { class: 'tr-n' }, t.track ? String(t.track) : String(i + 1)), h('span', { class: 'tr-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', { class: 'tr-txt' }, h('b', {}, t.title), showArtist || showAlbum ? h('small', {}, [showArtist ? t.artist : null, showAlbum ? t.album : null].filter(Boolean).join(' · ')) : null),
      h('small', { class: 'tr-d' }, fmt(t.duration))),
    h('button', { class: 'p-icon small f', 'aria-label': `Ajouter « ${t.title} » à la file`, title: 'Ajouter à la file', onclick: () => addToQueue([t]) }, icon('plus'))));
  const list = h('div', { class: 'tracks' }, rows);
  const mark = (track, playing) => list.querySelectorAll('.tr-row').forEach((r) => { const on = track && Number(r.dataset.id) === track.id; r.classList.toggle('on', !!on); r.classList.toggle('playing', !!(on && playing)); });
  const { track, playing } = nowPlaying(); mark(track, playing);
  const off = onAudioChange(mark);
  window.addEventListener('hashchange', off, { once: true });
  return list;
}

// Page Musique : accueil, albums, artistes, titres
export async function render(main, { view = 'home', query, name } = {}) {
  const page = h('div', { class: 'page music-page' });
  main.append(page);
  if (view === 'album') {
    const a = await api(`/api/music/album?slug=${encodeURIComponent(name || '')}`);
    setTitle(a.album);
    page.append(h('div', { class: 'm-head' }, h('span', { class: 'm-cover big' }, cover(a.cover, a.album, 500)),
      h('div', {}, h('small', {}, 'Album'), h('h1', {}, a.album),
        h('p', {}, h('button', { class: 'linkish f', onclick: () => go(`/musique/artiste/${encodeURIComponent(a.artistSlug)}`) }, a.artist), [a.year, `${a.tracks.length} titre${a.tracks.length > 1 ? 's' : ''}`, total(a.duration), ...a.genres].filter(Boolean).map((x) => ` · ${x}`).join('')),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => playList(a.tracks, 0) }, icon('play'), 'Lecture'),
          h('button', { class: 'btn btn-ghost f', onclick: () => playList([...a.tracks].sort(() => Math.random() - 0.5), 0) }, icon('shuffle'), 'Aléatoire'),
          h('button', { class: 'btn btn-ghost f', onclick: () => addToQueue(a.tracks) }, icon('plus'), 'À la suite')))),
    trackList(a.tracks));
    return;
  }
  if (view === 'artist') {
    const a = await api(`/api/music/artist?slug=${encodeURIComponent(name || '')}`);
    setTitle(a.name);
    page.append(h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, a.name), h('p', { class: 'count' }, `${a.albums.length} album${a.albums.length > 1 ? 's' : ''} · ${a.tracks.length} titres`)),
      h('div', { class: 'head-tools' }, h('button', { class: 'btn btn-play btn-small f', onclick: () => playList([...a.tracks].sort(() => Math.random() - 0.5), 0) }, icon('shuffle'), 'Lecture aléatoire'))),
    h('div', { class: 'm-grid' }, a.albums.map(albumTile)), h('h2', { class: 'section-title' }, 'Titres'), trackList(a.tracks, { showAlbum: true }));
    return;
  }
  setTitle('Musique');
  const d = await api('/api/music');
  let tab = (query && query.get('vue')) || 'albums';
  const body = h('div', {});
  const tabs = h('div', { class: 'seg' });
  const paint = () => {
    tabs.replaceChildren(...[['albums', `Albums (${d.albums.length})`], ['artistes', `Artistes (${d.artists.length})`], ['titres', `Titres (${d.total})`]].map(([k, l]) => h('button', { class: `seg-b f${k === tab ? ' on' : ''}`, onclick: () => { tab = k; paint(); } }, l)));
    if (tab === 'albums') body.replaceChildren(d.recent.length > 4 ? h('h2', { class: 'section-title' }, 'Ajoutés récemment') : null, d.recent.length > 4 ? h('div', { class: 'm-row' }, d.recent.slice(0, 12).map(albumTile)) : null,
      h('h2', { class: 'section-title' }, 'Tous les albums'), h('div', { class: 'm-grid' }, d.albums.map(albumTile)));
    else if (tab === 'artistes') body.replaceChildren(h('div', { class: 'm-grid artists' }, d.artists.map((a) => h('button', { class: 'm-tile f', onclick: () => go(`/musique/artiste/${encodeURIComponent(a.slug)}`) },
      h('span', { class: 'm-cover round' }, cover(a.cover, a.name)), h('b', {}, a.name), h('small', {}, `${a.albums} album${a.albums > 1 ? 's' : ''}`)))));
    else body.replaceChildren(d.tracks.length ? trackList(d.tracks, { showArtist: true, showAlbum: true }) : h('p', { class: 'muted' }, 'Trop de titres pour les afficher tous : passez par les albums ou les artistes.'));
  };
  page.append(h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Musique')),
    h('div', { class: 'head-tools' }, tabs, d.total ? h('button', { class: 'btn btn-play btn-small f', onclick: async () => { const all = d.tracks.length ? d.tracks : (await api('/api/music')).tracks; playList([...all].sort(() => Math.random() - 0.5).slice(0, 300), 0); } }, icon('shuffle'), 'Tout en aléatoire') : null)),
  d.total ? body : h('div', { class: 'empty' }, h('h2', {}, 'Pas encore de musique'), h('p', {}, 'Ajoutez une bibliothèque « Musique » dans Réglages → Bibliothèques (un dossier par artiste, puis par album).')));
  if (d.total) paint();
}
