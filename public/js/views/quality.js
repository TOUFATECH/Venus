// Qualité de la médiathèque (administration) : définition, codecs, HDR, poids ; titres à améliorer,
// avec demande d'une meilleure version (ou 4K) à Seerr.
import { api } from '../api.js';
import { h, icon, img, toast } from '../ui.js';
import { go, state } from '../app.js';

const fmtBytes = (b) => (b >= 1e12 ? `${(b / 1e12).toFixed(2).replace('.', ',')} To` : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.round(b / 1e6)} Mo`);
const FILTERS = [['improve', 'À améliorer'], ['all', 'Tout'], ['4K', '4K'], ['1080p', '1080p'], ['720p', '720p'], ['SD', 'SD'], ['hdr', 'HDR']];

export async function render(main) {
  if (!state.profile.isAdmin) { main.append(h('div', { class: 'empty' }, h('h2', {}, 'Réservé à l’administrateur'))); return; }
  const d = await api('/api/admin/quality');
  const s = d.summary;
  let filter = s.toImprove ? 'improve' : 'all';
  const list = h('div', { class: 'q-list' });
  const chips = h('div', { class: 'seg' });
  const paint = () => {
    chips.replaceChildren(...FILTERS.map(([id, label]) => h('button', { class: `seg-b f${filter === id ? ' on' : ''}`, onclick: () => { filter = id; paint(); } }, label,
      id === 'improve' ? h('small', {}, ` ${s.toImprove}`) : null)));
    const items = d.items.filter((x) => filter === 'all' || (filter === 'improve' ? x.reasons.length : filter === 'hdr' ? x.hdr : x.res === filter));
    list.replaceChildren(...(items.length ? items.slice(0, 300).map(row) : [h('p', { class: 'grid-empty' }, filter === 'improve' ? 'Rien à améliorer : tout est en bonne qualité.' : 'Aucun titre.')]));
  };
  const row = (x) => h('div', { class: 'q-row' },
    h('button', { class: 'q-main f', onclick: () => go(`/titre/${x.id}`) },
      h('span', { class: 'q-pic' }, x.poster ? h('img', { src: img(x.poster), alt: '', loading: 'lazy' }) : null),
      h('span', { class: 'q-text' }, h('b', {}, x.title || '—'), h('small', {}, [x.year, x.type === 'show' ? `${x.files} épisodes` : null, fmtBytes(x.size), x.sizePerHour ? `${fmtBytes(x.sizePerHour)}/h` : null].filter(Boolean).join(' · ')),
        x.reasons.length ? h('em', {}, x.reasons.join(' · ')) : null)),
    h('span', { class: 'q-badges' }, h('span', { class: `badge q-${x.res}` }, x.res), x.hdr ? h('span', { class: 'badge' }, 'HDR') : null, h('span', { class: 'badge ghost' }, x.codec), x.surround ? h('span', { class: 'badge ghost' }, '5.1') : null),
    d.seerr && x.tmdbId ? h('button', { class: 'btn btn-ghost btn-small f', title: 'Demander une meilleure version à Seerr', onclick: (e) => ask(x, e.currentTarget) }, icon('refresh'), x.res === '4K' ? 'Redemander' : 'Meilleure version') : null);
  const ask = async (x, btn) => {
    btn.disabled = true;
    try {
      await api('/api/admin/quality/request', { method: 'POST', body: { type: x.type, tmdbId: x.tmdbId, title: x.title, is4k: x.res !== '4K' && x.res !== 'SD' } });
      toast(`Meilleure version de « ${x.title} » demandée à Seerr`, { type: 'success' });
      btn.replaceChildren(icon('check'), 'Demandé');
    } catch (e) {
      // Pas de serveur 4K dans Seerr : demande normale
      try { await api('/api/admin/quality/request', { method: 'POST', body: { type: x.type, tmdbId: x.tmdbId, title: x.title } }); toast(`Nouvelle demande pour « ${x.title} » envoyée`, { type: 'success' }); btn.replaceChildren(icon('check'), 'Demandé'); }
      catch (e2) { toast(e2.message || e.message, true); btn.disabled = false; }
    }
  };
  const bar = (label, n) => h('div', { class: 'q-bar' }, h('span', {}, label), h('div', { class: 'meter' }, h('i', { style: { width: `${s.total ? (n / s.total) * 100 : 0}%` } })), h('b', {}, String(n)));
  main.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Qualité'), h('p', { class: 'count' }, `${s.total} titres · ${fmtBytes(s.size)}`))),
    h('div', { class: 'q-summary' },
      h('div', { class: 'dash-box' }, h('div', { class: 'dash-title' }, h('h2', {}, 'Définition')), ...['4K', '1080p', '720p', 'SD'].map((r) => bar(r, s.byRes[r] || 0)), bar('HDR', s.hdr)),
      h('div', { class: 'dash-box' }, h('div', { class: 'dash-title' }, h('h2', {}, 'Codecs vidéo')), ...s.codecs.slice(0, 5).map(([c, n]) => bar(c, n))),
      h('div', { class: 'dash-box q-improve' }, h('b', {}, String(s.toImprove)), h('span', {}, s.toImprove ? 'titres pourraient être en meilleure qualité' : 'Toute la médiathèque est en bonne qualité'),
        d.seerr ? null : h('small', { class: 'muted' }, 'Reliez Seerr pour demander une meilleure version en un clic.'))),
    h('div', { class: 'toolbar' }, chips), list));
  paint();
}
