// Assistant « Ajouter une source » : dossier du serveur, partage réseau (NAS, PC) ou IPTV (M3U, Xtream)
import { api } from '../api.js';
import { h, icon, sheet, toast } from '../ui.js';

const TYPES = [
  ['movies', 'Films'], ['shows', 'Séries'], ['anime', 'Animés'], ['clips', 'Clips'], ['iptv', 'TV en direct (IPTV)'],
];
const NAMES = { movies: 'Films', shows: 'Séries', anime: 'Animés', clips: 'Clips', iptv: 'TV en direct' };
// Chemins Windows (C:\\Films) ou Linux / macOS (/media/films)
const joinPath = (base, name) => (base.includes('\\') ? `${base.replace(/\\$/, '')}\\${name}` : `${base.replace(/\/$/, '')}/${name}`);
const field = (label, input, hint) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('small', {}, hint) : null);

export function openSourceWizard(preset = 'movies', onDone) {
  let type = preset;
  const body = h('div', { class: 'wizard' });
  const s = sheet('Ajouter une source', body);

  const typeBar = () => h('div', { class: 'chips wiz-types', role: 'group', 'aria-label': 'Type de contenu' },
    TYPES.map(([t, l]) => h('button', { type: 'button', class: `chip f${t === type ? ' on' : ''}`, onclick: () => { type = t; start(); } }, l)));

  const finish = async (payload, btn, err) => {
    err.textContent = '';
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = payload.remote ? 'Connexion au partage…' : 'Ajout…';
    try {
      await api('/api/admin/libraries', { method: 'POST', body: { type, ...payload } });
      s.close();
      toast(type === 'iptv' ? 'Liste ajoutée, chargement des chaînes' : 'Source ajoutée, Venus analyse vos vidéos');
      onDone && onDone();
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = label; }
  };

  // ------------------------------------------------------------ étape 1 : où se trouvent les vidéos ?
  function start() {
    const iptv = type === 'iptv';
    const opts = iptv ? [
      ['xtream', 'Identifiants Xtream', 'Serveur, identifiant et mot de passe fournis par votre abonnement', 'live'],
      ['m3u', 'Adresse M3U', 'Un lien http… qui se termine souvent par .m3u ou m3u_plus', 'tv'],
      ['file', 'Fichier sur le serveur', 'Une liste .m3u déjà copiée sur ce serveur', 'folder'],
    ] : [
      ['network', 'Partage réseau', 'Un NAS, un PC Windows, une box ou un disque réseau', 'wifi'],
      ['local', 'Dossier de ce serveur', 'Un disque interne, un disque USB, un dossier déjà monté', 'folder'],
    ];
    body.replaceChildren(typeBar(),
      h('h3', { class: 'wiz-q' }, iptv ? 'Comment accéder à vos chaînes ?' : `Où sont rangés vos ${NAMES[type].toLowerCase()} ?`),
      h('div', { class: 'wiz-choices' }, opts.map(([id, label, sub, ic]) => h('button', { type: 'button', class: 'wiz-choice f', onclick: () => ({ network, local, xtream, m3u, file })[id]() },
        icon(ic), h('b', {}, label), h('small', {}, sub)))));
    requestAnimationFrame(() => body.querySelector('.wiz-choice').focus());
  }

  // ------------------------------------------------------------ dossier local
  function local() {
    const picker = pathPicker({ onError: (m) => { err.textContent = m; } });
    const nameIn = h('input', { class: 'input', id: 'src-name', value: NAMES[type] });
    const err = h('p', { class: 'error-text' });
    const btn = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Ajouter ce dossier');
    body.replaceChildren(typeBar(), backLink(start),
      h('form', { onsubmit: (e) => { e.preventDefault(); if (!picker.value()) { err.textContent = 'Choisissez un dossier.'; return; } finish({ name: nameIn.value, path: picker.value() }, btn, err); } },
        h('h3', { class: 'wiz-q' }, `Choisissez le dossier de vos ${NAMES[type].toLowerCase()}`),
        picker.el, field('Nom affiché', nameIn), err, h('div', { class: 'form-actions' }, btn)));
    picker.open('start');
  }

  // ------------------------------------------------------------ partage réseau : 1. l'appareil
  function network() {
    const list = h('div', { class: 'net-hosts', 'aria-live': 'polite' }, h('p', { class: 'net-searching' }, h('span', { class: 'mini-spin' }), 'Recherche des appareils sur votre réseau…'));
    const hostIn = h('input', { class: 'input', id: 'net-host', placeholder: '192.168.1.20 ou nas.local', autocomplete: 'off' });
    const protoSel = h('select', { class: 'input', id: 'net-proto' }, h('option', { value: 'smb' }, 'SMB (Windows, la plupart des NAS)'), h('option', { value: 'nfs' }, 'NFS (Linux, certains NAS)'));
    const scan = async (force) => {
      try {
        const hosts = await api(`/api/admin/network/discover${force ? '?force=1' : ''}`);
        if (!hosts.length) {
          list.replaceChildren(h('p', { class: 'muted' }, 'Aucun appareil de partage trouvé automatiquement. Saisissez son adresse ci-dessous.'),
            h('button', { type: 'button', class: 'row-link f', onclick: () => { list.replaceChildren(h('p', { class: 'net-searching' }, h('span', { class: 'mini-spin' }), 'Nouvelle recherche…')); scan(true); } }, 'Chercher à nouveau'));
          return;
        }
        list.replaceChildren(...hosts.map((x) => h('button', { type: 'button', class: 'net-host f', onclick: () => login({ host: x.ip, name: x.name, proto: x.smb ? 'smb' : 'nfs', both: x.smb && x.nfs }) },
          icon('server'), h('span', {}, h('b', {}, x.name || x.ip), h('small', {}, x.name ? x.ip : 'Appareil du réseau')),
          h('span', { class: 'net-tags' }, x.smb ? h('span', {}, 'SMB') : null, x.nfs ? h('span', {}, 'NFS') : null))),
        h('button', { type: 'button', class: 'row-link f', onclick: () => scan(true) }, 'Actualiser'));
      } catch (e) { list.replaceChildren(h('p', { class: 'error-text' }, e.message)); }
    };
    const notice = h('div');
    api('/api/admin/network/capability').then((c) => {
      if (!c.advice) return;
      const a = c.advice;
      notice.replaceChildren(h('div', { class: 'advice', role: 'note' },
        h('div', { class: 'advice-head' }, icon('info'), h('b', {}, a.title)), h('p', {}, a.text),
        a.command ? h('div', { class: 'advice-cmd' }, h('code', {}, a.command)) : null,
        h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
          h('button', { type: 'button', class: 'btn btn-small f', onclick: local }, icon('folder'), 'Choisir un dossier déjà monté'))));
    }).catch(() => {});
    body.replaceChildren(typeBar(), backLink(start), notice,
      h('h3', { class: 'wiz-q' }, 'Choisissez l’appareil qui contient vos vidéos'), list,
      h('details', { class: 'wiz-manual' }, h('summary', {}, 'Saisir l’adresse à la main'),
        h('form', { onsubmit: (e) => { e.preventDefault(); if (hostIn.value.trim()) login({ host: hostIn.value.trim(), proto: protoSel.value }); } },
          h('div', { class: 'two-cols wide' }, field('Adresse de l’appareil', hostIn), field('Type de partage', protoSel)),
          h('div', { class: 'form-actions' }, h('button', { class: 'btn f', type: 'submit' }, 'Continuer')))));
    scan(false);
  }

  // ------------------------------------------------------------ 2. identifiants et choix du partage
  function login(dev) {
    let proto = dev.proto;
    const userIn = h('input', { class: 'input', id: 'net-user', autocomplete: 'username', placeholder: 'Laissez vide pour un accès invité' });
    const passIn = h('input', { class: 'input', id: 'net-pass', type: 'password', autocomplete: 'current-password' });
    const shareIn = h('input', { class: 'input', id: 'net-share', placeholder: proto === 'nfs' ? '/volume1/video' : 'Videos', autocomplete: 'off' });
    const shares = h('div', { class: 'net-shares' });
    const err = h('p', { class: 'error-text' });
    const creds = h('div', { class: 'two-cols wide' }, field('Identifiant', userIn), field('Mot de passe', passIn));
    const protoChips = dev.both ? h('div', { class: 'chips' }, ['smb', 'nfs'].map((p) => h('button', { type: 'button', class: `chip f${p === proto ? ' on' : ''}`, onclick: (e) => {
      proto = p; [...e.target.parentNode.children].forEach((c) => c.classList.toggle('on', c === e.target)); creds.hidden = proto === 'nfs'; shares.replaceChildren();
    } }, p.toUpperCase()))) : null;
    creds.hidden = proto === 'nfs';
    const list = async () => {
      err.textContent = '';
      shares.replaceChildren(h('p', { class: 'net-searching' }, h('span', { class: 'mini-spin' }), 'Lecture des partages…'));
      try {
        const r = await api('/api/admin/network/shares', { method: 'POST', body: { proto, host: dev.host, user: userIn.value.trim(), pass: passIn.value } });
        if (!r.length) { shares.replaceChildren(h('p', { class: 'muted' }, 'Aucun partage visible. Saisissez son nom ci-dessous.')); return; }
        shares.replaceChildren(...r.map((x) => h('button', { type: 'button', class: 'net-share f', onclick: () => choose(x.name) }, icon('folder'), h('span', {}, h('b', {}, x.name), x.comment ? h('small', {}, x.comment) : null))));
        shares.querySelector('button').focus();
      } catch (e) { shares.replaceChildren(); err.textContent = e.message; }
    };
    const choose = (share) => confirmShare({ ...dev, proto, user: proto === 'nfs' ? '' : userIn.value.trim(), pass: proto === 'nfs' ? '' : passIn.value, share });
    body.replaceChildren(...[typeBar(), backLink(network),
      h('h3', { class: 'wiz-q' }, dev.name || dev.host),
      protoChips,
      h('form', { onsubmit: (e) => { e.preventDefault(); list(); } }, creds,
        h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-play f', type: 'submit' }, 'Voir les partages'))),
      shares, err,
      h('form', { class: 'wiz-inline', onsubmit: (e) => { e.preventDefault(); if (shareIn.value.trim()) choose(shareIn.value.trim()); } },
        field('Ou nom du partage', shareIn), h('button', { class: 'btn f', type: 'submit' }, 'Utiliser ce partage'))].filter(Boolean));
    setTimeout(() => (proto === 'nfs' ? list() : userIn.focus()), 30);
  }

  // ------------------------------------------------------------ 3. sous-dossier, écriture, nom
  function confirmShare(r) {
    const subIn = h('input', { class: 'input', id: 'net-sub', placeholder: 'Ex. : Films/HD (laisser vide pour tout le partage)', autocomplete: 'off' });
    const nameIn = h('input', { class: 'input', id: 'net-name', value: NAMES[type] });
    const rw = h('input', { type: 'checkbox', id: 'net-rw', class: 'f' });
    const err = h('p', { class: 'error-text' });
    const btn = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Ajouter ce partage');
    const addr = r.proto === 'nfs' ? `${r.host}:${r.share}` : `\\\\${r.host}\\${r.share}`;
    body.replaceChildren(typeBar(), backLink(() => login(r)),
      h('div', { class: 'net-summary' }, icon('wifi'), h('span', {}, h('b', {}, addr), h('small', {}, r.user ? `Connexion en tant que ${r.user}` : 'Accès invité'))),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        finish({ name: nameIn.value, remote: { proto: r.proto, host: r.host, share: r.share, sub: subIn.value.trim(), user: r.user, pass: r.pass, writable: rw.checked } }, btn, err);
      } },
      field('Sous-dossier', subIn, `Si vos ${NAMES[type].toLowerCase()} sont rangés dans un dossier précis du partage.`),
      field('Nom affiché', nameIn),
      h('label', { class: 'switch' }, h('span', {}, 'Autoriser l’envoi de vidéos depuis l’application', h('small', { class: 'muted', style: { display: 'block' } }, 'Sinon, Venus lit seulement le partage.')), rw),
      err, h('div', { class: 'form-actions' }, btn)));
    setTimeout(() => subIn.focus(), 30);
  }

  // ------------------------------------------------------------ IPTV
  function xtream() {
    const server = h('input', { class: 'input', id: 'xt-server', placeholder: 'http://exemple-iptv.com:8080', autocomplete: 'off', inputmode: 'url' });
    const user = h('input', { class: 'input', id: 'xt-user', autocomplete: 'off' });
    const pass = h('input', { class: 'input', id: 'xt-pass', type: 'password', autocomplete: 'off' });
    const nameIn = h('input', { class: 'input', id: 'xt-name', value: NAMES.iptv });
    const err = h('p', { class: 'error-text' });
    const btn = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Ajouter mes chaînes');
    body.replaceChildren(typeBar(), backLink(start),
      h('form', { onsubmit: (e) => { e.preventDefault(); finish({ name: nameIn.value, xtream: { server: server.value.trim(), user: user.value.trim(), pass: pass.value } }, btn, err); } },
        field('Adresse du serveur', server, 'Elle figure dans l’e-mail de votre abonnement IPTV, souvent avec un numéro de port.'),
        h('div', { class: 'two-cols wide' }, field('Identifiant', user), field('Mot de passe', pass)),
        field('Nom affiché', nameIn), err, h('div', { class: 'form-actions' }, btn)));
    setTimeout(() => server.focus(), 30);
  }
  function m3u() {
    const url = h('input', { class: 'input', id: 'm3u-url', placeholder: 'http://mon-fournisseur/get.php?…&type=m3u_plus', autocomplete: 'off', inputmode: 'url' });
    const nameIn = h('input', { class: 'input', id: 'm3u-name', value: NAMES.iptv });
    const err = h('p', { class: 'error-text' });
    const btn = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Ajouter la liste');
    body.replaceChildren(typeBar(), backLink(start),
      h('form', { onsubmit: (e) => { e.preventDefault(); finish({ name: nameIn.value, path: url.value.trim() }, btn, err); } },
        field('Adresse de la liste M3U', url), field('Nom affiché', nameIn), err, h('div', { class: 'form-actions' }, btn)));
    setTimeout(() => url.focus(), 30);
  }
  function file() {
    const picker = pathPicker({ files: ['m3u', 'm3u8'], onError: (m) => { err.textContent = m; } });
    const nameIn = h('input', { class: 'input', id: 'm3u-fname', value: NAMES.iptv });
    const err = h('p', { class: 'error-text' });
    const btn = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Ajouter la liste');
    body.replaceChildren(typeBar(), backLink(start),
      h('form', { onsubmit: (e) => { e.preventDefault(); if (!picker.file()) { err.textContent = 'Choisissez un fichier .m3u dans la liste.'; return; } finish({ name: nameIn.value, path: picker.file() }, btn, err); } },
        h('h3', { class: 'wiz-q' }, 'Choisissez le fichier .m3u'),
        picker.el, field('Nom affiché', nameIn), err, h('div', { class: 'form-actions' }, btn)));
    picker.open('start');
  }

  function backLink(fn) { return h('button', { type: 'button', class: 'row-link f wiz-back', onclick: fn }, icon('back'), 'Retour'); }

  start();
}

// Explorateur de dossiers du serveur : fil d'Ariane cliquable, dossiers (et fichiers si demandés).
// Rien à taper, mais le chemin reste modifiable à la main pour les habitués.
function pathPicker({ files = null, onError } = {}) {
  let current = '', chosenFile = '';
  const crumbs = h('div', { class: 'pp-crumbs' });
  const list = h('div', { class: 'folder-list', role: 'listbox' });
  const manual = h('input', { class: 'input', placeholder: 'ou saisissez un chemin, puis Entrée', autocomplete: 'off', spellcheck: 'false' });
  const chosen = h('div', { class: 'picked', hidden: true });
  manual.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); open(manual.value.trim() || '/'); } });
  const sep = (p) => (p.includes('\\') ? '\\' : '/');
  function paintCrumbs(r) {
    const parts = [];
    if (r.path === '/' || !r.path) parts.push(['/', r.absolute ? 'Ce PC' : 'Racine']);
    else {
      const sp = sep(r.path);
      const bits = r.path.split(sp).filter(Boolean);
      let acc = sp === '/' ? '' : '';
      parts.push(['/', sp === '/' ? 'Racine' : 'Ce PC']);
      bits.forEach((b, i) => {
        acc = sp === '/' ? `${acc}/${b}` : (i === 0 ? `${b}\\` : `${acc.replace(/\\$/, '')}\\${b}`);
        parts.push([acc, b]);
      });
    }
    crumbs.replaceChildren(...parts.flatMap(([p, label], i) => [i ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null,
      h('button', { type: 'button', class: `crumb f${i === parts.length - 1 ? ' on' : ''}`, onclick: () => open(p) }, label)]).filter(Boolean));
  }
  function pickFile(path, btn) {
    chosenFile = path;
    list.querySelectorAll('.is-picked').forEach((x) => x.classList.remove('is-picked'));
    btn.classList.add('is-picked');
    chosen.hidden = false; chosen.replaceChildren(icon('check'), h('span', {}, path));
  }
  async function open(p) {
    try {
      const r = await api(`/api/admin/fs?path=${encodeURIComponent(p)}${files ? `&files=${files.join(',')}` : ''}`);
      current = r.absolute && r.path === '/' ? '' : r.path;
      manual.value = current;
      paintCrumbs(r);
      const items = [
        r.path !== '/' ? h('button', { type: 'button', class: 'f', onclick: () => open(r.parent) }, icon('back'), '..') : null,
        ...r.dirs.map((d) => h('button', { type: 'button', class: 'f', onclick: () => open(r.absolute ? d : joinPath(r.path, d)) }, icon('folder'), h('span', {}, d))),
        ...(r.files || []).map((f) => { const full = joinPath(r.path, f); const b = h('button', { type: 'button', class: 'f file', onclick: () => pickFile(full, b) }, icon('tv'), h('span', {}, f)); if (full === chosenFile) b.classList.add('is-picked'); return b; }),
      ].filter(Boolean);
      if (!r.dirs.length && !(r.files || []).length) items.push(h('p', { class: 'muted folder-empty' }, files ? 'Aucun sous-dossier ni fichier .m3u ici.' : 'Aucun sous-dossier : ce dossier peut être choisi.'));
      list.replaceChildren(...items);
      list.scrollTop = 0;
    } catch (e) { if (p !== '/') open('/'); else onError && onError(e.message); }
  }
  const el = h('div', { class: 'path-picker' }, crumbs, list,
    files ? chosen : h('p', { class: 'picker-hint' }, 'Entrez dans le dossier voulu : c’est le dossier affiché en haut qui sera ajouté.'),
    h('details', { class: 'wiz-manual' }, h('summary', {}, 'Saisir le chemin à la main'), manual));
  return { el, open, value: () => current, file: () => chosenFile };
}
