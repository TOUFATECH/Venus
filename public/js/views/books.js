// Livres : EPUB (chapitre par chapitre), PDF (lecteur du navigateur), bandes dessinées CBZ (page par page),
// et livres audio (lecteur audio de Venus, reprise là où on s'était arrêté)
import { api } from '../api.js';
import { h, icon, img, placeholder, sheet, toast, isBack } from '../ui.js';
import { go, setTitle, showSlug } from '../core.js';
import { playList } from '../audio.js';

// Avancement de lecture d'un livre en pourcentage
const pct = (b) => (b.progress && b.progress.duration ? Math.min(100, Math.round((b.progress.watched ? 1 : b.progress.position / b.progress.duration) * 100)) : 0);
const FORMAT = { epub: 'EPUB', pdf: 'PDF', cbz: 'BD', audiobook: 'Livre audio' };

// Page Livres : bibliothèque, auteur ou liseuse
export async function render(main, { view = 'all', id } = {}) {
  if (view === 'read') return reader(main, Number(id));
  setTitle('Livres');
  const page = h('div', { class: 'page books-page' });
  main.append(page);
  const list = await api('/api/books?flat=1');
  let filter = 'all';
  const grid = h('div', { class: 'm-grid books' });
  const tabs = h('div', { class: 'seg' });
  const paint = () => {
    tabs.replaceChildren(...[['all', 'Tous'], ['read', 'À lire'], ['audio', 'Livres audio']].map(([k, l]) => h('button', { class: `seg-b f${k === filter ? ' on' : ''}`, onclick: () => { filter = k; paint(); } }, l)));
    const shown = list.filter((b) => filter === 'all' || (filter === 'audio' ? b.type === 'audiobook' : b.type === 'book'));
    const reading = shown.filter((b) => b.progress && !b.progress.watched && b.progress.position > 0).sort((a, b) => b.progress.updated - a.progress.updated);
    grid.replaceChildren(...shown.map((b) => h('button', { class: 'm-tile f', onclick: () => open(b) },
      h('span', { class: 'm-cover book' }, b.cover ? h('img', { src: img(b.cover, 342), alt: '', loading: 'lazy' }) : placeholder(b.title), h('em', { class: 'b-fmt' }, FORMAT[b.type === 'audiobook' ? 'audiobook' : b.format] || ''),
        pct(b) ? h('span', { class: 'bar' }, h('i', { style: { width: `${pct(b)}%` } })) : null),
      h('b', {}, b.title), h('small', {}, b.author || ''))));
    page.replaceChildren(h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Livres'), h('p', { class: 'count' }, `${list.length} livre${list.length > 1 ? 's' : ''}`)), h('div', { class: 'head-tools' }, tabs)),
      reading.length ? h('h2', { class: 'section-title' }, 'En cours') : null, reading.length ? h('div', { class: 'm-row' }, reading.slice(0, 10).map((b) => h('button', { class: 'm-tile f', onclick: () => open(b) },
        h('span', { class: 'm-cover book' }, b.cover ? h('img', { src: img(b.cover, 342), alt: '', loading: 'lazy' }) : placeholder(b.title), h('span', { class: 'bar' }, h('i', { style: { width: `${pct(b)}%` } }))), h('b', {}, b.title), h('small', {}, `${pct(b)} %`)))) : null,
      list.length ? grid : h('div', { class: 'empty' }, h('h2', {}, 'Pas encore de livres'), h('p', {}, 'Ajoutez une bibliothèque « Livres » dans Réglages → Bibliothèques : EPUB, PDF, CBZ et livres audio (un dossier par livre).')));
  };
  const open = async (b) => {
    if (b.type !== 'audiobook') return go(`/lire/${b.id}`);
    const d = await api(`/api/books/${b.id}`);
    const parts = d.parts.map((p) => ({ ...p, artist: d.author, album: d.title, cover: d.cover }));
    // Reprise : partie et position d'après la progression enregistrée
    let at = d.progress && !d.progress.watched ? d.progress.position : 0, idx = 0;
    while (idx < parts.length - 1 && at >= (parts[idx].duration || 0)) { at -= parts[idx].duration || 0; idx++; }
    playList(parts, idx, { kind: 'book', bookId: b.id, at });
    toast(at > 5 || idx ? `Reprise de « ${d.title} »` : `Lecture de « ${d.title} »`);
  };
  paint();
}

// Lecteur : EPUB et CBZ dans Venus (thème clair / sépia / sombre, taille du texte), PDF par le navigateur
async function reader(main, id) {
  const b = await api(`/api/books/${id}`);
  setTitle(b.title);
  showSlug('lire', b.slug);
  const total = b.format === 'epub' ? b.chapters : b.format === 'cbz' ? b.pages : 1;
  let n = b.progress && !b.progress.watched ? Math.min(total - 1, Math.floor(b.progress.position)) : 0;
  let saveT = null;
  const save = (frac = 0) => {
    clearTimeout(saveT);
    saveT = setTimeout(() => api('/api/progress', { method: 'POST', body: { itemId: id, position: Math.min(total, n + frac), duration: total, watched: n >= total - 1 && frac > 0.9 } }).catch(() => {}), 800);
  };
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('vn_reader') || '{}'); } catch { return {}; } })();
  let theme = prefs.theme || 'light', size = prefs.size || 100;
  const keep = () => { try { localStorage.setItem('vn_reader', JSON.stringify({ theme, size })); } catch { /* */ } };
  const frame = h('iframe', { class: 'rd-frame', title: b.title, sandbox: 'allow-same-origin' });
  const pageImg = h('img', { class: 'rd-img', alt: '' });
  const pos = h('span', { class: 'rd-pos' });
  const root = h('div', { class: `reader rd-${theme}` });
  const styleFrame = () => {
    const doc = frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    let st = doc.getElementById('vn-style');
    if (!st) { st = doc.createElement('style'); st.id = 'vn-style'; (doc.head || doc.documentElement).append(st); }
    const c = { light: ['#fbfaf7', '#1d1d1f'], sepia: ['#f4ecd8', '#3b2f1e'], dark: ['#121214', '#e6e3dc'] }[theme];
    st.textContent = `html{background:${c[0]}!important;color:${c[1]}!important;font-size:${size}%!important}body{max-width:42em;margin:0 auto!important;padding:2.2em 1.4em 4em!important;line-height:1.65!important;font-family:Georgia,'Iowan Old Style','Palatino Linotype',serif!important;background:transparent!important;color:inherit!important}img,svg{max-width:100%!important;height:auto!important}a{color:inherit}`;
    // Reprise de la position dans le chapitre
    const frac = b.progress && Math.floor(b.progress.position) === n ? b.progress.position - n : 0;
    if (frac > 0) setTimeout(() => { const se = doc.scrollingElement; se.scrollTop = frac * (se.scrollHeight - se.clientHeight); }, 50);
    doc.addEventListener('scroll', () => { const se = doc.scrollingElement; save(se.scrollHeight > se.clientHeight ? se.scrollTop / (se.scrollHeight - se.clientHeight) : 1); }, { passive: true });
    doc.addEventListener('keydown', onKey, true);
  };
  frame.addEventListener('load', styleFrame);
  const show = (k) => {
    n = Math.max(0, Math.min(total - 1, k));
    pos.textContent = b.format === 'cbz' ? `Page ${n + 1} / ${total}` : `Chapitre ${n + 1} / ${total}`;
    if (b.format === 'epub') frame.src = `/api/books/${id}/chapter/${n}`;
    else if (b.format === 'cbz') { pageImg.src = `/api/books/${id}/page/${n}`; const pre = new Image(); pre.src = `/api/books/${id}/page/${Math.min(total - 1, n + 1)}`; }
    save(0);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' && b.format === 'cbz') { e.preventDefault(); show(n + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' && b.format === 'cbz') { e.preventDefault(); show(n - 1); }
    else if (isBack(e) && !document.querySelector('.sheet-wrap')) { e.preventDefault(); history.length > 1 ? history.back() : go('/livres'); }
  };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onKey, true), { once: true });
  const tools = h('div', { class: 'rd-bar' },
    h('button', { class: 'p-icon f', 'aria-label': 'Retour', onclick: () => go('/livres') }, icon('back')),
    h('b', { class: 'rd-title' }, b.title),
    b.toc && b.toc.length ? h('button', { class: 'p-icon f', 'aria-label': 'Table des matières', title: 'Table des matières', onclick: () => { const s = sheet('Table des matières', h('div', {}, b.toc.map((t) => h('button', { class: `opt f${t.chapter === n ? ' on' : ''}`, onclick: () => { s.close(); show(t.chapter); } }, t.title)))); } }, icon('chapters')) : null,
    b.format === 'epub' ? h('button', { class: 'p-icon f', 'aria-label': 'Affichage', title: 'Affichage', onclick: () => {
      const s = sheet('Affichage', h('div', { class: 'look' },
        h('div', { class: 'look-row' }, h('span', {}, 'Fond'), h('div', { class: 'seg' }, [['light', 'Clair'], ['sepia', 'Sépia'], ['dark', 'Sombre']].map(([v, l]) => h('button', { class: `seg-b f${theme === v ? ' on' : ''}`, onclick: () => { theme = v; root.className = `reader rd-${theme}`; keep(); styleFrame(); s.close(); } }, l)))),
        h('div', { class: 'look-row' }, h('span', {}, 'Taille du texte'), h('div', { class: 'seg' }, [80, 100, 120, 140, 170].map((v) => h('button', { class: `seg-b f${size === v ? ' on' : ''}`, onclick: () => { size = v; keep(); styleFrame(); s.close(); } }, `${v} %`))))));
    } }, icon('subs')) : null,
    h('a', { class: 'p-icon f', 'aria-label': 'Télécharger le livre', title: 'Télécharger', href: `/api/books/${id}/file?download=1`, download: '' }, icon('down')));
  // Le lecteur couvre tout l'écran (au-dessus du menu) ; il disparaît en changeant de page
  const mount = () => { document.body.append(root); main.append(h('div', { class: 'rd-spacer' })); window.addEventListener('hashchange', () => root.remove(), { once: true }); };
  if (b.format === 'pdf') {
    root.append(tools, h('iframe', { class: 'rd-frame pdf', src: `/api/books/${id}/file`, title: b.title }));
    mount();
    save(0.5);
    return;
  }
  root.append(tools, b.format === 'cbz' ? h('div', { class: 'rd-page', onclick: (e) => show(n + (e.clientX > innerWidth / 2 ? 1 : -1)) }, pageImg) : frame,
    h('div', { class: 'rd-foot' }, h('button', { class: 'btn btn-ghost btn-small f', onclick: () => show(n - 1) }, icon('back'), b.format === 'cbz' ? 'Page précédente' : 'Chapitre précédent'), pos,
      h('button', { class: 'btn btn-ghost btn-small f', onclick: () => show(n + 1) }, b.format === 'cbz' ? 'Page suivante' : 'Chapitre suivant', icon('fwd'))));
  mount();
  show(n);
}
