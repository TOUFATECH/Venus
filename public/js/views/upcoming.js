// Onglet « À venir » de Films, Séries et Animés : jour par jour, ce qui sort ou se diffuse, sur le NAS ou pas.
// En haut, des propositions de titres qui ne sont pas sur le NAS. Chaque titre absent peut être :
//  - mis en favori ♡ : il rejoint « Ma liste → Mes envies » et part tout de suite en téléchargement (Radarr / Sonarr) ;
//  - téléchargé directement (bouton ⬇), sans passer par les favoris.
import { api } from '../api.js';
import { h, icon, img, toast, sheet, fmtDate } from '../ui.js';
import { playPath } from '../components.js';
import { go } from '../app.js';

const TITLES = { movie: 'Films', show: 'Séries', anime: 'Animés' };
const FILTERS = [['all', 'Tout'], ['nas', 'Sur le NAS'], ['out', 'Pas sur le NAS'], ['fav', 'Mes favoris']];
const pad = (n) => String(n).padStart(2, '0');
const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayOf = (e) => (e.at ? localDay(e.at) : e.date);
const nameOf = (e) => e.show || e.title;
const epLabel = (e) => (e.kind === 'movie'
  ? [e.release, e.year].filter(Boolean).join(' · ')
  : `${e.season != null ? `S${e.season}:É${e.episode}` : `Épisode ${e.episode}`}${e.epTitle ? ` - ${e.epTitle}` : ''}`);

export async function renderUpcoming(page, kind, tabs) {
  const d = await api(`/api/upcoming?type=${kind}`);
  const kids = d.kids;
  let filter = 'all';
  try { filter = sessionStorage.getItem(`vn_up_${kind}`) || 'all'; } catch { /* */ }
  const today = localDay(Date.now());
  const label = (iso) => {
    const dt = new Date(`${iso}T00:00:00`), t0 = new Date(`${today}T00:00:00`);
    const diff = Math.round((dt - t0) / 864e5);
    if (diff === 0) return 'Aujourd’hui';
    if (diff === -1) return 'Hier';
    if (diff === 1) return 'Demain';
    const s = dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', ...(dt.getFullYear() !== t0.getFullYear() ? { year: 'numeric' } : {}) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  // Un même titre (série) partage son état de favori entre tous ses épisodes
  const favs = new Set(d.entries.filter((e) => e.wanted).map((e) => e.key));
  const repaint = [];
  const refreshAll = () => repaint.forEach((fn) => fn());

  // ---------------------------------------------------------------- actions
  const payload = (e, download) => ({ key: e.key, kind: e.kind, title: nameOf(e), year: e.year || undefined, poster: e.poster || undefined, image: e.image || undefined,
    date: e.date || undefined, tmdb: e.tmdb || undefined, tvdb: e.tvdb || undefined, anilist: e.anilist || undefined, download });
  async function toggleFav(e) {
    const on = favs.has(e.key);
    try {
      if (on) {
        await api(`/api/wanted?key=${encodeURIComponent(e.key)}`, { method: 'DELETE' });
        favs.delete(e.key); toast(`« ${nameOf(e)} » retiré de vos favoris`);
      } else {
        const r = await api('/api/wanted', { method: 'POST', body: payload(e, true) });
        favs.add(e.key);
        if (r.sent && !r.sent.error) { e.arr = true; markArr(e); }
        toast(r.sent && r.sent.error ? `Ajouté aux favoris, mais ${d.app} a répondu : ${r.sent.error}`
          : r.sent ? `« ${nameOf(e)} » en favori : ${r.sent.already ? `déjà suivi par ${d.app}` : 'le téléchargement est lancé'}`
            : `« ${nameOf(e)} » ajouté à vos favoris${kids ? '' : d.arr ? '' : ` (reliez ${d.app} pour le téléchargement automatique)`}`, { type: r.sent && r.sent.error ? undefined : 'success' });
      }
      refreshAll();
    } catch (err) { toast(err.message, true); }
  }
  const markArr = (e) => { for (const x of d.entries) if (x.key === e.key) x.arr = true; };
  async function download(e, btn) {
    if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    try {
      const r = await api('/api/wanted/grab', { method: 'POST', body: payload(e, true) });
      markArr(e); refreshAll();
      toast(r.already ? `« ${r.title} » est déjà suivi par ${d.app}` : `« ${r.title} » ajouté à ${d.app} : le téléchargement est lancé`, { type: 'success' });
    } catch (err) { toast(err.message, true); if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
  }

  // ---------------------------------------------------------------- éléments
  const favBtn = (e, cls = '') => {
    const b = h('button', { type: 'button', class: `up-act fav f ${cls}`, onclick: (ev) => { ev.stopPropagation(); toggleFav(e); } });
    const paint = () => {
      const on = favs.has(e.key);
      b.classList.toggle('on', on);
      b.setAttribute('aria-label', on ? `Retirer « ${nameOf(e)} » des favoris` : `Mettre « ${nameOf(e)} » en favori (téléchargement automatique)`);
      b.title = on ? 'Retirer des favoris' : 'Favori : téléchargé automatiquement';
      b.replaceChildren(icon('heart'), cls.includes('wide') ? (on ? 'En favori' : 'Favori') : '');
    };
    paint(); repaint.push(paint);
    return b;
  };
  const dlBtn = (e, cls = '') => {
    const b = h('button', { type: 'button', class: `up-act dl f ${cls}`, onclick: (ev) => { ev.stopPropagation(); download(e, b); } });
    const paint = () => {
      b.replaceChildren(icon(e.arr ? 'check' : 'download'), cls.includes('wide') ? (e.arr ? `Suivi par ${d.app}` : 'Télécharger') : '');
      b.disabled = !!e.arr; b.classList.toggle('done', !!e.arr);
      b.title = e.arr ? `Déjà suivi par ${d.app} : téléchargé dès sa sortie` : d.arr ? `Télécharger avec ${d.app}` : `${d.app} n’est pas relié`;
      b.setAttribute('aria-label', b.title);
    };
    paint(); repaint.push(paint);
    return b;
  };
  const badge = (e) => {
    const s = h('span', { class: 'up-badge' });
    const paint = () => {
      const [cls, txt] = e.nas ? ['in', e.epId ? (e.seen ? 'Vu' : 'Sur le NAS') : e.kind === 'movie' ? 'Sur le NAS' : 'Série sur le NAS']
        : e.arr ? ['arr', `Demandé · ${d.app}`] : favs.has(e.key) ? ['fav', 'Favori'] : ['out', 'Pas sur le NAS'];
      s.className = `up-badge ${cls}`; s.textContent = txt;
    };
    paint(); repaint.push(paint);
    return s;
  };
  const picOf = (e, wide) => {
    const src = wide ? e.image || e.poster : e.poster || e.image;
    if (!src) return h('div', { class: 'up-ph' }, h('span', {}, nameOf(e)));
    const el = h('img', { src: img(src), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', class: wide && !e.image ? 'tall' : '' });
    el.addEventListener('error', () => el.replaceWith(h('div', { class: 'up-ph' }, h('span', {}, nameOf(e)))), { once: true });
    // Pas d'image en largeur : l'affiche est posée sur un fond flou de la même image
    return wide && !e.image ? h('div', { class: 'up-tall' }, h('img', { src: img(src), alt: '', class: 'up-blur', 'aria-hidden': 'true', referrerpolicy: 'no-referrer' }), el) : el;
  };
  const open = (e) => {
    if (e.epId) return go(playPath(e.epId));
    if (e.nas) return go(`/titre/${e.nas}`);
    details(e);
  };
  function details(e) {
    const body = h('div', { class: 'up-sheet' },
      h('div', { class: 'up-sheet-pic' }, picOf(e, true)),
      h('div', { class: 'up-sheet-body' },
        h('h2', {}, nameOf(e)),
        h('p', { class: 'muted' }, [e.kind === 'movie' ? e.release : epLabel(e), fmtDate(dayOf(e)), e.network].filter(Boolean).join(' · ')),
        e.genres && e.genres.length ? h('p', { class: 'up-genres' }, e.genres.slice(0, 4).join(' · ')) : null,
        e.overview ? h('p', { class: 'up-over' }, e.overview) : null,
        kids ? null : h('div', { class: 'up-sheet-acts' }, favBtn(e, 'wide btn'), d.arr ? dlBtn(e, 'wide btn') : null),
        kids ? null : h('p', { class: 'muted small' }, d.arr
          ? `Favori : le titre rejoint « Mes envies » et ${d.app} le télécharge dès qu’il est disponible.`
          : `Reliez ${d.app} (Réglages → Demandes) pour que les favoris se téléchargent tout seuls.`)));
    sheet(null, body, { wide: true });
  }
  const upCard = (e) => {
    const out = !e.nas;
    const el = h('div', { class: `up-card${out ? ' out' : ''}`, 'data-key': e.key },
      h('button', { type: 'button', class: 'up-pic f', 'aria-label': `${nameOf(e)}, ${epLabel(e)}`, onclick: () => open(e) },
        picOf(e, true), badge(e),
        e.epId ? h('span', { class: 'ep-play' }, icon('play')) : null,
        e.at && e.kind !== 'movie' ? h('span', { class: 'up-time' }, new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })) : null),
      out && !kids ? h('div', { class: 'up-acts' }, favBtn(e), d.arr ? dlBtn(e) : null) : null,
      h('b', {}, nameOf(e)),
      h('span', {}, epLabel(e)));
    return el;
  };
  const sugCard = (e) => h('div', { class: 'up-sug' },
    h('button', { type: 'button', class: 'up-sug-pic f', 'aria-label': nameOf(e), onclick: () => details(e) }, picOf(e, false),
      h('span', { class: 'up-sug-date' }, `${label(dayOf(e))}`)),
    kids ? null : h('div', { class: 'up-acts' }, favBtn(e), d.arr ? dlBtn(e) : null),
    h('b', {}, nameOf(e)),
    h('small', {}, e.kind === 'movie' ? [e.release, e.year].filter(Boolean).join(' · ') : [e.network, e.genres && e.genres[0]].filter(Boolean).join(' · ') || epLabel(e)));

  // ---------------------------------------------------------------- page
  const chips = h('div', { class: 'seg up-filter', role: 'radiogroup', 'aria-label': 'Afficher' });
  const sug = h('section', { class: 'up-sugs' });
  const body = h('div', { class: 'upcoming' });
  const paintChips = () => chips.replaceChildren(...FILTERS.filter(([k]) => !(kids && (k === 'out' || k === 'fav'))).map(([k, txt]) => h('button', {
    class: `seg-b f${k === filter ? ' on' : ''}`, role: 'radio', 'aria-checked': String(k === filter),
    onclick: () => { filter = k; try { sessionStorage.setItem(`vn_up_${kind}`, k); } catch { /* */ } paintChips(); paintBody(); },
  }, txt)));
  const keep = (e) => (filter === 'nas' ? !!e.nas : filter === 'out' ? !e.nas : filter === 'fav' ? favs.has(e.key) : true);
  let showEarlier = false;
  function paintBody() {
    repaint.length = 0;
    const list = d.entries.filter(keep);
    const groups = new Map();
    for (const e of list) { const k = dayOf(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const yesterday = localDay(Date.now() - 864e5);
    const days = [...groups.keys()].sort();
    const earlier = days.filter((x) => x < yesterday);
    const shown = showEarlier ? days : days.filter((x) => x >= yesterday);
    body.replaceChildren();
    if (earlier.length && !showEarlier) {
      body.append(h('button', { class: 'btn btn-small btn-ghost up-earlier f', onclick: () => { showEarlier = true; paintBody(); } }, icon('up'), `Voir les ${earlier.length} jours précédents`));
    }
    for (const day of shown) {
      body.append(h('section', { class: `up-day${day < today ? ' past' : ''}${day === today ? ' today' : ''}` },
        h('h2', { class: 'section-title' }, label(day), h('small', {}, fmtDate(day))),
        h('div', { class: 'up-grid' }, groups.get(day).map(upCard))));
    }
    if (!shown.length) {
      body.append(h('div', { class: 'grid-empty' }, h('p', {}, filter === 'fav' ? 'Aucun favori à venir.' : filter === 'nas' ? 'Rien sur le NAS pour ces jours-ci.' : 'Rien d’annoncé pour l’instant.'),
        kind === 'movie' && !d.arr && !d.tmdb ? h('p', { class: 'muted' }, 'Les sorties de films viennent de Radarr (ou de TMDB) : reliez Radarr dans Réglages → Demandes.') : null));
    }
    // Propositions (pas sur le NAS), seulement avec le filtre « Tout » ou « Pas sur le NAS »
    const sugs = (filter === 'all' || filter === 'out') && !kids ? d.suggestions : [];
    sug.hidden = !sugs.length;
    sug.replaceChildren(h('h2', { class: 'section-title' }, kind === 'movie' ? 'Films à découvrir' : kind === 'anime' ? 'Animés à découvrir' : 'Séries à découvrir',
      h('small', {}, 'pas encore sur le NAS')), h('div', { class: 'up-sug-row' }, sugs.map(sugCard)));
  }
  paintChips(); paintBody();
  const count = d.entries.length;
  page.append(h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, TITLES[kind]),
    h('p', { class: 'count' }, `${count} ${kind === 'movie' ? `sortie${count > 1 ? 's' : ''}` : `épisode${count > 1 ? 's' : ''}`}`)), tabs),
  h('div', { class: 'up-bar' }, chips, !kids && d.arr ? h('span', { class: 'muted small' }, icon('heart'), ` Favori = téléchargé automatiquement par ${d.app}`) : null),
  sug, body);
}
