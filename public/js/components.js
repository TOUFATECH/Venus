// Composants partagés : cartes, rangées, actions de lecture
import { h, icon, img, picture, placeholder, fmtDate, daysSince, fadeIn } from './ui.js';
import { go } from './app.js';
import { prefs, hoverMode } from './api.js';
import { trailerPlayer } from './trailer.js';
import { setQueue } from './queue.js';

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
  const el = h('button', { class: 'card channel f', 'aria-label': `${item.number ? `${item.number}, ` : ''}${item.title}, en direct`, onclick: () => go(playPath(item.id)) },
    h('div', { class: 'shot' }, logo, h('span', { class: 'live-dot' }, 'Direct'), item.number ? h('span', { class: 'ch-num' }, item.number) : null),
    h('div', { class: 'cap' }, h('b', {}, item.title), item.group ? h('small', {}, item.group) : null));
  liveHover(el, item);
  return el;
}

// Chaîne survolée à la souris : l'image en direct se lance dans la carte (sans le son)
function liveHover(el, item) {
  let timer = null, session = null, detach = null, video = null, gone = false;
  const stop = () => {
    clearTimeout(timer); gone = true;
    if (detach) { detach(); detach = null; }
    if (session) { fetch(`/api/hls/${session}`, { method: 'DELETE', keepalive: true }).catch(() => {}); session = null; }
    if (video) { video.remove(); video = null; }
    el.classList.remove('previewing');
  };
  el.addEventListener('mouseenter', () => {
    if (document.documentElement.classList.contains('touch') || hoverMode() === 'off') return;
    gone = false;
    timer = setTimeout(async () => {
      try {
        const [{ api: callApi, deviceCaps }, { attachStream }] = await Promise.all([import('./api.js'), import('./live.js')]);
        const info = await callApi(`/api/play/${item.id}`, { method: 'POST', body: { caps: deviceCaps(), preview: true } });
        if (gone) { fetch(`/api/hls/${info.sessionId}`, { method: 'DELETE' }).catch(() => {}); return; }
        session = info.sessionId;
        video = h('video', { class: 'pv', muted: true, playsinline: true, autoplay: true });
        video.muted = true;
        video.addEventListener('playing', () => { if (!gone) el.classList.add('previewing'); });
        el.querySelector('.shot').append(video);
        detach = await attachStream(video, info.url, { live: true, onError: stop });
      } catch { /* chaîne muette : on garde le logo */ }
    }, 600);
  });
  el.addEventListener('mouseleave', stop);
  el.addEventListener('click', stop);
}
const initials = (t) => t.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

// Carte paysage (rangées) ou affiche (grilles). Le titre est écrit sous l'image, lisible de loin.
export function card(item, { poster = false, rank = null, onFocus, queue = null } = {}) {
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
  const sc = !isEp && !isClip ? scoreOf(item) : null;

  const isNew = (isEp && item.fresh && daysSince(item.released) <= 14) || (!isEp && !isClip && daysSince(item.released) <= 30);
  const pct = p && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  const seen = item.status === 'seen' || (p && p.watched && !resume);
  const el = h('button', {
    class: `card f${poster && !isClip ? ' poster' : ''}`,
    'aria-label': [title, sub, seen ? 'déjà vu' : null].filter(Boolean).join(', '),
    // Le nom ouvre la fiche (film, série, animé) ; l'image lance la lecture quand c'est le plus utile
    onclick: (e) => {
      const onTitle = e.target.closest && e.target.closest('.cap');
      if (isClip) { if (queue) setQueue(queue(), { startId: item.id }); return go(playPath(item.id)); }
      if (onTitle) return go(`/titre/${isEp ? item.showId : item.id}`);
      return resume || isEp ? go(playPath(item.id, item.next ? 0 : undefined)) : go(`/titre/${item.id}`);
    },
  },
  h('div', { class: 'shot' },
    media,
    rank ? h('span', { class: 'rank', 'aria-hidden': 'true' }, rank) : null,
    isNew && !seen ? h('span', { class: 'tag-new' }, isEp ? 'Nouvel épisode' : 'Nouveau') : null,
    pct > 0 && !(p && p.watched) ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null,
    seen ? h('span', { class: 'check', title: 'Déjà vu' }, icon('check')) : null),
  h('div', { class: 'cap' }, h('b', { title: isClip ? title : `Voir la fiche de ${title}` }, title),
    sub || sc ? h('small', {}, sub || '', sc ? h('span', { class: 'cap-score', title: 'Note moyenne des sites' }, `★ ${sc.toFixed(1).replace('.', ',')}`) : null) : null));
  if (onFocus) el.addEventListener('focus', () => onFocus(item));
  attachPreview(el, item);
  return el;
}

// Image tirée de la vidéo quand il n'y a pas d'affiche (pas de clé TMDB, titre inconnu…)
export function frameImage(id, title, { fade = true } = {}) {
  const el = h('img', { src: `/api/items/${id}/thumb`, alt: '', loading: fade ? 'lazy' : 'eager', decoding: 'async', class: fade ? 'fade' : '' });
  el.addEventListener('error', () => el.replaceWith(placeholder(title)), { once: true });
  if (fade) fadeIn(el);
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
  if (livePreview.trailer) livePreview.trailer.destroy();
  livePreview.el.classList.remove('previewing');
  livePreview = null;
}
function attachPreview(el, item) {
  if (item.type === 'channel') return;
  el.addEventListener('mouseenter', () => {
    const mode = hoverMode();
    if (document.documentElement.classList.contains('touch') || mode === 'off') return;
    stopPreview();
    const state = { el, video: null, trailer: null, timer: null };
    livePreview = state;
    const extract = () => {
      if (livePreview !== state) return;
      const v = h('video', { class: 'pv', muted: true, loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true' });
      v.muted = !prefs.get('hoverSound');
      v.src = window.__VN_PREVIEW ? window.__VN_PREVIEW(item.id) : `/api/items/${item.id}/preview`;
      v.addEventListener('playing', () => { if (livePreview === state) el.classList.add('previewing'); });
      v.addEventListener('error', () => v.remove(), { once: true });
      state.video = v;
      el.querySelector('.shot').append(v);
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    };
    // Bande-annonce (films, séries, animés) ; les clips et les titres sans bande-annonce montrent un extrait
    const useTrailer = mode === 'trailer' && item.trailer && item.type !== 'clip';
    state.timer = setTimeout(() => {
      if (livePreview !== state) return;
      if (!useTrailer) return extract();
      const t = trailerPlayer(item.trailer, {
        mute: !prefs.get('hoverSound'), loop: true,
        onPlaying: () => { if (livePreview === state) el.classList.add('previewing'); },
        onError: () => { t.destroy(); state.trailer = null; extract(); },
      });
      state.trailer = t;
      el.querySelector('.shot').append(t.el);
      // YouTube injoignable ou vidéo bloquée : extrait de la vidéo à la place
      setTimeout(() => { if (livePreview === state && state.trailer === t && !t.el.classList.contains('on')) { t.destroy(); state.trailer = null; extract(); } }, 5000);
    }, useTrailer ? 800 : 650);
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
  const clips = r.items.filter((it) => it.type === 'clip');
  const queue = clips.length ? () => clips : null;
  const scroller = h('div', { class: 'row-scroll' }, r.items.map((it, i) => card(it, { rank: ranked && i < 10 ? i + 1 : null, onFocus: opts.onFocus, queue })));
  const tools = [];
  if (clips.length > 1 && clips.length === r.items.length) {
    tools.push(h('button', { class: 'row-link f', onclick: () => { const f = setQueue(clips, { title: r.title }); go(playPath(f.id)); } }, icon('play'), 'Tout lire'));
    tools.push(h('button', { class: 'row-link f', onclick: () => { const f = setQueue(clips, { shuffle: true, title: r.title }); go(playPath(f.id)); } }, icon('shuffle'), 'Aléatoire'));
  }
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
  // La note détaillée (IMDb, TMDB…) s'affiche à part quand on la connaît
  if (item.vote && !(item.ratings && item.ratings.score)) bits.push(h('span', {}, `${item.vote.toFixed(1).replace('.', ',')}/10`));
  const isBadge = (e) => e && e.classList && e.classList.contains('badge');
  return [...extra.filter(isBadge), ...bits, ...extra.filter((e) => e && !isBadge(e))];
}

// ------------------------------------------------------------------ notes des sites (fiche, cartes, tri)
export const RATING_SOURCES = [
  ['imdb', 'IMDb'], ['rt', 'Rotten Tomatoes'], ['mc', 'Metacritic'], ['tmdb', 'TMDB'],
  ['anilist', 'AniList'], ['mal', 'MyAnimeList'], ['simkl', 'Simkl'],
];
export const fmtScore = (x) => (x.max === 10 ? x.v.toFixed(1).replace('.', ',') : x.max === 100 && x.v <= 100 ? `${Math.round(x.v)}${['rt', 'anilist'].includes(x.src) ? ' %' : ''}` : String(x.v));
// Note globale sur 10 (moyenne des sources), pour les cartes
export function scoreOf(item) {
  const r = item && item.ratings;
  if (r && r.score) return r.score / 10;
  return item && item.vote ? item.vote : null;
}
export function ratingChips(ratings, links = {}) {
  const r = ratings || {};
  const chips = RATING_SOURCES.filter(([k]) => r[k] && r[k].v).map(([k, label]) => {
    const x = { ...r[k], src: k };
    const votes = x.votes ? `, ${x.votes.toLocaleString('fr-FR')} votes` : '';
    return h(x.url ? 'a' : 'span', { class: `rating r-${k}`, href: x.url || null, target: x.url ? '_blank' : null, rel: 'noopener', title: `${label} : ${fmtScore(x)}${x.max === 10 ? ' sur 10' : x.max === 100 && k === 'mc' ? ' sur 100' : ''}${votes}` },
      h('span', { class: 'r-src' }, k === 'rt' ? (x.v >= 60 ? '🍅' : '🥀') : label), k === 'rt' ? h('span', { class: 'r-src-txt' }, 'Rotten Tomatoes') : null,
      h('b', {}, fmtScore(x)), x.max === 10 ? h('small', {}, '/10') : null);
  });
  // Sites sans note récupérable (SensCritique n'a pas d'API) : lien direct
  const extra = [
    links.anilist && !r.anilist ? ['anilist', 'AniList', links.anilist] : null,
    links.mal && !r.mal ? ['mal', 'MyAnimeList', links.mal] : null,
    links.imdb && !r.imdb ? ['imdb', 'IMDb', links.imdb] : null,
    links.senscritique ? ['sc', 'SensCritique', links.senscritique] : null,
  ].filter(Boolean).map(([k, label, url]) => h('a', { class: `rating r-${k} r-link`, href: url, target: '_blank', rel: 'noopener', title: `Voir sur ${label}` }, h('span', { class: 'r-src' }, label), h('span', { class: 'r-go' }, '↗')));
  if (!chips.length && !extra.length) return null;
  return h('div', { class: 'ratings' }, chips, extra);
}
