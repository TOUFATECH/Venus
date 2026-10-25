// Téléchargements : vidéos préparées pour regarder sans réseau (train, avion…)
import { api, auth } from '../api.js';
import { h, icon, img, sheet, toast } from '../ui.js';
import { go } from '../app.js';

const fmtSize = (b) => (!b ? '' : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.round(b / 1e6)} Mo`);
const fileUrl = (j) => `/api/downloads/${j.id}/file?token=${encodeURIComponent(auth.token || '')}`;
const STATE = { queued: 'En attente', working: 'Préparation', ready: 'Prêt', error: 'Échec' };

export async function render(main) {
  const list = h('div', { class: 'dl-list' });
  let timer = null;
  const paint = async () => {
    const jobs = await api('/api/downloads');
    list.replaceChildren(...(jobs.length ? jobs.map((j) => h('div', { class: `dl-row st-${j.state}` },
      h('span', { class: 'dl-pic' }, j.poster ? h('img', { src: img(j.poster), alt: '' }) : null),
      h('div', { class: 'dl-body' }, h('b', {}, j.title), h('small', {}, [j.quality === 'original' ? 'Original' : `Version légère ${j.quality}`, STATE[j.state], j.size ? fmtSize(j.size) : null].filter(Boolean).join(' · ')),
        j.state === 'working' || j.state === 'queued' ? h('div', { class: 'meter' }, h('i', { style: { width: `${j.progress}%` } })) : null,
        j.error ? h('small', { class: 'error-text' }, j.error) : null),
      h('div', { class: 'dl-actions' },
        j.state === 'ready' ? h('a', { class: 'btn btn-small f', href: fileUrl(j), download: j.name }, icon('down'), 'Enregistrer') : j.state === 'working' ? h('span', { class: 'dl-pct' }, `${j.progress} %`) : null,
        h('button', { class: 'btn btn-ghost btn-icon btn-mini f', 'aria-label': 'Supprimer', title: 'Supprimer', onclick: async () => { await api(`/api/downloads/${j.id}`, { method: 'DELETE' }); paint(); } }, icon('close')))))
      : [h('div', { class: 'grid-empty' }, h('p', {}, 'Aucun téléchargement. Sur la fiche d’un film ou d’une saison, touchez « Télécharger ».'))]));
    clearTimeout(timer);
    if (jobs.some((j) => j.state === 'working' || j.state === 'queued')) timer = setTimeout(paint, 2000);
  };
  main.append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'Téléchargements'))),
    h('p', { class: 'list-hint' }, 'Les vidéos sont enregistrées sur votre appareil : elles se regardent ensuite sans réseau. Sur iPhone, choisissez « Enregistrer dans Fichiers » puis ouvrez-les avec l’appli Fichiers ou VLC. Les versions légères restent prêtes 7 jours sur le serveur.'),
    list));
  await paint();
  return { destroy: () => clearTimeout(timer) };
}

// Choix de la version à télécharger (film, épisode ou saison entière)
export function openDownload({ id, title, size, duration, season = false }) {
  const est = (gbPerHour) => (duration ? `≈ ${fmtSize(gbPerHour * 1e9 * (duration / 3600))}` : '');
  const prep = async (quality) => {
    s.close();
    try {
      const r = await api(`/api/items/${id}/download`, { method: 'POST', body: { quality } });
      toast(r.length > 1 ? `${r.length} épisodes en préparation (${quality})` : `« ${title} » en préparation (${quality})`, { type: 'success', action: { label: 'Voir', onClick: () => go('/telechargements') } });
    } catch (e) { toast(e.message, true); }
  };
  const s = sheet(`Télécharger ${season ? 'la saison' : `« ${title} »`}`, h('div', { class: 'dl-choices' },
    season ? null : h('a', { class: 'opt f', href: `/api/items/${id}/download?token=${encodeURIComponent(auth.token || '')}`, download: '', onclick: () => setTimeout(() => s.close(), 300) },
      icon('down'), h('span', {}, h('b', {}, 'Fichier d’origine'), h('small', {}, ['Meilleure qualité', fmtSize(size)].filter(Boolean).join(' · ')))),
    h('button', { class: 'opt f', onclick: () => prep('720p') }, icon('film'), h('span', {}, h('b', {}, 'Version légère 720p'), h('small', {}, ['Idéale pour un téléphone ou une tablette', season ? '≈ 0,9 Go par heure' : est(0.9)].filter(Boolean).join(' · ')))),
    h('button', { class: 'opt f', onclick: () => prep('480p') }, icon('film'), h('span', {}, h('b', {}, 'Très légère 480p'), h('small', {}, ['Pour garder de la place', season ? '≈ 0,45 Go par heure' : est(0.45)].filter(Boolean).join(' · ')))),
    h('p', { class: 'muted', style: { fontSize: '.84rem', margin: '10px 0 0' } }, 'Les versions légères sont préparées par le serveur, puis disponibles dans « Téléchargements ».')));
}
