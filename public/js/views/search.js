// Recherche instantanée : titres, titres originaux, acteurs et réalisateurs, genres, années — insensible aux accents.
// Recherches récentes, suggestions, et les titres pas encore dans Venus (TMDB / Seerr) qu'on peut ajouter à ses envies.
import { api } from '../api.js';
import { h, icon, toast } from '../ui.js';
import { card } from '../components.js';
import { go, state } from '../app.js';

const kindOf = (i) => (i.type === 'clip' ? 'clip' : i.type === 'movie' ? 'movie' : i.category === 'anime' ? 'anime' : 'show');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const recentKey = () => `vn_recent_search_${state.profile ? state.profile.id : 0}`;
const getRecent = () => { try { return JSON.parse(localStorage.getItem(recentKey())) || []; } catch { return []; } };
const pushRecent = (q) => { try { localStorage.setItem(recentKey(), JSON.stringify([q, ...getRecent().filter((x) => norm(x) !== norm(q))].slice(0, 8))); } catch { /* */ } };

export async function render(main, { query } = {}) {
  const all = await api('/api/library');
  const index = all.map((i) => ({ i, t: norm(i.title), o: norm(i.originalTitle), g: (i.genres || []).map(norm), p: (i.people || []).map((n) => [n, norm(n)]), y: String(i.year || '') }));
  const genres = [...new Set(all.flatMap((i) => i.genres || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  const input = h('input', { type: 'search', placeholder: 'Titre, acteur, genre, année…', 'aria-label': 'Rechercher', autocomplete: 'off', enterkeyhint: 'search', 'data-autofocus': true, value: (query && query.get('q')) || '' });
  const clear = h('button', { class: 'search-clear f', type: 'button', 'aria-label': 'Effacer', hidden: true, onclick: () => { input.value = ''; paint(); input.focus(); } }, icon('close'));
  const body = h('div', { class: 'search-body' });
  // Filtre : tout, films, séries, animés ou clips (gardé pendant la visite)
  const KINDS = [['all', 'Tout'], ['movie', 'Films'], ['show', 'Séries'], ['anime', 'Animés'], ['clip', 'Clips']];
  const has = (k) => k === 'all' || all.some((i) => kindOf(i) === k);
  let kind = (query && query.get('type')) || 'all';
  const kindBar = h('div', { class: 'seg search-kinds', role: 'group', 'aria-label': 'Type' });
  const paintKinds = () => kindBar.replaceChildren(...KINDS.filter(([k]) => has(k)).map(([k, l]) => h('button', { class: `seg-b f${kind === k ? ' on' : ''}`, 'aria-pressed': String(kind === k), onclick: () => { kind = k; paintKinds(); paint(); } }, l)));
  const keep = (list) => (kind === 'all' ? list : list.filter((i) => kindOf(i) === kind));
  paintKinds();
  let onlineTimer = null, seq = 0;

  const section = (title, ...children) => h('section', { class: 'search-sec' }, h('h2', { class: 'section-title' }, title), ...children);

  const paintEmpty = () => {
    const recent = getRecent();
    const recentEls = recent.length ? section('Recherches récentes',
      h('div', { class: 'chips' }, recent.map((r) => h('button', { class: 'chip small f', onclick: () => { input.value = r; paint(); } }, icon('restart'), r)),
        h('button', { class: 'linkish f', onclick: () => { try { localStorage.removeItem(recentKey()); } catch { /* */ } paint(); } }, 'Effacer'))) : null;
    const genreEls = genres.length ? section('Parcourir par genre', h('div', { class: 'genre-tiles' }, genres.map((g, k) => h('button', { class: 'genre-tile f', style: { '--h': (k * 47) % 360 }, onclick: () => { input.value = g; paint(); } }, g)))) : null;
    const recentAdded = keep([...all]).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 18);
    body.replaceChildren(...[recentEls, genreEls, section('Ajouts récents', h('div', { class: 'grid' }, recentAdded.map((i) => card(i, { poster: true }))))].filter(Boolean));
  };

  const paint = () => {
    clearTimeout(onlineTimer);
    const raw = input.value;
    clear.hidden = !raw;
    const q = norm(raw);
    if (!q) { paintEmpty(); return; }
    const words = q.split(' ');
    const people = new Map();
    const scored = index.map((x) => {
      let s = 0;
      for (const w of words) {
        if (x.t === q) s += 10;
        if (x.t.startsWith(w)) s += 4; else if (x.t.includes(` ${w}`)) s += 3; else if (x.t.includes(w)) s += 2;
        else if (x.o.includes(w)) s += 2;
        else if (x.y === w) s += 2;
        else if (x.g.some((g) => g.startsWith(w))) s += 1.5;
        else if (x.p.some(([, n]) => n.split(' ').some((part) => part.startsWith(w)))) s += 1.2;
        else return null;
      }
      for (const [name, n] of x.p) if (words.every((w) => n.split(' ').some((part) => part.startsWith(w)))) people.set(name, (people.get(name) || 0) + 1);
      return { i: x.i, s };
    }).filter(Boolean).sort((a, b) => b.s - a.s || (b.i.year || 0) - (a.i.year || 0)).map((x) => x.i).filter((i) => kind === 'all' || kindOf(i) === kind);
    // Demande en français (« un film drôle de moins d'1 h 30 des années 90 ») : comprise à partir des données de la médiathèque
    const smart = understand(raw, { genres, people: [...new Set(all.flatMap((i) => i.people || []))] });
    if (smart && smart.terms.length >= 1 && words.length >= 2) {
      const hits = keep(all.filter(smart.test)).sort((a, b) => (b.vote || 0) - (a.vote || 0) || (b.year || 0) - (a.year || 0));
      body.replaceChildren(section('Pour cette demande',
        h('div', { class: 'chips', style: { marginBottom: '10px' } }, smart.terms.map((t) => h('span', { class: 'chip small on' }, t))),
        hits.length ? h('div', { class: 'grid' }, hits.slice(0, 40).map((i) => card(i, { poster: true }))) : h('p', { class: 'grid-empty' }, 'Rien ne correspond à tout ça. Enlevez un critère.')));
      return;
    }
    const genreHits = genres.filter((g) => norm(g).startsWith(q));
    const parts = [];
    if (people.size) {
      parts.push(section('Personnes', h('div', { class: 'people-hits' }, [...people].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) =>
        h('button', { class: 'person-hit f', onclick: async () => { pushRecent(name); const { openPerson } = await import('./details.js'); openPerson({ name }); } },
          h('span', { class: 'ph-ini' }, name.split(' ').map((w) => w[0]).slice(0, 2).join('')), h('span', {}, h('b', {}, name), h('small', {}, `${n} titre${n > 1 ? 's' : ''} dans Venus`)))))));
    }
    if (genreHits.length) parts.push(h('div', { class: 'chips', style: { marginBottom: '8px' } }, genreHits.map((g) => h('button', { class: 'chip small f', onclick: () => go(`/films?genre=${encodeURIComponent(g)}`) }, `Genre : ${g}`))));
    parts.push(section(scored.length ? `Dans Venus · ${scored.length}` : 'Dans Venus',
      scored.length ? h('div', { class: 'grid' }, scored.slice(0, 60).map((i) => card(i, { poster: true }))) : h('p', { class: 'grid-empty' }, 'Rien dans votre médiathèque pour cette recherche.')));
    const online = h('div', { class: 'online-hits' });
    parts.push(online);
    body.replaceChildren(...parts);
    // Pas encore dans Venus : recherche en ligne (après une courte pause de frappe)
    if (q.length >= 2) {
      const my = ++seq;
      onlineTimer = setTimeout(async () => {
        let r;
        try { r = await api(`/api/search/online?q=${encodeURIComponent(raw.trim())}`); } catch { return; }
        if (my !== seq || !r.available || !r.items.length) return;
        online.replaceChildren(section('Pas encore dans Venus', h('div', { class: 'grid' }, r.items.map(onlineCard))));
      }, 350);
    }
  };

  const onlineCard = (x) => {
    const heart = h('button', { class: 'oc-wish f', 'aria-label': `Ajouter ${x.title} à mes envies`, title: 'Ajouter à mes envies (demandé à Seerr)' }, icon('heart'));
    heart.onclick = async (e) => {
      e.stopPropagation();
      heart.disabled = true;
      try {
        const r = await api('/api/wishlist', { method: 'POST', body: { type: x.type, tmdbId: x.tmdbId, title: x.title, original: x.original, poster: x.poster, backdrop: x.backdrop, date: x.date, overview: x.overview, anime: !!x.anime } });
        heart.classList.add('on');
        toast(r.auto ? `« ${x.title} » est dans vos envies et demandé à Seerr` : `« ${x.title} » est dans vos envies`, { type: 'success', action: { label: 'Mes envies', onClick: () => go('/liste?vue=envies') } });
      } catch (err) { toast(err.message, true); heart.disabled = false; }
    };
    return h('div', { class: 'card poster online-card' },
      h('div', { class: 'shot' }, x.poster ? h('img', { src: x.poster, alt: '', loading: 'lazy' }) : h('div', { class: 'ph' }, x.title), heart,
        h('span', { class: 'oc-tag' }, x.type === 'movie' ? 'Film' : x.anime ? 'Animé' : 'Série')),
      h('div', { class: 'cap' }, h('b', {}, x.title), h('span', {}, [x.date ? x.date.slice(0, 4) : null, x.score ? `★ ${(x.score / 10).toFixed(1).replace('.', ',')}` : null].filter(Boolean).join(' · '))));
  };

  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(paint, 90); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { pushRecent(input.value.trim()); input.blur(); } });
  body.addEventListener('click', (e) => { if (e.target.closest('.card') && input.value.trim()) pushRecent(input.value.trim()); }, true);
  main.append(h('div', { class: 'page' }, h('div', { class: 'search-box' }, icon('search'), input, clear), kindBar, body));
  paint();
  setTimeout(() => input.focus(), 50);
  return { destroy: () => { clearTimeout(onlineTimer); clearTimeout(t); } };
}

// ---------------------------------------------------------------- compréhension d'une demande en français
const GENRE_WORDS = [
  [/\b(drole|rire|rigoler|marrant|comedie|comique|humour)\b/, 'Comédie'], [/\b(peur|frisson|horreur|effrayant|flipper|epouvante)\b/, 'Horreur'],
  [/\b(thriller|suspense|tendu|haletant)\b/, 'Thriller'], [/\b(action|explosions|baston)\b/, 'Action'], [/\b(aventure)\b/, 'Aventure'],
  [/\b(romance|amour|romantique|emouvant|pleurer)\b/, 'Romance'], [/\b(drame|dramatique|triste)\b/, 'Drame'], [/\b(science fiction|sf|espace|futur|robots?)\b/, 'Science-Fiction'],
  [/\b(fantastique|magie|dragons?)\b/, 'Fantastique'], [/\b(policier|enquete|crime|flic|detective)\b/, 'Policier'], [/\b(documentaire|docu|vrai|reel)\b/, 'Documentaire'],
  [/\b(animation|dessin anime|cartoon)\b/, 'Animation'], [/\b(famille|enfants?|gamins?|petits)\b/, 'Famille'], [/\b(guerre)\b/, 'Guerre'], [/\b(western)\b/, 'Western'], [/\b(histoire|historique)\b/, 'Histoire'], [/\b(musique|musical|comedie musicale)\b/, 'Musique'], [/\b(mystere|mysterieux)\b/, 'Mystère'],
];
export function understand(raw, { genres, people }) {
  const q = norm(raw);
  const tests = [], terms = [];
  // Type
  if (/\b(films?|long metrage)\b/.test(q)) { tests.push((i) => i.type === 'movie'); terms.push('Film'); }
  else if (/\b(series?)\b/.test(q)) { tests.push((i) => i.type === 'show' && i.category !== 'anime'); terms.push('Série'); }
  else if (/\b(animes?|animation japonaise|manga)\b/.test(q)) { tests.push((i) => i.type === 'show' && i.category === 'anime'); terms.push('Animé'); }
  // Genres (mots du quotidien → genres de la médiathèque)
  const g = new Set();
  for (const [re, name] of GENRE_WORDS) if (re.test(q)) { const real = genres.find((x) => norm(x) === norm(name)) || genres.find((x) => norm(x).startsWith(norm(name).slice(0, 5))); if (real) g.add(real); }
  for (const x of genres) if (q.includes(` ${norm(x)} `) || q.startsWith(`${norm(x)} `) || q.endsWith(` ${norm(x)}`)) g.add(x);
  if (g.size) { const keys = new Set([...g].map(norm)); tests.push((i) => (i.genres || []).some((x) => keys.has(norm(x)))); terms.push(...[...g].filter((x, k, arr) => arr.findIndex((y) => norm(y) === norm(x)) === k)); }
  // Durée : « moins d'1h30 », « moins de 90 min », « court », « long »
  const dur = /moins d(?:e |')?(\d)\s*h\s*(\d{2})?|moins de (\d{2,3}) ?min|plus d(?:e |')?(\d)\s*h\s*(\d{2})?/.exec(q);
  if (dur) {
    const minutes = dur[3] ? Number(dur[3]) : Number(dur[1] || dur[4]) * 60 + Number(dur[2] || dur[5] || 0);
    const less = !dur[4];
    tests.push((i) => i.runtime && (less ? i.runtime <= minutes : i.runtime >= minutes)); terms.push(`${less ? 'Moins' : 'Plus'} de ${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`}`);
  } else if (/\b(court|rapide|vite fait)\b/.test(q)) { tests.push((i) => i.runtime && i.runtime <= 95); terms.push('Court'); }
  else if (/\b(long|fleuve)\b/.test(q)) { tests.push((i) => i.runtime && i.runtime >= 150); terms.push('Long'); }
  // Époque : « années 90 », « des 80s », « de 2015 », « récent », « vieux »
  const dec = /annees? (\d{2,4})|\b(\d{2})s\b/.exec(q);
  if (dec) { let d = Number(dec[1] || dec[2]); if (d < 100) d += d < 30 ? 2000 : 1900; d = Math.floor(d / 10) * 10; tests.push((i) => i.year >= d && i.year < d + 10); terms.push(`Années ${String(d).slice(2)}`); }
  else { const y = /\b(19\d{2}|20\d{2})\b/.exec(q); if (y) { tests.push((i) => i.year === Number(y[1])); terms.push(String(y[1])); } }
  if (/\b(recent|nouveau|sorti recemment|cette annee)\b/.test(q)) { const y = new Date().getFullYear(); tests.push((i) => i.year >= y - 2); terms.push('Récent'); }
  if (/\b(vieux|ancien|classique|culte)\b/.test(q)) { tests.push((i) => i.year && i.year <= 2000); terms.push('Classique'); }
  // Statut : pas vu / déjà vu / pas commencé / en cours
  if (/\b(pas (encore )?(vu|vus|commence|commencee|regarde)|jamais vu|nouveau pour moi)\b/.test(q)) { tests.push((i) => i.status !== 'seen' && i.status !== 'progress'); terms.push('Pas encore vu'); }
  else if (/\b(deja vu|revoir|a revoir)\b/.test(q)) { tests.push((i) => i.status === 'seen'); terms.push('Déjà vu'); }
  else if (/\b(en cours|commence)\b/.test(q)) { tests.push((i) => i.status === 'progress'); terms.push('En cours'); }
  // Note : « bien noté », « les meilleurs »
  if (/\b(bien note|meilleurs?|top|excellent)\b/.test(q)) { tests.push((i) => (i.vote || 0) >= 7.5); terms.push('Bien noté'); }
  // Personne : « avec Omar Sy », « de Nolan »
  const who = /\b(?:avec|de|par|realise par) ([a-z]+(?: [a-z]+){0,2})$/.exec(q.replace(/ (pas|deja|jamais).*$/, ''));
  if (who) { const name = people.find((n) => norm(n) === who[1]) || people.find((n) => norm(n).includes(who[1])); if (name) { tests.push((i) => (i.people || []).includes(name)); terms.push(name); } }
  if (!tests.length) return null;
  return { terms, test: (i) => tests.every((t) => t(i)) };
}
