// Nouveautés : films au cinéma et à venir, séries de la semaine, animés de la saison.
// Grande affiche en haut qui suit le titre survolé (avec sa bande-annonce), et demande de
// téléchargement via Seerr (Radarr / Sonarr lancent la recherche automatiquement).
import { api, prefs, hoverMode } from '../api.js';
import { h, icon, toast, fmtDate } from '../ui.js';
import { go, state } from '../app.js';
import { scrollArrows } from '../components.js';
import { trailerPlayer } from '../trailer.js';

const KINDS = [['movie', 'Films'], ['show', 'Séries'], ['anime', 'Animés']];
const store = { get: (k, d) => { try { return sessionStorage.getItem(k) || d; } catch { return d; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };
const STATE_LABEL = {
  pending: 'Demandé, en attente de validation', processing: 'Demandé, recherche en cours', partial: 'Disponible en partie',
  available: 'Disponible, bientôt dans Venus', blocked: 'Bloqué dans Seerr', deleted: 'Supprimé de Seerr',
};

export async function render(main, { query }) {
  let kind = query.get('type') || store.get('vn_new_kind', 'movie');
  if (!KINDS.some(([k]) => k === kind)) kind = 'movie';
  const data = await api(`/api/discover?kind=${kind}`);
  const statusCache = new Map();
  let current = null, trailer = null, trailerTimer = null, soundOn = false, hoverTimer = null, destroyed = false;

  // ------------------------------------------------------------ grande affiche
  const bgA = h('div', { class: 'sp-layer' }), bgB = h('div', { class: 'sp-layer' });
  let front = bgA;
  const bg = h('div', { class: 'sp-bg' }, bgA, bgB);
  const body = h('div', { class: 'sp-body' });
  const soundBtn = h('button', { type: 'button', class: 'hero-sound sp-sound', hidden: true, tabindex: '-1', onclick: () => { soundOn = !soundOn; if (trailer) trailer.mute(!soundOn); paintSound(); } });
  const paintSound = () => { soundBtn.replaceChildren(icon(soundOn ? 'vol' : 'mute')); soundBtn.setAttribute('aria-label', soundOn ? 'Couper le son' : 'Activer le son'); };
  paintSound();
  const spot = h('section', { class: 'spotlight' }, bg, body, soundBtn);

  const fit = () => {
    if (!trailer) return;
    const w = spot.clientWidth, hh = spot.clientHeight;
    const W = Math.max(w, (hh * 16) / 9) * 1.18;
    Object.assign(trailer.el.style, { width: `${W}px`, height: `${(W * 9) / 16}px` });
  };
  const ro = new ResizeObserver(fit);
  ro.observe(spot);

  function stopTrailer() {
    clearTimeout(trailerTimer);
    if (trailer) { trailer.destroy(); trailer = null; }
    spot.classList.remove('trailer-on');
    soundBtn.hidden = true;
  }
  async function startTrailer(x) {
    stopTrailer();
    if (hoverMode() === 'off') return;
    trailerTimer = setTimeout(async () => {
      let key = x.trailer && x.trailer.key;
      if (!key && x.tmdbId) { try { key = ((await api(`/api/discover/trailer?type=${x.type}&tmdbId=${x.tmdbId}`)).trailer || {}).key; } catch { /* */ } }
      if (!key || current !== x || destroyed) return;
      const t = trailerPlayer(key, {
        mute: !soundOn && !prefs.get('hoverSound'), loop: true,
        onPlaying: () => { if (trailer === t) { spot.classList.add('trailer-on'); soundBtn.hidden = false; } },
        onError: () => { if (trailer === t) stopTrailer(); },
      });
      trailer = t; t.el.classList.add('hero-yt'); bg.append(t.el); fit();
    }, 1500);
  }

  function setBg(x) {
    const back = front === bgA ? bgB : bgA;
    const src = x.backdrop || x.poster;
    back.replaceChildren(src ? h('img', { src, alt: '', class: x.backdrop ? '' : 'blur', decoding: 'async' }) : h('div', { class: 'ph' }));
    const im = back.querySelector('img');
    const swap = () => { back.classList.add('on'); front.classList.remove('on'); front = back; };
    if (im && !im.complete) { im.addEventListener('load', swap, { once: true }); im.addEventListener('error', swap, { once: true }); } else swap();
  }

  const actions = h('div', { class: 'actions' });
  async function paintActions(x) {
    actions.replaceChildren();
    if (x.inLibrary) {
      actions.append(h('button', { class: 'btn btn-play f', onclick: () => go(`/titre/${x.inLibrary}`) }, icon('play'), 'Dans Venus : voir la fiche'));
      return;
    }
    if (!data.available.seerr) {
      if (state.profile.isAdmin) actions.append(h('button', { class: 'btn btn-ghost f', onclick: () => go('/reglages?section=seerr') }, icon('gear'), 'Relier Seerr pour demander ce titre'));
      return;
    }
    const st = h('span', { class: 'sp-state' }, h('span', { class: 'mini-spin' }), 'Vérification…');
    actions.append(st);
    const key = x.key;
    let s = statusCache.get(key);
    if (!s) {
      try { s = await api(`/api/discover/status?type=${x.type}&tmdbId=${x.tmdbId || ''}&anilistId=${x.anilistId || ''}&title=${encodeURIComponent(x.title)}&original=${encodeURIComponent(x.original || '')}`); }
      catch (e) { s = { state: 'error', error: e.message }; }
      statusCache.set(key, s);
    }
    if (current !== x) return;
    actions.replaceChildren();
    if (s.state === 'none' || s.state === 'unknown' || s.state === 'deleted') {
      if (s.state === 'unknown') { actions.append(h('span', { class: 'sp-state' }, 'Introuvable sur TMDB : Seerr ne peut pas le demander')); return; }
      if (state.profile.maxAge != null) { actions.append(h('span', { class: 'sp-state' }, 'Demandez à un adulte de l’ajouter')); return; }
      const btn = h('button', { class: 'btn btn-play f', onclick: async () => {
        btn.disabled = true; btn.textContent = 'Demande envoyée…';
        try {
          const r = await api('/api/discover/request', { method: 'POST', body: { type: x.type, tmdbId: x.tmdbId, anilistId: x.anilistId, title: x.title, original: x.original } });
          statusCache.set(key, r);
          toast(`« ${x.title} » est demandé : la recherche démarre`);
          if (current === x) paintActions(x);
        } catch (e) { toast(e.message, true); btn.disabled = false; btn.replaceChildren(icon('add'), 'Demander'); }
      } }, icon('add'), 'Demander');
      actions.append(btn);
      return;
    }
    if (s.state === 'error') { actions.append(h('span', { class: 'sp-state warn' }, `Seerr : ${s.error || 'injoignable'}`)); return; }
    const label = s.downloading && s.progress != null ? `Téléchargement ${s.progress} %` : STATE_LABEL[s.state] || 'Demandé';
    actions.append(...[h('span', { class: `sp-state st-${s.state}` }, icon(s.downloading ? 'down' : 'check'), label),
      s.downloading && s.progress != null ? h('div', { class: 'sp-progress' }, h('i', { style: { width: `${s.progress}%` } })) : null].filter(Boolean));
  }

  function show(x, { trailerToo = true } = {}) {
    if (current === x) return;
    current = x;
    setBg(x);
    const when = x.date ? (new Date(x.date) > new Date() ? `Sortie le ${fmtDate(x.date)}` : fmtDate(x.date)) : '';
    body.replaceChildren(...[
      h('div', { class: 'sp-kicker' }, x.inLibrary ? h('span', { class: 'sp-in' }, icon('check'), 'Dans Venus') : null, x.anime ? h('span', {}, 'Animé') : null, when ? h('span', {}, when) : null,
        x.next ? h('span', {}, `Épisode ${x.next.episode} le ${new Date(x.next.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`) : null),
      h('h1', { class: 'hero-title sp-title' }, x.title),
      x.original && x.original !== x.title ? h('p', { class: 'sp-orig' }, x.original) : null,
      x.score ? h('div', { class: 'ratings' }, h('span', { class: `rating r-${x.source === 'anilist' ? 'anilist' : 'tmdb'}` }, h('span', { class: 'r-src' }, x.source === 'anilist' ? 'AniList' : 'TMDB'),
        h('b', {}, x.source === 'anilist' ? `${x.score} %` : (x.score / 10).toFixed(1).replace('.', ',')), x.source === 'anilist' ? null : h('small', {}, '/10'))) : null,
      x.overview ? h('p', { class: 'hero-overview' }, x.overview) : null,
      actions].filter(Boolean));
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    paintActions(x);
    if (trailerToo) startTrailer(x); else stopTrailer();
  }

  // ------------------------------------------------------------ rangées d'affiches
  const posterCard = (x) => {
    const el = h('button', { class: 'card poster dcard f', 'aria-label': `${x.title}${x.inLibrary ? ', dans Venus' : ''}`, onclick: () => {
      if (current === x && x.inLibrary) return go(`/titre/${x.inLibrary}`);
      show(x); spot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } },
    h('div', { class: 'shot' }, x.poster ? h('img', { src: x.poster, alt: '', loading: 'lazy', decoding: 'async' }) : h('div', { class: 'ph' }, x.title),
      x.inLibrary ? h('span', { class: 'dc-in', title: 'Déjà dans Venus' }, icon('check')) : null,
      x.score ? h('span', { class: 'dc-score' }, x.source === 'anilist' ? `${x.score} %` : `★ ${(x.score / 10).toFixed(1).replace('.', ',')}`) : null),
    h('div', { class: 'cap' }, h('b', {}, x.title), h('small', {}, x.date ? (new Date(x.date) > new Date() ? `Le ${fmtDate(x.date, false)}` : x.date.slice(0, 4)) : '')));
    const hover = () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => show(x), 180); };
    el.addEventListener('mouseenter', () => { if (!document.documentElement.classList.contains('touch')) hover(); });
    el.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
    el.addEventListener('focus', hover);
    return el;
  };

  const sections = data.sections.filter((s) => s.items.length);
  const tabs = h('div', { class: 'chips new-tabs', role: 'tablist' }, KINDS.map(([k, label]) => h('button', {
    class: `chip f${k === kind ? ' on' : ''}`, role: 'tab', 'aria-selected': String(k === kind),
    onclick: () => { store.set('vn_new_kind', k); go(`/nouveautes?type=${k}`, { replace: true }); },
  }, label)));

  const missing = !data.available.tmdb && !data.available.seerr && kind !== 'anime';
  const rows = h('div', { class: 'rows new-rows' },
    sections.map((s) => h('section', { class: 'row' }, h('div', { class: 'row-head' }, h('h2', {}, s.title)),
      scrollArrows(h('div', { class: 'row-scroll' }, s.items.map(posterCard))))),
    !sections.length ? h('div', { class: 'empty' }, h('h2', {}, missing ? 'Nouveautés indisponibles' : 'Rien pour le moment'),
      h('p', {}, missing ? 'Ajoutez une clé TMDB (gratuite) ou reliez Seerr dans Réglages pour voir les films et séries qui sortent. Les animés fonctionnent sans clé.' : 'Les sites de référence ne répondent pas pour l’instant. Réessayez dans un moment.'),
      missing && state.profile.isAdmin ? h('button', { class: 'btn btn-play f', onclick: () => go('/reglages?section=sources') }, 'Ouvrir les réglages') : null) : null);

  main.classList.add('new-page');
  main.append(h('div', { class: 'new-head' }, h('h1', {}, 'Nouveautés'), tabs,
    data.available.seerr ? h('span', { class: 'auto-pill' }, h('span', { class: 'dot' }), 'Seerr relié : demandez un titre, il se télécharge tout seul') : null),
  sections.length ? spot : null, rows);
  if (sections.length) show(sections[0].items[0]);

  const onVis = () => { if (trailer) (document.hidden ? trailer.pause() : trailer.play()); };
  document.addEventListener('visibilitychange', onVis);
  return { destroy: () => { destroyed = true; clearTimeout(hoverTimer); stopTrailer(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); } };
}
