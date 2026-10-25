// Ajouter des vidéos : envoi depuis l'appareil, guide de rangement, liste IPTV
import { api, auth } from '../api.js';
import { h, icon, toast } from '../ui.js';
import { go, state } from '../app.js';

const TYPE_LABEL = { movies: 'Films', shows: 'Séries', anime: 'Animés', clips: 'Clips', iptv: 'TV en direct' };
const GUIDE = {
  movies: ['Un fichier par film, ou un dossier par film.', 'Inception (2010).mkv', 'Interstellar (2014)/Interstellar.mkv'],
  shows: ['Un dossier par série, puis un dossier par saison. Le numéro d’épisode dans le nom : S01E02.', 'Breaking Bad/Saison 1/Breaking Bad S01E01.mkv', 'Breaking Bad/Saison 2/Breaking Bad S02E05.mkv'],
  anime: ['Comme les séries : un dossier par animé, épisodes numérotés.', 'Frieren/Saison 1/Frieren S01E03.mkv', 'One Piece/One Piece - 1071.mkv'],
  clips: ['Tous les fichiers dans le dossier. Nom conseillé : Artiste - Titre.', 'Daft Punk - Around The World.mp4', 'Angèle - Balance ton quoi.mp4'],
};
const fmtSize = (b) => (b >= 1e12 ? `${(b / 1e12).toFixed(1).replace('.', ',')} To` : b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(b / 1e6))} Mo`);

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

  // ------------------------------------------------------------ 1. Envoi depuis cet appareil
  const writable = libs.filter((l) => l.writable);
  const sendBox = h('section', { class: 'box add-send' }, h('h2', {}, 'Envoyer depuis cet appareil'),
    h('p', {}, 'Choisissez où ranger les fichiers, puis déposez-les. Ils apparaissent dans Venus dès la fin de l’envoi.'));
  if (!libs.length) {
    sendBox.append(h('p', { class: 'notice' }, 'Ajoutez d’abord une bibliothèque (Films, Séries…) dans les réglages.'),
      h('button', { class: 'btn btn-play f', onclick: () => go('/reglages') }, 'Ouvrir les bibliothèques'));
  } else if (!writable.length) {
    sendBox.append(h('p', { class: 'notice' }, 'Vos dossiers sont en lecture seule pour Venus. Avec Docker, retirez « :ro » à la fin des volumes de vos médias dans docker-compose.yml, puis relancez « docker compose up -d ».'));
  } else {
    let lib = writable[0];
    const libSel = h('select', { class: 'input', id: 'up-lib', onchange: (e) => { lib = writable.find((l) => String(l.id) === e.target.value); updateFields(); } },
      writable.map((l) => h('option', { value: l.id }, l.name === TYPE_LABEL[l.type] ? l.name : `${l.name} (${TYPE_LABEL[l.type] || l.type})`)));
    const showIn = h('input', { class: 'input', id: 'up-show', list: 'up-shows', placeholder: 'Ex. : Breaking Bad', autocomplete: 'off' });
    const showList = h('datalist', { id: 'up-shows' });
    const seasonIn = h('input', { class: 'input', id: 'up-season', type: 'number', min: 0, max: 99, value: 1 });
    const movieFolder = h('label', { class: 'switch' }, h('span', {}, 'Créer un dossier au nom du film'), h('input', { type: 'checkbox', id: 'up-moviedir', class: 'f', checked: true }));
    const showFields = h('div', { class: 'two-cols' },
      h('div', { class: 'field' }, h('label', { for: 'up-show' }, 'Nom de la série'), showIn, showList),
      h('div', { class: 'field' }, h('label', { for: 'up-season' }, 'Saison'), seasonIn));
    const freeEl = h('small', {});
    const updateFields = async () => {
      const series = lib.type === 'shows' || lib.type === 'anime';
      showFields.hidden = !series;
      movieFolder.hidden = lib.type !== 'movies';
      showIn.parentElement.querySelector('label').textContent = lib.type === 'anime' ? 'Nom de l’animé' : 'Nom de la série';
      freeEl.textContent = lib.free != null ? `Espace libre sur le serveur : ${fmtSize(lib.free)}` : '';
      if (series) {
        try {
          const r = await api(`/api/admin/fs?path=${encodeURIComponent(lib.path)}`);
          showList.replaceChildren(...r.dirs.map((d) => h('option', { value: d })));
        } catch { showList.replaceChildren(); }
      }
    };

    const input = h('input', { type: 'file', id: 'up-files', multiple: true, accept: 'video/*,.mkv,.avi,.m2ts,.ts,.srt,.ass,.ssa,.vtt', hidden: true });
    const drop = h('label', { class: 'drop f', for: 'up-files', tabindex: '0' },
      icon('upload'), h('b', {}, 'Déposez vos vidéos ici'), h('span', {}, 'ou touchez pour choisir des fichiers (vidéos et sous-titres)'));
    const queue = h('div', { class: 'queue', 'aria-live': 'polite' });
    const jobs = [];
    let running = false;

    const folderFor = (file) => {
      if (lib.type === 'shows' || lib.type === 'anime') {
        const name = showIn.value.trim();
        if (!name) return null;
        const season = Number(seasonIn.value);
        return `${name}/${season === 0 ? 'Bonus' : `Saison ${season}`}`;
      }
      if (lib.type === 'movies' && movieFolder.querySelector('input').checked) {
        // Les sous-titres « Film.fr.srt » rejoignent le dossier de « Film.mkv »
        return file.name.replace(/((\.(fr|fre|fra|en|eng|es|de|it|forced|sdh))*\.(srt|ass|ssa|vtt)|\.[^.]+)$/i, '').replace(/[._]+/g, ' ').replace(/\s+(1080p|2160p|720p|4k|multi|french|vff|truefrench|bluray|web[- ]?dl|x26[45]|hevc).*$/i, '').trim();
      }
      return '';
    };

    const addFiles = (files) => {
      for (const file of files) {
        const folder = folderFor(file);
        if (folder === null) { toast(`Indiquez le nom de ${lib.type === 'anime' ? 'l’animé' : 'la série'} avant d’envoyer.`, true); showIn.focus(); return; }
        const bar = h('i');
        const st = h('small', {}, 'En attente');
        const cancel = h('button', { class: 'btn btn-small btn-ghost f', 'aria-label': `Annuler ${file.name}` }, 'Annuler');
        const row = h('div', { class: 'q-row' }, h('div', { class: 'grow' }, h('b', {}, file.name), st, h('div', { class: 'progress-line' }, bar)), cancel);
        const job = { file, lib, folder, bar, st, row, cancel, done: false };
        cancel.onclick = () => { if (job.xhr) job.xhr.abort(); else { job.done = true; st.textContent = 'Annulé'; cancel.remove(); } };
        jobs.push(job);
        queue.append(row);
      }
      run();
    };

    const send = (job) => new Promise((resolve) => {
      const q = new URLSearchParams({ library: job.lib.id, folder: job.folder, name: job.file.name });
      const xhr = new XMLHttpRequest();
      job.xhr = xhr;
      xhr.open('POST', `/api/admin/upload?${q}`);
      if (auth.token) xhr.setRequestHeader('Authorization', `Bearer ${auth.token}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      const t0 = Date.now();
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = (e.loaded / e.total) * 100;
        job.bar.style.width = `${pct}%`;
        const speed = e.loaded / Math.max(1, (Date.now() - t0) / 1000);
        const left = (e.total - e.loaded) / Math.max(1, speed);
        job.st.textContent = `${fmtSize(e.loaded)} sur ${fmtSize(e.total)}, ${fmtSize(speed)}/s, ${left > 90 ? `${Math.round(left / 60)} min` : `${Math.round(left)} s`} restantes`;
      };
      xhr.onload = () => {
        let msg = 'Envoyé. Venus l’analyse et l’ajoute à la bibliothèque.';
        if (xhr.status >= 400) { try { msg = JSON.parse(xhr.responseText).error; } catch { msg = `Erreur ${xhr.status}`; } job.row.classList.add('failed'); }
        else job.bar.style.width = '100%';
        job.st.textContent = msg;
        resolve();
      };
      xhr.onerror = () => { job.st.textContent = 'Connexion au serveur perdue. Réessayez.'; job.row.classList.add('failed'); resolve(); };
      xhr.onabort = () => { job.st.textContent = 'Annulé'; resolve(); };
      job.st.textContent = 'Envoi…';
      xhr.send(job.file);
    });

    async function run() {
      if (running) return;
      running = true;
      for (const job of jobs) {
        if (job.done) continue;
        await send(job);
        job.done = true; job.cancel.remove();
      }
      running = false;
    }

    input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));

    sendBox.append(
      h('div', { class: 'field' }, h('label', { for: 'up-lib' }, 'Ranger dans'), libSel, freeEl),
      showFields, movieFolder, input, drop, queue);
    updateFields();
  }

  // ------------------------------------------------------------ 2. Copier dans les dossiers
  const copyBox = h('section', { class: 'box' }, h('h2', {}, 'Ou copier dans les dossiers du serveur'),
    h('p', {}, 'Vous pouvez aussi copier les fichiers directement (partage réseau, clé USB, disque du NAS). Venus surveille ces dossiers et ajoute les nouveautés toutes seules en quelques secondes.'),
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

  // ------------------------------------------------------------ 3. Liste IPTV
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

  page.append(h('div', { class: 'add-grid' }, sendBox, h('div', { class: 'add-side' }, copyBox, iptvBox)));
  main.append(page);
  return {};
}
