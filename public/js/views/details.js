// Fiche d'un film, d'une série, d'un animé ou d'un clip
// Bande-annonce en fond (son et vidéo désactivables), distribution et équipe, fiche technique, épisodes.
import { api, prefs, detailsTrailers } from '../api.js';
import { h, icon, img, picture, placeholder, ageBadge, fmtRuntime, langName, toast, sheet, fmtDate, daysSince, hueOf } from '../ui.js';
import { sendTo, row, card, playPath, metaLine, frameImage, framePoster, ratingChips, scrollArrows, deleteVideo } from '../components.js';
import { trailerUrl, trailerPlayer } from '../trailer.js';
import { go, state, setTitle, showPath, currentUrl } from '../app.js';
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
  const from = currentUrl();
  const d = await api(`/api/items/${id}`);
  const isShow = d.type === 'show';
  const isClip = d.type === 'clip';
  const cr = d.credits || {};
  tintFrom(img(d.backdrop || d.poster));
  setTitle(d.title);
  showPath(d.path, ['ep'], from);
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
  // « Vu jusqu'à 42 min sur l'iPhone, hier » : où et quand on s'est arrêté (le même profil, sur n'importe quel appareil)
  function resumeNote() {
    const last = isShow ? d.lastWatch : (d.progress && d.progress.position > 20 && !d.progress.watched ? d.progress : null);
    if (!last || !last.updated) return null;
    const when = daysSince(new Date(last.updated).toISOString()) === 0 ? `à ${new Date(last.updated).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : daysSince(new Date(last.updated).toISOString()) === 1 ? 'hier' : `le ${fmtDate(new Date(last.updated).toISOString().slice(0, 10), false)}`;
    const where = last.device ? ` sur ${/^(la |l’)/.test(last.device) ? last.device : last.device.replace(/^(Chrome|Firefox|Safari|Edge|Opera)/, 'l’ordinateur ($1')}${/^(Chrome|Firefox|Safari|Edge|Opera)/.test(last.device) ? ')' : ''}` : '';
    const upTo = !isShow && d.progress ? `jusqu’à ${Math.round(d.progress.position / 60)} min` : isShow && d.nextUp && d.nextUp.progress && d.nextUp.progress.position > 20 ? `S${d.nextUp.season} É${d.nextUp.episode}, ${Math.round(d.nextUp.progress.position / 60)} min` : null;
    return h('p', { class: 'resume-note' }, icon('clock'), ` ${upTo ? `Vu ${upTo}` : 'Dernière lecture'}${where}, ${when}.`);
  }
  // Plusieurs versions du film (4K, 1080p, version longue) : choix mémorisé sur cet appareil
  const vKey = `vn_version_${d.id}`;
  let versionId = target && target.id;
  if (!isShow && d.versions && d.versions.length > 1) {
    try { const v = Number(localStorage.getItem(vKey)); if (d.versions.some((x) => x.id === v)) versionId = v; } catch { /* */ }
  }
  if (target) {
    actions.append(h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => go(playPath(isShow ? target.id : versionId)) }, icon('play'), label));
    if (resumable) actions.append(h('button', { class: 'btn btn-ghost btn-icon f', 'aria-label': 'Recommencer depuis le début', title: 'Recommencer', onclick: () => go(playPath(isShow ? target.id : versionId, 0)) }, icon('restart')));
  }
  // Envoyer la vidéo vers un autre écran où Venus est ouvert (la télé)
  if (target) actions.append(h('button', { class: 'btn btn-ghost btn-icon f', 'aria-label': 'Envoyer vers un autre écran', title: 'Envoyer vers la télé', onclick: () => sendTo({ id: isShow ? target.id : versionId, title: d.title }) }, icon('cast')));
  if (!isShow && d.versions && d.versions.length > 1) {
    const cur = () => d.versions.find((x) => x.id === versionId) || d.versions[0];
    const vBtn = h('button', { class: 'btn btn-ghost f', title: 'Choisir la version', onclick: () => {
      const s = sheet('Version', h('div', {}, d.versions.map((x) => h('button', { class: `opt f${x.id === versionId ? ' on' : ''}`, onclick: () => {
        versionId = x.id; try { localStorage.setItem(vKey, String(x.id)); } catch { /* */ }
        vBtn.querySelector('span').textContent = x.quality || 'Version'; s.close(); toast(`Version ${x.quality} ${x.detail ? `· ${x.detail}` : ''}`);
      } }, icon('check'), x.quality || 'Version', h('small', {}, x.detail)))));
    } }, icon('film'), h('span', {}, cur().quality || 'Version'));
    actions.append(vBtn);
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
  if (!isShow && !(state.profile.perms && state.profile.perms.download === false)) actions.append(h('button', { class: 'btn btn-ghost btn-icon f', 'aria-label': 'Télécharger pour regarder sans réseau', title: 'Télécharger', onclick: async () => {
    const m = await import('./downloads.js');
    m.openDownload({ id: d.id, title: d.title, size: d.file && d.file.size, duration: d.duration || (d.runtime ? d.runtime * 60 : 0) });
  } }, icon('down')));
  actions.append(h('button', { class: 'btn btn-ghost btn-icon f', 'aria-label': 'Plus d’options', title: 'Ajouter à une liste, modifier…', onclick: () => {
    const admin = state.profile.isAdmin;
    const s = sheet(d.title, h('div', {},
      h('button', { class: 'opt ic f', onclick: async () => { s.close(); const m = await import('./collections.js'); m.addToSheet(d); } }, icon('list'), 'Ajouter à une liste de lecture', h('small', {}, admin ? 'ou à une collection' : '')),
      !admin ? null : h('button', { class: 'opt ic f', onclick: () => { s.close(); editInfo(d); } }, icon('edit'), 'Modifier les infos', h('small', {}, 'Titre, résumé, année, genres, âge')),
      isClip || !admin ? null : h('button', { class: 'opt ic f', onclick: () => { s.close(); chooseImages(d); } }, icon('grid4'), 'Choisir les images', h('small', {}, 'Affiche, fond, logo (TMDB, Trakt)')),
      isClip || !admin ? null : h('button', { class: 'opt ic f', onclick: () => { s.close(); fixMatch(d); } }, icon('search'), 'Corriger l’identification', h('small', {}, 'Ce n’est pas le bon titre'))));
  } }, icon('more')));
  if (state.profile.isAdmin) {
    const nEps = isShow ? d.seasons.reduce((n, s) => n + s.episodes.length, 0) : 0;
    const size = !isShow && d.file && d.file.size ? d.file.size : 0;
    actions.append(h('button', { class: 'btn btn-ghost btn-icon btn-del f', 'aria-label': isShow ? 'Supprimer la série' : 'Supprimer la vidéo', title: isShow ? 'Supprimer la série (fichiers effacés)' : 'Supprimer la vidéo (fichier effacé)', onclick: () => deleteVideo({
      id: d.id, what: isShow ? `la série « ${d.title} »` : `« ${d.title} »`,
      detail: isShow ? `Les ${nEps} épisode${nEps > 1 ? 's' : ''} de toutes les saisons seront supprimés.` : size ? `Place libérée : ${size >= 1e9 ? `${(size / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.round(size / 1e6)} Mo`}.` : '',
      onDone: () => go(libOf(d), { replace: true }),
    }) }, icon('trash')));
  }

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
    actions, resumeNote());

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

    const stepSeason = (dir) => { const i = d.seasons.indexOf(current); showSeason(d.seasons[(i + dir + d.seasons.length) % d.seasons.length]); };
    const paintBar = () => {
      seasonBar.replaceChildren(...d.seasons.map((s) => {
        const seen = s.episodes.filter(isSeen).length, total = s.episodes.length;
        const on = s === current;
        const pic = s.poster || d.poster;
        const b = h('button', { class: `season-card f${on ? ' on' : ''}${seen === total && total ? ' done' : ''}`, role: 'tab', 'aria-selected': String(on), 'data-id': s.id, onclick: () => showSeason(s) },
          h('span', { class: 'season-pic' }, pic ? h('img', { src: img(pic, 342), alt: '', loading: 'lazy' }) : h('span', { class: 'season-ph' }, String(s.number)),
            h('i', { class: 'season-prog' }, h('i', { style: { width: `${total ? (seen / total) * 100 : 0}%` } }))),
          h('b', {}, seasonName(s)),
          h('span', {}, seen === total && total ? 'Vue en entier' : seen ? `${seen} / ${total} vus` : `${total} épisode${total > 1 ? 's' : ''}`));
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
          h('button', { class: `btn btn-small btn-ghost f${all ? ' is-on' : ''}`, onclick: () => markSeason(s, !all) }, icon('eye'), all ? 'Saison vue' : 'Marquer la saison vue'),
          state.profile.perms && state.profile.perms.download === false ? null : h('button', { class: 'btn btn-small btn-ghost btn-icon f', 'aria-label': 'Télécharger la saison', title: 'Télécharger la saison', onclick: async () => { const m = await import('./downloads.js'); m.openDownload({ id: s.id, title: seasonName(s), season: true }); } }, icon('down')),
          state.profile.isAdmin ? h('button', { class: 'btn btn-small btn-ghost btn-icon btn-del f', 'aria-label': `Supprimer ${seasonName(s)}`, title: `Supprimer ${seasonName(s)} (fichiers effacés)`, onclick: () => deleteVideo({
            id: s.id, what: `${seasonName(s).toLowerCase().startsWith('saison') ? 'la ' : ''}${seasonName(s)}`, detail: `Les ${total} épisode${total > 1 ? 's' : ''} de cette saison seront supprimés.`,
            onDone: (r) => (r.gone && d.seasons.length === 1 ? go(libOf(d), { replace: true }) : window.dispatchEvent(new HashChangeEvent('hashchange'))),
          }) }, icon('trash')) : null));
    };
    const showSeason = (s, focusId = null) => {
      current = s;
      try { sessionStorage.setItem(memoKey, String(s.id)); } catch { /* */ }
      paintBar(); paintHead();
      const list = s.episodes.filter((e) => epFilter === 'all' || (epFilter === 'unseen' ? !isSeen(e) : isSeen(e)));
      epList.replaceChildren(...list.map((e) => episodeRow(e, e.id === focusId, (w) => markEpisode(e, w))));
      if (!list.length) epList.replaceChildren(h('p', { class: 'grid-empty' }, epFilter === 'unseen' ? 'Tous les épisodes de cette saison sont vus.' : 'Aucun épisode vu dans cette saison.'));
      // Épisodes diffusés mais absents des dossiers (d'après TMDB), à leur place dans l'ordre
      if (epFilter === 'all' && prefs.get('showMissing') !== false && s.missing && s.missing.length) {
        for (const m of s.missing) {
          const ghost = h('div', { class: 'episode missing', title: 'Pas dans vos dossiers' },
            h('div', { class: 'thumb' }, m.still ? h('img', { src: m.still, alt: '', loading: 'lazy' }) : placeholder(m.title || `Épisode ${m.number}`), h('span', { class: 'miss-tag' }, 'Manquant')),
            h('div', {}, h('div', { class: 'ep-meta' }, `Épisode ${m.number}${m.air ? `, ${fmtDate(m.air)}` : ''}`), h('h3', {}, m.title || `Épisode ${m.number}`), m.overview ? h('p', {}, m.overview) : null));
          const after = [...epList.children].find((el) => !el.classList.contains('missing') && Number(el.dataset.ep || el.querySelector('[data-ep]')?.dataset.ep) > m.number);
          if (after) epList.insertBefore(ghost, after); else epList.append(ghost);
        }
      }
      // Fin de saison : on enchaîne sur la suivante
      const idx = d.seasons.indexOf(s);
      const nextS = d.seasons.length > 1 ? d.seasons[(idx + 1) % d.seasons.length] : null; // après la dernière : retour à la première
      if (nextS) epList.append(h('button', { class: 'next-season f', onclick: () => { showSeason(nextS); seasonBar.scrollIntoView({ block: 'start', behavior: 'smooth' }); } },
        h('span', {}, h('small', {}, idx === d.seasons.length - 1 ? 'Reprendre depuis le début' : 'Ensuite'), h('b', {}, seasonName(nextS)), h('em', {}, `${nextS.episodes.length} épisodes`)), icon('fwd')));
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
    // « À suivre » (comme Jellyfin) : l'image lance l'épisode, son nom mène à l'épisode dans sa saison
    const nu = d.nextUp && !showDone ? d.nextUp : null;
    if (nu) {
      const nuSeason = d.seasons.find((s) => s.episodes.some((e) => e.id === nu.id));
      const p = nu.progress;
      const pct = p && p.duration && !p.watched ? Math.min(100, (p.position / p.duration) * 100) : 0;
      const shot = h('img', { src: nu.still ? img(nu.still, 780) : `/api/items/${nu.id}/thumb`, alt: '', loading: 'lazy' });
      shot.addEventListener('error', () => shot.replaceWith(placeholder(nu.title)), { once: true });
      const label = `S${nu.season}:É${nu.episode} - ${nu.title}`;
      const toEpisode = () => {
        if (!nuSeason) return;
        if (epFilter !== 'all') { epFilter = 'all'; [...epChips.children].forEach((c, i) => c.classList.toggle('on', i === 0)); }
        showSeason(nuSeason, nu.id);
      };
      content.append(h('section', { class: 'd-section next-up' },
        h('h2', { class: 'section-title' }, pct ? 'Reprendre' : 'À suivre'),
        h('div', { class: 'nu-card' },
          h('button', { class: 'nu-shot f', 'aria-label': `Lire ${label}`, onclick: () => go(playPath(nu.id)) }, shot, h('span', { class: 'ep-play' }, icon('play')),
            pct ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null),
          h('div', { class: 'nu-text' },
            h('a', { class: 'nu-link f', href: `/titre/${d.id}?ep=${nu.id}`, title: label, onclick: (e) => { e.preventDefault(); toEpisode(); } }, label),
            h('small', {}, [nuSeason ? (nuSeason.title || `Saison ${nuSeason.number}`) : null, nu.runtime ? `${nu.runtime} min` : null, pct && p.duration ? `${Math.max(1, Math.round((p.duration - p.position) / 60))} min restantes` : null].filter(Boolean).join(' · ')),
            nu.overview ? h('p', {}, nu.overview) : null))));
    }
    content.append(h('section', { class: 'd-section', id: 'episodes' },
      h('div', { class: 'ep-head' }, h('h2', { class: 'section-title' }, d.seasons.length > 1 ? `${d.seasons.length} saisons` : 'Épisodes'),
        // Flèches : saison précédente / suivante, en boucle (après la dernière, retour à la première)
        d.seasons.length > 1 ? h('div', { class: 'season-arrows' },
          h('button', { class: 'season-arrow f', 'aria-label': 'Saison précédente', onclick: () => stepSeason(-1) }, icon('back')),
          h('button', { class: 'season-arrow f', 'aria-label': 'Saison suivante', onclick: () => stepSeason(1) }, icon('fwd'))) : null, epChips),
      d.seasons.length > 1 ? seasonBar : null, seasonHead, epList,
      d.missingSeasons && d.missingSeasons.length && prefs.get('showMissing') !== false ? h('p', { class: 'missing-seasons' }, `Pas dans vos dossiers : ${d.missingSeasons.map((x) => `${x.title || `Saison ${x.number}`} (${x.count} épisodes)`).join(', ')}.`) : null));
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
  // « À propos » et « Fiche technique » : deux boutons, les détails s'ouvrent dans une fenêtre si besoin
  if (pairs.length || tech.length || (cr.tags && cr.tags.length)) {
    const open = (title, body) => sheet(title, h('div', { class: 'about-sheet' }, body));
    content.append(h('section', { class: 'd-section about' },
      h('div', { class: 'about-btns' },
        pairs.length || (cr.tags && cr.tags.length) ? h('button', { class: 'btn btn-ghost f', onclick: () => open('À propos', [dl(pairs),
          cr.tags && cr.tags.length ? h('div', { class: 'tag-cloud' }, h('span', { class: 'tag-cloud-label' }, 'Étiquettes'), cr.tags.map((t) => h('span', { class: 'tag ghost' }, t))) : null]) }, icon('info'), 'À propos') : null,
        tech.length ? h('button', { class: 'btn btn-ghost f', onclick: () => open(isShow ? 'Fiche technique (premier épisode)' : 'Fiche technique', dl(tech)) }, icon('film'), 'Fiche technique') : null)));
  }

  if (d.extras && d.extras.length) {
    const list = h('div', { class: 'extras-row' }, d.extras.map((x) => {
      const im = h('img', { src: x.still ? img(x.still) : `/api/items/${x.id}/thumb`, alt: '', loading: 'lazy' });
      im.addEventListener('error', () => im.replaceWith(placeholder(x.title)), { once: true });
      return h('button', { class: 'extra f', onclick: () => go(playPath(x.id, 0)) },
        h('span', { class: 'thumb' }, im, h('span', { class: 'ep-play' }, icon('play'))),
        h('small', {}, [x.kindLabel, x.duration ? `${Math.max(1, Math.round(x.duration / 60))} min` : null].filter(Boolean).join(' · ')), h('b', {}, x.title));
    }));
    content.append(h('section', { class: 'd-section' }, h('h2', { class: 'section-title' }, `Bonus (${d.extras.length})`), scrollArrows(list)));
  }
  if (d.saga && d.saga.items.length > 1) {
    content.append(h('div', { class: 'd-similar' }, row({ title: `Saga : ${d.saga.name.replace(/ - (Saga|Collection)$|^Saga /i, '')}`, items: d.saga.items })));
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
export async function openPerson(p) {
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
  const row = h('button', { class: `episode f${current ? ' is-current' : ''}${seen ? ' seen' : ''}`, 'data-ep': e.episode, onclick: () => go(playPath(e.id)) },
    h('div', { class: 'thumb' }, thumb, h('span', { class: 'ep-play' }, icon('play')),
      pct > 0 && !p.watched ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null,
      p && p.watched ? h('span', { class: 'check' }, icon('check')) : null),
    h('div', {},
      h('div', { class: 'ep-meta' }, `Épisode ${e.episode}${e.episodeEnd ? `–${e.episodeEnd}` : ''}${dur ? `, ${dur} min` : ''}${e.released && e.released.length === 10 ? `, ${fmtDate(e.released)}` : ''}`,
        current ? h('span', { class: 'tag-new inline now' }, p && !p.watched && p.position > 0 ? 'Vous en étiez là' : 'Cet épisode') : null,
        e.released && daysSince(e.released) <= 14 && !(e.progress && e.progress.watched) ? h('span', { class: 'tag-new inline' }, 'Nouveau') : null),
      h('h3', {}, e.title),
      e.overview ? h('p', {}, e.overview) : null));
  return toggle ? h('div', { class: 'ep-item' }, row, toggle) : row;
}

// Administration : choisir la bonne fiche TMDB quand l'identification automatique s'est trompée
// ---------------------------------------------------------------- modifier les infos (administrateur)
async function editInfo(d) {
  let r;
  try { r = await api(`/api/admin/items/${d.id}/edit`); } catch (e) { toast(e.message, true); return; }
  const f = r.fields;
  const inp = (v, attrs = {}) => h('input', { class: 'input', value: v ?? '', ...attrs });
  const title = inp(f.title, { maxlength: 200 }), orig = inp(f.originalTitle, { maxlength: 200 }), year = inp(f.year, { inputmode: 'numeric', maxlength: 4 });
  const tagline = inp(f.tagline, { maxlength: 300 }), genres = inp((f.genres || []).join(', '), { placeholder: 'Action, Comédie' });
  const age = h('select', { class: 'input' }, [['', 'Non classé'], ['0', 'Tous publics'], ['10', '10 ans et plus'], ['12', '12 ans et plus'], ['16', '16 ans et plus'], ['18', '18 ans et plus']].map(([v, l]) => h('option', { value: v, selected: String(f.age ?? '') === v }, l)));
  const overview = h('textarea', { class: 'input', rows: 6, maxlength: 5000 }, f.overview || '');
  const err = h('p', { class: 'error-text' });
  const field = (l, el) => h('div', { class: 'field' }, h('label', {}, l), el);
  const s = sheet('Modifier les infos', h('form', { class: 'edit-form', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    const y = year.value.trim();
    if (!title.value.trim()) { err.textContent = 'Le titre est obligatoire'; return; }
    if (y && !/^\d{4}$/.test(y)) { err.textContent = 'Année sur 4 chiffres'; return; }
    try {
      await api(`/api/admin/items/${d.id}/edit`, { method: 'PUT', body: { title: title.value.trim(), originalTitle: orig.value.trim() || null, year: y ? Number(y) : null,
        overview: overview.value.trim() || null, tagline: tagline.value.trim() || null, genres: genres.value.split(',').map((g) => g.trim()).filter(Boolean).slice(0, 12), age: age.value === '' ? null : Number(age.value) } });
      s.close(); toast('Infos enregistrées : elles ne seront plus remplacées par TMDB', { type: 'success' });
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e2) { err.textContent = e2.message; }
  } },
  h('div', { class: 'two-cols' }, field('Titre', title), field('Titre original', orig)),
  h('div', { class: 'two-cols' }, field('Année', year), field('Âge minimum', age)),
  field('Genres (séparés par des virgules)', genres), field('Accroche', tagline), field('Résumé', overview), err,
  h('div', { class: 'form-actions' },
    r.custom.length ? h('button', { class: 'btn btn-ghost f', type: 'button', onclick: async () => {
      await api(`/api/admin/items/${d.id}/reset`, { method: 'POST' }); s.close(); toast('Infos d’origine rétablies'); window.dispatchEvent(new HashChangeEvent('hashchange'));
    } }, 'Revenir aux infos d’origine') : null,
    h('button', { class: 'btn btn-play f', type: 'submit' }, 'Enregistrer'))), { wide: true });
}

async function chooseImages(d) {
  const body = h('div', { class: 'img-pick' }, h('p', { class: 'muted' }, h('span', { class: 'mini-spin' }), ' Recherche des images…'));
  const s = sheet('Choisir les images', body, { wide: true });
  let r;
  try { r = await api(`/api/admin/items/${d.id}/edit`); } catch (e) { body.replaceChildren(h('p', { class: 'error-text' }, e.message)); return; }
  let kind = 'poster';
  const tabs = h('div', { class: 'seg' });
  const grid = h('div', { class: 'img-grid' });
  const NAMES = { poster: 'Affiches', backdrop: 'Fonds', logo: 'Logos' };
  const SRC = { trakt: 'Trakt', tmdb: 'TMDB', free: '' };
  const apply = async (btn, src, ref) => {
    if (btn) btn.classList.add('busy');
    try { await api(`/api/admin/items/${d.id}/image`, { method: 'POST', body: { kind, src, ref } }); s.close(); toast(`${NAMES[kind].slice(0, -1)} changé${kind === 'poster' ? 'e' : ''}`, { type: 'success' }); window.dispatchEvent(new HashChangeEvent('hashchange')); }
    catch (err) { if (btn) btn.classList.remove('busy'); toast(err.message, true); }
  };
  // Adresse d'une image sur internet (n'importe quel site : IMP Awards, MoviePosterDB, CineMaterial…)
  const urlIn = h('input', { class: 'input', type: 'url', placeholder: 'https://… adresse d’une image (JPEG, PNG ou WebP)', autocomplete: 'off', inputmode: 'url' });
  const urlBtn = h('button', { class: 'btn btn-small btn-play f', type: 'submit' }, icon('down'), 'Utiliser cette image');
  const urlForm = h('form', { class: 'img-url', onsubmit: (e) => { e.preventDefault(); const u = urlIn.value.trim(); if (!/^https:\/\//i.test(u)) { toast('Collez une adresse qui commence par https://', true); return; } urlBtn.disabled = true; apply(urlBtn, 'url', u).finally(() => { urlBtn.disabled = false; }); } },
    h('label', { class: 'img-url-label' }, 'Ou collez l’adresse d’une image'), h('div', { class: 'img-url-row' }, urlIn, urlBtn),
    h('small', { class: 'muted' }, 'Copiez l’adresse de l’image (clic droit → « Copier l’adresse de l’image ») depuis IMP Awards, MoviePosterDB, CineMaterial, TMDB… Venus la vérifie et la garde chez lui.'));
  const paint = () => {
    tabs.replaceChildren(...Object.keys(NAMES).map((k) => h('button', { class: `seg-b f${k === kind ? ' on' : ''}`, onclick: () => { kind = k; paint(); } }, `${NAMES[k]} (${r.images[k].length})`)));
    grid.className = `img-grid ${kind}`;
    const list = r.images[kind];
    const tag = (x) => [x.label || SRC[x.src] || x.src, x.lang ? x.lang.toUpperCase() : null].filter(Boolean).join(' · ');
    grid.replaceChildren(...(list.length ? list.map((x) => h('button', { class: 'img-opt f', title: [tag(x), x.w ? `${x.w}×${x.h}` : null].filter(Boolean).join(' · '), onclick: (e) => apply(e.currentTarget, x.src, x.ref) },
      h('img', { src: x.preview, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), h('span', { class: 'img-src' }, tag(x))))
      : [h('p', { class: 'muted' }, 'Aucune image proposée pour l’instant. Collez une adresse ci-dessous, ajoutez une clé TMDB ou un identifiant Trakt dans Réglages, ou placez poster.jpg / fanart.jpg dans le dossier.')]));
  };
  body.replaceChildren(tabs, grid, urlForm);
  paint();
  // Séries : le fond et le logo peuvent aussi venir d'une adresse, l'onglet courant décide
}

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
