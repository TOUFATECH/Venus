// Recherche instantanée : titres, titres originaux, acteurs et réalisateurs, genres, années — insensible aux accents.
// Recherches récentes, suggestions, et les titres pas encore dans Venus (TMDB / Seerr) qu'on peut ajouter à ses envies.
import { api } from '../api.js';
import { h, icon, toast } from '../ui.js';
import { card } from '../components.js';
import { go, state } from '../app.js';

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
  let onlineTimer = null, seq = 0;

  const section = (title, ...children) => h('section', { class: 'search-sec' }, h('h2', { class: 'section-title' }, title), ...children);

  const paintEmpty = () => {
    const recent = getRecent();
    const recentEls = recent.length ? section('Recherches récentes',
      h('div', { class: 'chips' }, recent.map((r) => h('button', { class: 'chip small f', onclick: () => { input.value = r; paint(); } }, icon('restart'), r)),
        h('button', { class: 'linkish f', onclick: () => { try { localStorage.removeItem(recentKey()); } catch { /* */ } paint(); } }, 'Effacer'))) : null;
    const genreEls = genres.length ? section('Parcourir par genre', h('div', { class: 'genre-tiles' }, genres.map((g, k) => h('button', { class: 'genre-tile f', style: { '--h': (k * 47) % 360 }, onclick: () => { input.value = g; paint(); } }, g)))) : null;
    const recentAdded = [...all].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 18);
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
    }).filter(Boolean).sort((a, b) => b.s - a.s || (b.i.year || 0) - (a.i.year || 0)).map((x) => x.i);
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
  main.append(h('div', { class: 'page' }, h('div', { class: 'search-box' }, icon('search'), input, clear), body));
  paint();
  setTimeout(() => input.focus(), 50);
  return { destroy: () => { clearTimeout(onlineTimer); clearTimeout(t); } };
}
