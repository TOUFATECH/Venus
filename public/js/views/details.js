// Fiche d'un film, d'une série, d'un animé ou d'un clip
// Bande-annonce en fond (son et vidéo désactivables), distribution et équipe, fiche technique, épisodes.
import { api, prefs, detailsTrailers } from '../api.js';
import { h, icon, img, picture, placeholder, ageBadge, fmtRuntime, langName, toast, sheet, fmtDate, daysSince, hueOf } from '../ui.js';
import { row, card, playPath, metaLine, frameImage, framePoster, ratingChips, scrollArrows } from '../components.js';
import { trailerUrl, trailerPlayer } from '../trailer.js';
import { go, state, setTitle } from '../app.js';
import { focusEl } from '../nav.js';
import { tintFrom } from '../ambiance.js';

const LIB = { movie: '/films', show: '/series', anime: '/animes', clip: '/clips' };
const libOf = (d) => LIB[d.category] || LIB[d.type] || '/films';
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtSize = (b) => (!b ? '' : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.round(b / 1e6)} Mo`);
const fmtRate = (b) => (!b ? '' : b >= 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} Mb/s` : `${Math.round(b / 1e3)} kb/s`);
const chLabel = (n) => (n >= 8 ? '7.1' : n >= 6 ? '5.1' : n === 2 ? 'Stéréo' : n === 1 ? 'Mono' : `${n} canaux`);
const STATUS = { 'Returning Series': 'En cours de diffusion', Ended: 'Terminée', Canceled: 'Annulée', 'In Production': 'En production', Planned: 'Prévue', Released: 'Sorti', 'Post Production': 'En post-production' };
let regionNames = null;
const country = (c) => { try { regionNames = regionNames || new Intl.DisplayNames(['fr'], { type: 'region' }); return regionNames.of(c); } catch { return c; } };

export async function render(main, { id, query }) {
  const d = await api(`/api/items/${id}`);
  const isShow = d.type === 'show';
  const isClip = d.type === 'clip';
  const cr = d.credits || {};
  tintFrom(img(d.backdrop || d.poster));
  setTitle(d.title);
  const cleanups = [];

  const bg = h('div', { class: 'details-bg' }, d.backdrop ? picture(img(d.backdrop), d.title, { lazy: false }) : frameImage(d.id, d.title, { fade: false }));
  const posterEl = h('div', { class: `details-poster${isClip ? ' wide' : ''}` }, d.poster && !isClip ? picture(img(d.poster), d.title, { lazy: false }) : isClip ? frameImage(d.id, d.title, { fade: false }) : framePoster(d));
  const root = h('div', { class: 'details' });

  // ---------------------------------------------------------------- bouton principal : Lecture / Reprendre / Épisode suivant
  const actions = h('div', { class: 'actions' });
  const showDone = isShow && d.seasons.length && d.seasons.every((s) => s.episodes.every((e) => e.progress && e.progress.watched));
  const firstEp = isShow && d.seasons.length ? (d.seasons.find((s) => s.number > 0) || d.seasons[0]).episodes[0] : null;
  const target = isShow ? (showDone ? firstEp : d.nextUp) : d;
  const prog = target && target.progress;
  const resumable = prog && !prog.watched && prog.position > 20;
  const remaining = resumable && prog.duration ? Math.round((prog.duration - prog.position) / 60) : 0;
  let label = 'Lecture';
  if (isShow && target) label = showDone ? 'Revoir depuis le début' : `${resumable ? 'Reprendre' : 'Lecture'} S${target.season} É${target.episode}`;
  else if (resumable) label = `Reprendre (${remaining} min restantes)`;
  if (target) {
    actions.append(h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => go(playPath(target.id)) }, icon('play'), label));
    if (resumable) actions.append(h('button', { class: 'btn btn-ghost btn-icon f', 'aria-label': 'Recommencer depuis le début', title: 'Recommencer', onclick: () => go(playPath(target.id, 0)) }, icon('restart')));
  }
  let bt = null;
  if (d.trailer) actions.append(h('button', { class: 'btn btn-ghost f', onclick: () => openTrailer(d, bt) }, icon('film'), 'Bande-annonce'));
  const listBtn = h('button', { class: 'btn btn-ghost btn-icon f', 'aria-label': d.inList ? 'Retirer de ma liste' : 'Ajouter à ma liste', title: 'Ma liste' }, icon(d.inList ? 'check' : 'plus'));
  listBtn.onclick = async () => {
    const r = await api(`/api/items/${d.id}/mylist`, { method: 'POST' });
    listBtn.replaceChildren(icon(r.inList ? 'check' : 'plus'));
    listBtn.setAttribute('aria-label', r.inList ? 'Retirer de ma liste' : 'Ajouter à ma liste');
    toast(r.inList ? (r.follows ? 'Ajouté à ma liste : chaque nouvelle saison sera demandée à Seerr' : 'Ajouté à ma liste') : 'Retiré de ma liste',
      { type: r.inList ? 'success' : 'info', action: { label: 'Annuler', onClick: () => listBtn.click() } });
  };
  actions.append(listBtn);
  const allWatched = isShow ? d.seasons.every((s) => s.episodes.every((e) => e.progress && e.progress.watched)) : prog && prog.watched;
  actions.append(h('button', { class: `btn btn-ghost btn-icon f${allWatched ? ' is-on' : ''}`, 'aria-label': allWatched ? 'Marquer comme non vu' : 'Marquer comme vu', title: allWatched ? 'Vu : marquer comme non vu' : 'Marquer comme vu', 'aria-pressed': String(!!allWatched), onclick: async () => {
    const set = async (w) => { await api(`/api/items/${d.id}/watched`, { method: 'POST', body: { watched: w } }); window.dispatchEvent(new HashChangeEvent('hashchange')); };
    await set(!allWatched);
    const what = isShow ? (d.seasons.length > 1 ? `Les ${d.seasons.length} saisons` : 'Toute la série') : d.title;
    toast(allWatched ? `${what} : marqué comme non vu` : `${what} : marqué comme vu`, { type: 'success', action: { label: 'Annuler', onClick: () => set(allWatched) } });
  } }, icon('eye')));
  if (state.profile.isAdmin && !isClip) actions.append(h('button', { class: 'btn btn-ghost btn-icon f', 'aria-label': 'Corriger l’identification', title: 'Corriger l’identification', onclick: () => fixMatch(d) }, icon('gear')));

  // ---------------------------------------------------------------- ligne d'infos : année, âge, durée, heure de fin
  const nbEps = isShow ? d.seasons.reduce((n, s) => n + s.episodes.length, 0) : 0;
  const endsAt = h('span', { class: 'ends-at' });
  const paintEnd = () => {
    const t = target;
    if (!t) { endsAt.hidden = true; return; }
    const total = t.duration || (t.runtime ? t.runtime * 60 : 0);
    if (!total) { endsAt.hidden = true; return; }
    const pos = t.progress && !t.progress.watched ? t.progress.position || 0 : 0;
    endsAt.textContent = `Se termine à ${hhmm(Date.now() + (total - pos) * 1000)}`;
  };
  paintEnd();
  const endTimer = setInterval(paintEnd, 30000);
  cleanups.push(() => clearInterval(endTimer));
  const meta = metaLine(d, [
    ageBadge(d),
    !isShow && d.runtime ? h('span', {}, fmtRuntime(d.runtime)) : null,
    isShow ? h('span', {}, `${d.seasons.length} saison${d.seasons.length > 1 ? 's' : ''}, ${nbEps} épisode${nbEps > 1 ? 's' : ''}`) : null,
    target && !(isShow && !d.nextUp) ? endsAt : null,
  ].filter(Boolean));

  const overview = d.overview ? h('p', { class: 'hero-overview clamp' }, d.overview) : null;
  const more = overview ? h('button', { class: 'linkish f', hidden: true, onclick: () => { const open = overview.classList.toggle('clamp'); more.textContent = open ? 'Lire la suite' : 'Réduire'; } }, 'Lire la suite') : null;
  if (overview) requestAnimationFrame(() => { more.hidden = overview.scrollHeight <= overview.clientHeight + 2; });

  const genreChips = d.genres && d.genres.length ? h('div', { class: 'genre-links' }, d.genres.map((g) => h('button', { class: 'tag f', onclick: () => go(`${libOf(d)}?genre=${encodeURIComponent(g)}`) }, g))) : null;

  const mainInfo = h('div', { class: 'details-main' },
    d.logo ? h('img', { class: 'hero-logo', src: img(d.logo), alt: d.title }) : h('h1', { class: 'hero-title' }, d.title),
    h('div', { class: 'meta' }, meta),
    genreChips,
    ratingChips(d.ratings, d.links),
    d.tagline ? h('p', { class: 'tagline' }, d.tagline) : null,
    overview, more,
    actions);

  const content = h('div', { class: 'details-body' }, h('div', { class: 'details-top' }, posterEl, mainInfo));

  // ---------------------------------------------------------------- épisodes
  if (isShow && d.seasons.length) {
    // Saisons : sélecteur avec la progression de chacune, actions par saison, « Saison suivante », vu / non vu par épisode
    const epList = h('div', { class: 'episodes' });
    const seasonBar = h('div', { class: 'season-bar', role: 'tablist', 'aria-label': 'Saisons' });
    const seasonHead = h('div', { class: 'season-head' });
    const wantEp = Number(query && query.get('ep')) || null;
    const memoKey = `vn_season_${d.id}`;
    let current = null;
    let epFilter = 'all';
    const isSeen = (e) => !!(e.progress && e.progress.watched);
    const seasonName = (s) => s.title || (s.number === 0 ? 'Bonus' : `Saison ${s.number}`);
    const dur = (s) => s.episodes.reduce((n, e) => n + (e.runtime ? e.runtime * 60 : e.duration || 0), 0);

    const paintBar = () => {
      seasonBar.replaceChildren(...d.seasons.map((s) => {
        const seen = s.episodes.filter(isSeen).length, total = s.episodes.length;
        const on = s === current;
        const b = h('button', { class: `season-card f${on ? ' on' : ''}${seen === total && total ? ' done' : ''}`, role: 'tab', 'aria-selected': String(on), 'data-id': s.id, onclick: () => showSeason(s) },
          h('b', {}, seasonName(s)),
          h('span', {}, seen === total && total ? 'Vue en entier' : seen ? `${seen} / ${total} vus` : `${total} épisode${total > 1 ? 's' : ''}`),
          h('i', { class: 'season-prog' }, h('i', { style: { width: `${total ? (seen / total) * 100 : 0}%` } })));
        return b;
      }));
      requestAnimationFrame(() => seasonBar.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
    };
    const paintHead = () => {
      const s = current;
      const seen = s.episodes.filter(isSeen).length, total = s.episodes.length, all = seen === total && total > 0;
      const next = s.episodes.find((e) => !isSeen(e)) || s.episodes[0];
      const mins = Math.round(dur(s) / 60);
      seasonHead.replaceChildren(
        h('div', { class: 'sh-info' }, h('b', {}, seasonName(s)),
          h('span', {}, [`${total} épisode${total > 1 ? 's' : ''}`, mins ? fmtRuntime(mins) : null, seen && !all ? `${total - seen} à voir` : null].filter(Boolean).join(' · '))),
        h('div', { class: 'sh-actions' },
          next ? h('button', { class: 'btn btn-small f', onclick: () => go(playPath(next.id)) }, icon('play'), all ? 'Revoir la saison' : seen ? `Continuer É${next.episode}` : 'Lire la saison') : null,
          h('button', { class: `btn btn-small btn-ghost f${all ? ' is-on' : ''}`, onclick: () => markSeason(s, !all) }, icon('eye'), all ? 'Saison vue' : 'Marquer la saison vue')));
    };
    const showSeason = (s, focusId = null) => {
      current = s;
      try { sessionStorage.setItem(memoKey, String(s.id)); } catch { /* */ }
      paintBar(); paintHead();
      const list = s.episodes.filter((e) => epFilter === 'all' || (epFilter === 'unseen' ? !isSeen(e) : isSeen(e)));
      epList.replaceChildren(...list.map((e) => episodeRow(e, e.id === focusId, (w) => markEpisode(e, w))));
      if (!list.length) epList.replaceChildren(h('p', { class: 'grid-empty' }, epFilter === 'unseen' ? 'Tous les épisodes de cette saison sont vus.' : 'Aucun épisode vu dans cette saison.'));
      // Fin de saison : on enchaîne sur la suivante
      const idx = d.seasons.indexOf(s);
      const nextS = d.seasons[idx + 1];
      if (nextS) epList.append(h('button', { class: 'next-season f', onclick: () => { showSeason(nextS); seasonBar.scrollIntoView({ block: 'start', behavior: 'smooth' }); } },
        h('span', {}, h('small', {}, 'Ensuite'), h('b', {}, seasonName(nextS)), h('em', {}, `${nextS.episodes.length} épisodes`)), icon('fwd')));
      if (focusId) {
        const el = epList.querySelector('.episode.is-current');
        if (el) setTimeout(() => { el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); focusEl(el); }, 350);
      }
    };
    const setLocal = (eps, w) => { for (const e of eps) e.progress = w ? { ...(e.progress || {}), position: 0, watched: true } : undefined; };
    async function markEpisode(e, w) {
      const before = e.progress;
      setLocal([e], w); showSeason(current);
      try { await api(`/api/items/${e.id}/watched`, { method: 'POST', body: { watched: w } }); }
      catch (err) { e.progress = before; showSeason(current); toast(err.message, true); return; }
      toast(`É${e.episode} « ${e.title} » ${w ? 'vu' : 'non vu'}`, { type: 'success', action: { label: 'Annuler', onClick: () => markEpisode(e, !w) } });
    }
    async function markSeason(s, w) {
      const before = s.episodes.map((e) => e.progress);
      setLocal(s.episodes, w); showSeason(s);
      try { await api(`/api/items/${s.id}/watched`, { method: 'POST', body: { watched: w } }); }
      catch (err) { s.episodes.forEach((e, i) => { e.progress = before[i]; }); showSeason(s); toast(err.message, true); return; }
      const nextS = d.seasons[d.seasons.indexOf(s) + 1];
      toast(`${seasonName(s)} ${w ? 'vue en entier' : 'marquée non vue'}`, { type: 'success',
        action: w && nextS ? { label: `${seasonName(nextS)} →`, onClick: () => showSeason(nextS) } : { label: 'Annuler', onClick: () => { s.episodes.forEach((e, i) => { e.progress = before[i]; }); markSeasonRaw(s, before); } } });
    }
    async function markSeasonRaw(s, before) {
      showSeason(s);
      for (const [i, e] of s.episodes.entries()) await api(`/api/items/${e.id}/watched`, { method: 'POST', body: { watched: !!(before[i] && before[i].watched) } }).catch(() => {});
    }
    const epChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer les épisodes' },
      [['all', 'Tous'], ['unseen', 'Non vus'], ['seen', 'Déjà vus']].map(([fid, lbl]) => {
        const b = h('button', { class: `chip small f${fid === epFilter ? ' on' : ''}`, onclick: () => {
          epFilter = fid; [...epChips.children].forEach((c) => c.classList.toggle('on', c === b)); showSeason(current);
        } }, lbl);
        return b;
      }));
    let remembered = null;
    try { remembered = d.seasons.find((s) => String(s.id) === sessionStorage.getItem(memoKey)); } catch { /* */ }
    const fromPlayer = wantEp && d.seasons.find((s) => s.episodes.some((e) => e.id === wantEp));
    const startSeason = fromPlayer || remembered || d.seasons.find((s) => d.nextUp && s.episodes.some((e) => e.id === d.nextUp.id)) || d.seasons[0];
    content.append(h('section', { class: 'd-section', id: 'episodes' },
      h('div', { class: 'ep-head' }, h('h2', { class: 'section-title' }, d.seasons.length > 1 ? `${d.seasons.length} saisons` : 'Épisodes'), epChips),
      d.seasons.length > 1 ? seasonBar : null, seasonHead, epList));
    showSeason(startSeason, fromPlayer ? wantEp : null);
  }

  // ---------------------------------------------------------------- distribution et équipe
  const people = [
    ...(cr.directors || []).map((p) => ({ ...p, role: 'Réalisation' })),
    ...(cr.creators || []).map((p) => ({ ...p, role: 'Création' })),
    ...(cr.cast || []),
    ...(cr.writers || []).map((p) => ({ ...p, role: 'Scénario' })),
    ...(cr.composers || []).map((p) => ({ ...p, role: 'Musique' })),
  ];
  if (people.length) {
    const scroller = h('div', { class: 'cast-row' }, people.map((p) => personCard(p)));
    content.append(h('section', { class: 'd-section cast' }, h('h2', { class: 'section-title' }, 'Distribution et équipe'), scrollArrows(scroller)));
  }

  // ---------------------------------------------------------------- à propos : équipe, studios, fiche technique
  const pairs = [];
  const names = (list) => (list || []).map((p) => p.name).join(', ');
  if (cr.directors && cr.directors.length) pairs.push(['Réalisation', names(cr.directors)]);
  if (cr.creators && cr.creators.length) pairs.push(['Création', names(cr.creators)]);
  if (cr.writers && cr.writers.length) pairs.push(['Scénario', names(cr.writers)]);
  if (cr.composers && cr.composers.length) pairs.push(['Musique', names(cr.composers)]);
  if (cr.studios && cr.studios.length) pairs.push(['Studios', cr.studios.join(', ')]);
  if (cr.networks && cr.networks.length) pairs.push(['Diffusion', cr.networks.join(', ')]);
  if (cr.countries && cr.countries.length) pairs.push(['Pays', cr.countries.map(country).join(', ')]);
  if (d.released && d.released.length === 10) pairs.push([isShow ? 'Première diffusion' : 'Sortie', fmtDate(d.released)]);
  if (cr.status && isShow) pairs.push(['Statut', STATUS[cr.status] || cr.status]);
  if (cr.nextEpisode && cr.nextEpisode.date) pairs.push(['Prochain épisode', `S${cr.nextEpisode.season} É${cr.nextEpisode.episode}, ${fmtDate(cr.nextEpisode.date)}`]);
  if (d.originalTitle && d.originalTitle !== d.title) pairs.push(['Titre original', d.originalTitle]);
  if (isShow && d.totalDuration) pairs.push(['Durée totale', fmtRuntime(Math.round(d.totalDuration / 60))]);
  if (cr.budget) pairs.push(['Budget', `${Math.round(cr.budget / 1e6)} M$`]);

  const m = d.media;
  const tech = [];
  if (m) {
    const v = m.video || {};
    tech.push(['Vidéo', [m.resolution, v.codec, v.hdr || m.hdr, v.bits && v.bits > 8 ? `${v.bits} bits` : null, v.fps ? `${String(v.fps).replace('.', ',')} i/s` : null].filter(Boolean).join(' · ')]);
    const tracks = m.tracks || (m.audio || []).map((l) => ({ lang: l }));
    if (tracks.length) tech.push(['Audio', h('ul', { class: 'track-list' }, tracks.map((a) => h('li', {}, [langName(a.lang), a.codec, a.channels ? chLabel(a.channels) : null, /atmos/i.test(`${a.title} ${a.profile}`) ? 'Atmos' : null].filter(Boolean).join(' · '), a.isDefault && tracks.length > 1 ? h('em', {}, ' par défaut') : null)))]);
    const subs = m.subtitles || (m.subs || []).map((l) => ({ lang: l }));
    if (subs.length) tech.push(['Sous-titres', h('ul', { class: 'track-list' }, subs.map((x) => h('li', {}, [langName(x.lang), x.forced ? 'forcés' : null, x.codec, x.external ? 'fichier à part' : null].filter(Boolean).join(' · '))))]);
    if (d.file && d.file.name) tech.push(['Fichier', [d.file.name, fmtSize(d.file.size), (d.file.container || '').toUpperCase(), fmtRate(m.bitrate)].filter(Boolean).join(' · ')]);
  }
  const dl = (list) => h('dl', { class: 'info-list' }, list.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  if (pairs.length || tech.length || (cr.tags && cr.tags.length)) {
    content.append(h('section', { class: 'd-section about' },
      h('h2', { class: 'section-title' }, 'À propos'),
      h('div', { class: 'about-grid' },
        pairs.length ? h('div', { class: 'about-card' }, dl(pairs)) : null,
        tech.length ? h('div', { class: 'about-card' }, h('h3', {}, isShow ? 'Fiche technique (premier épisode)' : 'Fiche technique'), dl(tech)) : null),
      cr.tags && cr.tags.length ? h('div', { class: 'tag-cloud' }, h('span', { class: 'tag-cloud-label' }, 'Étiquettes'), cr.tags.map((t) => h('span', { class: 'tag ghost' }, t))) : null));
  }

  if (d.similar && d.similar.length) {
    content.append(h('div', { class: 'd-similar' }, row({ title: isClip ? 'Autres clips' : 'Plus de ce genre', items: d.similar })));
  }

  // ---------------------------------------------------------------- bande-annonce en fond
  bt = backdropTrailer(d, bg, root);
  cleanups.push(bt.destroy);
  root.append(bg, bt.ctrl, content);
  main.append(root);
  return { destroy: () => cleanups.forEach((f) => f()) };
}

// Bande-annonce jouée derrière la fiche, avec deux boutons : son, et vidéo (activer / désactiver)
function backdropTrailer(d, bg, root) {
  if (!d.trailer) return { ctrl: null, destroy() {}, hold() {}, release() {} };
  let t = null, timer = null, soundOn = !!prefs.get('detailsSound'), videoOn = detailsTrailers(), visible = true, ended = false;
  const soundBtn = h('button', { type: 'button', class: 'bg-btn f' });
  const videoBtn = h('button', { type: 'button', class: 'bg-btn f' });
  const replayBtn = h('button', { type: 'button', class: 'bg-btn f', 'aria-label': 'Revoir la bande-annonce en fond', title: 'Revoir la bande-annonce', hidden: true }, icon('restart'));
  const ctrl = h('div', { class: 'bg-ctrl' }, replayBtn, soundBtn, videoBtn);
  const paint = () => {
    soundBtn.replaceChildren(icon(soundOn ? 'vol' : 'mute'));
    soundBtn.setAttribute('aria-label', soundOn ? 'Couper le son de la bande-annonce' : 'Activer le son de la bande-annonce');
    soundBtn.title = soundOn ? 'Couper le son' : 'Activer le son';
    soundBtn.hidden = !videoOn || ended;
    videoBtn.replaceChildren(icon('film'));
    videoBtn.classList.toggle('off', !videoOn);
    videoBtn.setAttribute('aria-pressed', String(videoOn));
    videoBtn.setAttribute('aria-label', videoOn ? 'Désactiver la bande-annonce en fond' : 'Activer la bande-annonce en fond');
    videoBtn.title = videoOn ? 'Désactiver la vidéo en fond' : 'Activer la vidéo en fond';
    replayBtn.hidden = !videoOn || !ended;
  };
  const fit = () => {
    if (!t) return;
    const w = bg.clientWidth, hh = bg.clientHeight;
    const W = Math.max(w, (hh * 16) / 9) * 1.18;
    Object.assign(t.el.style, { width: `${W}px`, height: `${(W * 9) / 16}px` });
  };
  const stop = () => {
    clearTimeout(timer);
    if (t) { t.destroy(); t = null; }
    root.classList.remove('trailer-on');
  };
  const start = (delay = 1400) => {
    stop(); ended = false; paint();
    if (!videoOn) return;
    timer = setTimeout(() => {
      if (document.hidden) return;
      const x = trailerPlayer(d.trailer, {
        mute: !soundOn,
        onPlaying: () => { if (t !== x) return; root.classList.add('trailer-on'); if (soundOn) x.mute(false); if (!visible) x.pause(); },
        onEnd: () => { if (t !== x) return; ended = true; stop(); paint(); },
        onError: () => { if (t === x) { stop(); ended = true; paint(); } },
      });
      t = x;
      x.el.classList.add('details-yt');
      bg.append(x.el);
      fit();
    }, delay);
  };
  soundBtn.onclick = () => { soundOn = !soundOn; prefs.set('detailsSound', soundOn); if (t) t.mute(!soundOn); paint(); };
  videoBtn.onclick = () => {
    videoOn = !videoOn; prefs.set('detailsTrailer', videoOn);
    if (videoOn) start(0); else { stop(); ended = false; paint(); }
    toast(videoOn ? 'Bande-annonce en fond activée' : 'Bande-annonce en fond désactivée');
  };
  replayBtn.onclick = () => start(0);
  const ro = new ResizeObserver(fit); ro.observe(bg);
  // Hors de l'écran (on descend vers les épisodes) ou onglet caché : pause
  const io = new IntersectionObserver(([e]) => { visible = e.intersectionRatio > 0.3; if (t && !api_held()) (visible ? t.play() : t.pause()); }, { threshold: [0, 0.3, 0.6] });
  io.observe(bg);
  const onVis = () => { if (!t || api_held()) return; if (document.hidden) t.pause(); else if (visible) t.play(); };
  const api_held = () => held;
  document.addEventListener('visibilitychange', onVis);
  paint();
  start();
  let held = false;
  return {
    ctrl,
    destroy() { stop(); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); },
    // Pendant la bande-annonce en grand : la vidéo de fond se tait
    hold() { held = true; if (t) t.pause(); },
    release() { held = false; if (t && visible && !document.hidden) t.play(); },
    get held() { return held; },
  };
}

function personCard(p) {
  const initials = p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  const face = h('div', { class: 'face', style: { '--h': hueOf(p.name) } }, initials);
  if (p.photo) {
    const im = h('img', { src: img(p.photo), alt: '', loading: 'lazy' });
    im.addEventListener('load', () => face.classList.add('has-img'), { once: true });
    im.addEventListener('error', () => im.remove(), { once: true });
    face.append(im);
  }
  return h('button', { class: 'person f', onclick: () => openPerson(p) }, face,
    h('b', {}, p.name), p.role ? h('span', {}, p.role) : null);
}

// Une personne : ses titres présents dans la médiathèque
async function openPerson(p) {
  const list = h('div', { class: 'grid person-grid' }, h('p', { class: 'grid-empty' }, 'Recherche dans votre médiathèque…'));
  const links = h('p', { class: 'person-links' },
    h('a', { href: `https://www.themoviedb.org/search/person?query=${encodeURIComponent(p.name)}`, target: '_blank', rel: 'noopener' }, 'Voir sur TMDB'), ' · ',
    h('a', { href: `https://www.imdb.com/fr/find/?q=${encodeURIComponent(p.name)}&s=nm`, target: '_blank', rel: 'noopener' }, 'IMDb'));
  const s = sheet(p.name, h('div', {}, links, list), { wide: true });
  window.addEventListener('hashchange', () => s.close(), { once: true });
  try {
    const r = await api(`/api/people?name=${encodeURIComponent(p.name)}`);
    list.replaceChildren(...(r.length ? r.map((i) => {
      const c = card(i, { poster: true });
      c.addEventListener('click', () => s.close(), true);
      return c;
    }) : [h('p', { class: 'grid-empty' }, 'Aucun autre titre avec cette personne dans votre médiathèque.')]));
  } catch (e) { list.replaceChildren(h('p', { class: 'error-text' }, e.message)); }
}

function episodeRow(e, current = false, onToggle = null) {
  const p = e.progress;
  const pct = p && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  const thumbSrc = e.still ? img(e.still) : `/api/items/${e.id}/thumb`;
  const thumb = h('img', { src: thumbSrc, alt: '', loading: 'lazy' });
  thumb.addEventListener('error', () => thumb.replaceWith(placeholder(e.title)), { once: true });
  const dur = e.runtime || (e.duration ? Math.round(e.duration / 60) : null);
  const seen = !!(p && p.watched);
  const toggle = onToggle ? h('button', { class: `ep-toggle f${seen ? ' on' : ''}`, 'aria-label': seen ? `Marquer « ${e.title} » comme non vu` : `Marquer « ${e.title} » comme vu`, title: seen ? 'Vu' : 'Marquer comme vu', onclick: (ev) => { ev.stopPropagation(); onToggle(!seen); } }, icon(seen ? 'check' : 'eye')) : null;
  const row = h('button', { class: `episode f${current ? ' is-current' : ''}${seen ? ' seen' : ''}`, onclick: () => go(playPath(e.id)) },
    h('div', { class: 'thumb' }, thumb, h('span', { class: 'ep-play' }, icon('play')),
      pct > 0 && !p.watched ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null,
      p && p.watched ? h('span', { class: 'check' }, icon('check')) : null),
    h('div', {},
      h('div', { class: 'ep-meta' }, `Épisode ${e.episode}${e.episodeEnd ? `–${e.episodeEnd}` : ''}${dur ? `, ${dur} min` : ''}${e.released && e.released.length === 10 ? `, ${fmtDate(e.released)}` : ''}`,
        current ? h('span', { class: 'tag-new inline now' }, 'Vous en étiez là') : null,
        e.released && daysSince(e.released) <= 14 && !(e.progress && e.progress.watched) ? h('span', { class: 'tag-new inline' }, 'Nouveau') : null),
      h('h3', {}, e.title),
      e.overview ? h('p', {}, e.overview) : null));
  return toggle ? h('div', { class: 'ep-item' }, row, toggle) : row;
}

// Administration : choisir la bonne fiche TMDB quand l'identification automatique s'est trompée
export function fixMatch(item) {
  const input = h('input', { class: 'input', value: item.title });
  const year = h('input', { class: 'input', value: item.year || '', inputmode: 'numeric', style: { maxWidth: '110px' } });
  const list = h('div', { class: 'match-list' });
  const search = async () => {
    list.replaceChildren(h('p', { style: { color: 'var(--mist)' } }, 'Recherche…'));
    try {
      const r = await api(`/api/admin/match/${item.id}?q=${encodeURIComponent(input.value)}&year=${encodeURIComponent(year.value)}`);
      if (!r.length) { list.replaceChildren(h('p', { style: { color: 'var(--mist)' } }, 'Aucun résultat. Essayez le titre original.')); return; }
      list.replaceChildren(...r.map((x) => h('button', { class: 'f', onclick: async () => {
        list.replaceChildren(h('p', {}, 'Mise à jour…'));
        await api(`/api/admin/match/${item.id}`, { method: 'POST', body: { tmdbId: x.id } });
        s.close(); toast('Fiche mise à jour');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } }, x.poster ? h('img', { src: x.poster, alt: '' }) : h('img', { alt: '' }),
      h('div', {}, h('b', {}, `${x.title}${x.year ? ` (${x.year})` : ''}`), h('p', { style: { margin: 0, color: 'var(--mist)', fontSize: '.85rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, x.overview || '')))));
    } catch (e) { list.replaceChildren(h('p', { class: 'error-text' }, e.message)); }
  };
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); search(); } },
    h('div', { style: { display: 'flex', gap: '10px', marginBottom: '14px' } }, input, year, h('button', { class: 'btn f', type: 'submit' }, 'Chercher')),
    list);
  const s = sheet('Corriger l’identification', form);
  search();
}

// Bande-annonce avec le son, dans une grande fenêtre
function openTrailer(d, bt) {
  if (bt) bt.hold();
  const frame = h('iframe', { class: 'trailer-frame', src: trailerUrl(d.trailer), title: `Bande-annonce de ${d.title}`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
  sheet(`Bande-annonce : ${d.title}`, h('div', { class: 'trailer-box' }, frame), { wide: true, onClose: () => { frame.remove(); if (bt) bt.release(); } });
}
