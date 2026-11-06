// Tableau de bord de l'administrateur
// Lectures en cours (pause, arrêt, message), code de connexion à 6 chiffres, appareils, tâches de fond,
// santé du serveur (processeur, mémoire, disques), activité récente, ajouts récents.
import { api } from '../api.js';
import { h, icon, img, toast, sheet, fmtTime, avatar, confirmSheet } from '../ui.js';
import { go, state } from '../app.js';

const fmtBytes = (b) => {
  if (!b) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To', 'Po'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i >= 3 ? 1 : 0).replace('.', ',')} ${u[i]}`;
};
const nf = new Intl.NumberFormat('fr-FR');
const ago = (t) => {
  if (!t) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d < 30 ? `il y a ${d} j` : new Date(t).toLocaleDateString('fr-FR');
};
const fmtUptime = (s) => {
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
  return d ? `${d} j ${hh} h` : hh ? `${hh} h ${mm} min` : `${mm} min`;
};
const meter = (pct, cls = '') => h('div', { class: `meter ${cls}${pct > 90 ? ' hot' : pct > 75 ? ' warm' : ''}` }, h('i', { style: { width: `${Math.max(0, Math.min(100, pct))}%` } }));
const ACT_ICON = { play: 'play', stop: 'stop', login: 'key', message: 'chat', control: 'pause', device: 'exit', server: 'power', scan: 'refresh', seerr: 'down' };

export async function render(main, { query } = {}) {
  if (!state.profile.isAdmin) { main.append(h('div', { class: 'empty' }, h('h2', {}, 'Réservé à l’administrateur'))); return; }
  let d = await api('/api/admin/dashboard');
  const page = h('div', { class: 'page dash' });
  main.append(page);

  // Chaque bloc n'est redessiné que si ses données ont changé (le focus clavier reste en place)
  const slots = {};
  const slot = (name, cls = '') => (slots[name] = { el: h('section', { class: `dash-box ${cls}` }), sig: null }).el;
  const paintSlot = (name, data, build) => {
    const s = slots[name];
    const sig = JSON.stringify(data);
    if (s.sig === sig) return;
    s.sig = sig;
    const hadFocus = s.el.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    s.el.replaceChildren(...build(data).filter(Boolean));
    if (hadFocus) s.el.querySelector(`[data-k="${hadFocus}"]`)?.focus({ preventScroll: true });
  };

  const head = h('div', { class: 'dash-head' });
  // Mise à jour disponible ? (vérifié au plus toutes les 30 minutes côté serveur)
  const updNote = h('div', { class: 'upd-note', hidden: true });
  // Journal des changements : ce qui a changé depuis la dernière visite, montré une fois
  api('/api/admin/changelog').then((c) => {
    if (!c.items || !c.items.length) return;
    const box = h('div', { class: 'upd-note changelog' }, icon('spark'),
      h('div', { class: 'cl-body' }, h('b', {}, `Venus a été mis à jour (${c.items.length} changement${c.items.length > 1 ? 's' : ''})`), h('ul', {}, c.items.slice(0, 6).map((i) => h('li', {}, i.title)))),
      h('button', { class: 'btn btn-small f', onclick: async () => { box.remove(); await api('/api/admin/changelog/seen', { method: 'POST' }).catch(() => {}); } }, 'Vu'));
    updNote.before(box);
  }).catch(() => {});
  api('/api/admin/update').then((u) => { if (u && u.behind) { updNote.hidden = false; updNote.replaceChildren(icon('spark'), h('span', {}, `Mise à jour disponible : ${u.behind}${u.more ? '+' : ''} nouveauté${u.behind > 1 ? 's' : ''}`), h('button', { class: 'btn btn-small btn-play f', onclick: () => go('/serveur?onglet=maj') }, 'Voir')); } }).catch(() => {});
  const kpis = h('div', { class: 'kpis' });
  const kpiMore = h('p', { class: 'kpi-more' });
  // Deux colonnes : ce qui se passe (lectures, santé, activité) à gauche ; les outils du quotidien à droite.
  // Navigation par rubriques, comme les réglages : une colonne à gauche (bande en haut sur téléphone),
  // chaque rubrique ne montre que ses blocs ; les outils (Qualité, Sécurité…) sont des liens visibles, plus de menu caché.
  const NAV = [
    ['Suivi', [['apercu', 'Aperçu', 'gauge'], ['lectures', 'En ce moment', 'play'], ['appareils', 'Appareils', 'cast'], ['activite', 'Activité', 'chat']]],
    ['Serveur', [['sante', 'Santé', 'server'], ['taches', 'Tâches de fond', 'refresh'], ['medias', 'Médiathèques', 'folder']]],
    ['Outils', [['/qualite', 'Qualité', 'film'], ['/securite', 'Sécurité', 'lock'], ['/serveur', 'Mises à jour et journaux', 'spark'], ['/stats', 'Statistiques', 'gauge'], ['/reglages', 'Réglages', 'gear']]],
  ];
  const WHERE = { playing: ['apercu', 'lectures'], code: ['apercu', 'appareils'], tasks: ['apercu', 'taches'], devices: ['appareils'], system: ['sante'], activity: ['activite'], libs: ['medias', 'sante'] };
  const TABS = NAV.flatMap(([, l]) => l).filter(([k]) => !k.startsWith('/'));
  let tab = (query && query.get('vue')) || (() => { try { return sessionStorage.getItem('vn_dash_tab'); } catch { return null; } })() || 'apercu';
  if (!TABS.some(([k]) => k === tab)) tab = 'apercu';
  const nav = h('nav', { class: 'set-nav', 'aria-label': 'Rubriques du tableau de bord' });
  const paneHead = h('div', { class: 'set-head' });
  const grid = h('div', { class: 'dash-grid' }, slot('playing', 'playing-box'), slot('code', 'code-box c-code'), slot('tasks', 'c-task'), slot('devices', 'c-dev'), slot('system', 'c-health'), slot('activity', 'c-act'), slot('libs', 'c-libs'));
  const show = () => {
    for (const [name, tabs] of Object.entries(WHERE)) slots[name].el.hidden = !tabs.includes(tab);
    kpis.hidden = kpiMore.hidden = tab !== 'apercu';
    grid.dataset.tab = tab;
    nav.replaceChildren(...NAV.map(([title, items]) => h('div', { class: 'set-group' }, h('span', { class: 'set-group-t' }, title),
      ...items.map(([k, label, ic]) => (k.startsWith('/')
        ? h('a', { class: 'set-tab f', href: k }, icon(ic), h('span', {}, label), icon('fwd'))
        : h('button', { class: `set-tab f${k === tab ? ' on' : ''}`, 'aria-current': k === tab ? 'page' : null, onclick: () => {
          tab = k; try { sessionStorage.setItem('vn_dash_tab', k); } catch { /* */ }
          history.replaceState(history.state, '', k === 'apercu' ? '/dashboard' : `/dashboard?vue=${k}`);
          show(); grid.classList.remove('swap'); void grid.offsetWidth; grid.classList.add('swap');
        } }, icon(ic), h('span', {}, label)))))));
    paneHead.replaceChildren(h('h2', {}, (TABS.find(([k]) => k === tab) || [])[1] || ''));
  };
  page.append(head, updNote, h('div', { class: 'set-layout dash-layout' }, nav, h('div', { class: 'set-main' }, paneHead, kpis, kpiMore, grid)));
  show();

  // ---------------------------------------------------------------- en-tête et chiffres
  let headSig = null;
  const paintHead = () => {
    const sv = d.server;
    const sig = JSON.stringify([sv.name, Math.floor(sv.uptime / 60), d.counts, d.totals, Math.round((d.system.load[0] / d.system.cpus) * 10), Math.round(d.system.memFree / 1e9), d.system.disks.map((k) => Math.round(k.free / 1e10)), d.libraries.map((l) => [l.exists, l.network && l.network.ok])]);
    if (sig === headSig) return;
    headSig = sig;
    // État général en un coup d'œil (vert / orange / rouge)
    const s = d.system, loadPct = (s.load[0] / s.cpus) * 100, memPct = ((s.memTotal - s.memFree) / s.memTotal) * 100;
    const diskPct = Math.max(0, ...s.disks.map((k) => ((k.total - k.free) / k.total) * 100));
    const missing = d.libraries.filter((l) => !l.exists || (l.network && l.network.ok === false)).length;
    const issues = [loadPct > 100 && 'processeur saturé', memPct > 90 && 'mémoire presque pleine', diskPct > 90 && 'disque presque plein', missing && `${missing} médiathèque${missing > 1 ? 's' : ''} introuvable${missing > 1 ? 's' : ''}`].filter(Boolean);
    const level = diskPct > 95 || missing || loadPct > 150 ? 'bad' : issues.length ? 'warn' : 'good';
    const more = () => {
      const go2 = (path) => () => { sh.close(); go(path); };
      const opt = (ic, label, sub, fn) => h('button', { class: 'opt f', onclick: fn }, icon(ic), h('span', {}, h('b', {}, label), h('small', {}, sub)));
      const sh = sheet('Administration', h('div', { class: 'dash-menu' },
        opt('film', 'Qualité', 'Conversions, formats, accélération', go2('/qualite')), opt('lock', 'Sécurité', 'Accès, mots de passe, appareils', go2('/securite')),
        opt('server', 'Serveur', `Venus ${sv.version} · ${sv.host} (${sv.os}) · Node ${sv.node.replace(/^v/, '')}`, go2('/serveur')), opt('gear', 'Réglages', 'Médiathèques, sources, menu', go2('/reglages'))));
    };
    head.replaceChildren(
      h('div', {},
        h('div', { class: 'dash-h1' }, h('h1', {}, 'Tableau de bord'), h('span', { class: `status-chip ${level}` }, h('i'), level === 'good' ? 'Tout va bien' : issues.join(' · '))),
        h('p', { class: 'dash-sub' }, `Venus ${sv.version} · en ligne depuis ${fmtUptime(sv.uptime)}`)),
      h('div', { class: 'dash-actions' },
        h('button', { class: 'tool f', onclick: async () => { await api('/api/admin/scan', { method: 'POST', body: {} }); toast('Analyse des médiathèques lancée'); refresh(); } }, icon('refresh'), h('span', { class: 'lbl' }, 'Analyser')),
        h('button', { class: 'tool f', onclick: () => compose(null) }, icon('chat'), h('span', { class: 'lbl' }, 'Message à tous')),
        sv.canRestart ? h('button', { class: 'tool f', onclick: restart }, icon('power'), h('span', { class: 'lbl' }, 'Redémarrer')) : null,
        null));
    const c = d.counts;
    // Quatre chiffres en couleur ; le reste en une ligne discrète
    const tiles = [['Films', c.movie, 'film', '/films', 'k-blue'], ['Séries', c.show, 'tv', '/series', 'k-violet'], ['Animés', c.anime, 'spark', '/animes', 'k-pink'], ['Stockage', fmtBytes(d.totals.size), 'server', null, 'k-amber']].filter(([, v], i) => i === 3 || v);
    kpis.replaceChildren(...tiles.map(([label, v, ic, href, col]) => h(href ? 'button' : 'div', { class: `kpi ${col}${href ? ' f' : ''}`, onclick: href ? () => go(href) : undefined },
      h('span', { class: 'kpi-ic' }, icon(ic)), h('b', {}, typeof v === 'number' ? nf.format(v) : v), h('span', {}, label))));
    kpiMore.textContent = [c.episode && `${nf.format(c.episode)} épisodes`, c.clip && `${nf.format(c.clip)} clips`, c.channel && `${nf.format(c.channel)} chaînes`, d.totals.hours && `${nf.format(d.totals.hours)} h de vidéo`].filter(Boolean).join(' · ');
  };

  // ---------------------------------------------------------------- lectures en cours
  const paintPlaying = () => paintSlot('playing', d.playing.map((p) => ({ ...p, position: Math.round(p.position / 5), seen: 0 })), () => {
    const list = d.playing;
    return [
      h('div', { class: 'dash-title' }, h('h2', {}, 'En ce moment'), list.length ? h('span', { class: 'pill live' }, `${list.length} en cours`) : null,
        d.transcodes ? h('span', { class: 'pill warm' }, `${d.transcodes} conversion${d.transcodes > 1 ? 's' : ''}`) : null),
      list.length ? h('div', { class: 'np-list' }, list.map(npCard)) : h('p', { class: 'dash-empty calm' }, icon('moon'), 'Personne ne regarde en ce moment.'),
    ];
  });
  const npCard = (p) => {
    const pct = p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
    const mode = p.mode === 'direct' ? 'Lecture directe' : p.mode === 'remux' ? 'Remux (sans perte)' : p.mode === 'live' || p.live ? 'Direct TV' : p.mode ? `Conversion${p.hw ? ` · ${p.hw}` : ''}` : '';
    const art = p.backdrop || p.poster;
    const pic = h('img', { src: art ? img(art) : `/api/items/${p.itemId}/thumb`, alt: '' });
    pic.addEventListener('error', () => pic.remove(), { once: true });
    return h('article', { class: `np${p.paused ? ' paused' : ''}` },
      h('div', { class: 'np-art' }, p.live && !art ? null : pic, h('span', { class: `np-state${p.paused ? ' paused' : ''}` }, icon(p.paused ? 'pause' : 'play'), p.paused ? 'En pause' : 'Lecture')),
      h('div', { class: 'np-body' },
        h('button', { class: 'np-title f', 'data-k': `t${p.device}`, onclick: () => go(`/titre/${p.showId || p.itemId}`) }, p.showTitle || p.title),
        p.showTitle ? h('div', { class: 'np-sub' }, `S${p.season} É${p.episode} · ${p.title}`) : null,
        h('div', { class: 'np-who' }, avatar({ name: p.profile, avatar: p.avatar }, 'tiny'), h('span', {}, `${p.profile} · ${p.deviceName}`), h('small', {}, p.ip ? p.ip.replace(/^::ffff:/, '') : '')),
        p.live ? h('div', { class: 'np-time' }, 'En direct') : h('div', { class: 'np-prog' }, h('div', { class: 'meter' }, h('i', { style: { width: `${pct}%` } })), h('span', {}, `${fmtTime(p.position)} / ${fmtTime(p.duration)}`)),
        h('div', { class: 'np-tags' }, mode ? h('span', { class: `pill${p.mode === 'transcode' ? ' warm' : ''}` }, mode) : null, p.quality && p.quality !== 'auto' ? h('span', { class: 'pill' }, p.quality) : null,
          p.hls && p.hls.reason ? h('span', { class: 'pill ghost', title: p.hls.reason }, p.hls.reason) : null)),
      h('div', { class: 'np-ctl' },
        h('button', { class: 'btn btn-ghost btn-icon f', 'data-k': `p${p.device}`, 'aria-label': p.paused ? 'Reprendre la lecture' : 'Mettre en pause', title: p.paused ? 'Reprendre' : 'Pause', onclick: () => send(p.device, p.paused ? 'play' : 'pause') }, icon(p.paused ? 'play' : 'pause')),
        h('button', { class: 'btn btn-ghost btn-icon f', 'data-k': `s${p.device}`, 'aria-label': 'Arrêter la lecture', title: 'Arrêter', onclick: () => send(p.device, 'stop') }, icon('stop')),
        h('button', { class: 'btn btn-ghost btn-icon f', 'data-k': `m${p.device}`, 'aria-label': 'Envoyer un message', title: 'Message', onclick: () => compose(p.device, p.profile) }, icon('chat'))));
  };
  const send = async (device, cmd, text) => {
    try {
      const r = await api('/api/admin/control', { method: 'POST', body: device ? { device, cmd, text } : { all: true, cmd, text } });
      toast(cmd === 'pause' ? 'Pause demandée' : cmd === 'play' ? 'Reprise demandée' : cmd === 'stop' ? 'Lecture arrêtée'
        : !device ? (r && r.sent ? `Message envoyé à ${r.sent} appareil${r.sent > 1 ? 's' : ''}` : 'Message envoyé (aucun autre appareil ouvert pour l’instant)') : 'Message envoyé', { type: 'success' });
      setTimeout(refresh, 1200);
    } catch (e) { toast(e.message, true); }
  };
  const compose = (device, who) => {
    const input = h('textarea', { class: 'input', rows: 3, maxlength: 300, placeholder: 'Ex. : le serveur redémarre dans 5 minutes' });
    const s = sheet(device ? `Message pour ${who || 'cet appareil'}` : 'Message à tous les appareils', h('form', { onsubmit: async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      await send(device, 'message', input.value);
      s.close();
    } }, input, h('p', { class: 'muted' }, 'Il apparaît en petite notification en bas à droite chez les autres, même en plein écran. Toi, tu ne le reçois pas.'), h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', type: 'submit' }, icon('send'), 'Envoyer'))));
    setTimeout(() => input.focus(), 50);
  };
  const restart = async () => {
    if (!(await confirmSheet('Redémarrer Venus ? Les lectures en cours seront coupées quelques secondes.', 'Redémarrer'))) return;
    try { await api('/api/admin/restart', { method: 'POST' }); toast('Redémarrage…'); setTimeout(() => location.reload(), 6000); } catch (e) { toast(e.message, true); }
  };

  // ---------------------------------------------------------------- code de connexion
  const codeEl = h('b', { class: 'big-code' });
  const codeLeft = h('span', { class: 'code-left' });
  const codeBar = h('div', { class: 'meter code-meter' }, h('i'));
  const paintCode = () => paintSlot('code', { code: d.loginCode.code, uses: d.loginCode.uses }, () => {
    codeEl.textContent = `${d.loginCode.code.slice(0, 3)} ${d.loginCode.code.slice(3)}`;
    return [
      h('div', { class: 'dash-title' }, h('h2', {}, 'Code de connexion'), d.loginCode.uses ? h('span', { class: 'pill' }, `${d.loginCode.uses} connexion${d.loginCode.uses > 1 ? 's' : ''}`) : null),
      h('p', { class: 'muted small' }, 'Pour connecter un appareil sans mot de passe. Valable une fois.'),
      h('div', { class: 'code-wrap' }, codeEl, h('button', { class: 'btn btn-ghost btn-icon f', 'data-k': 'copy', 'aria-label': 'Copier le code', title: 'Copier', onclick: () => { navigator.clipboard?.writeText(d.loginCode.code).then(() => toast('Code copié'), () => {}); } }, icon('copy'))),
      codeBar, codeLeft,
      h('button', { class: 'btn btn-small btn-ghost f', 'data-k': 'renew', onclick: async () => { d.loginCode = await api('/api/admin/login-code', { method: 'POST' }); paintCode(); tick(); toast('Nouveau code créé'); } }, icon('refresh'), 'Nouveau code'),
    ];
  });
  const tick = () => {
    const left = Math.max(0, d.loginCode.expires - Date.now());
    codeLeft.textContent = left ? `Expire dans ${fmtTime(left / 1000)}` : 'Expiré : un nouveau code arrive…';
    codeBar.firstChild.style.width = `${(left / d.loginCode.ttl) * 100}%`;
    if (!left) refresh();
  };

  // ---------------------------------------------------------------- appareils
  let allDevices = false;
  const paintDevices = () => paintSlot('devices', [allDevices, d.devices.map((x) => ({ ...x, lastSeen: Math.round(x.lastSeen / 60000) }))], () => [
    h('div', { class: 'dash-title' }, h('h2', {}, 'Appareils'), h('span', { class: 'pill' }, String(d.devices.length))),
    h('div', { class: 'dev-list' }, d.devices.slice(0, allDevices ? 40 : 5).map((x) => h('div', { class: 'dev' },
      h('span', { class: `dev-dot${Date.now() - x.lastSeen < 5 * 60000 ? ' on' : ''}`, title: Date.now() - x.lastSeen < 5 * 60000 ? 'Actif' : 'Inactif' }),
      h('div', { class: 'grow' }, h('b', {}, x.name, x.current ? h('em', {}, ' (cet appareil)') : null, x.playing ? h('span', { class: 'pill tiny' }, 'en lecture') : null),
        h('span', {}, `${x.profile || 'Aucun profil'} · ${ago(x.lastSeen)}`)),
      h('button', { class: 'btn btn-ghost btn-icon btn-mini f', 'data-k': `dm${x.id}`, title: 'Envoyer un message', 'aria-label': 'Envoyer un message', onclick: () => compose(x.id, x.profile || x.name) }, icon('chat')),
      x.current ? null : h('button', { class: 'btn btn-ghost btn-icon btn-mini f', 'data-k': `dx${x.id}`, title: 'Déconnecter cet appareil', 'aria-label': 'Déconnecter cet appareil', onclick: async () => {
        if (!(await confirmSheet(`Déconnecter « ${x.name} » ? Il faudra le mot de passe ou un code pour revenir.`, 'Déconnecter'))) return;
        try { await api(`/api/admin/devices/${x.id}`, { method: 'DELETE' }); toast('Appareil déconnecté'); refresh(); } catch (e) { toast(e.message, true); }
      } }, icon('exit'))))),
    d.devices.length > 5 ? h('button', { class: 'linkish dash-more f', 'data-k': 'alldev', onclick: () => { allDevices = !allDevices; paintDevices(); } }, allDevices ? 'Afficher moins' : `Afficher les ${d.devices.length} appareils`) : null,
  ]);

  // ---------------------------------------------------------------- tâches de fond
  const paintTasks = () => paintSlot('tasks', d.tasks, () => {
    const t = d.tasks;
    const sc = t.scan;
    const item = (ic, title, text, extra) => h('div', { class: 'task' }, h('span', { class: 'task-ic' }, icon(ic)), h('div', { class: 'grow' }, h('b', {}, title), h('span', {}, text), extra || null));
    const pending = [
      sc.running && item('refresh', 'Analyse des médiathèques', `${sc.phase || 'En cours'}${sc.total ? ` · ${sc.done} / ${sc.total}` : ''}`, sc.total ? meter((sc.done / sc.total) * 100) : null),
      sc.error && item('info', 'Dernière analyse', `Erreur : ${sc.error}`),
      t.ratings && item('spark', 'Notes et distribution', `${t.ratings} titre${t.ratings > 1 ? 's' : ''} en file d’attente`),
      t.segments && item('skip', 'Génériques (début et fin)', `${t.segments} saison${t.segments > 1 ? 's' : ''} à analyser`),
      t.unmatched && item('info', 'Titres non reconnus', `${t.unmatched} à identifier`, h('button', { class: 'linkish f', 'data-k': 'unm', onclick: () => go('/reglages?section=sources') }, 'Corriger')),
    ].filter(Boolean);
    // Rien en cours : une seule ligne
    return [
      h('div', { class: 'dash-title' }, h('h2', {}, 'Tâches de fond'), pending.length ? h('span', { class: 'pill warm' }, String(pending.length)) : null),
      ...(pending.length ? pending : [h('p', { class: 'dash-empty ok' }, icon('check'), `Tout est à jour${sc.lastScan ? ` · dernière analyse ${ago(sc.lastScan)}` : ''}`)]),
    ];
  });

  // ---------------------------------------------------------------- système
  const paintSystem = () => paintSlot('system', { ...d.system, load: d.system.load.map((x) => Math.round(x * 10)), memFree: Math.round(d.system.memFree / 5e7), rss: Math.round(d.system.rss / 5e6) }, () => {
    const s = d.system;
    const memUsed = s.memTotal - s.memFree;
    const loadPct = (s.load[0] / s.cpus) * 100;
    const diskUsed = s.disks.reduce((a, k) => a + k.total - k.free, 0), diskTotal = s.disks.reduce((a, k) => a + k.total, 0);
    const gauge = (label, pct, value, sub) => h('div', { class: `gauge ${pct > 90 ? 'hot' : pct > 75 ? 'warm' : 'ok'}` },
      h('div', { class: 'g-ring', style: { '--p': `${Math.min(100, Math.round(pct))}` } }, h('b', {}, pct > 100 ? '100 %+' : `${Math.round(pct)} %`)),
      h('div', { class: 'g-txt' }, h('span', {}, label), h('small', {}, value), sub ? h('small', { class: 'dim' }, sub) : null));
    return [
      h('div', { class: 'dash-title' }, h('h2', {}, 'Santé du serveur')),
      h('div', { class: 'gauges' },
        gauge('Processeur', loadPct, loadPct > 100 ? 'Saturé' : 'Charge', `${s.cpus} cœurs`),
        gauge('Mémoire', (memUsed / s.memTotal) * 100, `${fmtBytes(memUsed)} / ${fmtBytes(s.memTotal)}`),
        diskTotal ? gauge('Disques', (diskUsed / diskTotal) * 100, `${fmtBytes(diskTotal - diskUsed)} libres`, d.forecast && d.forecast.fullIn != null && d.forecast.fullIn < 365 ? `plein dans ${d.forecast.fullIn > 60 ? `${Math.round(d.forecast.fullIn / 30)} mois` : `${d.forecast.fullIn} j`}` : null) : null),
      h('details', { class: 'sys-more' }, h('summary', { class: 'f' }, 'Détails'),
        h('div', { class: 'sys' },
          h('div', { class: 'sys-row' }, h('span', {}, 'Processeur'), h('b', {}, s.cpuModel.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').trim())),
          h('div', { class: 'sys-row' }, h('span', {}, 'Venus utilise'), h('b', {}, fmtBytes(s.rss))),
          h('div', { class: 'sys-row' }, h('span', {}, 'Accélération'), h('b', {}, d.server.hw.label || 'Processeur seul'), null, h('small', {}, d.server.hw.type && d.server.hw.type !== 'none' ? (d.server.hw.tested ? 'Testée et fonctionnelle' : 'Détectée') : 'Aucune carte graphique : conversions plus lentes')),
          ...s.disks.map((k) => h('div', { class: 'sys-row' }, h('span', {}, 'Disque'), h('b', {}, `${fmtBytes(k.total - k.free)} / ${fmtBytes(k.total)}`), meter(((k.total - k.free) / k.total) * 100), h('small', {}, `${fmtBytes(k.free)} libres · ${k.names.join(', ')}`))))),
    ];
  });

  // ---------------------------------------------------------------- activité
  const paintActivity = () => paintSlot('activity', d.activity.map((a) => a.at), () => [
    h('div', { class: 'dash-title' }, h('h2', {}, 'Activité récente')),
    d.activity.length ? h('ol', { class: 'timeline' }, d.activity.slice(0, 6).map((a) => h('li', { class: `act-${a.kind}` }, h('span', { class: 'tl-ic' }, icon(ACT_ICON[a.kind] || 'info')), h('div', {}, h('p', {}, a.text), h('small', {}, ago(a.at))))))
      : h('p', { class: 'dash-empty' }, 'Rien depuis le démarrage du serveur. Lectures, connexions et messages s’afficheront ici.'),
  ]);

  // ---------------------------------------------------------------- médiathèques
  // Médiathèques : affichées seulement quand l'une pose problème (sinon : Plus → Réglages)
  const badLibs = () => d.libraries.filter((l) => !l.exists || (l.network && l.network.ok === false));
  const paintLibs = () => paintSlot('libs', badLibs().map((l) => [l.id, l.items, l.exists, l.network && l.network.ok]), () => (!badLibs().length ? [] : [
    h('div', { class: 'dash-title' }, h('h2', {}, 'Médiathèques à vérifier'), h('button', { class: 'linkish f', 'data-k': 'libs', onclick: () => go('/reglages') }, 'Gérer')),
    h('div', { class: 'dev-list' }, badLibs().map((l) => h('div', { class: 'dev' },
      h('span', { class: `dev-dot${!l.exists || (l.network && l.network.ok === false) ? ' bad' : ' on'}`, title: !l.exists ? 'Dossier introuvable' : 'Disponible' }),
      h('div', { class: 'grow' }, h('b', {}, l.name), h('span', {}, `${!l.exists ? 'Dossier introuvable' : 'Partage réseau injoignable'} · ${l.network ? l.network.address : l.path}`))))),
  ]));

  // ---------------------------------------------------------------- ajouts récents

  const paintAll = () => { paintHead(); paintPlaying(); paintCode(); paintDevices(); paintTasks(); paintSystem(); paintActivity(); paintLibs(); };
  paintAll();
  tick();

  let busy = false;
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try { d = await api('/api/admin/dashboard'); paintAll(); } catch { /* serveur en redémarrage */ }
    busy = false;
  }
  const poll = setInterval(refresh, 4000);
  const clock = setInterval(tick, 1000);
  return { destroy: () => { clearInterval(poll); clearInterval(clock); } };
}
