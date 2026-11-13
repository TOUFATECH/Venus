// « Nouveau » : chercher un film, une série ou un animé et l'ajouter à Radarr / Sonarr, qui le téléchargent.
// En dessous : les téléchargements en cours (progression), rafraîchis toutes les 15 s.
import { api } from '../api.js';
import { h, icon, toast } from '../ui.js';
import { go, state } from '../core.js';

const KINDS = [['movie', 'Films', 'film'], ['show', 'Séries', 'tv'], ['anime', 'Animés', 'spark']];

// Page Nouveau : chercher un titre et l'envoyer à Radarr / Sonarr
export async function render(main, { query } = {}) {
  const st = await api('/api/arr/status').catch(() => ({ radarr: false, sonarr: false }));
  const admin = !!(state.profile && state.profile.isAdmin);
  let kind = (query && query.get('type')) || (st.radarr ? 'movie' : 'show');
  if (!KINDS.some(([k]) => k === kind)) kind = 'movie';
  const page = h('div', { class: 'page req-page' });
  main.append(page);

  if (!st.radarr && !st.sonarr) {
    page.append(h('div', { class: 'page-head' }, h('h1', {}, 'Nouveau')),
      h('div', { class: 'empty' }, h('h2', {}, 'Radarr et Sonarr ne sont pas encore reliés'),
        h('p', {}, 'Une fois reliés, vous cherchez un film, une série ou un animé ici et un clic suffit : il se télécharge tout seul et arrive dans Venus.'),
        admin ? h('button', { class: 'btn btn-play f', onclick: () => go('/reglages?section=arr') }, icon('settings'), 'Relier Radarr et Sonarr') : h('p', { class: 'muted' }, 'Demandez à l’administrateur de les relier.')));
    return {};
  }

  const input = h('input', { class: 'input', type: 'search', placeholder: 'Titre d’un film, d’une série ou d’un animé…', autocomplete: 'off', 'aria-label': 'Rechercher un titre à ajouter', enterkeyhint: 'search' });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Type' });
  const results = h('div', { class: 'req-grid' });
  const note = h('p', { class: 'muted req-note' });
  const queueBox = h('section', { class: 'req-queue', hidden: true });
  const paintSeg = () => seg.replaceChildren(...KINDS.map(([k, label, ic]) => {
    const off = k === 'movie' ? !st.radarr : !st.sonarr;
    return h('button', { class: `seg-b f${k === kind ? ' on' : ''}`, role: 'radio', 'aria-checked': String(k === kind), disabled: off, title: off ? `${k === 'movie' ? 'Radarr' : 'Sonarr'} n’est pas relié` : '', onclick: () => { kind = k; paintSeg(); search(); } }, icon(ic), label);
  }));

  const add = async (r, btn) => {
    btn.disabled = true; btn.replaceChildren(icon('refresh'), 'Ajout…');
    try {
      const res = await api('/api/arr/add', { method: 'POST', body: { kind, id: r.id } });
      r.requested = true;
      btn.classList.add('done'); btn.replaceChildren(icon('check'), res.already ? 'Déjà demandé' : 'Ajouté');
      toast(res.already ? `« ${res.title} » était déjà demandé` : `« ${res.title} » ajouté : le téléchargement commence`, { type: 'success' });
      setTimeout(loadQueue, 4000);
    } catch (e) { btn.disabled = false; btn.replaceChildren(icon('download'), 'Ajouter'); toast(e.message, true); }
  };
  const tile = (r) => {
    const btn = r.inVenus ? h('span', { class: 'req-state ok' }, icon('check'), 'Déjà dans Venus')
      : r.requested ? h('span', { class: 'req-state' }, icon('check'), 'Déjà demandé')
        : h('button', { class: 'btn btn-small btn-play f' }, icon('download'), 'Ajouter');
    if (btn.tagName === 'BUTTON') btn.onclick = () => add(r, btn);
    const pic = r.poster ? h('img', { src: r.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'req-ph' }, r.title.slice(0, 1));
    if (r.poster) pic.addEventListener('error', () => pic.replaceWith(h('span', { class: 'req-ph' }, r.title.slice(0, 1))), { once: true });
    return h('article', { class: 'req-card' },
      h('div', { class: 'req-pic' }, pic),
      h('div', { class: 'req-body' },
        h('b', { class: 'req-title' }, r.title),
        h('small', {}, [r.year, r.seasons ? `${r.seasons} saison${r.seasons > 1 ? 's' : ''}` : null, r.runtime ? `${r.runtime} min` : null, r.network].filter(Boolean).join(' · ')),
        r.overview ? h('p', {}, r.overview) : null,
        btn));
  };

  let timer = 0, seq = 0;
  async function search() {
    const q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { results.replaceChildren(); note.textContent = 'Tapez au moins deux lettres.'; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      note.textContent = 'Recherche…';
      try {
        const list = await api(`/api/arr/search?kind=${kind}&q=${encodeURIComponent(q)}`);
        if (my !== seq) return;
        // Animés : ceux que Sonarr reconnaît comme tels d'abord
        if (kind === 'anime') list.sort((a, b) => Number(b.animeHint) - Number(a.animeHint));
        results.replaceChildren(...list.map(tile));
        note.textContent = list.length ? `${list.length} résultat${list.length > 1 ? 's' : ''}` : 'Aucun résultat.';
      } catch (e) { if (my === seq) { results.replaceChildren(); note.textContent = e.message; } }
    }, 350);
  }
  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });

  async function loadQueue() {
    let q = [];
    try { q = await api('/api/arr/queue'); } catch { /* */ }
    queueBox.hidden = !q.length;
    queueBox.replaceChildren(h('h2', {}, 'En téléchargement'), h('div', { class: 'req-q-list' }, q.map((x) => h('div', { class: 'req-q' },
      x.poster ? h('img', { src: x.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'req-ph small' }, (x.title || '?').slice(0, 1)),
      h('div', { class: 'grow' }, h('b', {}, x.title, x.episode ? h('small', {}, ` · ${x.episode}`) : null),
        h('div', { class: 'progress-line' }, h('i', { style: { width: `${x.progress}%` } })),
        h('small', {}, [x.status, `${x.progress} %`, x.timeleft && x.timeleft !== '00:00:00' ? `reste ${x.timeleft.replace(/^00:/, '')}` : null].filter(Boolean).join(' · ')))))));
  }

  paintSeg();
  page.append(
    h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Nouveau'), h('p', { class: 'muted' }, 'Ajoutez un titre : il se télécharge tout seul et arrive dans Venus.'))),
    h('div', { class: 'req-bar' }, h('div', { class: 'search-box' }, icon('search'), input), seg),
    queueBox, note, results);
  const q0 = query && query.get('q');
  if (q0) { input.value = q0; search(); }
  else note.textContent = 'Cherchez un titre pour l’ajouter.';
  setTimeout(() => input.focus(), 50);
  loadQueue();
  const iv = setInterval(loadQueue, 15000);
  return { destroy: () => { clearInterval(iv); clearTimeout(timer); } };
}
