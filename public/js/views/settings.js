// Réglages : mon profil (tous) + administration du serveur (administrateur)
import { api, auth, preferredQuality, setPreferredQuality } from '../api.js';
import { h, icon, avatar, sheet, toast, AVATAR_HUES, fmtTime, confirmSheet } from '../ui.js';
import { state, switchProfile, go } from '../app.js';
import { openSourceWizard } from './source-wizard.js';

const AGES = [['', 'Aucune limite'], ['3', '3 ans et +'], ['7', '7 ans et +'], ['10', '10 ans et +'], ['12', '12 ans et +'], ['16', '16 ans et +']];
const LANGS = [['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'], ['de', 'Allemand'], ['it', 'Italien'], ['pt', 'Portugais'], ['ja', 'Japonais'], ['ar', 'Arabe']];
const HW = [['auto', 'Automatique (recommandé)'], ['nvenc', 'NVIDIA (NVENC)'], ['vaapi', 'Intel / AMD (VA-API)'], ['qsv', 'Intel Quick Sync'], ['v4l2m2m', 'Raspberry Pi'], ['none', 'Processeur uniquement']];

const select = (opts, value, attrs = {}) => h('select', { class: 'input', ...attrs }, opts.map(([v, l]) => h('option', { value: v, selected: String(value ?? '') === v }, l)));
const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('small', {}, hint) : null);
const LIB_ICON = { movies: 'film', shows: 'tv', anime: 'spark', clips: 'note', iptv: 'live' };
const SOURCE_TYPES = [
  ['movies', 'Films', 'Un film par fichier, ou un dossier par film.'],
  ['shows', 'Séries', 'Un dossier par série, puis un dossier par saison (S01E01 dans le nom).'],
  ['anime', 'Animés', 'Rangés comme des séries : un dossier par animé, épisodes numérotés.'],
  ['clips', 'Clips', 'Clips musicaux ou vidéos courtes. Nom conseillé : « Artiste - Titre ».'],
  ['iptv', 'TV en direct (IPTV)', 'Collez l’adresse M3U fournie par votre abonnement IPTV, ou le chemin d’un fichier .m3u sur le serveur.'],
];
const fmtBytes = (b) => `${(b / 1073741824).toFixed(1).replace('.', ',')} Go`;

export async function render(main) {
  const me = state.profile;
  const page = h('div', { class: 'page admin' });
  main.append(page);
  let timer = null;

  // ----------------------------------------------------------- mon profil
  const myBox = h('section', { class: 'box' },
    h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '14px' } }, avatar(me, 'sm'), h('h2', {}, me.name)),
    field('Langue audio préférée', select(LANGS, me.audioLang, { onchange: (e) => saveMe({ audioLang: e.target.value }) })),
    field('Langue des sous-titres', select(LANGS, me.subtitleLang, { onchange: (e) => saveMe({ subtitleLang: e.target.value }) }),
      'Si l’audio est déjà dans votre langue, seuls les sous-titres « forcés » s’affichent.'),
    field('Qualité sur cet appareil', select([['auto', 'Auto'], ['original', 'Originale'], ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p'], ['360p', '360p (data mobile)']], preferredQuality(),
      { onchange: (e) => { setPreferredQuality(e.target.value); toast('Qualité enregistrée pour cet appareil'); } })),
    h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
      h('button', { class: 'btn btn-small f', onclick: () => editProfile(me, true, () => window.dispatchEvent(new CustomEvent('vn:reboot'))) }, 'Modifier nom, couleur et code PIN'),
      h('button', { class: 'btn btn-small f', onclick: switchProfile }, 'Changer de profil'),
      h('button', { class: 'btn btn-small btn-danger f', onclick: async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); auth.token = null; window.dispatchEvent(new CustomEvent('vn:reboot')); } }, 'Déconnecter l’appareil')));

  async function saveMe(body) {
    const p = await api(`/api/profiles/${me.id}`, { method: 'PUT', body });
    Object.assign(state.profile, p);
    toast('Préférence enregistrée');
  }

  page.append(h('div', { class: 'page-head' }, h('h1', {}, 'Réglages')));
  if (!me.isAdmin) { page.append(h('div', { class: 'admin-grid' }, myBox)); return; }

  // ----------------------------------------------------------- administration
  const grid = h('div', { class: 'admin-grid' });
  page.append(grid);

  async function refresh() {
    let a;
    try { a = await api('/api/admin'); } catch (e) { grid.replaceChildren(h('p', { class: 'error-text' }, e.message)); return; }
    grid.replaceChildren(libraryBox(a), myBox, playbackBox(a), profilesBox(a), metadataBox(a), serverBox(a), devicesBox(a));
    clearTimeout(timer);
    const delay = a.scan.running || a.sessions.length ? 3000 : 15000;
    const tick = () => {
      const el = document.activeElement;
      const busy = document.querySelector('.sheet-wrap') || (grid.contains(el) && /INPUT|SELECT/.test(el.tagName));
      if (busy) timer = setTimeout(tick, delay); else refresh();
    };
    timer = setTimeout(tick, delay);
  }

  // Espace « Bibliothèques » : un bloc par type de média, détection automatique des ajouts
  function libraryBox(a) {
    const s = a.scan;
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    const COUNTS = { movies: [a.counts.movie, 'film'], shows: [a.counts.show, 'série'], anime: [null, 'animé'], clips: [a.counts.clip, 'clip'], iptv: [a.counts.channel, 'chaîne'] };
    const typeCard = ([type, label, hint]) => {
      const libs = a.libraries.filter((l) => l.type === type);
      const [n, word] = COUNTS[type];
      return h('div', { class: `lib-card${libs.length ? '' : ' empty'}` },
        h('div', { class: 'lib-head' }, icon(LIB_ICON[type]), h('b', {}, label),
          libs.length && n ? h('small', {}, `${n} ${word}${n > 1 ? 's' : ''}`) : null),
        libs.length ? libs.map((l) => h('div', { class: 'list-row' },
          h('span', { class: `dot${l.exists ? '' : ' off'}`, title: l.exists ? 'Accessible' : 'Inaccessible' }),
          h('div', { class: 'grow' },
            l.network ? h('span', { class: 'net-line' }, icon('wifi'), l.network.address) : h('span', {}, l.path),
            l.network && l.network.error ? h('small', { class: 'warn' }, l.network.error)
              : !l.exists ? h('small', { class: 'warn' }, l.network ? 'Partage injoignable' : 'Dossier introuvable')
                : type !== 'iptv' && !l.writable ? h('small', { class: 'muted' }, l.network ? 'Lecture seule' : 'Lecture seule : envoi depuis l’application impossible') : null),
          l.network && !l.exists ? h('button', { class: 'btn btn-small f', onclick: async (e) => {
            e.target.disabled = true;
            try { await api(`/api/admin/libraries/${l.id}/reconnect`, { method: 'POST' }); toast('Partage reconnecté'); } catch (e2) { toast(e2.message, true); }
            refresh();
          } }, 'Reconnecter') : null,
          h('button', { class: 'btn btn-small btn-danger f', 'aria-label': `Retirer ${l.path}`, onclick: async () => {
            if (!(await confirmSheet(`Retirer « ${l.path} » de Venus ? Vos fichiers ne sont pas supprimés.`, 'Retirer'))) return;
            await api(`/api/admin/libraries/${l.id}`, { method: 'DELETE' }); refresh();
          } }, 'Retirer'))) : h('p', { class: 'lib-hint' }, hint),
        h('button', { class: 'btn btn-small f', onclick: () => addLibrary(type) }, icon('plus'), type === 'iptv' ? 'Ajouter une liste IPTV' : 'Ajouter un emplacement'));
    };
    const last = (s.lastAdded || []).slice(0, 6);
    return h('section', { class: 'box libs-box' },
      h('div', { class: 'libs-top' },
        h('div', {}, h('h2', {}, 'Bibliothèques'),
          h('p', {}, 'Indiquez où se trouvent vos films, séries, animés et clips : un dossier de ce serveur ou un partage réseau (NAS, PC Windows). Venus les surveille et chaque nouveau fichier apparaît tout seul.')),
        h('div', { class: 'auto-pill' }, h('span', { class: 'dot' }), 'Détection automatique active')),
      s.running ? h('div', { class: 'scan-line' }, h('p', {}, `${s.phase}… ${s.total ? `${s.done}/${s.total}` : ''}`),
        h('div', { class: 'progress-line' }, h('i', { style: { width: `${pct}%` } }))) : null,
      s.error ? h('p', { class: 'error-text' }, s.error) : null,
      h('div', { class: 'lib-grid' }, SOURCE_TYPES.map(typeCard)),
      last.length ? h('div', { class: 'last-added' }, h('h3', {}, 'Derniers médias détectés'),
        h('ul', {}, last.map((x) => h('li', {}, h('b', {}, x.title), h('small', {}, new Date(x.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })))))) : null,
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn btn-small btn-play f', onclick: () => go('/ajouter') }, icon('upload'), 'Envoyer des vidéos'),
        h('button', { class: 'btn btn-small f', disabled: s.running, onclick: async () => { await api('/api/admin/scan', { method: 'POST', body: {} }); toast('Recherche des nouveautés lancée'); refresh(); } }, 'Rechercher les nouveautés'),
        h('button', { class: 'btn btn-small btn-ghost f', disabled: s.running, onclick: async () => { await api('/api/admin/scan', { method: 'POST', body: { force: true } }); toast('Analyse complète lancée'); refresh(); } }, 'Tout réanalyser')),
      s.lastScan ? h('p', { class: 'lib-foot' }, `Dernière vérification : ${new Date(s.lastScan).toLocaleString('fr-FR')}. Les dossiers du serveur sont surveillés en continu, les partages réseau vérifiés toutes les 10 minutes.`) : null);
  }

  function playbackBox(a) {
    const hwSel = select(HW, a.settings.hwaccel);
    const maxS = h('input', { class: 'input', type: 'number', min: 1, max: 20, value: a.settings.maxSessions });
    return h('section', { class: 'box' },
      h('h2', {}, 'Lecture et conversion'),
      h('p', {}, 'Venus lit vos fichiers tels quels dès que l’appareil le permet. Sinon, il les convertit à la volée avec la puce graphique détectée.'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Accélération'), h('dd', {}, a.hw.label),
        h('dt', {}, 'HDR → SDR'), h('dd', {}, a.hw.tonemap ? 'Disponible' : 'Non disponible'),
        h('dt', {}, 'Processeur'), h('dd', {}, `${a.system.cpus} cœurs, charge ${a.system.load.toFixed(1)}`),
        h('dt', {}, 'Mémoire libre'), h('dd', {}, `${fmtBytes(a.system.memFree)} / ${fmtBytes(a.system.memTotal)}`)),
      a.hw.tested.length ? h('p', { style: { fontSize: '.85rem' } }, `Testé : ${a.hw.tested.map((t) => `${t.label} ${t.ok ? '✓' : '✗'}`).join(', ')}`) : null,
      field('Accélération matérielle', hwSel),
      field('Lectures simultanées maximum', maxS),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small f', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Test du matériel…';
        try { await api('/api/admin/settings', { method: 'PUT', body: { hwaccel: hwSel.value, maxSessions: Number(maxS.value) } }); toast('Réglages enregistrés'); }
        finally { refresh(); }
      } }, 'Enregistrer')),
      h('h2', { style: { marginTop: '18px' } }, `En cours de lecture (${a.sessions.length})`),
      a.sessions.length ? a.sessions.map((s) => h('div', { class: 'list-row' },
        h('span', { class: `dot${s.paused ? ' off' : ''}` }),
        h('div', { class: 'grow' }, h('b', {}, s.item), h('span', {}, `${s.reason}, ${s.pipeline}${s.target ? `, ${s.target.height}p ${(s.target.bitrate / 1e6).toFixed(1)} Mb/s` : ''}${s.paused ? ', en avance, en pause' : ''}`)))) :
        h('p', { style: { margin: 0 } }, 'Aucune conversion en cours. Les lectures directes n’apparaissent pas ici : elles ne coûtent rien au serveur.'));
  }

  function profilesBox(a) {
    return h('section', { class: 'box' },
      h('h2', {}, 'Profils'),
      h('p', {}, 'Un profil enfant ne voit que les titres adaptés à son âge.'),
      a.profiles.map((p) => h('div', { class: 'list-row' },
        avatar(p, 'sm'),
        h('div', { class: 'grow' }, h('b', {}, p.name), h('span', {}, [p.isAdmin ? 'Administrateur' : null, p.maxAge != null ? `Jusqu’à ${p.maxAge} ans` : null, p.hasPin ? 'Code PIN' : null].filter(Boolean).join(', ') || 'Profil standard')),
        h('button', { class: 'btn btn-small f', onclick: () => editProfile(p, false, refresh) }, 'Modifier'))),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small f', onclick: () => editProfile(null, false, refresh) }, icon('plus'), 'Ajouter un profil')),
      h('label', { class: 'switch', style: { marginTop: '10px' } }, h('span', {}, 'Montrer aux enfants les titres sans classification'),
        h('input', { type: 'checkbox', class: 'f', checked: a.settings.kidsAllowUnrated, onchange: async (e) => { await api('/api/admin/settings', { method: 'PUT', body: { kidsAllowUnrated: e.target.checked } }); toast('Enregistré'); } })));
  }

  function metadataBox(a) {
    const key = h('input', { class: 'input', placeholder: a.settings.tmdbConfigured ? 'Clé enregistrée (laisser vide pour conserver)' : 'Collez votre clé API ou jeton TMDB' });
    return h('section', { class: 'box' },
      h('h2', {}, 'Affiches et résumés'),
      h('p', {}, a.settings.tmdbConfigured ? 'TMDB est connecté : affiches, résumés en français et classifications d’âge sont récupérés automatiquement.'
        : 'Ajoutez une clé TMDB gratuite pour obtenir les affiches et résumés en français, et activer le contrôle parental automatique.'),
      field('Clé TMDB', key, h('span', {}, 'Créez-la sur ', h('a', { href: 'https://www.themoviedb.org/settings/api', target: '_blank', rel: 'noopener', style: { textDecoration: 'underline' } }, 'themoviedb.org/settings/api'), '.')),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small f', onclick: async () => {
        if (!key.value.trim()) return;
        await api('/api/admin/settings', { method: 'PUT', body: { tmdbKey: key.value.trim() } }); toast('Clé enregistrée, mise à jour des fiches…'); refresh();
      } }, 'Enregistrer la clé')),
      a.unmatched.length ? h('div', {}, h('h2', { style: { marginTop: '16px' } }, `Titres non reconnus (${a.unmatched.length})`),
        a.unmatched.slice(0, 30).map((u) => h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('b', {}, u.title), h('span', {}, u.type === 'movie' ? `Film${u.year ? `, ${u.year}` : ''}` : 'Série')),
          h('button', { class: 'btn btn-small f', onclick: async () => { const { fixMatch } = await import('./details.js'); fixMatch(u); } }, 'Identifier')))) : null);
  }

  function serverBox(a) {
    const name = h('input', { class: 'input', value: a.settings.serverName });
    const pass = h('input', { class: 'input', type: 'password', placeholder: 'Nouveau mot de passe', autocomplete: 'new-password' });
    const interval = h('input', { class: 'input', type: 'number', min: 5, value: a.settings.scanInterval });
    return h('section', { class: 'box' },
      h('h2', {}, 'Serveur'),
      h('p', {}, `Venus ${a.version}, en ligne depuis ${fmtTime(a.system.uptime)}`),
      field('Nom', name),
      field('Mot de passe du foyer', pass, 'Les appareils déjà connectés restent connectés.'),
      field('Vérifier les nouveautés toutes les (minutes)', interval, 'Les ajouts sont aussi détectés automatiquement quand c’est possible.'),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small f', onclick: async () => {
        await api('/api/admin/settings', { method: 'PUT', body: { serverName: name.value, password: pass.value || undefined, scanInterval: Number(interval.value) } });
        pass.value = ''; toast('Réglages enregistrés');
      } }, 'Enregistrer')));
  }

  function devicesBox(a) {
    return h('section', { class: 'box' }, h('h2', {}, 'Appareils connectés'),
      h('p', {}, 'Derniers appareils ayant utilisé Venus.'),
      a.devices.slice(0, 10).map((d) => h('div', { class: 'list-row' }, h('div', { class: 'grow' },
        h('b', {}, deviceName(d.device)), h('span', {}, `${d.profile || 'Aucun profil'}, ${new Date(d.last_seen).toLocaleString('fr-FR')}`)))));
  }

  // ----------------------------------------------------------- dialogue : ajouter une bibliothèque
  function addLibrary(preset = 'movies') { openSourceWizard(preset, refresh); }

  refresh();
  return { destroy: () => clearTimeout(timer) };
}

// ----------------------------------------------------------- dialogue : profil
function editProfile(p, self, onDone) {
  const isNew = !p;
  const nameIn = h('input', { class: 'input', value: p ? p.name : '', required: true, maxlength: 30 });
  let av = p ? p.avatar : Math.floor(Math.random() * AVATAR_HUES.length);
  const picker = h('div', { class: 'avatar-pick' });
  const paintPicker = () => picker.replaceChildren(...AVATAR_HUES.map((_, i) => h('button', { type: 'button', class: `f${i === av ? ' on' : ''}`, 'aria-label': `Couleur ${i + 1}`, onclick: () => { av = i; paintPicker(); } },
    avatar({ name: nameIn.value || '?', avatar: i }))));
  nameIn.addEventListener('input', paintPicker);
  paintPicker();
  const pin = h('input', { class: 'input', inputmode: 'numeric', maxlength: 4, pattern: '\\d{4}', placeholder: p && p.hasPin ? '•••• (laisser vide pour conserver)' : 'Aucun' });
  const removePin = p && p.hasPin ? h('label', { class: 'switch' }, h('span', {}, 'Supprimer le code PIN'), h('input', { type: 'checkbox', class: 'f' })) : null;
  const age = !self ? select(AGES, p ? p.maxAge : '') : null;
  const adminSw = !self && (!p || p.id !== state.profile.id) ? h('label', { class: 'switch' }, h('span', {}, 'Administrateur (accès aux réglages du serveur)'), h('input', { type: 'checkbox', class: 'f', checked: p ? p.isAdmin : false })) : null;
  const err = h('p', { class: 'error-text' });
  const s = sheet(isNew ? 'Nouveau profil' : `Modifier ${p.name}`, h('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (pin.value && !/^\d{4}$/.test(pin.value)) { err.textContent = 'Le code PIN doit contenir 4 chiffres.'; return; }
    const body = { name: nameIn.value.trim(), avatar: av };
    if (pin.value) body.pin = pin.value; else if (removePin && removePin.querySelector('input').checked) body.pin = null;
    if (age) body.maxAge = age.value === '' ? null : Number(age.value);
    if (adminSw) body.isAdmin = adminSw.querySelector('input').checked;
    try {
      await api(isNew ? '/api/profiles' : `/api/profiles/${p.id}`, { method: isNew ? 'POST' : 'PUT', body });
      s.close(); toast(isNew ? 'Profil créé' : 'Profil enregistré'); onDone && onDone();
    } catch (e2) { err.textContent = e2.message; }
  } },
  field('Nom', nameIn), field('Couleur', picker),
  field('Code PIN', pin, 'Protège l’accès à ce profil.'), removePin,
  age ? field('Contrôle parental', age, 'Les titres au-dessus de cet âge sont masqués.') : null,
  adminSw, err,
  h('div', { class: 'form-actions' },
    !isNew && !self && p.id !== state.profile.id ? h('button', { type: 'button', class: 'btn btn-danger f', onclick: async () => {
      if (!(await confirmSheet(`Supprimer le profil « ${p.name} » et sa progression ?`, 'Supprimer'))) return;
      await api(`/api/profiles/${p.id}`, { method: 'DELETE' }); s.close(); toast('Profil supprimé'); onDone && onDone();
    } }, 'Supprimer') : null,
    h('button', { class: 'btn btn-play f', type: 'submit' }, isNew ? 'Créer le profil' : 'Enregistrer'))));
  setTimeout(() => nameIn.focus(), 30);
}

function deviceName(ua = '') {
  if (/Tizen/i.test(ua)) return 'TV Samsung';
  if (/Web0S|webOS/i.test(ua)) return 'TV LG';
  if (/AFT/i.test(ua)) return 'Fire TV';
  if (/Android TV|GoogleTV|BRAVIA/i.test(ua)) return 'Android TV';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Téléphone Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'PC Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Appareil';
}
