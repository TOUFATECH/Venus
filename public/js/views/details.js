// Fiche d'un film ou d'une série
import { api } from '../api.js';
import { h, icon, img, picture, placeholder, ageBadge, fmtRuntime, langName, toast, sheet, fmtDate, daysSince } from '../ui.js';
import { row, playPath, metaLine, frameImage, framePoster, ratingChips } from '../components.js';
import { trailerUrl } from '../trailer.js';
import { go, state, setTitle } from '../app.js';
import { focusEl } from '../nav.js';
import { tintFrom } from '../ambiance.js';

export async function render(main, { id }) {
  const d = await api(`/api/items/${id}`);
  const isShow = d.type === 'show';
  tintFrom(img(d.backdrop || d.poster));
  setTitle(d.title);

  const bg = h('div', { class: 'details-bg' }, d.backdrop ? picture(img(d.backdrop), d.title, { lazy: false }) : frameImage(d.id, d.title, { fade: false }));
  const posterEl = h('div', { class: 'details-poster' }, d.poster ? picture(img(d.poster), d.title, { lazy: false }) : framePoster(d));

  // Bouton principal : Lecture / Reprendre / Épisode suivant
  const actions = h('div', { class: 'actions' });
  const target = isShow ? d.nextUp : d;
  const prog = target && target.progress;
  const resumable = prog && !prog.watched && prog.position > 20;
  const remaining = resumable && prog.duration ? Math.round((prog.duration - prog.position) / 60) : 0;
  let label = 'Lecture';
  if (isShow && target) label = `${resumable ? 'Reprendre' : 'Lecture'} S${target.season} É${target.episode}`;
  else if (resumable) label = `Reprendre (${remaining} min restantes)`;
  if (target) {
    actions.append(h('button', { class: 'btn btn-play f', 'data-autofocus': true, onclick: () => go(playPath(target.id)) }, icon('play'), label));
    if (resumable) actions.append(h('button', { class: 'btn btn-ghost btn-icon f', 'aria-label': 'Recommencer depuis le début', title: 'Recommencer', onclick: () => go(playPath(target.id, 0)) }, icon('restart')));
  }
  const listBtn = h('button', { class: 'btn btn-ghost btn-icon f', 'aria-label': d.inList ? 'Retirer de ma liste' : 'Ajouter à ma liste', title: 'Ma liste' }, icon(d.inList ? 'check' : 'plus'));
  listBtn.onclick = async () => {
    const r = await api(`/api/items/${d.id}/mylist`, { method: 'POST' });
    listBtn.replaceChildren(icon(r.inList ? 'check' : 'plus'));
    listBtn.setAttribute('aria-label', r.inList ? 'Retirer de ma liste' : 'Ajouter à ma liste');
    toast(r.inList ? 'Ajouté à ma liste' : 'Retiré de ma liste');
  };
  actions.append(listBtn);
  if (d.trailer) {
    actions.append(h('button', { class: 'btn btn-ghost f', onclick: () => openTrailer(d) }, icon('play'), 'Bande-annonce'));
  }
  const allWatched = isShow ? d.seasons.every((s) => s.episodes.every((e) => e.progress && e.progress.watched)) : prog && prog.watched;
  actions.append(h('button', { class: 'btn btn-ghost btn-small f', style: { alignSelf: 'center' }, onclick: async () => {
    await api(`/api/items/${d.id}/watched`, { method: 'POST', body: { watched: !allWatched } });
    toast(allWatched ? 'Marqué comme non vu' : 'Marqué comme vu');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } }, allWatched ? 'Marquer non vu' : 'Marquer comme vu'));

  const nbEps = isShow ? d.seasons.reduce((n, s) => n + s.episodes.length, 0) : 0;
  const meta = metaLine(d, [
    ageBadge(d),
    !isShow && d.runtime ? h('span', {}, fmtRuntime(d.runtime)) : null,
    isShow ? h('span', {}, `${d.seasons.length} saison${d.seasons.length > 1 ? 's' : ''}, ${nbEps} épisode${nbEps > 1 ? 's' : ''}`) : null,
  ].filter(Boolean));

  const m = d.media;
  const tech = m ? h('div', { class: 'tech' },
    h('span', { class: 'badge' }, m.resolution), m.hdr ? h('span', { class: 'badge' }, m.hdr) : null,
    m.surround ? h('span', { class: 'badge' }, m.surround) : null) : null;
  const facts = h('div', { class: 'facts' },
    d.genres.length ? h('div', {}, h('b', {}, 'Genres : '), d.genres.join(', ')) : null,
    d.released && d.released.length === 10 ? h('div', {}, h('b', {}, isShow ? 'Première diffusion : ' : 'Sortie : '), fmtDate(d.released)) : null,
    m && m.audio.some((l) => l !== 'und') ? h('div', {}, h('b', {}, 'Audio : '), [...new Set(m.audio.map(langName))].join(', ')) : null,
    m && m.subs.some((l) => l !== 'und') ? h('div', {}, h('b', {}, 'Sous-titres : '), [...new Set(m.subs.map(langName))].join(', ')) : null,
    d.originalTitle && d.originalTitle !== d.title ? h('div', {}, h('b', {}, 'Titre original : '), d.originalTitle) : null);

  const mainInfo = h('div', { class: 'details-main' },
    d.logo ? h('img', { class: 'hero-logo', src: img(d.logo), alt: d.title }) : h('h1', { class: 'hero-title' }, d.title),
    h('div', { class: 'meta' }, meta),
    ratingChips(d.ratings, d.links),
    d.tagline ? h('p', { style: { fontStyle: 'italic', color: 'var(--mist)', margin: '0 0 10px' } }, d.tagline) : null,
    d.overview ? h('p', { class: 'hero-overview' }, d.overview) : null,
    actions, tech, facts,
    state.profile.isAdmin ? h('button', { class: 'btn btn-ghost btn-small f', style: { marginTop: '18px' }, onclick: () => fixMatch(d) }, 'Corriger l’identification') : null);

  const content = h('div', { class: 'details-body' }, h('div', { class: 'details-top' }, posterEl, mainInfo));

  if (isShow && d.seasons.length) {
    const epList = h('div', { class: 'episodes' });
    const tabs = h('div', { class: 'season-tabs', role: 'tablist' });
    let current = null;
    let epFilter = 'all';
    const showSeason = (s, focus = false) => {
      current = s;
      [...tabs.children].forEach((t) => t.classList.toggle('on', t.dataset.id === String(s.id)));
      const isSeen = (e) => e.progress && e.progress.watched;
      const list = s.episodes.filter((e) => epFilter === 'all' || (epFilter === 'unseen' ? !isSeen(e) : isSeen(e)));
      epList.replaceChildren(...list.map((e) => episodeRow(e)));
      if (!list.length) epList.replaceChildren(h('p', { class: 'grid-empty' }, epFilter === 'unseen' ? 'Tous les épisodes de cette saison sont vus.' : 'Aucun épisode vu dans cette saison.'));
      if (focus) focusEl(epList.firstChild);
    };
    const epChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrer les épisodes' },
      [['all', 'Tous'], ['unseen', 'Non vus'], ['seen', 'Déjà vus']].map(([id, label]) => {
        const b = h('button', { class: `chip f${id === epFilter ? ' on' : ''}`, onclick: () => {
          epFilter = id; [...epChips.children].forEach((c) => c.classList.toggle('on', c === b)); showSeason(current);
        } }, label);
        return b;
      }));
    for (const s of d.seasons) {
      tabs.append(h('button', { class: 'chip f', role: 'tab', 'data-id': s.id, onclick: () => showSeason(s) }, s.title || (s.number === 0 ? 'Bonus' : `Saison ${s.number}`)));
    }
    const startSeason = d.seasons.find((s) => d.nextUp && s.episodes.some((e) => e.id === d.nextUp.id)) || d.seasons[0];
    content.append(...[h('div', { class: 'ep-head' }, h('h2', { class: 'section-title' }, 'Épisodes'), epChips), d.seasons.length > 1 ? tabs : null, epList].filter(Boolean));
    showSeason(startSeason);
  }

  if (d.similar && d.similar.length) {
    content.append(h('div', { style: { margin: '40px calc(-1 * var(--gutter)) 0' } }, row({ title: 'Dans le même genre', items: d.similar })));
  }

  main.append(h('div', { class: 'details' }, bg, content));
}

function episodeRow(e) {
  const p = e.progress;
  const pct = p && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
  const thumbSrc = e.still ? img(e.still) : `/api/items/${e.id}/thumb`;
  const thumb = h('img', { src: thumbSrc, alt: '', loading: 'lazy' });
  thumb.addEventListener('error', () => thumb.replaceWith(placeholder(e.title)), { once: true });
  const dur = e.runtime || (e.duration ? Math.round(e.duration / 60) : null);
  return h('button', { class: 'episode f', onclick: () => go(playPath(e.id)) },
    h('div', { class: 'thumb' }, thumb,
      pct > 0 && !p.watched ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null,
      p && p.watched ? h('span', { class: 'check' }, icon('check')) : null),
    h('div', {},
      h('div', { class: 'ep-meta' }, `Épisode ${e.episode}${e.episodeEnd ? `–${e.episodeEnd}` : ''}${dur ? `, ${dur} min` : ''}${e.released && e.released.length === 10 ? `, ${fmtDate(e.released)}` : ''}`,
        e.released && daysSince(e.released) <= 14 && !(e.progress && e.progress.watched) ? h('span', { class: 'tag-new inline' }, 'Nouveau') : null),
      h('h3', {}, e.title),
      e.overview ? h('p', {}, e.overview) : null));
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
function openTrailer(d) {
  const frame = h('iframe', { class: 'trailer-frame', src: trailerUrl(d.trailer), title: `Bande-annonce de ${d.title}`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' });
  sheet(`Bande-annonce : ${d.title}`, h('div', { class: 'trailer-box' }, frame), { wide: true, onClose: () => frame.remove() });
}
