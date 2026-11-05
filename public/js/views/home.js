// Accueil : grande affiche + rangées. L'affiche suit la carte sélectionnée (télécommande ou souris).
import { api, heroTrailers, deviceCaps } from '../api.js';
import { trailerPlayer } from '../trailer.js';
import { h, icon, img, picture, placeholder, ageBadge, fmtRuntime, toast } from '../ui.js';
import { row, playPath, metaLine, frameImage } from '../components.js';
import { attachStream } from '../live.js';
import { go, state, currentPath, hasCat, openAll } from '../app.js';
import { tintFrom } from '../ambiance.js';
import { sections } from '../menu.js';

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
  // Bande-annonce de la diapositive : muette, avec un bouton pour le son (mémorisé le temps de la visite)
  let trailer = null, trailerTimer = null, trailerOn = false, soundOn = false;
  const soundBtn = h('button', { type: 'button', class: 'hero-sound', hidden: true, tabindex: '-1', onclick: () => { soundOn = !soundOn; if (trailer) trailer.mute(!soundOn); if (media) media.el.muted = !soundOn; paintSound(); } });
  const paintSound = () => { soundBtn.replaceChildren(icon(soundOn ? 'vol' : 'mute')); soundBtn.setAttribute('aria-label', soundOn ? 'Couper le son de la bande-annonce' : 'Activer le son de la bande-annonce'); };
  paintSound();
  const hero = h('section', { class: 'hero', style: { '--rotate': `${ROTATE_MS}ms` } }, bg, body, many ? arrow(-1) : null, many ? arrow(1) : null, soundBtn, many ? dots : null);
  const layers = new Map();
  let shown = null, heroIdx = 0, timer = null, keyboardInRows = false, hovering = false;

  // La bande-annonce couvre toute l'affiche (rognée comme une image en « cover »)
  const fit = () => {
    if (!trailer) return;
    const w = hero.clientWidth, hh = hero.clientHeight;
    const W = Math.max(w, (hh * 16) / 9) * 1.18;
    Object.assign(trailer.el.style, { width: `${W}px`, height: `${(W * 9) / 16}px` });
  };
  const ro = new ResizeObserver(fit);
  ro.observe(hero);
  // Média de la diapositive : bande-annonce YouTube, extrait de la vidéo, ou la vraie vidéo là où on s'était
  // arrêté (« Reprendre ») ou la chaîne en direct. Il se lance tout seul quand la diapositive est choisie,
  // et tout de suite quand la souris passe dessus ou que l'affiche a le focus.
  let media = null; // { item, kind, el, stop }
  const playable = (item) => heroTrailers() && (item.heroResume || item.type !== 'clip');
  function stopTrailer() {
    clearTimeout(trailerTimer);
    if (trailer) { trailer.destroy(); trailer = null; }
    if (media) { media.stop(); media = null; }
    trailerOn = false;
    hero.classList.remove('trailer-on');
    soundBtn.hidden = true;
  }
  const mediaOn = (forItem) => { if (shown !== forItem) return; trailerOn = true; hero.classList.add('trailer-on'); soundBtn.hidden = false; restart(); };
  // Vraie vidéo (petite qualité) : reprise d'un film / épisode, ou chaîne de TV
  async function startVideo(item) {
    const v = h('video', { class: 'hero-vid', muted: true, playsinline: true, 'aria-hidden': 'true' });
    v.muted = !soundOn;
    let session = null, detach = null, gone = false;
    const m = { item, kind: 'video', el: v, stop: () => {
      gone = true;
      if (detach) detach();
      v.remove();
      if (session) fetch(`/api/hls/${session}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    } };
    media = m;
    try {
      const info = await api(`/api/play/${item.id}`, { method: 'POST', body: { caps: deviceCaps(), preview: true, start: 'resume' } });
      session = info.sessionId;
      if (gone) { m.stop(); return; }
      v.addEventListener('playing', () => { if (media === m) mediaOn(item); });
      v.addEventListener('ended', () => { if (media === m) { stopTrailer(); if (many) { goTo(heroIdx + 1); restart(); } } });
      if (info.mode === 'direct' && info.startAt) v.addEventListener('loadedmetadata', () => { try { v.currentTime = info.startAt; } catch { /* */ } }, { once: true });
      bg.append(v);
      detach = await attachStream(v, info.url, { live: !!info.live, onError: () => { if (media === m) stopTrailer(); } });
      if (gone && detach) detach();
    } catch { if (media === m) { media = null; } }
  }
  // Extrait de la vidéo, quand il n'y a pas de bande-annonce (ou que YouTube ne répond pas)
  function startClip(item) {
    const v = h('video', { class: 'hero-vid', muted: true, loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true' });
    v.muted = !soundOn;
    v.src = window.__VN_PREVIEW ? window.__VN_PREVIEW(item.id) : `/api/items/${item.id}/preview`;
    const m = { item, kind: 'clip', el: v, stop: () => { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } };
    media = m;
    v.addEventListener('playing', () => { if (media === m) mediaOn(item); });
    v.addEventListener('error', () => { if (media === m) { media = null; v.remove(); } }, { once: true });
    bg.append(v);
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  }
  function launch(item) {
    if (shown !== item || document.hidden || media || trailer) return;
    if (item.heroResume) return startVideo(item);
    if (!item.trailer) return startClip(item);
    const t = trailerPlayer(item.trailer, {
      mute: !soundOn,
      onPlaying: () => { if (trailer !== t) return; mediaOn(item); },
      // Fin de la bande-annonce : on passe au titre suivant, qui lance la sienne
      onEnd: () => { if (trailer !== t) return; stopTrailer(); if (many) { goTo(heroIdx + 1); restart(); } },
      onError: () => { if (trailer !== t) return; trailer.destroy(); trailer = null; startClip(item); },
    });
    trailer = t;
    t.el.classList.add('hero-yt');
    bg.append(t.el);
    fit();
    // YouTube injoignable : extrait de la vidéo à la place
    setTimeout(() => { if (trailer === t && !t.el.classList.contains('on') && shown === item) { t.destroy(); trailer = null; startClip(item); } }, 6000);
  }
  function startTrailer(item, delay = 1200) {
    stopTrailer();
    if (!playable(item)) return;
    trailerTimer = setTimeout(() => launch(item), delay);
  }
  // Souris sur l'affiche ou focus (télécommande, clavier) : la vidéo démarre sans attendre
  const playNow = () => { if (shown && playable(shown) && !media && !trailer) { clearTimeout(trailerTimer); launch(shown); } };

  function setBackground(item) {
    const key = item.backdrop ? item.backdrop : `th:${item.id}`;
    let layer = layers.get(key);
    if (!layer) {
      layer = item.backdrop ? picture(img(item.backdrop), item.title, { lazy: false })
        : item.type === 'channel' ? h('img', { src: `/api/channels/${item.id}/preview.jpg`, alt: '', class: 'ch-snap' })
          : frameImage(item.id, item.title, { fade: false });
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
    startTrailer(item);
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
    if (item.heroResume) { paintResume(item, hadFocus); return; }
    const playBtn = h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => playItem(item) }, icon('play'), 'Lecture');
    body.classList.remove('resume');
    body.replaceChildren(...[
      item.logo ? h('img', { class: 'hero-logo', src: img(item.logo), alt: item.title }) : h('h1', { class: 'hero-title' }, item.title),
      h('div', { class: 'meta' }, meta),
      item.overview ? h('p', { class: 'hero-overview' }, item.overview) : null,
      h('div', { class: 'actions' }, playBtn,
        h('button', { class: 'btn btn-ghost f', 'aria-label': 'Plus d’infos', onclick: () => go(`/titre/${item.id}`) }, icon('info'), h('span', { class: 'lbl' }, 'Plus d’infos'))),
    ].filter(Boolean));
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    if (hadFocus) playBtn.focus({ preventScroll: true }); // la télécommande ne perd pas sa place
  }

  // Tête d'affiche « Reprendre » : le dernier épisode, film ou chaîne regardé
  function paintResume(item, hadFocus) {
    const isEp = item.type === 'episode', live = item.type === 'channel';
    const p = item.progress;
    const pct = p && p.duration && !p.watched ? Math.min(100, (p.position / p.duration) * 100) : 0;
    const left = p && p.duration && !p.watched ? Math.max(1, Math.round((p.duration - p.position) / 60)) : 0;
    const title = isEp ? item.showTitle || item.title : item.title;
    const playBtn = h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => go(playPath(item.id, item.next ? 0 : undefined)) },
      icon('play'), live ? 'Regarder' : item.next ? `Lire S${item.season} É${item.episode}` : pct ? 'Reprendre' : 'Lecture');
    const ghost = (ic, label, to) => h('button', { class: 'btn btn-ghost f', 'aria-label': label, onclick: () => go(to) }, icon(ic), h('span', { class: 'lbl' }, label));
    const info = live ? ghost('tv', 'Toutes les chaînes', '/tv')
      : isEp ? ghost('info', 'Voir l’épisode', `/titre/${item.showId}?ep=${item.id}`)
        : ghost('info', 'Plus d’infos', `/titre/${item.id}`);
    body.classList.add('resume');
    body.replaceChildren(...[
      h('div', { class: 'hero-kicker' }, live ? h('span', { class: 'live-dot' }, 'Direct') : icon('restart'), live ? 'Votre dernière chaîne' : item.next ? 'À suivre' : 'Reprendre là où vous en étiez'),
      item.logo && !live ? h('img', { class: 'hero-logo', src: img(item.logo), alt: title }) : h('h1', { class: 'hero-title' }, title),
      isEp ? h('a', { class: 'hero-ep f', href: `/titre/${item.showId}?ep=${item.id}`, onclick: (e) => { e.preventDefault(); go(`/titre/${item.showId}?ep=${item.id}`); } }, `S${item.season}:É${item.episode} - ${item.title}`) : null,
      pct ? h('div', { class: 'hero-progress' }, h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })), h('span', {}, `${left} min restantes`)) : null,
      item.overview && !live ? h('p', { class: 'hero-overview' }, item.overview) : null,
      h('div', { class: 'actions' }, playBtn, info),
    ].filter(Boolean));
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    if (hadFocus) playBtn.focus({ preventScroll: true });
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
    // Pendant une bande-annonce, on attend sa fin (au plus 3 minutes)
    timer = setTimeout(() => { goTo(heroIdx + 1); restart(); }, trailerOn ? 180000 : ROTATE_MS);
  }

  // À la télécommande, la carte sélectionnée éclaire l'affiche (comme un projecteur qui suit le regard)
  const onFocus = (item) => {
    if (item.type === 'episode' || !document.documentElement.classList.contains('keys')) return;
    keyboardInRows = true; stopTrailer(); restart();
    setBackground(item);
    tintFrom(img(item.backdrop || item.poster || item.still));
  };

  const rows = h('div', { class: 'rows' }, data.rows.map((r) => row(r, { onFocus })));
  rows.addEventListener('focusout', (e) => { if (!rows.contains(e.relatedTarget)) { keyboardInRows = false; restart(); } });
  hero.addEventListener('focusin', () => { if (shown) setBackground(shown); playNow(); });
  hero.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hovering = true; restart(); playNow(); } });
  hero.addEventListener('pointerleave', () => { hovering = false; restart(); });
  const onVis = () => { if (trailer) (document.hidden ? trailer.pause() : trailer.play()); if (media) (document.hidden ? media.el.pause() : media.el.play().catch(() => {})); restart(); };
  document.addEventListener('visibilitychange', onVis);

  main.classList.add('home');
  main.append(hero, sectionStrip(), elsewhereNote(), data.noPosters ? noPostersNote() : null, rows);
  todayRow().then((el) => { if (el && rows.isConnected) rows.prepend(el); }).catch(() => {});
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

  return { destroy: () => { clearTimeout(timer); stopTrailer(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); } };
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

// Tuiles des sections : tout Venus à portée de main (Films, Séries, Animés, TV, Clips, Musique, Photos, Livres…)
function sectionStrip() {
  // Quatre tuiles seulement : ce qui n'est pas déjà dans le menu (Ce soir, Nouveautés, Ma liste), puis « Tout »
  const all = sections(state.profile, hasCat, state.categories || {});
  const pref = ['today', 'new', 'mylist', 'collections', 'tv', 'clips'];
  const list = pref.map((id) => all.find((x) => x.id === id)).filter(Boolean).slice(0, 3);
  return h('nav', { class: 'home-sections', 'aria-label': 'Sections' },
    h('div', { class: 'hs-track' },
      list.map((it) => h('a', { class: `hs-tile f hs-${it.id}`, href: it.href },
        h('span', { class: 'hs-ic' }, icon(it.icon)),
        h('span', { class: 'hs-txt' }, h('b', {}, it.label), it.sub ? h('small', {}, it.sub) : null))),
      h('button', { class: 'hs-tile hs-all f', onclick: () => openAll() }, h('span', { class: 'hs-ic' }, icon('apps')), h('span', { class: 'hs-txt' }, h('b', {}, 'Tout'), h('small', {}, 'Toutes les sections')))));
}

// Pas de clé TMDB : les affiches, résumés et notes manquent ; l'administrateur est invité à l'ajouter (une minute)
function noPostersNote() {
  const btn = h('button', { class: 'btn btn-small f', onclick: async () => {
    btn.disabled = true;
    try { await api('/api/admin/tasks/posters/run', { method: 'POST' }); toast('Recherche des affiches lancée : elles apparaîtront d’ici quelques minutes'); } catch (e) { toast(e.message, true); btn.disabled = false; }
  } }, 'Chercher les affiches');
  return h('div', { class: 'home-note' }, icon('image'),
    h('div', {}, h('b', {}, 'Vos films n’ont pas encore d’affiches'), h('p', {}, 'Venus les cherche tout seul sur des services gratuits. Pour les résumés complets, les notes et les bandes-annonces, ajoutez une clé TMDB (gratuite).')),
    h('div', { class: 'actions' }, btn, h('button', { class: 'btn btn-small btn-play f', onclick: () => go('/reglages?section=sources') }, 'Ajouter la clé')));
}

// « Vous regardiez X sur la télé il y a 2 min » : reprise au même endroit sur cet appareil
function elsewhereNote() {
  const e = state.status && state.status.elsewhere;
  if (!e || e.duration < 60) return null;
  const ago = e.ago < 90000 ? 'à l’instant' : `il y a ${Math.round(e.ago / 60000)} min`;
  const at = `${Math.floor(e.position / 60)} min`;
  return h('div', { class: 'home-note elsewhere' }, icon('tv'),
    h('div', {}, h('b', {}, `Vous regardiez « ${e.title} »${e.sub ? ` (${e.sub})` : ''} sur ${e.device}`), h('p', {}, `${e.paused ? 'En pause' : 'En cours'} ${ago}, à ${at}.`)),
    h('div', { class: 'actions' }, h('button', { class: 'btn btn-small btn-play f', onclick: () => go(playPath(e.itemId)) }, icon('play'), 'Continuer ici')));
}
// « Un jour comme aujourd'hui » : films sortis à la même date, les autres années
async function todayRow() {
  const list = await api('/api/today');
  if (!list.length) return null;
  const d = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return row({ id: 'today', title: `Sortis un ${d}`, hint: list.map((x) => `${x.title} : il y a ${x.yearsAgo} an${x.yearsAgo > 1 ? 's' : ''}`).slice(0, 3).join(' · '), items: list });
}
