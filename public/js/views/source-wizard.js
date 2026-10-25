// Assistant « Ajouter une source » : dossier du serveur, partage réseau (NAS, PC) ou IPTV (M3U, Xtream)
import { api } from '../api.js';
import { h, icon, sheet, toast } from '../ui.js';

const TYPES = [
  ['movies', 'Films'], ['shows', 'Séries'], ['anime', 'Animés'], ['clips', 'Clips'], ['iptv', 'TV en direct (IPTV)'],
];
const NAMES = { movies: 'Films', shows: 'Séries', anime: 'Animés', clips: 'Clips', iptv: 'TV en direct' };
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
    const pathIn = h('input', { class: 'input', id: 'src-path', value: '/media' });
    const list = h('div', { class: 'folder-list' });
    const nameIn = h('input', { class: 'input', id: 'src-name', value: NAMES[type] });
    const err = h('p', { class: 'error-text' });
    const btn = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Ajouter ce dossier');
    const browse = async (p) => {
      try {
        const r = await api(`/api/admin/fs?path=${encodeURIComponent(p)}`);
        pathIn.value = r.path;
        list.replaceChildren(...[
          r.path !== '/' ? h('button', { type: 'button', class: 'f', onclick: () => browse(r.parent) }, icon('back'), 'Dossier parent') : null,
          ...r.dirs.map((d) => h('button', { type: 'button', class: 'f', onclick: () => browse(`${r.path.replace(/\/$/, '')}/${d}`) }, icon('folder'), d))].filter(Boolean));
      } catch (e) { if (p !== '/') browse('/'); else err.textContent = e.message; }
    };
    body.replaceChildren(typeBar(), backLink(start),
      h('form', { onsubmit: (e) => { e.preventDefault(); finish({ name: nameIn.value, path: pathIn.value }, btn, err); } },
        field('Dossier', pathIn, 'Touchez un dossier pour y entrer. Le chemin affiché est celui qui sera ajouté.'), list,
        field('Nom affiché', nameIn), err, h('div', { class: 'form-actions' }, btn)));
    browse('/media');
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
    body.replaceChildren(typeBar(), backLink(start),
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
    const p = h('input', { class: 'input', id: 'm3u-file', placeholder: '/media/tv/chaines.m3u', autocomplete: 'off' });
    const nameIn = h('input', { class: 'input', id: 'm3u-fname', value: NAMES.iptv });
    const err = h('p', { class: 'error-text' });
    const btn = h('button', { class: 'btn btn-play f', type: 'submit' }, 'Ajouter la liste');
    body.replaceChildren(typeBar(), backLink(start),
      h('form', { onsubmit: (e) => { e.preventDefault(); finish({ name: nameIn.value, path: p.value.trim() }, btn, err); } },
        field('Chemin du fichier .m3u sur le serveur', p), field('Nom affiché', nameIn), err, h('div', { class: 'form-actions' }, btn)));
    setTimeout(() => p.focus(), 30);
  }

  function backLink(fn) { return h('button', { type: 'button', class: 'row-link f wiz-back', onclick: fn }, icon('back'), 'Retour'); }

  start();
}
