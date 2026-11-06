// Réglages : mon profil (tous) + administration du serveur (administrateur)
import { api, auth, preferredQuality, setPreferredQuality, prefs, hoverMode, heroTrailers, detailsTrailers } from '../api.js';
import { h, icon, avatar, sheet, toast, AVATAR_HUES, fmtTime, confirmSheet, passwordProblem, passwordMeter } from '../ui.js';
import { state, switchProfile, go } from '../app.js';
import { openSourceWizard } from './source-wizard.js';
import { NAV_ITEMS, menuPrefs, saveMenuPrefs, resetMenuPrefs, labelOf, iconOf } from '../menu.js';
import { PLANETS, currentPlanet, setPlanet, planetMarkup, glassMode, setGlassMode, sunInfo } from '../themes.js';

const AGES = [['', 'Aucune limite'], ['3', '3 ans et +'], ['7', '7 ans et +'], ['10', '10 ans et +'], ['12', '12 ans et +'], ['16', '16 ans et +']];
const LANGS = [['fr', 'Français'], ['en', 'Anglais'], ['es', 'Espagnol'], ['de', 'Allemand'], ['it', 'Italien'], ['pt', 'Portugais'], ['ja', 'Japonais'], ['ar', 'Arabe']];
const HW = [['auto', 'Automatique (recommandé)'], ['nvenc', 'NVIDIA (NVENC)'], ['vaapi', 'Intel / AMD (VA-API)'], ['qsv', 'Intel Quick Sync'], ['amf', 'AMD (Windows)'], ['videotoolbox', 'Apple (Mac)'], ['v4l2m2m', 'Raspberry Pi'], ['none', 'Processeur uniquement']];

const select = (opts, value, attrs = {}) => h('select', { class: 'input', ...attrs }, opts.map(([v, l]) => h('option', { value: v, selected: String(value ?? '') === v }, l)));
const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('small', {}, hint) : null);
const LIB_ICON = { movies: 'film', shows: 'tv', anime: 'spark', clips: 'note', iptv: 'live', music: 'note', photos: 'image', books: 'book' };
const SOURCE_TYPES = [
  ['movies', 'Films', 'Un film par fichier, ou un dossier par film.'],
  ['shows', 'Séries', 'Un dossier par série, puis un dossier par saison (S01E01 dans le nom).'],
  ['anime', 'Animés', 'Rangés comme des séries : un dossier par animé, épisodes numérotés.'],
  ['clips', 'Clips', 'Clips musicaux ou vidéos courtes. Nom conseillé : « Artiste - Titre ».'],
  ['music', 'Musique', 'Un dossier par artiste, puis par album. Pochette : cover.jpg ; paroles : fichier .lrc du même nom.'],
  ['photos', 'Photos', 'Chaque dossier devient un album.'],
  ['books', 'Livres', 'EPUB, PDF, bandes dessinées CBZ, et livres audio (un dossier par livre, ou un fichier .m4b).'],
  ['iptv', 'TV en direct (IPTV)', 'Collez l’adresse M3U fournie par votre abonnement IPTV, ou le chemin d’un fichier .m3u sur le serveur.'],
];
// Conseil affiché quand le serveur ne peut pas faire quelque chose seul (GPU, partages réseau)
function adviceBox(adv) {
  if (!adv) return null;
  const copy = async (e) => {
    try { await navigator.clipboard.writeText(adv.command); toast('Commande copiée'); }
    catch { const r = document.createRange(); r.selectNodeContents(e.currentTarget.previousSibling); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Sélectionnée : copiez-la avec Ctrl+C'); }
  };
  return h('div', { class: 'advice', role: 'note' },
    h('div', { class: 'advice-head' }, icon('info'), h('b', {}, adv.title)),
    h('p', {}, adv.text),
    adv.command ? h('div', { class: 'advice-cmd' }, h('code', {}, adv.command),
      h('button', { class: 'btn btn-small f', type: 'button', 'aria-label': 'Copier la commande', onclick: copy }, icon('copy'), 'Copier')) : null,
    adv.command && adv.command.includes('<ID-du-conteneur>') ? h('small', {}, 'À lancer sur l’hôte Proxmox, dans le dossier Venus (ou via la commande curl du README). Remplacez <ID-du-conteneur> par le numéro du conteneur, par exemple 7700.') : null);
}
const prefSwitch = (key, label) => h('label', { class: 'switch' }, h('span', {}, label),
  h('input', { type: 'checkbox', class: 'f', checked: !!prefs.get(key), onchange: (e) => { prefs.set(key, e.target.checked); toast('Préférence enregistrée pour cet appareil'); } }));
const fmtBytes = (b) => `${(b / 1073741824).toFixed(1).replace('.', ',')} Go`;

export async function render(main, { query } = {}) {
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
    h('h3', { class: 'box-sub' }, 'Lecture sur cet appareil'),
    prefSwitch('fullscreenOnPlay', 'Plein écran au lancement d’une vidéo'),
    field('Au survol d’une affiche', select([['trailer', 'Bande-annonce (sinon un extrait)'], ['extract', 'Extrait de la vidéo'], ['off', 'Rien']], hoverMode(),
      { onchange: (e) => { prefs.set('hoverMode', e.target.value); toast('Préférence enregistrée pour cet appareil'); } })),
    prefSwitch('hoverSound', 'Aperçus et bandes-annonces avec le son'),
    h('label', { class: 'switch' }, h('span', {}, 'Bandes-annonces dans l’affiche d’accueil'),
      h('input', { type: 'checkbox', class: 'f', checked: heroTrailers(), onchange: (e) => { prefs.set('heroTrailer', e.target.checked); toast('Préférence enregistrée pour cet appareil'); } })),
    h('label', { class: 'switch' }, h('span', {}, 'Bande-annonce en fond des fiches (films, séries, animés)'),
      h('input', { type: 'checkbox', class: 'f', checked: detailsTrailers(), onchange: (e) => { prefs.set('detailsTrailer', e.target.checked); toast('Préférence enregistrée pour cet appareil'); } })),
    h('label', { class: 'switch' }, h('span', {}, 'Montrer les épisodes manquants dans les saisons (diffusés mais pas dans vos dossiers)'),
      h('input', { type: 'checkbox', class: 'f', checked: prefs.get('showMissing') !== false, onchange: (e) => { prefs.set('showMissing', e.target.checked); toast('Préférence enregistrée pour cet appareil'); } })),
    h('label', { class: 'switch' }, h('span', {}, 'Avec le son'),
      h('input', { type: 'checkbox', class: 'f', checked: !!prefs.get('detailsSound'), onchange: (e) => { prefs.set('detailsSound', e.target.checked); toast('Préférence enregistrée pour cet appareil'); } })),
    h('div', { class: 'two-cols wide' },
      field('Sous-titres', select([['text', 'Texte blanc seul'], ['box', 'Texte sur fond noir']], prefs.get('subStyle'), { onchange: (e) => { prefs.set('subStyle', e.target.value); toast('Préférence enregistrée pour cet appareil'); } })),
      field('Taille', select([['small', 'Petite'], ['medium', 'Moyenne'], ['large', 'Grande'], ['xlarge', 'Très grande']], prefs.get('subSize'), { onchange: (e) => { prefs.set('subSize', e.target.value); toast('Préférence enregistrée pour cet appareil'); } })),
      field('Couleur', select([['white', 'Blanc'], ['yellow', 'Jaune']], prefs.get('subColor'), { onchange: (e) => { prefs.set('subColor', e.target.value); toast('Préférence enregistrée pour cet appareil'); } })),
      field('Position', select([['normal', 'En bas de l’image'], ['high', 'Un peu plus haut']], prefs.get('subPos'), { onchange: (e) => { prefs.set('subPos', e.target.value); toast('Préférence enregistrée pour cet appareil'); } }))),
    prefSwitch('autoSkip', 'Passer automatiquement les génériques (opening, ending)'),
    prefSwitch('miniPlayer', 'Mini-lecteur : la vidéo continue en petit quand on quitte le lecteur'),
    pushRow(),
    h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
      h('button', { class: 'btn btn-small f', onclick: () => editProfile(me, true, () => window.dispatchEvent(new CustomEvent('vn:reboot'))) }, 'Modifier nom, couleur et code PIN'),
      h('button', { class: 'btn btn-small f', onclick: switchProfile }, 'Changer de profil'),
      h('button', { class: 'btn btn-small btn-danger f', onclick: async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); auth.token = null; window.dispatchEvent(new CustomEvent('vn:reboot')); } }, 'Déconnecter l’appareil')));

  async function saveMe(body) {
    const p = await api(`/api/profiles/${me.id}`, { method: 'PUT', body });
    Object.assign(state.profile, p);
    toast('Préférence enregistrée');
  }

  const menuBox = menuEditor(me);
  const themeBox = themeEditor();
  page.append(h('div', { class: 'page-head' }, h('h1', {}, 'Réglages'),
    me.isAdmin ? h('button', { class: 'tool f', onclick: () => go('/tableau-de-bord') }, icon('gauge'), 'Tableau de bord') : null));
  // Une rubrique à la fois : onglets en haut, seuls les blocs de la rubrique choisie sont affichés.
  const TABS = me.isAdmin
    ? [['medias', 'Médiathèques', 'folder'], ['profil', 'Mon profil', 'key'], ['affichage', 'Affichage', 'image'], ['lecture', 'Lecture', 'play'], ['famille', 'Profils', 'people'], ['infos', 'Infos et affiches', 'spark'], ['alertes', 'Notifications', 'chat'], ['serveur', 'Serveur', 'server']]
    : [['profil', 'Mon profil', 'key'], ['affichage', 'Affichage', 'image']];
  const SECTION_TAB = { menu: 'affichage', sources: 'infos', seerr: 'infos', ratings: 'infos', affiches: 'infos', subtitles: 'infos', notifications: 'alertes', backups: 'serveur' };
  let tab = SECTION_TAB[query && query.get('section')] || (query && query.get('onglet')) || (() => { try { return sessionStorage.getItem('vn_settings_tab'); } catch { return null; } })() || TABS[0][0];
  if (!TABS.some(([k]) => k === tab)) tab = TABS[0][0];
  const tabBar = h('nav', { class: 'set-tabs', role: 'tablist', 'aria-label': 'Rubriques des réglages' });
  const body = h('div', { class: 'admin-grid' });
  const groups = {};
  const paintTabs = () => tabBar.replaceChildren(...TABS.map(([k, label, ic]) => h('button', { class: `set-tab f${k === tab ? ' on' : ''}`, role: 'tab', 'aria-selected': String(k === tab), onclick: () => { tab = k; try { sessionStorage.setItem('vn_settings_tab', k); } catch { /* */ } paintTabs(); paintBody(); scrollTo({ top: 0 }); } }, icon(ic), h('span', {}, label))));
  const paintBody = () => { body.replaceChildren(...(groups[tab] || []).filter(Boolean)); body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap'); };
  const toMenu = () => {
    const sec = query && query.get('section');
    if (!sec) return;
    requestAnimationFrame(() => { const el = sec === 'menu' ? menuBox : document.getElementById(sec); if (el) el.scrollIntoView({ block: 'start' }); });
  };
  page.append(tabBar, body);
  paintTabs();
  if (!me.isAdmin) { groups.profil = [myBox]; groups.affichage = [themeBox, menuBox]; paintBody(); toMenu(); return; }

  // ----------------------------------------------------------- administration
  const grid = body;

  async function refresh() {
    let a;
    try { a = await api('/api/admin'); } catch (e) { grid.replaceChildren(h('p', { class: 'error-text' }, e.message)); return; }
    const first = !Object.keys(groups).length;
    Object.assign(groups, {
      medias: [libraryBox(a)], profil: [myBox], affichage: [themeBox, menuBox], lecture: [playbackBox(a), subtitlesBox(a)], famille: [profilesBox(a), devicesBox(a)],
      infos: [metadataBox(a), postersBox(a), ratingsBox(a), seerrBox(a)], alertes: [notifyBox(a)], serveur: [serverBox(a), backupBox(a)],
    });
    paintBody();
    if (first) toMenu();
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
    const COUNTS = { movies: [a.counts.movie, 'film'], shows: [a.counts.show, 'série'], anime: [null, 'animé'], clips: [a.counts.clip, 'clip'], iptv: [a.counts.channel, 'chaîne'], music: [a.counts.track, 'titre'], photos: [a.counts.photo, 'photo'], books: [a.counts.book, 'livre'] };
    const typeCard = ([type, label, hint]) => {
      const libs = a.libraries.filter((l) => l.type === type);
      const [n, word] = COUNTS[type] || [null, ''];
      return h('div', { class: `lib-card${libs.length ? '' : ' is-empty'}` },
        h('div', { class: 'lib-head' }, icon(LIB_ICON[type]), h('b', {}, label),
          libs.length && n ? h('small', {}, `${n} ${word}${n > 1 ? 's' : ''}`) : null),
        libs.length ? libs.map((l) => h('div', { class: 'list-row' },
          h('span', { class: `dot${l.exists ? '' : ' off'}`, title: l.exists ? 'Accessible' : 'Inaccessible' }),
          h('div', { class: 'grow' },
            l.network ? h('span', { class: 'net-line' }, icon('wifi'), l.network.address) : h('span', {}, l.path),
            l.network && l.network.error ? h('small', { class: 'warn' }, l.network.error)
              : !l.exists ? h('small', { class: 'warn' }, l.network ? 'Partage injoignable' : 'Dossier introuvable')
                : type !== 'iptv' && !l.writable ? h('small', { class: 'muted' }, 'Lecture seule') : null),
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
      a.runtime && a.runtime.mount ? adviceBox(a.runtime.mount) : null,
      s.running ? h('div', { class: 'scan-line' }, h('p', {}, `${s.phase}… ${s.total ? `${s.done}/${s.total}` : ''}`),
        h('div', { class: 'progress-line' }, h('i', { style: { width: `${pct}%` } }))) : null,
      s.error ? h('p', { class: 'error-text' }, s.error) : null,
      h('div', { class: 'lib-grid' }, SOURCE_TYPES.map(typeCard)),
      last.length ? h('div', { class: 'last-added' }, h('h3', {}, 'Derniers médias détectés'),
        h('ul', {}, last.map((x) => h('li', {}, h('b', {}, x.title), h('small', {}, new Date(x.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })))))) : null,
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn btn-small f', onclick: () => openDuplicates() }, icon('grid4'), 'Doublons'),
        h('button', { class: 'btn btn-small f', onclick: () => openTrash() }, icon('trash'), 'Corbeille'),
        h('button', { class: 'btn btn-small f', onclick: () => openBroken() }, icon('eye'), 'Fichiers abîmés'),
        h('button', { class: 'btn btn-small f', onclick: () => openRename() }, icon('edit'), 'Renommer les fichiers'),
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
      a.runtime ? adviceBox(a.runtime.gpu) : null,
      a.hw.tested.length ? h('p', { style: { fontSize: '.85rem' } }, `Testé : ${a.hw.tested.map((t) => `${t.label} ${t.ok ? '✓' : '✗'}`).join(', ')}`) : null,
      field('Accélération matérielle', hwSel),
      field('Lectures simultanées maximum', maxS),
      h('label', { class: 'switch' }, h('span', {}, 'Repérer les génériques des séries et animés (analyse audio en arrière-plan)'),
        h('input', { type: 'checkbox', class: 'f', checked: a.settings.detectSegments !== false, onchange: async (e) => { await api('/api/admin/settings', { method: 'PUT', body: { detectSegments: e.target.checked } }); toast('Réglage enregistré'); } })),
      field('Vignettes d’aperçu de la barre de lecture', select([['auto', 'Préparées en arrière-plan pour toute la médiathèque'], ['play', 'Préparées à la première lecture seulement'], ['off', 'Désactivées']], a.settings.trickplay || 'auto',
        { onchange: async (e) => { await api('/api/admin/settings', { method: 'PUT', body: { trickplay: e.target.value } }); toast('Réglage enregistré'); } }),
        'Une image toutes les 10 secondes, au survol de la barre. Environ 1 Mo par heure de vidéo.'),
      h('div', { class: 'field', style: { marginTop: '8px' } }, h('label', {}, 'Changer de machine'),
        h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
          h('a', { class: 'btn btn-small f', href: `/api/admin/export?token=${encodeURIComponent(auth.token || '')}`, download: '' }, icon('down'), 'Exporter tout (base + images)'),
          h('button', { class: 'btn btn-small btn-ghost f', onclick: () => importArchive() }, icon('upload'), 'Importer une archive')),
        h('small', {}, 'L’export contient profils, vus, listes, réglages et affiches choisies, jamais les vidéos. Sur la nouvelle machine : installez Venus, puis « Importer ».')),
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

  // Notes des sites : clés facultatives (OMDb pour IMDb / Rotten Tomatoes / Metacritic, Simkl, Trakt)
  function ratingsBox(a) {
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener', style: { textDecoration: 'underline' } }, text);
    const omdb = h('input', { class: 'input', placeholder: a.settings.omdbConfigured ? 'Clé enregistrée (laisser vide pour conserver)' : 'Clé OMDb' });
    const simkl = h('input', { class: 'input', placeholder: a.settings.simklConfigured ? 'Identifiant enregistré (laisser vide pour conserver)' : 'Client ID Simkl' });
    const trakt = h('input', { class: 'input', placeholder: a.settings.traktConfigured ? 'Identifiant enregistré (laisser vide pour conserver)' : 'Client ID Trakt' });
    const err = h('p', { class: 'error-text' });
    const save = async (body, btn) => {
      err.textContent = ''; btn.disabled = true;
      try { await api('/api/admin/settings', { method: 'PUT', body }); toast('Enregistré : les notes se mettent à jour en arrière-plan'); refresh(); }
      catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
    };
    return h('section', { class: 'box', id: 'ratings' },
      h('h2', {}, 'Notes des sites'),
      h('p', {}, 'Venus affiche les notes sur chaque fiche et permet de trier par note. AniList et MyAnimeList (animés) fonctionnent sans clé ; TMDB utilise la clé des affiches.'),
      h('div', { class: 'src-list' },
        h('span', { class: 'src ok' }, 'AniList'), h('span', { class: 'src ok' }, 'MyAnimeList'),
        h('span', { class: `src${a.settings.tmdbConfigured ? ' ok' : ''}` }, 'TMDB'),
        h('span', { class: `src${a.settings.omdbConfigured ? ' ok' : ''}` }, 'IMDb'), h('span', { class: `src${a.settings.omdbConfigured ? ' ok' : ''}` }, 'Rotten Tomatoes'),
        h('span', { class: `src${a.settings.omdbConfigured ? ' ok' : ''}` }, 'Metacritic'), h('span', { class: `src${a.settings.simklConfigured ? ' ok' : ''}` }, 'Simkl'),
        h('span', { class: `src${a.settings.traktConfigured ? ' ok' : ''}` }, 'Trakt'),
        h('span', { class: 'src link', title: 'SensCritique n’a pas d’API publique : un lien vers sa page est proposé sur chaque fiche' }, 'SensCritique (lien)')),
      field('Clé OMDb : notes IMDb, Rotten Tomatoes et Metacritic', omdb, h('span', {}, 'Gratuite (1 000 titres par jour) sur ', link('https://www.omdbapi.com/apikey.aspx', 'omdbapi.com'), '.')),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn btn-small f', onclick: (e) => omdb.value.trim() && save({ omdbKey: omdb.value.trim() }, e.currentTarget) }, 'Enregistrer'),
        a.settings.omdbConfigured ? h('button', { class: 'btn btn-small btn-ghost f', onclick: (e) => save({ omdbKey: '' }, e.currentTarget) }, 'Retirer') : null),
      field('Client ID Simkl', simkl, h('span', {}, 'Gratuit : créez une application sur ', link('https://simkl.com/settings/developer/', 'simkl.com/settings/developer'), '.')),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn btn-small f', onclick: (e) => simkl.value.trim() && save({ simklClientId: simkl.value.trim() }, e.currentTarget) }, 'Enregistrer'),
        a.settings.simklConfigured ? h('button', { class: 'btn btn-small btn-ghost f', onclick: (e) => save({ simklClientId: '' }, e.currentTarget) }, 'Retirer') : null),
      field('Client ID Trakt : note Trakt, et affiches, fonds et logos', trakt, h('span', {}, 'Gratuit : créez une application sur ', link('https://trakt.tv/oauth/applications/new', 'trakt.tv/oauth/applications'), ' (adresse de redirection : urn:ietf:wg:oauth:2.0:oob), puis copiez le « Client ID ».')),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn btn-small f', onclick: (e) => trakt.value.trim() && save({ traktClientId: trakt.value.trim() }, e.currentTarget) }, 'Enregistrer'),
        a.settings.traktConfigured ? h('button', { class: 'btn btn-small btn-ghost f', onclick: (e) => save({ traktClientId: '' }, e.currentTarget) }, 'Retirer') : null),
      a.settings.traktConfigured ? field('Affiches des films, séries et animés', select([['tmdb', 'TMDB d’abord, Trakt quand TMDB n’en a pas'], ['trakt', 'Trakt d’abord, TMDB en secours']], a.settings.posterSource || 'tmdb',
        { onchange: (e) => save({ posterSource: e.target.value }, e.target) }), 'Vos images du dossier (poster.jpg, fanart.jpg) restent toujours prioritaires. Le changement se fait en arrière-plan.') : null,
      err,
      h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => { const r = await api('/api/admin/ratings/refresh', { method: 'POST' }); toast(`${r.queued} titre(s) en cours de mise à jour`); } }, 'Mettre à jour toutes les notes'));
  }

  // Seerr (Overseerr / Jellyseerr) : demander un titre depuis Nouveautés, Radarr / Sonarr le téléchargent
  function seerrBox(a) {
    const err = h('p', { class: 'error-text' });
    const box = h('section', { class: 'box', id: 'seerr' });
    const url = h('input', { class: 'input', id: 'seerr-url', placeholder: 'http://192.168.1.20:5055', value: a.settings.seerrUrl || '', inputmode: 'url', autocomplete: 'off' });
    // Deux façons de relier Seerr : avec son compte (la clé API est récupérée toute seule) ou en collant la clé
    let how = 'account';
    const method = select([['local', 'Compte Seerr (e-mail)'], ['jellyfin', 'Compte Jellyfin / Emby']], 'local');
    const user = h('input', { class: 'input', id: 'seerr-user', autocomplete: 'username', placeholder: 'E-mail ou nom d’utilisateur' });
    const pass = h('input', { class: 'input', id: 'seerr-pass', type: 'password', autocomplete: 'current-password', placeholder: 'Mot de passe (jamais enregistré)' });
    const key = h('input', { class: 'input', id: 'seerr-key', placeholder: a.settings.seerrConfigured ? 'Clé enregistrée (laisser vide pour conserver)' : 'Clé API (Seerr : Réglages, Général)', autocomplete: 'off' });
    const accountFields = h('div', {}, field('Se connecter avec', method), field('Identifiant', user), field('Mot de passe', pass));
    const keyFields = h('div', { hidden: true }, field('Clé API', key));
    const tabs = h('div', { class: 'seg', role: 'tablist', style: { marginBottom: '14px' } });
    const paintTabs = () => tabs.replaceChildren(...[['account', 'Avec mon compte'], ['key', 'Avec la clé API']].map(([id, label]) => h('button', { type: 'button', class: `seg-b f${how === id ? ' on' : ''}`, onclick: () => { how = id; accountFields.hidden = id !== 'account'; keyFields.hidden = id !== 'key'; paintTabs(); } }, label)));
    paintTabs();
    const connect = h('button', { class: 'btn btn-small f', onclick: async () => {
      err.textContent = ''; connect.disabled = true; connect.textContent = 'Connexion…';
      try {
        if (how === 'account') {
          const r = await api('/api/admin/seerr/login', { method: 'POST', body: { url: url.value.trim(), method: method.value, user: user.value.trim(), password: pass.value } });
          toast(`Seerr relié avec le compte « ${r.user.name} »`);
        } else {
          await api('/api/admin/settings', { method: 'PUT', body: { seerrUrl: url.value.trim(), ...(key.value.trim() ? { seerrKey: key.value.trim() } : {}) } });
          toast('Seerr relié');
        }
        pass.value = ''; refresh();
      } catch (e) { err.textContent = e.message; connect.disabled = false; connect.textContent = 'Relier Seerr'; }
    } }, 'Relier Seerr');

    box.append(
      h('h2', {}, 'Seerr : téléchargements automatiques'),
      h('p', {}, a.settings.seerrConfigured
        ? 'Seerr est relié. Les titres ajoutés à « Mes envies » (♡ dans Nouveautés) sont demandés tout de suite, même s’ils ne sortent que dans plusieurs mois, et les nouvelles saisons des séries suivies sont demandées dès qu’elles sont annoncées.'
        : 'Reliez Seerr (Overseerr ou Jellyseerr) : vos envies et les nouvelles saisons de vos séries seront demandées automatiquement, et Radarr / Sonarr les téléchargeront. Le plus simple : se connecter avec un compte administrateur de Seerr, Venus récupère la clé tout seul.'),
      a.settings.seerrConfigured ? h('div', { class: 'auto-pill', style: { marginBottom: '12px' } }, h('span', { class: 'dot' }), `Relié à ${a.settings.seerrUrl}`) : null,
      field('Adresse de Seerr', url), tabs, accountFields, keyFields, err,
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, connect,
        a.settings.seerrConfigured ? h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => { await api('/api/admin/settings', { method: 'PUT', body: { seerrUrl: '', seerrKey: '' } }); toast('Seerr retiré'); refresh(); } }, 'Retirer') : null));

    if (a.settings.seerrConfigured) {
      const auto = h('div', { class: 'seerr-auto' }, h('p', { class: 'muted' }, 'Chargement des comptes Seerr…'));
      box.append(h('h3', { class: 'box-sub' }, 'Automatique'), auto);
      api('/api/admin/seerr/users').then((u) => {
        const save = async (body, msg) => { try { await api('/api/admin/seerr/users', { method: 'PUT', body }); toast(msg); } catch (e) { toast(e.message, true); } };
        const userOpts = [['', 'Compte de la clé API (administrateur)'], ...u.users.map((x) => [String(x.id), `${x.name}${x.email && x.email !== x.name ? ` (${x.email})` : ''}`])];
        auto.replaceChildren(
          h('label', { class: 'switch' }, h('span', {}, 'Demander mes envies à Seerr dès qu’on les ajoute'),
            h('input', { type: 'checkbox', class: 'f', checked: u.auto, onchange: (e) => save({ auto: e.target.checked }, 'Préférence enregistrée') })),
          field('Nouvelles saisons demandées automatiquement', select([['mylist', 'Pour les séries de « Ma liste » et des envies'], ['all', 'Pour toutes les séries de la médiathèque'], ['off', 'Jamais']], u.follow,
            { onchange: (e) => save({ follow: e.target.value }, 'Préférence enregistrée') })),
          h('h3', { class: 'box-sub' }, 'Demandes au nom de chacun'),
          h('p', { class: 'muted', style: { fontSize: '.88rem', margin: '0 0 10px' } }, 'Reliez chaque profil à son compte Seerr : ses demandes apparaissent à son nom dans Seerr (avec ses quotas), et ses envies dans sa liste de suivi Seerr.'),
          ...u.profiles.map((p) => field(p.name, select(userOpts, String(u.links[String(p.id)] || ''), { onchange: (e) => save({ profileId: p.id, seerrUserId: e.target.value || null }, `${p.name} relié`) }))),
          h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
            h('button', { class: 'btn btn-small btn-ghost f', onclick: async (e) => {
              const b = e.currentTarget; b.disabled = true; b.textContent = 'Vérification…';
              try { const r = await api('/api/admin/seerr/sync', { method: 'POST' }); toast(`${r.followed} série${r.followed > 1 ? 's' : ''} suivie${r.followed > 1 ? 's' : ''}${r.error ? ` · ${r.error}` : ''}`); } catch (e2) { toast(e2.message, true); }
              b.disabled = false; b.textContent = 'Vérifier maintenant';
            } }, icon('refresh'), 'Vérifier maintenant')),
          u.watch.lastRun ? h('p', { class: 'muted', style: { fontSize: '.82rem' } }, `Dernière vérification : ${new Date(u.watch.lastRun).toLocaleString('fr-FR')} · vérifié toutes les 6 heures`) : null);
      }).catch((e) => auto.replaceChildren(h('p', { class: 'error-text' }, e.message)));
    }
    return box;
  }

  function notifyBox(a) {
    const n = a.settings.notify || {};
    const ntfyTopic = h('input', { class: 'input', value: n.ntfyTopic || '', placeholder: `venus-${Math.random().toString(36).slice(2, 8)}`, autocomplete: 'off' });
    const ntfyServer = h('input', { class: 'input', value: n.ntfyServer || 'https://ntfy.sh', autocomplete: 'off' });
    const discord = h('input', { class: 'input', placeholder: n.discord ? 'Webhook enregistré (laisser vide pour conserver)' : 'https://discord.com/api/webhooks/…', autocomplete: 'off' });
    const tgToken = h('input', { class: 'input', placeholder: n.telegramToken ? 'Jeton enregistré (laisser vide pour conserver)' : 'Jeton du bot (BotFather)', autocomplete: 'off' });
    const tgChat = h('input', { class: 'input', value: n.telegramChat || '', placeholder: 'Identifiant de la discussion', autocomplete: 'off' });
    const pub = h('input', { class: 'input', value: n.publicUrl || '', placeholder: 'https://venus.mondomaine.fr (facultatif)', inputmode: 'url', autocomplete: 'off' });
    return h('section', { class: 'box', id: 'notifications' },
      h('h2', {}, 'Notifications'),
      h('p', {}, 'Prévenir quand un film, une série ou un épisode arrive dans Venus. Chaque personne reçoit aussi « Votre envie est arrivée » sur ses appareils (Réglages, Cet appareil).'),
      h('label', { class: 'switch' }, h('span', {}, 'Annoncer les nouveautés'), h('input', { type: 'checkbox', class: 'f', checked: n.notifyNew !== false, onchange: async (e) => { await api('/api/admin/settings', { method: 'PUT', body: { notifyNew: e.target.checked } }); toast('Préférence enregistrée'); } })),
      h('h3', { class: 'box-sub' }, 'ntfy (le plus simple, marche sans HTTPS)'),
      h('p', { class: 'muted', style: { fontSize: '.86rem', margin: '0 0 8px' } }, 'Installez l’appli gratuite ntfy sur le téléphone et abonnez-vous au même sujet.'),
      h('div', { class: 'two-cols' }, field('Sujet', ntfyTopic), field('Serveur', ntfyServer)),
      h('h3', { class: 'box-sub' }, 'Discord et Telegram'),
      field('Webhook Discord', discord),
      h('div', { class: 'two-cols' }, field('Bot Telegram', tgToken), field('Discussion', tgChat)),
      field('Adresse publique de Venus', pub, 'Pour que les liens des notifications ouvrent Venus.'),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn btn-small f', onclick: async () => {
          await api('/api/admin/settings', { method: 'PUT', body: { ntfyTopic: ntfyTopic.value.trim(), ntfyServer: ntfyServer.value.trim(), telegramChat: tgChat.value.trim(), publicUrl: pub.value.trim(),
            ...(discord.value.trim() ? { discordWebhook: discord.value.trim() } : {}), ...(tgToken.value.trim() ? { telegramToken: tgToken.value.trim() } : {}) } });
          toast('Notifications enregistrées'); refresh();
        } }, 'Enregistrer'),
        h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => {
          const r = await api('/api/admin/notify/test', { method: 'POST' });
          toast(r.errors.length ? `Erreur : ${r.errors.join(' ; ')}` : 'Notification de test envoyée', r.errors.length ? true : { type: 'success' });
        } }, 'Envoyer un test')));
  }

  // Affiches : titres sans affiche, recherche sur les services gratuits, choix d'une affiche (propositions ou adresse)
  function postersBox(a) {
    const list = h('div', { class: 'poster-missing' }, h('p', { class: 'muted' }, 'Chargement…'));
    const head = h('p', {});
    const runBtn = h('button', { class: 'btn btn-small btn-play f', onclick: async () => {
      runBtn.disabled = true; runBtn.textContent = 'Recherche en cours…';
      try { const r = await api('/api/admin/posters/run', { method: 'POST' }); toast(r.found ? `${r.found} affiche${r.found > 1 ? 's' : ''} trouvée${r.found > 1 ? 's' : ''}` : 'Rien de nouveau trouvé'); await paintList(); }
      catch (e) { toast(e.message, true); } finally { runBtn.disabled = false; runBtn.replaceChildren(icon('refresh'), 'Chercher les affiches manquantes'); }
    } }, icon('refresh'), 'Chercher les affiches manquantes');
    const paintList = async () => {
      const r = await api('/api/admin/posters');
      head.textContent = r.missing.length ? `${r.missing.length} titre${r.missing.length > 1 ? 's' : ''} sans affiche sur ${r.total}.` : `Tous vos ${r.total} titres ont une affiche.`;
      list.replaceChildren(...r.missing.slice(0, 40).map((it) => h('div', { class: 'list-row' },
        h('span', { class: 'pm-ph' }, icon(it.type === 'movie' ? 'film' : 'tv')),
        h('div', { class: 'grow' }, h('b', {}, it.title), h('span', {}, [it.year, it.type === 'movie' ? 'Film' : it.category === 'anime' ? 'Animé' : 'Série', it.poster_tried ? `${it.poster_tried} recherche${it.poster_tried > 1 ? 's' : ''} sans résultat` : null].filter(Boolean).join(' · '))),
        h('button', { class: 'btn btn-small f', onclick: () => choosePoster(it, paintList) }, icon('image'), 'Choisir une affiche'),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => go(it.path) }, 'Fiche'))),
      r.missing.length > 40 ? h('p', { class: 'muted' }, `… et ${r.missing.length - 40} autres.`) : null);
    };
    paintList().catch((e) => list.replaceChildren(h('p', { class: 'error-text' }, e.message)));
    // Diagnostic : chaque service est interrogé pour un titre connu ; on voit lequel répond, lequel est bloqué
    const testOut = h('div', { class: 'poster-test' });
    const testBtn = h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => {
      testBtn.disabled = true; testOut.replaceChildren(h('p', { class: 'muted' }, 'Test en cours (quelques secondes)…'));
      try {
        const [mv, tv] = await Promise.all([api('/api/admin/posters/test?title=Inception&year=2010&type=movie'), api('/api/admin/posters/test?title=Naruto&year=2002&type=anime')]);
        const rows = (r) => r.results.map((x) => h('div', { class: 'list-row' },
          x.poster ? h('img', { class: 'pt-img', src: x.poster, alt: '', loading: 'lazy' }) : h('span', { class: `pm-ph ${x.status === 200 || x.status === 'non configuré' ? '' : 'bad'}` }, icon(x.status === 200 ? 'check' : x.status === 'non configuré' ? 'info' : 'close')),
          h('div', { class: 'grow' }, h('b', {}, x.source), h('span', {}, [x.status === 200 ? 'Répond' : x.status === 'non configuré' ? 'Non configuré (facultatif)' : x.status === 'aucun résultat' ? 'Répond, mais ne trouve pas ce titre' : x.status === 'injoignable' ? `Injoignable${x.error ? ` (${x.error})` : ''}` : `Refuse (HTTP ${x.status})`, `${x.ms} ms`].join(' · ')))));
        testOut.replaceChildren(h('p', { class: 'muted' }, `Film : « ${mv.title} » (${mv.year})${mv.tmdbKey ? ' · clé TMDB présente' : ' · sans clé TMDB'}`), ...rows(mv), h('p', { class: 'muted' }, `Animé : « ${tv.title} » (${tv.year})`), ...rows(tv),
          mv.results.every((x) => x.status !== 200 && x.status !== 'aucun résultat') && tv.results.every((x) => x.status !== 200 && x.status !== 'aucun résultat') ? h('p', { class: 'error-text' }, 'Aucun service ne répond : le serveur de Venus n’a sans doute pas accès à Internet (pare-feu, DNS du conteneur Docker, proxy).') : null);
      } catch (e) { testOut.replaceChildren(h('p', { class: 'error-text' }, e.message)); } finally { testBtn.disabled = false; }
    } }, icon('search'), 'Tester les sources');
    // Affiches trouvées avec l'ancienne correspondance (parfois fausses, ex. DB Multiverse pour Dragon Ball)
    const redoBtn = h('button', { class: 'btn btn-small btn-ghost f', title: 'Oublie les affiches trouvées sans clé et les recherche à nouveau avec la correspondance stricte. Les affiches choisies à la main, de TMDB ou du dossier ne bougent pas.', onclick: async () => {
      if (!await confirmSheet('Revérifier les affiches trouvées sans clé ? Elles seront recherchées à nouveau avec une correspondance plus stricte : les mauvaises disparaissent, les bonnes reviennent. Les affiches choisies à la main, celles de TMDB et celles du dossier ne bougent pas.', 'Revérifier')) return;
      redoBtn.disabled = true;
      try { const r = await api('/api/admin/posters/redo', { method: 'POST' }); toast(`${r.reset} affiche(s) à revérifier, recherche lancée en tâche de fond`); paintList(); }
      catch (e) { toast(e.message, true); } finally { redoBtn.disabled = false; }
    } }, icon('refresh'), 'Revérifier les affiches automatiques');
    return h('section', { class: 'box', id: 'affiches' },
      h('h2', {}, 'Affiches'),
      h('p', {}, 'Les affiches viennent de TMDB (avec une clé), ou sans clé de Trakt (si un Client ID est renseigné), du site de TMDB, d’IMP Awards, de Wikipédia, d’iTunes, de TVmaze et d’OMDb. Pour un titre précis, vous pouvez choisir parmi plusieurs propositions ou coller l’adresse d’une image trouvée sur n’importe quel site.'),
      h('label', { class: 'switch' }, h('span', {}, 'Chercher les affiches sur les services gratuits (sans clé)'), h('input', { type: 'checkbox', class: 'f', checked: a.settings.postersFree !== false, onchange: async (e) => { await api('/api/admin/settings', { method: 'PUT', body: { postersFree: e.target.checked } }); toast(e.target.checked ? 'Recherche gratuite activée' : 'Recherche gratuite désactivée'); } })),
      head, list,
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start', flexWrap: 'wrap' } }, runBtn, testBtn, redoBtn), testOut);
  }

  function backupBox(a) {
    const list = h('div', { class: 'backup-list' }, h('p', { class: 'muted' }, 'Chargement…'));
    const paintList = async () => {
      const r = await api('/api/admin/backups');
      list.replaceChildren(...(r.items.length ? r.items.slice(0, 6).map((b) => h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, h('b', {}, new Date(b.at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })), h('span', {}, `${(b.size / 1048576).toFixed(1).replace('.', ',')} Mo${b.manual ? ' · manuelle' : ''}`)),
        h('a', { class: 'btn btn-ghost btn-icon btn-mini f', href: `/api/admin/backups/${encodeURIComponent(b.name)}?token=${encodeURIComponent(auth.token || '')}`, download: b.name, title: 'Télécharger', 'aria-label': 'Télécharger' }, icon('down')),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: async () => {
          if (!(await confirmSheet(`Revenir à la sauvegarde du ${new Date(b.at).toLocaleString('fr-FR')} ? Profils, vus et listes reviendront à cet état (l’état actuel est sauvegardé avant).`, 'Restaurer'))) return;
          const x = await api(`/api/admin/backups/${encodeURIComponent(b.name)}/restore`, { method: 'POST' });
          toast(x.restarting ? 'Restauration : Venus redémarre…' : 'Restauration prête : redémarrez Venus pour l’appliquer', { type: 'success', duration: 8000 });
          if (x.restarting) setTimeout(() => location.reload(), 7000);
        } }, 'Restaurer'))) : [h('p', { class: 'muted' }, 'Aucune sauvegarde pour l’instant.')]));
    };
    paintList().catch((e) => list.replaceChildren(h('p', { class: 'error-text' }, e.message)));
    return h('section', { class: 'box', id: 'backups' },
      h('h2', {}, 'Sauvegardes'),
      h('p', {}, 'Profils, vus, listes, envies et réglages sont sauvegardés chaque nuit (les 10 dernières sont gardées). Vos vidéos ne sont pas concernées.'),
      h('label', { class: 'switch' }, h('span', {}, 'Sauvegarde automatique chaque nuit'), h('input', { type: 'checkbox', class: 'f', checked: a.settings.autoBackup !== false, onchange: async (e) => { await api('/api/admin/settings', { method: 'PUT', body: { autoBackup: e.target.checked } }); toast('Préférence enregistrée'); } })),
      list,
      // Second emplacement (NAS, disque externe) : chaque sauvegarde y est aussi copiée
      (() => {
        const inp = h('input', { class: 'input', value: a.settings.backupCopyDir || '', placeholder: '/mnt/nas/sauvegardes-venus (vide : aucune copie)', autocomplete: 'off' });
        return h('form', { class: 'field', style: { marginTop: '8px' }, onsubmit: async (e) => { e.preventDefault(); try { await api('/api/admin/settings', { method: 'PUT', body: { backupCopyDir: inp.value.trim() } }); toast(inp.value.trim() ? 'Les sauvegardes seront aussi copiées là' : 'Copie désactivée'); } catch (err) { toast(err.message, true); } } },
          h('label', {}, 'Copier aussi les sauvegardes dans un autre dossier'), h('div', { style: { display: 'flex', gap: '8px' } }, inp, h('button', { class: 'btn btn-small f', type: 'submit' }, 'Enregistrer')),
          h('small', {}, 'Un dossier d’un NAS ou d’un disque externe monté sur le serveur (sous Docker : un dossier partagé dans docker-compose.yml). Les 10 dernières y sont gardées.'));
      })(),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small f', onclick: async (e) => {
        e.currentTarget.disabled = true;
        await api('/api/admin/backups', { method: 'POST' }); toast('Sauvegarde faite', { type: 'success' }); await paintList(); e.currentTarget.disabled = false;
      } }, 'Sauvegarder maintenant')));
  }

  function subtitlesBox(a) {
    const key = h('input', { class: 'input', placeholder: a.settings.opensubtitlesConfigured ? 'Clé enregistrée (laisser vide pour conserver)' : 'Clé API OpenSubtitles', autocomplete: 'off' });
    const user = h('input', { class: 'input', placeholder: 'Nom d’utilisateur (facultatif)', value: a.settings.opensubtitlesUser || '', autocomplete: 'off' });
    const pass = h('input', { class: 'input', type: 'password', placeholder: 'Mot de passe (facultatif)', autocomplete: 'new-password' });
    return h('section', { class: 'box', id: 'subtitles' },
      h('h2', {}, 'Sous-titres en ligne'),
      h('p', {}, 'Dans le lecteur, « Audio et sous-titres », puis « Chercher des sous-titres en ligne » : les sous-titres manquants sont trouvés sur OpenSubtitles, la version qui correspond à votre fichier en premier. Le fichier vidéo n’est jamais modifié.'),
      a.settings.opensubtitlesConfigured ? h('div', { class: 'auto-pill', style: { marginBottom: '12px' } }, h('span', { class: 'dot' }), 'Activé') : null,
      field('Clé API', key, h('span', {}, 'Gratuite sur ', h('a', { href: 'https://www.opensubtitles.com/fr/consumers', target: '_blank', rel: 'noopener', style: { textDecoration: 'underline' } }, 'opensubtitles.com/consumers'), '.')),
      h('div', { class: 'two-cols' }, field('Compte', user), field('Mot de passe', pass)),
      h('p', { class: 'muted', style: { fontSize: '.84rem' } }, 'Avec un compte gratuit, vous avez plus de téléchargements par jour.'),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small f', onclick: async () => {
        await api('/api/admin/settings', { method: 'PUT', body: { ...(key.value.trim() ? { opensubtitlesKey: key.value.trim() } : {}), opensubtitlesUser: user.value.trim(), ...(pass.value ? { opensubtitlesPass: pass.value } : {}) } });
        pass.value = ''; toast('Sous-titres en ligne enregistrés'); refresh();
      } }, 'Enregistrer')));
  }

  function metadataBox(a) {
    const key = h('input', { class: 'input', placeholder: a.settings.tmdbConfigured ? 'Clé enregistrée (laisser vide pour conserver)' : 'Collez votre clé API ou jeton TMDB' });
    return h('section', { class: 'box', id: 'sources' },
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
    const pass = h('input', { class: 'input', type: 'password', placeholder: 'Nouveau mot de passe', autocomplete: 'new-password', minlength: 10, maxlength: 200 });
    const interval = h('input', { class: 'input', type: 'number', min: 5, value: a.settings.scanInterval });
    return h('section', { class: 'box' },
      h('h2', {}, 'Serveur'),
      h('p', {}, `Venus ${a.version}, en ligne depuis ${fmtTime(a.system.uptime)}`),
      field('Nom', name),
      field('Mot de passe du foyer', pass, 'Après un changement, les autres appareils devront se reconnecter.'), passwordMeter(pass),
      field('Vérifier les nouveautés toutes les (minutes)', interval, 'Les ajouts sont aussi détectés automatiquement quand c’est possible.'),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small f', onclick: async () => {
        if (pass.value && passwordProblem(pass.value)) { toast(`Mot de passe : ${passwordProblem(pass.value).toLowerCase()}`, true); pass.focus(); return; }
        if (!(Number(interval.value) >= 5)) { toast('Vérification : 5 minutes minimum', true); return; }
        try {
          await api('/api/admin/settings', { method: 'PUT', body: { serverName: name.value.trim().slice(0, 40), password: pass.value || undefined, scanInterval: Number(interval.value) } });
          toast(pass.value ? 'Mot de passe changé : les autres appareils devront se reconnecter' : 'Réglages enregistrés', { type: 'success' });
          pass.value = ''; pass.dispatchEvent(new Event('input'));
        } catch (e) { toast(e.message, true); }
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
  // Droits (comme Jellyfin) : seulement pour les profils non administrateurs, réglés par un administrateur
  const perms = { libraries: null, download: true, transcode: true, remote: true, schedule: [], dailyMinutes: 0, ...(p && p.perms ? JSON.parse(JSON.stringify(p.perms)) : {}) };
  const permsBox = !self && !isNew ? h('div', { class: 'perms' }) : null;
  const DAYS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
  const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const paintPerms = (libs) => {
    if (!permsBox) return;
    const sw = (label, key, hint) => h('label', { class: 'switch' }, h('span', {}, label, hint ? h('small', {}, hint) : null), h('input', { type: 'checkbox', class: 'f', checked: perms[key], onchange: (e) => { perms[key] = e.target.checked; } }));
    const allLibs = perms.libraries == null;
    const libList = h('div', { class: 'perm-libs' }, libs.map((l) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'f', checked: allLibs || perms.libraries.includes(l.id), disabled: allLibs,
      onchange: (e) => { perms.libraries = e.target.checked ? [...perms.libraries, l.id] : perms.libraries.filter((x) => x !== l.id); } }), l.name)));
    const slots = h('div', { class: 'slots' }, perms.schedule.map((sl, i) => h('div', { class: 'slot' },
      h('div', { class: 'days' }, DAYS.map(([d, l]) => h('button', { type: 'button', class: `day f${sl.days.includes(d) ? ' on' : ''}`, title: DAY_NAMES[d], 'aria-pressed': String(sl.days.includes(d)),
        onclick: () => { sl.days = sl.days.includes(d) ? sl.days.filter((x) => x !== d) : [...sl.days, d]; paintPerms(libs); } }, l))),
      h('input', { class: 'input', type: 'time', value: sl.from, onchange: (e) => { sl.from = e.target.value; } }), h('span', {}, 'à'),
      h('input', { class: 'input', type: 'time', value: sl.to, onchange: (e) => { sl.to = e.target.value; } }),
      h('button', { type: 'button', class: 'p-icon small f', 'aria-label': 'Retirer ce créneau', onclick: () => { perms.schedule.splice(i, 1); paintPerms(libs); } }, icon('close')))));
    permsBox.replaceChildren(h('h3', {}, 'Droits'),
      h('label', { class: 'switch' }, h('span', {}, 'Toutes les bibliothèques'), h('input', { type: 'checkbox', class: 'f', checked: allLibs, onchange: (e) => { perms.libraries = e.target.checked ? null : libs.map((l) => l.id); paintPerms(libs); } })),
      allLibs ? null : libList,
      sw('Télécharger pour regarder sans réseau', 'download'),
      sw('Lire les vidéos qui demandent une conversion', 'transcode', 'Sinon, seulement les fichiers que l’appareil lit tels quels'),
      sw('Accès depuis l’extérieur de la maison', 'remote', 'Sinon, seulement sur le réseau local'),
      h('div', { class: 'field' }, h('label', {}, 'Horaires autorisés'), perms.schedule.length ? slots : h('small', {}, 'À toute heure.'),
        perms.schedule.length < 7 ? h('button', { type: 'button', class: 'btn btn-small btn-ghost f', onclick: () => { perms.schedule.push({ days: [1, 2, 3, 4, 5], from: '17:00', to: '20:00' }); paintPerms(libs); } }, icon('plus'), 'Ajouter un créneau') : null,
        perms.schedule.length ? h('small', {}, 'Heure du serveur. En dehors de ces créneaux, le profil ne s’ouvre pas.') : null),
      h('div', { class: 'field' }, h('label', {}, 'Temps d’écran par jour'),
        h('select', { class: 'input', style: { maxWidth: '220px' }, onchange: (e) => { perms.dailyMinutes = Number(e.target.value); } },
          [[0, 'Sans limite'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 heure'], [90, '1 h 30'], [120, '2 heures'], [180, '3 heures']].map(([v, l]) => h('option', { value: v, selected: Number(perms.dailyMinutes || 0) === v }, l))),
        h('small', {}, 'Compte le temps réellement regardé. Une fois la limite atteinte, la lecture s’arrête jusqu’au lendemain ; le profil reste ouvert pour parcourir.')));
  };
  if (permsBox) api('/api/admin').then((a) => paintPerms(a.libraries.filter((l) => l.type !== 'iptv' || true))).catch(() => permsBox.remove());
  const s = sheet(isNew ? 'Nouveau profil' : `Modifier ${p.name}`, h('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (pin.value && !/^\d{4}$/.test(pin.value)) { err.textContent = 'Le code PIN doit contenir 4 chiffres.'; return; }
    if (!nameIn.value.trim()) { err.textContent = 'Indiquez un nom.'; return; }
    const willBeAdmin = adminSw ? adminSw.querySelector('input').checked : !!(p && p.isAdmin);
    const hasPinAfter = pin.value ? true : p && p.hasPin && !(removePin && removePin.querySelector('input').checked);
    if (willBeAdmin && !hasPinAfter) { err.textContent = 'Un profil administrateur doit avoir un code PIN.'; pin.focus(); return; }
    const body = { name: nameIn.value.trim(), avatar: av };
    if (pin.value) body.pin = pin.value; else if (removePin && removePin.querySelector('input').checked) body.pin = null;
    if (age) body.maxAge = age.value === '' ? null : Number(age.value);
    if (adminSw) body.isAdmin = adminSw.querySelector('input').checked;
    if (permsBox && !willBeAdmin) {
      if (perms.libraries && !perms.libraries.length) { err.textContent = 'Choisissez au moins une bibliothèque.'; return; }
      if (perms.schedule.some((x) => !x.days.length || !x.from || !x.to || x.from === x.to)) { err.textContent = 'Chaque créneau a besoin d’au moins un jour et de deux heures différentes.'; return; }
      body.perms = perms;
    }
    try {
      await api(isNew ? '/api/profiles' : `/api/profiles/${p.id}`, { method: isNew ? 'POST' : 'PUT', body });
      s.close(); toast(isNew ? 'Profil créé' : 'Profil enregistré'); onDone && onDone();
    } catch (e2) { err.textContent = e2.message; }
  } },
  field('Nom', nameIn), field('Couleur', picker),
  field('Code PIN', pin, 'Protège l’accès à ce profil.'), removePin,
  age ? field('Contrôle parental', age, 'Les titres au-dessus de cet âge sont masqués.') : null,
  adminSw, permsBox, err,
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

// Menu de navigation : afficher, masquer et réordonner (propre à ce profil, sur cet appareil)
function menuEditor(me) {
  const box = h('section', { class: 'box menu-box', id: 'menu' });
  const paint = (focusId, focusDir) => {
    const p = menuPrefs(me.id);
    const byId = new Map(NAV_ITEMS.map((i) => [i.id, i]));
    const items = p.order.map((id) => byId.get(id)).filter((it) => it && (!it.admin || me.isAdmin));
    const move = (id, d) => {
      const order = [...p.order]; const i = order.indexOf(id); const j = i + d;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      saveMenuPrefs(me.id, { ...p, order }); paint(id, d);
    };
    const toggle = (id, on) => saveMenuPrefs(me.id, { ...p, hidden: on ? p.hidden.filter((x) => x !== id) : [...p.hidden, id] });
    box.replaceChildren(
      h('h2', {}, 'Menu'),
      h('p', {}, 'Choisissez ce qui apparaît dans le menu et dans quel ordre. Sur ordinateur, seules les 4 premières sections sont affichées ; le reste est rangé dans « Plus ». Réglages et profil restent toujours en bas.'),
      h('ol', { class: 'menu-edit' }, items.map((it, i) => h('li', { class: p.hidden.includes(it.id) ? 'off' : '' },
        h('span', { class: 'me-ic' }, icon(iconOf(it))), h('b', {}, it.id === 'today' ? 'Aujourd’hui / Ce soir' : labelOf(it)),
        h('button', { class: 'p-icon small f', 'data-id': it.id, 'data-dir': '-1', 'aria-label': `Monter ${labelOf(it)}`, disabled: i === 0, onclick: () => move(it.id, -1) }, icon('up')),
        h('button', { class: 'p-icon small f', 'data-id': it.id, 'data-dir': '1', 'aria-label': `Descendre ${labelOf(it)}`, disabled: i === items.length - 1, onclick: () => move(it.id, 1) }, icon('down')),
        h('label', { class: 'switch mini', title: 'Afficher dans le menu' }, h('input', { type: 'checkbox', class: 'f', 'aria-label': `Afficher ${labelOf(it)} dans le menu`, checked: !p.hidden.includes(it.id), onchange: (e) => { toggle(it.id, e.target.checked); paint(); } }))))),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn btn-small btn-ghost f', onclick: () => { resetMenuPrefs(me.id); paint(); toast('Menu d’origine rétabli'); } }, 'Rétablir le menu d’origine')));
    if (focusId) { const b = box.querySelector(`[data-id="${focusId}"][data-dir="${focusDir}"]`); (b && !b.disabled ? b : box.querySelector(`[data-id="${focusId}"]`))?.focus(); }
  };
  paint();
  return box;
}

// Thème : une planète du système solaire (couleurs, nom, logo qui tourne)
// Notifications sur cet appareil (même appli fermée) : Web Push, possible seulement si Venus est ouvert en HTTPS
function pushRow() {
  const row = h('div', { class: 'push-row' });
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;
  const paint = async () => {
    if (!supported) {
      row.replaceChildren(h('b', {}, 'Notifications sur cet appareil'), h('p', { class: 'muted' }, window.isSecureContext ? 'Ce navigateur ne gère pas les notifications. Sur iPhone, installez d’abord Venus sur l’écran d’accueil.' : 'Il faut ouvrir Venus en HTTPS (adresse sécurisée) pour les recevoir. Sinon, utilisez l’appli ntfy (Réglages, Notifications).'));
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    row.replaceChildren(h('b', {}, 'Notifications sur cet appareil'), h('p', { class: 'muted' }, sub ? 'Activées : vous serez prévenu quand vos envies arrivent.' : 'Recevez « Votre envie est arrivée » et les nouveautés, même appli fermée.'),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } },
        sub ? h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); toast('Notifications désactivées'); paint(); } }, 'Désactiver')
          : h('button', { class: 'btn btn-small f', onclick: async () => {
            try {
              const perm = await Notification.requestPermission();
              if (perm !== 'granted') { toast('Notifications refusées par le navigateur', true); return; }
              const { key } = await api('/api/push/key');
              const s2 = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)) });
              await api('/api/push/subscribe', { method: 'POST', body: { subscription: s2.toJSON() } });
              toast('Notifications activées', { type: 'success' }); paint();
            } catch (e) { toast(e.message, true); }
          } }, icon('cal'), 'Activer'),
        sub ? h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => { const r = await api('/api/push/test', { method: 'POST' }); toast(r.errors.length ? r.errors.join(' ; ') : 'Test envoyé', r.errors.length ? true : { type: 'success' }); } }, 'Tester') : null));
  };
  paint().catch(() => {});
  return row;
}

function themeEditor() {
  const box = h('section', { class: 'box' });
  const paint = () => {
    const cur = currentPlanet();
    const markOf = (id) => { const t = document.createElement('template'); t.innerHTML = planetMarkup(id).trim(); return t.content.firstChild; };
    box.replaceChildren(h('h2', {}, 'Thème'),
      h('p', {}, 'Choisissez votre planète : les couleurs, le nom et le logo de l’application changent sur cet appareil. « Verre » est clair le jour et sombre la nuit, comme un téléphone.'),
      h('div', { class: 'theme-grid', role: 'radiogroup', 'aria-label': 'Planète' }, Object.entries(PLANETS).map(([id, t]) => h('button', {
        class: `theme-opt f${id === cur ? ' on' : ''}`, role: 'radio', 'aria-checked': String(id === cur),
        onclick: (e) => { setPlanet(id, e.currentTarget.querySelector('.mark')); paint(); toast(t.glass ? "Thème Verre : clair le jour, sombre la nuit" : `Bienvenue sur ${t.name}`); box.querySelector(`[data-id="${id}"]`)?.focus(); }, 'data-id': id,
      }, h('span', { class: 'theme-pic' }, markOf(id), id === cur ? h('span', { class: 'moon', 'aria-hidden': 'true' }) : null), t.name))),
      PLANETS[cur].glass ? glassChooser() : null);
  };
  // Thème Verre : clair le jour, sombre la nuit (au soleil), ou toujours l'un des deux
  const glassChooser = () => {
    const sun = sunInfo();
    const hm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return h('div', { class: 'glass-mode' }, h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Clair ou sombre' },
      [['auto', 'Au rythme du soleil'], ['day', 'Toujours clair'], ['night', 'Toujours sombre']].map(([v, l]) => h('button', {
        class: `seg-b f${glassMode() === v ? ' on' : ''}`, role: 'radio', 'aria-checked': String(glassMode() === v),
        onclick: () => { setGlassMode(v); paint(); box.querySelector(`.glass-mode [aria-checked="true"]`)?.focus(); },
      }, l))),
    glassMode() === 'auto' ? h('small', {}, `Clair de ${hm(sun.rise)} à ${hm(sun.set)} (lever et coucher du soleil chez vous, calculés sur l’appareil).`) : null);
  };
  paint();
  return box;
}

// Choisir l'affiche d'un titre : propositions de toutes les sources, recherche avec un autre nom, ou adresse d'une image
export function choosePoster(it, onDone) {
  const q = h('input', { class: 'input', value: it.title, 'aria-label': 'Titre à chercher' });
  const y = h('input', { class: 'input', value: it.year || '', inputmode: 'numeric', placeholder: 'Année', style: { maxWidth: '100px' } });
  const grid = h('div', { class: 'img-grid poster' });
  const urlIn = h('input', { class: 'input', type: 'url', placeholder: 'https://… adresse d’une image', inputmode: 'url', autocomplete: 'off' });
  const use = async (btn, src, ref) => {
    btn.disabled = true;
    try { await api(`/api/admin/items/${it.id}/image`, { method: 'POST', body: { kind: 'poster', src, ref } }); toast('Affiche enregistrée', { type: 'success' }); s.close(); onDone && onDone(); }
    catch (e) { toast(e.message, true); btn.disabled = false; }
  };
  const search = async () => {
    grid.replaceChildren(h('p', { class: 'muted' }, h('span', { class: 'mini-spin' }), ' Recherche…'));
    try {
      const r = await api(`/api/admin/posters/${it.id}/candidates?q=${encodeURIComponent(q.value.trim())}&year=${encodeURIComponent(y.value.trim())}`);
      grid.replaceChildren(...(r.length ? r.map((c) => h('button', { class: 'img-opt f', title: `${c.source}${c.year ? ` · ${c.year}` : ''}`, onclick: (e) => use(e.currentTarget, c.source === 'TMDB' ? 'url' : 'free', c.url) },
        h('img', { src: c.url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), h('span', { class: 'img-src' }, c.source))) : [h('p', { class: 'muted' }, 'Aucune proposition. Essayez le titre original ou en anglais, ou collez une adresse ci-dessous.')]));
    } catch (e) { grid.replaceChildren(h('p', { class: 'error-text' }, e.message)); }
  };
  const s = sheet(`Affiche de « ${it.title} »`, h('div', { class: 'img-pick' },
    h('form', { class: 'img-url-row', onsubmit: (e) => { e.preventDefault(); search(); } }, q, y, h('button', { class: 'btn btn-small f', type: 'submit' }, icon('search'), 'Chercher')),
    grid,
    h('form', { class: 'img-url', onsubmit: (e) => { e.preventDefault(); const u = urlIn.value.trim(); if (!/^https:\/\//i.test(u)) { toast('Collez une adresse qui commence par https://', true); return; } use(e.submitter || urlIn, 'url', u); } },
      h('label', { class: 'img-url-label' }, 'Ou collez l’adresse d’une image'), h('div', { class: 'img-url-row' }, urlIn, h('button', { class: 'btn btn-small btn-play f', type: 'submit' }, icon('down'), 'Utiliser')),
      h('small', { class: 'muted' }, 'Depuis IMP Awards, MoviePosterDB, CineMaterial, TMDB… (clic droit sur l’image → « Copier l’adresse de l’image »).'))), { wide: true });
  search();
}

const fmtGo = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(b / 1e6))} Mo`);
// Doublons : films présents plusieurs fois ; on garde la meilleure version d'un clic
async function openDuplicates() {
  const body = h('div', { class: 'dup-list' }, h('p', { class: 'muted' }, 'Recherche…'));
  const s = sheet('Doublons', body, { wide: true });
  const paint = async () => {
    const r = await api('/api/admin/duplicates');
    if (!r.groups.length) { body.replaceChildren(h('p', { class: 'muted' }, 'Aucun film en double. Les versions voulues (4K et 1080p d’un même film) apparaissent ici aussi : ne supprimez que ce qui est de trop.')); return; }
    body.replaceChildren(h('p', {}, `${r.groups.length} film${r.groups.length > 1 ? 's' : ''} en plusieurs exemplaires · ${fmtGo(r.recoverable)} récupérables en ne gardant que la meilleure version.`),
      ...r.groups.map((g) => h('div', { class: 'dup' },
        h('div', { class: 'dup-head' }, h('b', {}, `${g.title}${g.year ? ` (${g.year})` : ''}`), h('small', {}, `${g.versions.length} fichiers`)),
        h('div', { class: 'dup-versions' }, g.versions.map((v) => h('div', { class: `dup-v${v.primary ? ' best' : ''}` },
          h('div', { class: 'grow' }, h('b', {}, [v.quality || 'Qualité inconnue', v.detail].filter(Boolean).join(' · ')), h('small', {}, v.file)),
          v.primary ? h('span', { class: 'pill' }, 'Meilleure') : h('button', { class: 'btn btn-small btn-danger f', onclick: async (e) => {
            if (!(await confirmSheet(`Supprimer le fichier « ${v.file} » (${fmtGo(v.size)}) ? Il est effacé du disque.`, 'Supprimer'))) return;
            e.target.disabled = true;
            try { await api(`/api/admin/items/${v.id}/delete`, { method: 'POST' }); toast(`${fmtGo(v.size)} libérés`); await paint(); } catch (err) { toast(err.message, true); e.target.disabled = false; }
          } }, 'Supprimer')))))));
  };
  paint().catch((e) => body.replaceChildren(h('p', { class: 'error-text' }, e.message)));
}

// Renommage façon Plex / Jellyfin : propositions cochables, puis renommage (la base suit)
async function openRename() {
  const body = h('div', { class: 'ren-list' }, h('p', { class: 'muted' }, 'Analyse des noms…'));
  const s = sheet('Renommer les fichiers', body, { wide: true });
  try {
    const { plan } = await api('/api/admin/rename');
    if (!plan.length) { body.replaceChildren(h('p', { class: 'muted' }, 'Tous les fichiers identifiés ont déjà un nom propre (« Film (Année)/Film (Année).mkv », « Série/Saison 01/Série - S01E02.mkv »). Les titres non identifiés n’apparaissent pas : identifiez-les d’abord depuis leur fiche.')); return; }
    const checks = new Map();
    const row = (p) => { const c = h('input', { type: 'checkbox', class: 'f', checked: !p.exists, disabled: p.exists }); checks.set(p.id, c);
      return h('label', { class: `ren${p.exists ? ' blocked' : ''}` }, c, h('div', { class: 'grow' }, h('small', {}, p.from), h('b', {}, p.to), p.exists ? h('small', { class: 'warn' }, 'Un fichier porte déjà ce nom') : null)); };
    const apply = h('button', { class: 'btn btn-play f', onclick: async () => {
      const ids = [...checks].filter(([, c]) => c.checked && !c.disabled).map(([id]) => id);
      if (!ids.length) return;
      if (!(await confirmSheet(`Renommer ${ids.length} fichier${ids.length > 1 ? 's' : ''} (et leurs sous-titres) ? Les dossiers vides sont retirés. Venus continue de les reconnaître.`, 'Renommer'))) return;
      apply.disabled = true; apply.textContent = 'Renommage…';
      try { const r = await api('/api/admin/rename', { method: 'POST', body: { ids } }); toast(`${r.done} fichier${r.done > 1 ? 's' : ''} renommé${r.done > 1 ? 's' : ''}${r.errors.length ? `, ${r.errors.length} échec(s)` : ''}`, r.errors.length ? true : { type: 'success' }); if (r.errors.length) console.warn(r.errors); s.close(); }
      catch (e) { toast(e.message, true); apply.disabled = false; apply.textContent = 'Renommer la sélection'; }
    } }, 'Renommer la sélection');
    body.replaceChildren(h('p', {}, `${plan.length} fichier${plan.length > 1 ? 's' : ''} à renommer. Modèle : « Film (Année)/Film (Année).ext », « Série (Année)/Saison 01/Série (Année) - S01E02 - Titre.ext ».`),
      h('div', { class: 'form-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn btn-small btn-ghost f', onclick: () => checks.forEach((c) => { if (!c.disabled) c.checked = true; }) }, 'Tout cocher'), h('button', { class: 'btn btn-small btn-ghost f', onclick: () => checks.forEach((c) => { c.checked = false; }) }, 'Tout décocher')),
      h('div', { class: 'ren-rows' }, plan.map(row)), h('div', { class: 'form-actions' }, apply));
  } catch (e) { body.replaceChildren(h('p', { class: 'error-text' }, e.message)); }
}

// Import d'une archive d'export (changement de machine) : la base est restaurée au redémarrage
function importArchive() {
  const input = h('input', { type: 'file', accept: '.tar.gz,.tgz,application/gzip', hidden: true, onchange: async () => {
    const f = input.files[0]; if (!f) return;
    if (!(await confirmSheet(`Importer « ${f.name} » ? Profils, vus, listes et réglages actuels seront remplacés par ceux de l’archive (une sauvegarde est faite avant). Venus redémarre ensuite.`, 'Importer'))) return;
    toast('Envoi de l’archive…');
    try {
      const r = await fetch('/api/admin/import', { method: 'POST', headers: { Authorization: `Bearer ${auth.token || ''}`, 'Content-Type': 'application/gzip' }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Import impossible');
      toast(d.restarting ? 'Import prêt : Venus redémarre…' : 'Import prêt : redémarrez Venus pour l’appliquer', { type: 'success', duration: 8000 });
      if (d.restarting) setTimeout(() => location.reload(), 8000);
    } catch (e) { toast(e.message, true); }
  } });
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 60000);
}

// Corbeille : vidéos supprimées depuis Venus, gardées 7 jours, restaurables
async function openTrash() {
  const body = h('div', { class: 'dup-list' }, h('p', { class: 'muted' }, 'Chargement…'));
  const s = sheet('Corbeille', body, { wide: true });
  const paint = async () => {
    const r = await api('/api/admin/trash');
    if (!r.items.length) { body.replaceChildren(h('p', { class: 'muted' }, `La corbeille est vide. Les vidéos supprimées depuis Venus y restent ${r.keepDays} jours avant d’être effacées du disque.`)); return; }
    const total = r.items.reduce((n, t) => n + t.size, 0);
    body.replaceChildren(h('p', {}, `${r.items.length} élément${r.items.length > 1 ? 's' : ''} · ${fmtGo(total)}. Effacés automatiquement ${r.keepDays} jours après leur suppression.`),
      ...r.items.map((t) => h('div', { class: 'dup-v' }, h('div', { class: 'grow' }, h('b', {}, t.title), h('small', {}, `${t.kind === 'episode' ? 'Épisode' : t.kind === 'movie' ? 'Film' : 'Vidéo'} · ${fmtGo(t.size)} · supprimé le ${new Date(t.deleted_at).toLocaleDateString('fr-FR')}${t.by_name ? ` par ${t.by_name}` : ''} · effacé le ${new Date(t.expires).toLocaleDateString('fr-FR')}`)),
        h('button', { class: 'btn btn-small f', onclick: async (e) => { e.target.disabled = true; try { await api(`/api/admin/trash/${t.id}/restore`, { method: 'POST' }); toast('Restauré : la vidéo réapparaît après l’analyse (quelques secondes)'); await paint(); } catch (err) { toast(err.message, true); e.target.disabled = false; } } }, 'Restaurer'),
        h('button', { class: 'btn btn-small btn-ghost btn-danger f', onclick: async (e) => { if (!(await confirmSheet(`Effacer « ${t.title} » du disque maintenant ?`, 'Effacer'))) return; e.target.disabled = true; try { await api(`/api/admin/trash/${t.id}`, { method: 'DELETE' }); await paint(); } catch (err) { toast(err.message, true); } } }, 'Effacer'))),
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-small btn-danger f', onclick: async () => { if (!(await confirmSheet(`Vider la corbeille (${fmtGo(total)}) ? Tout est effacé du disque.`, 'Vider'))) return; try { const x = await api('/api/admin/trash', { method: 'DELETE' }); toast(`${fmtGo(x.freed)} libérés`); await paint(); } catch (err) { toast(err.message, true); } } }, 'Vider la corbeille')));
  };
  paint().catch((e) => body.replaceChildren(h('p', { class: 'error-text' }, e.message)));
}
// Fichiers abîmés repérés par la tâche d'intégrité
async function openBroken() {
  const body = h('div', { class: 'dup-list' }, h('p', { class: 'muted' }, 'Chargement…'));
  const s = sheet('Fichiers abîmés', body, { wide: true });
  try {
    const list = await api('/api/admin/broken');
    if (!list.length) { body.replaceChildren(h('p', { class: 'muted' }, 'Aucun fichier abîmé repéré. La tâche « Fichiers abîmés » (Serveur → Tâches) lit un peu de chaque vidéo, 30 par passage, les nouvelles d’abord.')); return; }
    body.replaceChildren(h('p', {}, `${list.length} fichier${list.length > 1 ? 's' : ''} ne se lisent pas correctement (téléchargement incomplet, disque abîmé…). Remplacez-les, ou supprimez-les.`),
      ...list.map((f) => h('div', { class: 'dup-v' }, h('div', { class: 'grow' }, h('b', {}, f.show_title ? `${f.show_title} S${f.season_num} É${f.episode_num}` : f.title), h('small', {}, f.path), h('small', { class: 'warn' }, f.error || 'Erreur de lecture')),
        h('button', { class: 'btn btn-small f', onclick: () => { s.close(); go(`/titre/${f.item_id}`); } }, 'Fiche'))));
  } catch (e) { body.replaceChildren(h('p', { class: 'error-text' }, e.message)); }
}
