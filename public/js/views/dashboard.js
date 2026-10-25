// Tableau de bord de l'administrateur
// Lectures en cours (pause, arrêt, message), code de connexion à 6 chiffres, appareils, tâches de fond,
// santé du serveur (processeur, mémoire, disques), activité récente, ajouts récents.
import { api } from '../api.js';
import { h, icon, img, toast, sheet, fmtTime, avatar, confirmSheet } from '../ui.js';
import { row } from '../components.js';
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

export async function render(main) {
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
  const kpis = h('div', { class: 'kpis' });
  page.append(head, kpis,
    h('div', { class: 'dash-grid top' }, slot('playing', 'playing-box'), slot('code', 'code-box')),
    h('div', { class: 'dash-grid' }, slot('devices'), slot('tasks'), slot('system'), slot('activity'), slot('libs')),
    slot('recent', 'recent-box'));

  // ---------------------------------------------------------------- en-tête et chiffres
  let headSig = null;
  const paintHead = () => {
    const sv = d.server;
    const sig = JSON.stringify([sv.name, Math.floor(sv.uptime / 60), d.counts, d.totals]);
    if (sig === headSig) return;
    headSig = sig;
    head.replaceChildren(
      h('div', {},
        h('h1', {}, 'Tableau de bord'),
        h('p', { class: 'dash-sub' }, h('b', {}, sv.name), ` · Venus ${sv.version} · en ligne depuis ${fmtUptime(sv.uptime)} · ${sv.host} (${sv.os}, ${sv.runtime === 'docker' ? 'Docker' : sv.runtime === 'lxc' ? 'conteneur LXC' : sv.platform}) · Node ${sv.node.replace(/^v/, '')}`)),
      h('div', { class: 'dash-actions' },
        h('button', { class: 'tool f', onclick: async () => { await api('/api/admin/scan', { method: 'POST', body: {} }); toast('Analyse des médiathèques lancée'); refresh(); } }, icon('refresh'), h('span', { class: 'lbl' }, 'Analyser les médiathèques')),
        h('button', { class: 'tool f', onclick: () => compose(null) }, icon('chat'), h('span', { class: 'lbl' }, 'Message à tous')),
        sv.canRestart ? h('button', { class: 'tool f', onclick: restart }, icon('power'), h('span', { class: 'lbl' }, 'Redémarrer')) : null,
        h('button', { class: 'tool f', onclick: () => go('/reglages') }, icon('gear'), h('span', { class: 'lbl' }, 'Réglages'))));
    const c = d.counts;
    const tiles = [
      ['Films', c.movie, 'film', '/films'], ['Séries', c.show, 'tv', '/series'], ['Animés', c.anime, 'spark', '/animes'],
      ['Épisodes', c.episode, 'eps', null], ['Clips', c.clip, 'note', '/clips'], ['Chaînes', c.channel, 'live', '/tv'],
      ['Stockage', fmtBytes(d.totals.size), 'server', null], ['Heures de vidéo', nf.format(d.totals.hours), 'cal', null],
    ].filter(([, v], i) => i >= 6 || v);
    kpis.replaceChildren(...tiles.map(([label, v, ic, href]) => h(href ? 'button' : 'div', { class: `kpi${href ? ' f' : ''}`, onclick: href ? () => go(href) : undefined },
      h('span', { class: 'kpi-ic' }, icon(ic)), h('b', {}, typeof v === 'number' ? nf.format(v) : v), h('span', {}, label))));
  };

  // ---------------------------------------------------------------- lectures en cours
  const paintPlaying = () => paintSlot('playing', d.playing.map((p) => ({ ...p, position: Math.round(p.position / 5), seen: 0 })), () => {
    const list = d.playing;
    return [
      h('div', { class: 'dash-title' }, h('h2', {}, 'En cours de lecture'), h('span', { class: 'pill' }, list.length ? `${list.length} en cours` : 'Personne'),
        d.transcodes ? h('span', { class: 'pill warm' }, `${d.transcodes} conversion${d.transcodes > 1 ? 's' : ''}`) : null),
      list.length ? h('div', { class: 'np-list' }, list.map(npCard)) : h('p', { class: 'dash-empty' }, 'Personne ne regarde quoi que ce soit en ce moment. Les lectures apparaissent ici en direct, avec de quoi les mettre en pause, les arrêter ou envoyer un message.'),
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
      await api('/api/admin/control', { method: 'POST', body: { device, cmd, text } });
      toast(cmd === 'pause' ? 'Pause demandée' : cmd === 'play' ? 'Reprise demandée' : cmd === 'stop' ? 'Lecture arrêtée' : 'Message envoyé');
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
    } }, input, h('p', { class: 'muted' }, 'Le message s’affiche par-dessus l’image, même en plein écran.'), h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-play f', type: 'submit' }, icon('send'), 'Envoyer'))));
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
      h('p', { class: 'muted' }, 'Pour connecter un nouvel appareil sans donner le mot de passe : « Se connecter avec un code à 6 chiffres ». Le code ne sert qu’une fois, il change à chaque connexion.'),
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
    h('div', { class: 'dev-list' }, d.devices.slice(0, allDevices ? 40 : 7).map((x) => h('div', { class: 'dev' },
      h('span', { class: `dev-dot${Date.now() - x.lastSeen < 5 * 60000 ? ' on' : ''}`, title: Date.now() - x.lastSeen < 5 * 60000 ? 'Actif' : 'Inactif' }),
      h('div', { class: 'grow' }, h('b', {}, x.name, x.current ? h('em', {}, ' (cet appareil)') : null, x.playing ? h('span', { class: 'pill tiny' }, 'en lecture') : null),
        h('span', {}, `${x.profile || 'Aucun profil'} · ${ago(x.lastSeen)}`)),
      h('button', { class: 'btn btn-ghost btn-icon btn-mini f', 'data-k': `dm${x.id}`, title: 'Envoyer un message', 'aria-label': 'Envoyer un message', onclick: () => compose(x.id, x.profile || x.name) }, icon('chat')),
      x.current ? null : h('button', { class: 'btn btn-ghost btn-icon btn-mini f', 'data-k': `dx${x.id}`, title: 'Déconnecter cet appareil', 'aria-label': 'Déconnecter cet appareil', onclick: async () => {
        if (!(await confirmSheet(`Déconnecter « ${x.name} » ? Il faudra le mot de passe ou un code pour revenir.`, 'Déconnecter'))) return;
        try { await api(`/api/admin/devices/${x.id}`, { method: 'DELETE' }); toast('Appareil déconnecté'); refresh(); } catch (e) { toast(e.message, true); }
      } }, icon('exit'))))),
    d.devices.length > 7 ? h('button', { class: 'linkish dash-more f', 'data-k': 'alldev', onclick: () => { allDevices = !allDevices; paintDevices(); } }, allDevices ? 'Afficher moins' : `Afficher les ${d.devices.length} appareils`) : null,
  ]);

  // ---------------------------------------------------------------- tâches de fond
  const paintTasks = () => paintSlot('tasks', d.tasks, () => {
    const t = d.tasks;
    const sc = t.scan;
    const item = (ic, title, text, extra) => h('div', { class: 'task' }, h('span', { class: 'task-ic' }, icon(ic)), h('div', { class: 'grow' }, h('b', {}, title), h('span', {}, text), extra || null));
    return [
      h('div', { class: 'dash-title' }, h('h2', {}, 'Tâches de fond')),
      item('refresh', 'Analyse des médiathèques', sc.running ? `${sc.phase || 'En cours'}${sc.total ? ` · ${sc.done} / ${sc.total}` : ''}` : sc.lastScan ? `Terminée ${ago(sc.lastScan)}${sc.error ? ` · erreur : ${sc.error}` : ''}` : 'Pas encore lancée',
        sc.running && sc.total ? meter((sc.done / sc.total) * 100) : null),
      item('spark', 'Notes et distribution', t.ratings ? `${t.ratings} titre${t.ratings > 1 ? 's' : ''} en file d’attente` : t.noRatings ? `${t.noRatings} titre${t.noRatings > 1 ? 's' : ''} pas encore traités` : 'À jour'),
      item('skip', 'Génériques (début et fin)', t.segments ? `${t.segments} saison${t.segments > 1 ? 's' : ''} à analyser` : 'À jour'),
      t.unmatched ? item('info', 'Titres non reconnus', `${t.unmatched} à identifier`, h('button', { class: 'linkish f', 'data-k': 'unm', onclick: () => go('/reglages?section=sources') }, 'Corriger')) : null,
    ];
  });

  // ---------------------------------------------------------------- système
  const paintSystem = () => paintSlot('system', { ...d.system, load: d.system.load.map((x) => Math.round(x * 10)), memFree: Math.round(d.system.memFree / 5e7), rss: Math.round(d.system.rss / 5e6) }, () => {
    const s = d.system;
    const memUsed = s.memTotal - s.memFree;
    const loadPct = (s.load[0] / s.cpus) * 100;
    return [
      h('div', { class: 'dash-title' }, h('h2', {}, 'Serveur')),
      h('div', { class: 'sys' },
        h('div', { class: 'sys-row' }, h('span', {}, 'Processeur'), h('b', {}, loadPct > 100 ? 'Saturé' : `${Math.round(loadPct)} %`), meter(loadPct), h('small', {}, `${s.cpus} cœurs · ${s.cpuModel.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').trim()}`)),
        h('div', { class: 'sys-row' }, h('span', {}, 'Mémoire'), h('b', {}, `${fmtBytes(memUsed)} / ${fmtBytes(s.memTotal)}`), meter((memUsed / s.memTotal) * 100), h('small', {}, `Venus utilise ${fmtBytes(s.rss)}`)),
        h('div', { class: 'sys-row' }, h('span', {}, 'Accélération'), h('b', {}, d.server.hw.label || 'Processeur seul'), null, h('small', {}, d.server.hw.type && d.server.hw.type !== 'none' ? (d.server.hw.tested ? 'Testée et fonctionnelle' : 'Détectée') : 'Aucune carte graphique utilisable : conversions plus lentes')),
        ...s.disks.map((k) => h('div', { class: 'sys-row' }, h('span', {}, 'Disque'), h('b', {}, `${fmtBytes(k.total - k.free)} / ${fmtBytes(k.total)}`), meter(((k.total - k.free) / k.total) * 100), h('small', {}, `${fmtBytes(k.free)} libres · ${k.names.join(', ')}`)))),
    ];
  });

  // ---------------------------------------------------------------- activité
  const paintActivity = () => paintSlot('activity', d.activity.map((a) => a.at), () => [
    h('div', { class: 'dash-title' }, h('h2', {}, 'Activité récente')),
    d.activity.length ? h('ol', { class: 'timeline' }, d.activity.slice(0, 14).map((a) => h('li', { class: `act-${a.kind}` }, h('span', { class: 'tl-ic' }, icon(ACT_ICON[a.kind] || 'info')), h('div', {}, h('p', {}, a.text), h('small', {}, ago(a.at))))))
      : h('p', { class: 'dash-empty' }, 'Rien depuis le démarrage du serveur. Lectures, connexions et messages s’afficheront ici.'),
  ]);

  // ---------------------------------------------------------------- médiathèques
  const paintLibs = () => paintSlot('libs', d.libraries.map((l) => [l.id, l.items, l.exists, l.network && l.network.ok]), () => [
    h('div', { class: 'dash-title' }, h('h2', {}, 'Médiathèques'), h('button', { class: 'linkish f', 'data-k': 'libs', onclick: () => go('/reglages') }, 'Gérer')),
    d.libraries.length ? h('div', { class: 'dev-list' }, d.libraries.map((l) => h('div', { class: 'dev' },
      h('span', { class: `dev-dot${!l.exists || (l.network && l.network.ok === false) ? ' bad' : ' on'}`, title: !l.exists ? 'Dossier introuvable' : 'Disponible' }),
      h('div', { class: 'grow' }, h('b', {}, l.name), h('span', {}, `${nf.format(l.items)} élément${l.items > 1 ? 's' : ''} · ${l.network ? l.network.address : l.path}`))))) : h('p', { class: 'dash-empty' }, 'Aucune médiathèque.'),
  ]);

  // ---------------------------------------------------------------- ajouts récents
  const paintRecent = () => paintSlot('recent', d.recent.map((i) => i.id), () => (d.recent.length ? [row({ title: 'Ajouts récents', items: d.recent })] : []));

  const paintAll = () => { paintHead(); paintPlaying(); paintCode(); paintDevices(); paintTasks(); paintSystem(); paintActivity(); paintLibs(); paintRecent(); };
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
