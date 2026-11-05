// Ajouter des vidéos : guide de rangement des dossiers du serveur, liste IPTV
import { api } from '../api.js';
import { h, icon, toast } from '../ui.js';
import { go, state } from '../app.js';

const TYPE_LABEL = { movies: 'Films', shows: 'Séries', anime: 'Animés', clips: 'Clips', iptv: 'TV en direct', music: 'Musique', photos: 'Photos', books: 'Livres' };
const GUIDE = {
  movies: ['Un fichier par film, ou un dossier par film.', 'Inception (2010).mkv', 'Interstellar (2014)/Interstellar.mkv'],
  shows: ['Un dossier par série, puis un dossier par saison. Le numéro d’épisode dans le nom : S01E02.', 'Breaking Bad/Saison 1/Breaking Bad S01E01.mkv', 'Breaking Bad/Saison 2/Breaking Bad S02E05.mkv'],
  anime: ['Comme les séries : un dossier par animé, épisodes numérotés.', 'Frieren/Saison 1/Frieren S01E03.mkv', 'One Piece/One Piece - 1071.mkv'],
  clips: ['Tous les fichiers dans le dossier. Nom conseillé : Artiste - Titre.', 'Daft Punk - Around The World.mp4', 'Angèle - Balance ton quoi.mp4'],
};

export async function render(main) {
  if (!state.profile.isAdmin) {
    main.append(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('h2', {}, 'Réservé à l’administrateur'),
      h('p', {}, 'Demandez au propriétaire du serveur d’ajouter les vidéos, ou de vous donner les droits d’administration.'))));
    return {};
  }
  const admin = await api('/api/admin');
  const libs = admin.libraries.filter((l) => l.type !== 'iptv');
  const page = h('div', { class: 'page add-page' });
  page.append(h('div', { class: 'page-head' }, h('h1', {}, 'Ajouter des vidéos')));

  // ------------------------------------------------------------ 1. Copier dans les dossiers
  const copyBox = h('section', { class: 'box' }, h('h2', {}, 'Copier dans les dossiers du serveur'),
    h('p', {}, 'Copiez vos fichiers directement dans les dossiers des bibliothèques (partage réseau, clé USB, disque du NAS). Venus surveille ces dossiers et ajoute les nouveautés toutes seules en quelques secondes.'),
    libs.length ? libs.map((l) => {
      const g = GUIDE[l.type] || GUIDE.movies;
      return h('div', { class: 'guide' },
        h('div', { class: 'guide-head' }, h('b', {}, TYPE_LABEL[l.type] || l.name), h('code', {}, l.path)),
        h('p', {}, g[0]),
        h('pre', {}, `${l.path}/\n  ${g[1]}\n  ${g[2]}`));
    }) : h('p', { class: 'notice' }, 'Aucune bibliothèque pour l’instant.'),
    h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
      h('button', { class: 'btn btn-small f', onclick: () => go('/reglages') }, 'Gérer les bibliothèques'),
      h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => { await api('/api/admin/scan', { method: 'POST', body: {} }); toast('Recherche des nouveautés lancée'); } }, 'Rechercher les nouveautés maintenant')));

  // ------------------------------------------------------------ 2. Liste IPTV
  const iptvLibs = admin.libraries.filter((l) => l.type === 'iptv');
  const urlIn = h('input', { class: 'input', id: 'iptv-url', placeholder: 'http://mon-fournisseur/get.php?…&type=m3u_plus', autocomplete: 'off' });
  const nameIn = h('input', { class: 'input', id: 'iptv-name', value: 'TV en direct' });
  const err = h('p', { class: 'error-text' });
  const iptvBox = h('section', { class: 'box' }, h('h2', {}, 'Ajouter une liste IPTV'),
    h('p', {}, 'Collez l’adresse M3U fournie par votre abonnement. Les chaînes apparaissent dans « TV » avec un aperçu en direct.'),
    iptvLibs.map((l) => h('div', { class: 'list-row' }, h('span', { class: 'dot' }), h('div', { class: 'grow' }, h('b', {}, l.name), h('span', {}, l.path)))),
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try { await api('/api/admin/libraries', { method: 'POST', body: { type: 'iptv', name: nameIn.value, path: urlIn.value.trim() } }); toast('Liste ajoutée, chargement des chaînes'); setTimeout(() => go('/tv'), 2500); }
      catch (e2) { err.textContent = e2.message; }
    } }, h('div', { class: 'field' }, h('label', { for: 'iptv-url' }, 'Adresse de la liste M3U'), urlIn),
    h('div', { class: 'field' }, h('label', { for: 'iptv-name' }, 'Nom affiché'), nameIn), err,
    h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Ajouter la liste'))));

  page.append(h('div', { class: 'add-grid' }, copyBox, h('div', { class: 'add-side' }, iptvBox)));
  main.append(page);
  return {};
}
