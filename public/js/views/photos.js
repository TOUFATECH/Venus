// Photos : albums (un dossier = un album), grille, visionneuse plein écran avec diaporama
import { api } from '../api.js';
import { h, icon } from '../ui.js';
import { go, setTitle } from '../app.js';
import { isBack } from '../ui.js';

const dateOf = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export async function render(main, { view = 'albums', query } = {}) {
  const page = h('div', { class: 'page photos-page' });
  main.append(page);
  if (view === 'album') {
    const key = query.get('album') || '';
    const a = await api(`/api/photos/album?key=${encodeURIComponent(key)}`);
    setTitle(a.name);
    page.append(h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, a.name), h('p', { class: 'count' }, `${a.photos.length} photo${a.photos.length > 1 ? 's' : ''}`)),
      h('div', { class: 'head-tools' }, h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go('/photos') }, icon('back'), 'Albums'),
        h('button', { class: 'btn btn-play btn-small f', onclick: () => viewer(a.photos, 0, true) }, icon('play'), 'Diaporama'))),
    h('div', { class: 'ph-grid' }, a.photos.map((p, i) => h('button', { class: 'ph-cell f', 'aria-label': p.title, onclick: () => viewer(a.photos, i) }, h('img', { src: `/api/photo/${p.id}?w=320`, alt: '', loading: 'lazy' })))));
    return;
  }
  setTitle('Photos');
  const albums = await api('/api/photos');
  page.append(h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Photos'), h('p', { class: 'count' }, `${albums.length} album${albums.length > 1 ? 's' : ''}`))),
    albums.length ? h('div', { class: 'm-grid' }, albums.map((a) => h('button', { class: 'm-tile f', onclick: () => go(`/photos/album?album=${encodeURIComponent(a.key)}`) },
      h('span', { class: 'm-cover wide' }, h('img', { src: `/api/photo/${a.cover}?w=640`, alt: '', loading: 'lazy' })), h('b', {}, a.name), h('small', {}, `${a.count} photo${a.count > 1 ? 's' : ''} · ${dateOf(a.last)}`))))
      : h('div', { class: 'empty' }, h('h2', {}, 'Pas encore de photos'), h('p', {}, 'Ajoutez une bibliothèque « Photos » dans Réglages → Bibliothèques : chaque dossier devient un album.')));
}

// Visionneuse : flèches, glisser du doigt, Échap pour fermer, diaporama toutes les 5 secondes
function viewer(list, start, slideshow = false) {
  let i = start, timer = null;
  const im = h('img', { class: 'pv-img', alt: '' });
  const cap = h('div', { class: 'pv-cap' });
  const playBtn = h('button', { class: 'p-icon f', 'aria-label': 'Diaporama', onclick: () => setShow(!timer) }, icon('play'));
  const root = h('div', { class: 'photo-viewer', role: 'dialog', 'aria-label': 'Photo' },
    im, cap,
    h('button', { class: 'p-icon f pv-prev', 'aria-label': 'Photo précédente', onclick: () => show(i - 1) }, icon('back')),
    h('button', { class: 'p-icon f pv-next', 'aria-label': 'Photo suivante', onclick: () => show(i + 1) }, icon('fwd')),
    h('div', { class: 'pv-tools' }, playBtn,
      h('a', { class: 'p-icon f', 'aria-label': 'Télécharger', title: 'Télécharger l’original', href: '#', onclick: (e) => { e.currentTarget.href = `/api/photo/${list[i].id}`; e.currentTarget.download = list[i].title; } }, icon('down')),
      h('button', { class: 'p-icon f', 'aria-label': 'Fermer', onclick: () => close() }, icon('close'))));
  const show = (n) => {
    i = (n + list.length) % list.length;
    const p = list[i];
    im.src = `/api/photo/${p.id}?w=${Math.min(2048, Math.round(innerWidth * (devicePixelRatio || 1)))}`;
    cap.textContent = `${p.title} · ${dateOf(p.date)} · ${i + 1} / ${list.length}`;
    // Préchargement de la suivante
    const nx = list[(i + 1) % list.length]; if (nx) { const pre = new Image(); pre.src = `/api/photo/${nx.id}?w=${Math.min(2048, Math.round(innerWidth * (devicePixelRatio || 1)))}`; }
  };
  const setShow = (on) => { clearInterval(timer); timer = on ? setInterval(() => show(i + 1), 5000) : null; playBtn.replaceChildren(icon(on ? 'pause' : 'play')); root.classList.toggle('show', !!on); };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
    else if (e.key === ' ') { e.preventDefault(); setShow(!timer); } else if (isBack(e)) { e.preventDefault(); e.stopPropagation(); close(); }
  };
  let x0 = null;
  root.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') x0 = e.clientX; });
  root.addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); });
  const close = () => { clearInterval(timer); document.removeEventListener('keydown', onKey, true); root.remove(); window.removeEventListener('hashchange', close); };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', close, { once: true });
  document.body.append(root);
  show(i);
  if (slideshow) setShow(true);
  root.requestFullscreen?.().catch?.(() => {});
}
