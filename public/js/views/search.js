// Recherche instantanée (titres, titres originaux, genres) — insensible aux accents
import { api } from '../api.js';
import { h, icon } from '../ui.js';
import { card } from '../components.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');

export async function render(main) {
  const all = await api('/api/library');
  const index = all.map((i) => ({ i, t: norm(i.title), o: norm(i.originalTitle), g: norm((i.genres || []).join(' ')) }));
  const input = h('input', { type: 'search', placeholder: 'Titre, genre…', 'aria-label': 'Rechercher', autocomplete: 'off', enterkeyhint: 'search', 'data-autofocus': true });
  const grid = h('div', { class: 'grid' });
  const info = h('p', { style: { color: 'var(--mist)' } });

  const paint = () => {
    const q = norm(input.value).trim();
    let list;
    if (!q) { list = [...all].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 24); info.textContent = 'Ajouts récents'; }
    else {
      const words = q.split(/\s+/);
      list = index.map((x) => {
        let s = 0;
        for (const w of words) {
          if (x.t.startsWith(w)) s += 4; else if (x.t.includes(` ${w}`)) s += 3; else if (x.t.includes(w)) s += 2;
          else if (x.o.includes(w)) s += 2; else if (x.g.includes(w)) s += 1; else return null;
        }
        return { i: x.i, s };
      }).filter(Boolean).sort((a, b) => b.s - a.s).map((x) => x.i);
      info.textContent = list.length ? `${list.length} résultat${list.length > 1 ? 's' : ''}` : 'Aucun titre ne correspond. Essayez un autre mot.';
    }
    grid.replaceChildren(...list.map((i) => card(i, { poster: true })));
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(paint, 80); });
  main.append(h('div', { class: 'page' }, h('div', { class: 'search-box' }, icon('search'), input), info, grid));
  paint();
  setTimeout(() => input.focus(), 50);
}
