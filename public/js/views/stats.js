// Mes statistiques : heures regardées, mois par mois, genres, séries préférées, et « votre année sur Venus »
import { api } from '../api.js';
import { h, img } from '../ui.js';
import { go, state } from '../app.js';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const nf = (n) => String(n).replace('.', ',');
// 0,05 h → « 3 min », 12,34 h → « 12,3 h »
const fh = (x) => (!x ? '0 h' : x < 1 ? `${Math.max(1, Math.round(x * 60))} min` : `${nf(x >= 100 ? Math.round(x) : Math.round(x * 10) / 10)} h`);

export async function render(main, { query } = {}) {
  const year = Number(query && query.get('annee')) || new Date().getFullYear();
  const d = await api(`/api/stats?year=${year}`);
  const page = h('div', { class: 'page stats' });
  main.append(page);
  const years = d.years.length ? d.years : [year];
  const head = h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Mes statistiques'), h('p', { class: 'count' }, state.profile.name)),
    years.length > 1 ? h('div', { class: 'view-tabs' }, years.slice(0, 5).map((y) => h('button', { class: `vt f${y === year ? ' on' : ''}`, onclick: () => go(`/stats?annee=${y}`, { replace: true }) }, String(y)))) : null);
  if (!d.totalHours && !d.movies && !d.episodes) {
    page.append(head, h('div', { class: 'grid-empty' }, h('p', {}, `Rien de regardé en ${year} pour l’instant. Lancez un film : vos statistiques se rempliront toutes seules.`)));
    return;
  }
  const days = Math.floor(d.totalHours / 24);
  const story = h('section', { class: 'st-year' },
    h('h2', {}, `Votre année ${year} sur Venus`),
    h('p', {}, 'Vous avez passé ', h('strong', {}, d.totalHours < 1 ? fh(d.totalHours).replace('min', 'minutes') : `${nf(Math.round(d.totalHours * 10) / 10)} heures`), days >= 1 ? ` (plus de ${days} jour${days > 1 ? 's' : ''} entier${days > 1 ? 's' : ''})` : '', ' devant vos écrans : ',
      h('strong', {}, `${d.movies} film${d.movies > 1 ? 's' : ''}`), ' et ', h('strong', {}, `${d.episodes} épisode${d.episodes > 1 ? 's' : ''}`), '. ',
      d.genres[0] ? ['Votre genre préféré : ', h('strong', {}, d.genres[0].name), '. '] : null,
      d.topShows[0] && d.topShows[0].eps ? ['La série qui vous a le plus tenu : ', h('strong', {}, d.topShows[0].title), ` (${d.topShows[0].eps} épisodes). `] : null,
      d.bestMonth && d.bestMonth.hours ? ['Votre plus gros mois : ', h('strong', {}, MONTHS_LONG[d.bestMonth.m]), '. '] : null,
      d.person ? ['Vous avez beaucoup vu ', h('strong', {}, d.person), '.'] : null));
  const kpi = (v, label) => h('div', { class: 'st-kpi' }, h('b', {}, v), h('span', {}, label));
  const max = Math.max(0.01, ...d.months.map((m) => m.hours));
  const months = h('div', { class: 'dash-box' }, h('div', { class: 'dash-title' }, h('h2', {}, 'Mois par mois')),
    h('div', { class: 'st-months' }, d.months.map((m) => h('div', { class: 'st-month', title: `${MONTHS_LONG[m.m]} : ${fh(m.hours)}` },
      m.hours ? h('b', {}, m.hours < 1 ? fh(m.hours) : nf(Math.round(m.hours))) : null, h('i', { style: { height: `${Math.max(2, Math.round((m.hours / max) * 104))}px` } }), h('small', {}, MONTHS[m.m].slice(0, 3))))));
  const gmax = Math.max(0.01, ...d.genres.map((g) => g.hours));
  const genres = h('div', { class: 'dash-box' }, h('div', { class: 'dash-title' }, h('h2', {}, 'Genres')),
    d.genres.length ? d.genres.map((g) => h('div', { class: 'q-bar' }, h('span', {}, g.name), h('div', { class: 'meter' }, h('i', { style: { width: `${(g.hours / gmax) * 100}%` } })), h('b', {}, fh(g.hours))))
      : h('p', { class: 'muted' }, 'Pas encore assez de données.'));
  const top = (title, list, sub) => h('div', { class: 'dash-box' }, h('div', { class: 'dash-title' }, h('h2', {}, title)),
    list.length ? h('div', { class: 'st-top' }, list.map((x) => h('button', { class: 'st-top-row f', onclick: () => go(`/titre/${x.id}`) },
      x.poster ? h('img', { src: img(x.poster), alt: '', loading: 'lazy' }) : h('span', { class: 'st-ph' }), h('b', {}, x.title), h('span', {}, sub(x))))) : h('p', { class: 'muted' }, 'Rien pour l’instant.'));
  page.append(head, story,
    h('div', { class: 'st-kpis' }, kpi(fh(d.totalHours), `regardées en ${year}`), kpi(String(d.movies), 'films vus'), kpi(String(d.episodes), 'épisodes vus'),
      kpi(String(d.days), 'jours avec une lecture'), kpi(`${d.streak} j`, 'plus longue série de jours'), kpi(fh(d.allTimeHours), 'depuis le début')),
    h('div', { class: 'st-grid' }, months, genres),
    h('div', { class: 'st-grid' }, top('Séries les plus regardées', d.topShows, (x) => [x.eps ? `${x.eps} ép.` : null, fh(x.hours)].filter(Boolean).join(' · ')), top('Derniers films vus', d.lastMovies, (x) => new Date(x.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }))));
}
