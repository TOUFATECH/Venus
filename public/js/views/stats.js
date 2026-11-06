// Mes statistiques : l'année en un coup d'œil (heures, calendrier jour par jour), puis le détail
// (mois, jours de la semaine, heures de la journée, films / séries / animés, genres, titres préférés).
// Une seule couleur (celle du thème), plus ou moins intense selon la valeur ; chaque barre a sa valeur au survol.
import { api } from '../api.js';
import { h, img } from '../ui.js';
import { go, state } from '../app.js';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const DAYS_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const KIND = { movie: 'Films', show: 'Séries', anime: 'Animés', clip: 'Clips' };
const nf = (n) => String(n).replace('.', ',');
// 0,05 h → « 3 min », 12,34 h → « 12,3 h »
const fh = (x) => (!x ? '0 h' : x < 1 ? `${Math.max(1, Math.round(x * 60))} min` : `${nf(x >= 100 ? Math.round(x) : Math.round(x * 10) / 10)} h`);
const fm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`);

export async function render(main, { query } = {}) {
  const year = Number(query && query.get('annee')) || new Date().getFullYear();
  const d = await api(`/api/stats?year=${year}`);
  const page = h('div', { class: 'page stats' });
  main.append(page);
  const years = d.years.length ? d.years : [year];
  const head = h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Mes statistiques'), h('p', { class: 'count' }, state.profile.name)),
    years.length > 1 ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Année' }, years.slice(0, 5).map((y) => h('button', { class: `seg-b f${y === year ? ' on' : ''}`, role: 'radio', 'aria-checked': String(y === year), onclick: () => go(`/stats?annee=${y}`, { replace: true }) }, String(y)))) : null);
  if (!d.totalHours && !d.movies && !d.episodes) {
    page.append(head, h('div', { class: 'empty' }, h('h2', {}, `Rien de regardé en ${year} pour l’instant`), h('p', {}, 'Lancez un film ou un épisode : vos statistiques se rempliront toutes seules.')));
    return;
  }

  // ------------------------------------------------------------ en-tête : le chiffre de l'année et son histoire
  const days = Math.floor(d.totalHours / 24);
  const hero = h('section', { class: 'st-hero' },
    h('div', { class: 'st-big' }, h('b', {}, fh(d.totalHours)), h('span', {}, `regardées en ${year}${days >= 1 ? ` · plus de ${days} jour${days > 1 ? 's' : ''} entier${days > 1 ? 's' : ''}` : ''}`)),
    h('p', { class: 'st-story' },
      d.genres[0] ? ['Genre préféré : ', h('strong', {}, d.genres[0].name), '. '] : null,
      d.topShows[0] && d.topShows[0].eps ? ['Série la plus suivie : ', h('strong', {}, d.topShows[0].title), '. '] : null,
      d.topAnime && d.topAnime[0] && d.topAnime[0].eps ? ['Animé le plus suivi : ', h('strong', {}, d.topAnime[0].title), '. '] : null,
      d.bestMonth && d.bestMonth.hours ? ['Plus gros mois : ', h('strong', {}, MONTHS_LONG[d.bestMonth.m]), '. '] : null,
      d.person ? ['Vous avez beaucoup vu ', h('strong', {}, d.person), '.'] : null),
    h('div', { class: 'st-kpis' },
      kpi(String(d.movies), d.movies > 1 ? 'films vus' : 'film vu'), kpi(String(d.episodes), d.episodes > 1 ? 'épisodes vus' : 'épisode vu'),
      kpi(String(d.days), 'jours avec une lecture'), kpi(`${d.streak} j`, 'plus longue série de jours'), kpi(fh(d.allTimeHours), 'depuis le début')));

  // ------------------------------------------------------------ calendrier de l'année (une case par jour)
  const cal = calendar(year, d.calendar || {});

  // ------------------------------------------------------------ détail
  const months = box('Mois par mois', columns(d.months.map((m) => ({ label: MONTHS[m.m].slice(0, 3), value: m.hours, tip: `${MONTHS_LONG[m.m]} : ${fh(m.hours)}` })), fh));
  const kinds = box('Films, séries, animés', bars((d.byKind || []).filter((k) => k.hours).map((k) => ({ label: KIND[k.kind], value: k.hours })), fh));
  const week = box('Jours de la semaine', columns((d.weekdays || []).map((w) => ({ label: DAYS[w.w], value: w.hours, tip: `${DAYS_LONG[w.w]} : ${fh(w.hours)}` })), fh));
  const clock = box('Heures de la journée', columns((d.hoursOfDay || []).map((x) => ({ label: x.h % 6 === 0 ? `${x.h} h` : '', value: x.hours, tip: `${x.h} h – ${x.h + 1} h : ${fh(x.hours)}` })), fh, { thin: true }));
  const genres = box('Genres', d.genres.length ? bars(d.genres.map((g) => ({ label: g.name, value: g.hours })), fh) : h('p', { class: 'muted' }, 'Pas encore assez de données.'));
  const top = (title, list, sub) => box(title, list && list.length ? h('div', { class: 'st-top' }, list.map((x) => h('button', { class: 'st-top-row f', onclick: () => go(`/titre/${x.id}`) },
    x.poster ? h('img', { src: img(x.poster), alt: '', loading: 'lazy' }) : h('span', { class: 'st-ph' }), h('b', {}, x.title), h('span', {}, sub(x))))) : h('p', { class: 'muted' }, 'Rien pour l’instant.'));
  const showSub = (x) => [x.eps ? `${x.eps} ép.` : null, fh(x.hours)].filter(Boolean).join(' · ');

  page.append(head, hero, cal,
    h('div', { class: 'st-grid two' }, months, kinds, week, clock),
    h('div', { class: 'st-grid' }, genres, top('Séries les plus regardées', d.topShows, showSub), top('Animés les plus regardés', d.topAnime, showSub),
      top('Derniers films vus', d.lastMovies, (x) => new Date(x.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }))));
}

const kpi = (v, label) => h('div', { class: 'st-kpi' }, h('b', {}, v), h('span', {}, label));
const box = (title, body) => h('section', { class: 'dash-box st-box' }, h('div', { class: 'dash-title' }, h('h2', {}, title)), body);

// Barres verticales, valeur au survol (et en clair sur la plus haute)
function columns(items, fmt, { thin = false } = {}) {
  const max = Math.max(0.0001, ...items.map((x) => x.value));
  const peak = items.reduce((a, b) => (b.value > a.value ? b : a), items[0] || { value: 0 });
  return h('div', { class: `st-cols${thin ? ' thin' : ''}`, role: 'img', 'aria-label': items.map((x) => x.tip).join(', ') },
    items.map((x) => h('div', { class: 'st-col', title: x.tip },
      h('span', { class: 'st-val' }, x === peak && x.value ? fmt(x.value) : ''),
      h('i', { style: { height: `${x.value ? Math.max(4, Math.round((x.value / max) * 100)) : 2}%` }, class: x.value ? '' : 'zero' }),
      h('small', {}, x.label))));
}
// Barres horizontales : libellé, barre, valeur
function bars(items, fmt) {
  const max = Math.max(0.0001, ...items.map((x) => x.value));
  return h('div', { class: 'st-bars' }, items.map((x) => h('div', { class: 'st-bar', title: `${x.label} : ${fmt(x.value)}` },
    h('span', {}, x.label), h('div', { class: 'meter' }, h('i', { style: { width: `${Math.max(2, (x.value / max) * 100)}%` } })), h('b', {}, fmt(x.value)))));
}
// Calendrier façon « contributions » : 7 lignes (lundi → dimanche), une colonne par semaine, intensité selon les minutes
function calendar(year, data) {
  const start = new Date(year, 0, 1), end = new Date(year, 11, 31);
  const first = new Date(start); first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const vals = Object.values(data).filter(Boolean).sort((a, b) => a - b);
  // Seuils sur la répartition réelle (quartiles), pour que les petits et les gros jours se distinguent
  const q = (p) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 1;
  const steps = [q(0.25), q(0.5), q(0.75)];
  const level = (v) => (!v ? 0 : v <= steps[0] ? 1 : v <= steps[1] ? 2 : v <= steps[2] ? 3 : 4);
  const cells = [], labels = [];
  const today = new Date();
  for (let w = 0, dte = new Date(first); dte <= end; w++) {
    for (let k = 0; k < 7; k++, dte.setDate(dte.getDate() + 1)) {
      const key = `${dte.getFullYear()}-${String(dte.getMonth() + 1).padStart(2, '0')}-${String(dte.getDate()).padStart(2, '0')}`;
      const inYear = dte.getFullYear() === year, future = dte > today;
      const v = data[key] || 0;
      cells.push(h('i', { class: `cal-c l${inYear && !future ? level(v) : 'x'}`, style: { gridColumn: w + 1, gridRow: k + 1 },
        title: inYear ? `${dte.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} : ${v ? fm(v) : 'rien'}` : '' }));
      if (inYear && dte.getDate() === 1) labels.push(h('small', { style: { gridColumn: w + 1 } }, MONTHS[dte.getMonth()].slice(0, 4)));
    }
  }
  const active = vals.length;
  return h('section', { class: 'dash-box st-cal-box' },
    h('div', { class: 'dash-title' }, h('h2', {}, 'Jour par jour'), h('span', { class: 'muted' }, `${active} jour${active > 1 ? 's' : ''} avec une lecture`)),
    h('div', { class: 'st-cal-scroll' }, h('div', { class: 'st-cal-months' }, labels), h('div', { class: 'st-cal', role: 'img', 'aria-label': `Calendrier ${year} : ${active} jours avec une lecture` }, cells)),
    h('div', { class: 'st-cal-legend' }, h('small', {}, 'Moins'), [0, 1, 2, 3, 4].map((l) => h('i', { class: `cal-c l${l}` })), h('small', {}, 'Plus')));
}
