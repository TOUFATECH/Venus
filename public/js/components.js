// Composants partagés : cartes, rangées, actions de lecture
import { h, icon, img, picture, placeholder, fmtDate, daysSince } from './ui.js';
import { go } from './app.js';
import { prefs } from './api.js';

export function playPath(id, t) { return `/lecture/${id}${t != null ? `?t=${Math.floor(t)}` : ''}`; }

function remaining(p) {
  if (!p || !p.duration) return null;
  const min = Math.max(1, Math.round((p.duration - p.position) / 60));
  return `Reste ${min} min`;
}

// Tuile de chaîne TV : logo sur fond sombre, nom dessous
export function channelCard(item) {
  const logo = item.poster
    ? h('img', { src: img(item.poster), alt: '', loading: 'lazy', class: 'ch-logo', onerror: (e) => e.target.replaceWith(h('span', { class: 'ch-initials' }, initials(item.title))) })
    : h('span', { class: 'ch-initials' }, initials(item.title));
  return h('button', { class: 'card channel f', 'aria-label': `${item.title}, en direct`, onclick: () => go(playPath(item.id)) },
    h('div', { class: 'shot' }, logo, h('span', { class: 'live-dot' }, 'Direct')),
    h('div', { class: 'cap' }, h('b', {}, item.title), item.group ? h('small', {}, item.group) : null));
}
const initials = (t) => t.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

// Carte paysage (rangées) ou affiche (grilles). Le titre est écrit sous l'image, lisible de loin.
export function card(item, { poster = false, rank = null, onFocus } = {}) {
  if (item.type === 'channel') return channelCard(item);
  const isEp = item.type === 'episode';
  const isClip = item.type === 'clip';
  const p = item.progress;
  const resume = !!(p && !p.watched && p.position > 0) || item.next;
  const title = isEp ? item.showTitle || item.title : item.title;

  let media;
  if (poster && !isClip) {
    media = item.poster ? picture(img(item.poster), item.title) : framePoster(item);
  } else {
    const src = img(item.backdrop || item.still);
    media = src ? picture(src, title) : frameImage(item.id, title);
  }

  let sub;
  if (isEp && item.fresh) sub = `S${item.season} É${item.episode}${item.released ? `, sorti le ${fmtDate(item.released, false)}` : ''}`;
  else if (isEp && item.next) sub = `À suivre : saison ${item.season}, épisode ${item.episode}`;
  else if (isEp) sub = `S${item.season} É${item.episode}, ${item.title}${resume ? `, ${remaining(p) || ''}` : ''}`;
  else if (resume) sub = remaining(p);
  else if (isClip) sub = item.originalTitle || 'Clip';
  else if (item.type === 'show' && item.status === 'progress' && item.unseen) sub = `${item.unseen} épisode${item.unseen > 1 ? 's' : ''} non vu${item.unseen > 1 ? 's' : ''}`;
  else sub = [item.year, item.type === 'show' ? (item.category === 'anime' ? 'Animé' : 'Série') : (item.genres || [])[0]].filter(Boolean).join(', ');

  const isNew = (isEp && item.fresh && daysSince(item.released) <= 14) || (!isEp && !isClip && daysSince(item.released) <= 30);
  const pct = p && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  const seen = item.status === 'seen' || (p && p.watched && !resume);
  const el = h('button', {
    class: `card f${poster && !isClip ? ' poster' : ''}`,
    'aria-label': [title, sub, seen ? 'déjà vu' : null].filter(Boolean).join(', '),
    onclick: () => (resume || isEp || isClip ? go(playPath(item.id, item.next ? 0 : undefined)) : go(`/titre/${item.id}`)),
  },
  h('div', { class: 'shot' },
    media,
    rank ? h('span', { class: 'rank', 'aria-hidden': 'true' }, rank) : null,
    isNew && !seen ? h('span', { class: 'tag-new' }, isEp ? 'Nouvel épisode' : 'Nouveau') : null,
    pct > 0 && !(p && p.watched) ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null,
    seen ? h('span', { class: 'check', title: 'Déjà vu' }, icon('check')) : null),
  h('div', { class: 'cap' }, h('b', {}, title), sub ? h('small', {}, sub) : null));
  if (onFocus) el.addEventListener('focus', () => onFocus(item));
  attachPreview(el, item);
  return el;
}

// Image tirée de la vidéo quand il n'y a pas d'affiche (pas de clé TMDB, titre inconnu…)
export function frameImage(id, title) {
  const el = h('img', { src: `/api/items/${id}/thumb`, alt: '', loading: 'lazy', decoding: 'async' });
  el.addEventListener('error', () => el.replaceWith(placeholder(title)), { once: true });
  return el;
}
export function framePoster(item) {
  return h('div', { class: 'gen-poster' }, frameImage(item.id, item.title), h('b', {}, item.title));
}

// Aperçu vidéo au survol de la souris (une seule carte à la fois)
let livePreview = null;
function stopPreview() {
  if (!livePreview) return;
  clearTimeout(livePreview.timer);
  if (livePreview.video) { livePreview.video.pause(); livePreview.video.removeAttribute('src'); livePreview.video.load(); livePreview.video.remove(); }
  livePreview.el.classList.remove('previewing');
  livePreview = null;
}
function attachPreview(el, item) {
  if (item.type === 'channel') return;
  el.addEventListener('mouseenter', () => {
    if (document.documentElement.classList.contains('touch') || !prefs.get('hoverPreview')) return;
    stopPreview();
    const state = { el, video: null, timer: null };
    livePreview = state;
    state.timer = setTimeout(() => {
      if (livePreview !== state) return;
      const v = h('video', { class: 'pv', muted: true, loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true' });
      v.muted = !prefs.get('hoverSound');
      v.src = `/api/items/${item.id}/preview`;
      v.addEventListener('playing', () => { if (livePreview === state) el.classList.add('previewing'); });
      v.addEventListener('error', () => v.remove(), { once: true });
      state.video = v;
      el.querySelector('.shot').append(v);
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    }, 650);
  });
  el.addEventListener('mouseleave', () => { if (livePreview && livePreview.el === el) stopPreview(); });
  el.addEventListener('click', stopPreview);
}
window.addEventListener('hashchange', stopPreview);

// Flèches gauche / droite sur une rangée qui défile (souris) ; le doigt et le pavé tactile glissent normalement
export function scrollArrows(scroller) {
  const mk = (dir) => h('button', { type: 'button', class: `row-arrow ${dir < 0 ? 'prev' : 'next'}`, tabindex: '-1', 'aria-label': dir < 0 ? 'Précédent' : 'Suivant',
    onclick: () => scroller.scrollBy({ left: dir * Math.max(240, scroller.clientWidth * 0.82), behavior: 'smooth' }) }, icon(dir < 0 ? 'back' : 'fwd'));
  const prev = mk(-1), next = mk(1);
  const update = () => {
    prev.classList.toggle('off', scroller.scrollLeft < 8);
    next.classList.toggle('off', scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 8);
  };
  scroller.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(scroller);
  requestAnimationFrame(update);
  return h('div', { class: 'row-body' }, prev, scroller, next);
}

export function row(r, opts = {}) {
  const ranked = r.id === 'top';
  const scroller = h('div', { class: 'row-scroll' }, r.items.map((it, i) => card(it, { rank: ranked && i < 10 ? i + 1 : null, onFocus: opts.onFocus })));
  const tools = [];
  if (r.shuffle) {
    tools.push(h('button', { class: 'row-link f', onclick: () => {
      const kids = [...scroller.children].sort(() => Math.random() - 0.5);
      scroller.replaceChildren(...kids); scroller.scrollTo({ left: 0, behavior: 'smooth' });
    } }, icon('shuffle'), 'Mélanger'));
  }
  if (r.more) tools.push(h('button', { class: 'row-link f', onclick: () => go(r.more) }, 'Tout voir'));
  return h('section', { class: `row${r.style === 'channels' ? ' row-channels' : ''}`, 'aria-label': r.title },
    h('div', { class: 'row-head' }, h('h2', {}, r.title), tools.length ? h('div', { class: 'row-tools' }, tools) : null),
    scrollArrows(scroller));
}

export function metaLine(item, extra = []) {
  const bits = [];
  if (item.year) bits.push(h('span', {}, item.year));
  if (item.vote) bits.push(h('span', {}, `${item.vote.toFixed(1).replace('.', ',')}/10`));
  const isBadge = (e) => e && e.classList && e.classList.contains('badge');
  return [...extra.filter(isBadge), ...bits, ...extra.filter((e) => e && !isBadge(e))];
}
