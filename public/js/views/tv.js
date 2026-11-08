// TV en direct : lecteur qui reste visible (pause = direct différé, ±10 s, retour au direct, chaîne ±, son,
// plein écran) + mosaïque des chaînes avec leur image actuelle. Un clic lance la chaîne, le survol ne fait rien.
import { api, auth, deviceCaps } from '../api.js';
import { h, icon, img } from '../ui.js';
import { go, state } from '../core.js';
import { toast } from '../ui.js';
import { playPath } from '../components.js';
import { attachStream, numberZapper } from '../live.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const initials = (t) => t.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

export async function render(main, { query } = {}) {
  const vue = query && query.get('vue');
  if (vue === 'guide' || vue === 'enregistrements') {
    const m = await import('./guide.js');
    return vue === 'guide' ? m.renderGuide(main) : m.renderRecordings(main);
  }
  const { tvTabs, programSheet } = await import('./guide.js');
  const all = await api('/api/library?type=channel');
  // Chaînes qui n'ont pas donné d'image lors de la dernière vérification : cachées (l'administrateur peut revérifier)
  const down = all.filter((c) => c.down);
  const channels = all.filter((c) => !c.down);
  const admin = !!(state.profile && state.profile.isAdmin);
  // Programme en cours et suivant (guide XMLTV), s'il y en a un
  let nn = {};
  try { nn = await api('/api/epg/now'); } catch { /* pas de guide */ }
  const hm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const groups = [...new Set(channels.map((c) => c.group).filter(Boolean))];
  let group = '';
  let selected = null, session = null, detach = null, switchTimer = null, destroyed = false, muted = true, visible = [];

  // ------------------------------------------------------------ lecteur (en haut / à gauche, reste visible)
  let relay = null, hlsRef = null, heldAt = 0;
  const video = h('video', { playsinline: true, 'webkit-playsinline': true });
  const still = h('img', { class: 'pv-still', alt: '', onerror: (e) => { e.target.style.visibility = 'hidden'; }, onload: (e) => { e.target.style.visibility = ''; } });
  const status = h('div', { class: 'pv-status', hidden: true });
  const nameEl = h('h2', { class: 'pv-name' });
  const groupEl = h('p', { class: 'pv-group' });
  const progEl = h('div', { class: 'pv-prog' });
  // Enregistrer la chaîne : le programme en cours, le suivant, ou une durée (même sans guide)
  const record = async () => { if (!selected) return; const g = await import('./guide.js'); g.recordSheet(selected, nn[selected.id] || []); };
  // Commandes sur l'image
  const ctl = (ic, label, fn, cls = '') => h('button', { class: `pv-c f ${cls}`, type: 'button', title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); fn(); wake(); } }, icon(ic));
  const playBtn = ctl('pause', 'Pause (Venus enregistre : tu reprends où tu étais)', () => togglePause());
  const muteBtn = ctl('mute', 'Activer le son', () => setMuted(!muted));
  const volIn = h('input', { class: 'pv-vol', type: 'range', min: 0, max: 100, step: 5, value: 80, 'aria-label': 'Volume', oninput: (e) => { video.volume = e.target.value / 100; if (muted && video.volume > 0) setMuted(false); paintSound(); wake(); } });
  const liveBtn = h('button', { class: 'pv-livebtn f', type: 'button', title: 'Revenir au direct', onclick: (e) => { e.stopPropagation(); goLive(); wake(); } }, h('span', { class: 'dot' }), h('span', { class: 'lbl' }, 'Direct'));
  const bar = h('div', { class: 'pv-bar' },
    ctl('prev', 'Chaîne précédente', () => zap(-1)), playBtn, ctl('stop', 'Arrêter', () => stopPlayback(), 'pv-stop'), ctl('next', 'Chaîne suivante', () => zap(1)),
    ctl('r10', 'Reculer de 10 s', () => seekBy(-10), 'pv-seek'), ctl('f10', 'Avancer de 10 s', () => seekBy(10), 'pv-seek'), liveBtn,
    h('span', { class: 'pv-sp' }),
    muteBtn, volIn,
    h('button', { class: 'pv-c pv-rec f', type: 'button', title: 'Enregistrer', 'aria-label': 'Enregistrer', onclick: (e) => { e.stopPropagation(); record(); } }, h('span', { class: 'rec-dot' })),
    ctl('fs', 'Agrandir (plein écran)', () => toggleFs(), 'pv-fs'));
  const bigPlay = h('button', { class: 'pv-big f', type: 'button', 'aria-label': 'Lancer la chaîne', onclick: (e) => { e.stopPropagation(); if (selected) choose(selected, false); } }, icon('play'));
  const screen = h('div', { class: 'pv-screen idle', tabindex: 0, 'aria-label': 'Lecteur : espace pour pause, flèches pour le son et les chaînes, F pour agrandir' }, still, video, status, bigPlay, bar);
  let wakeT = 0, playing = false;
  function wake() { screen.classList.add('awake'); clearTimeout(wakeT); wakeT = setTimeout(() => screen.classList.remove('awake'), 3000); }
  screen.addEventListener('pointermove', wake);
  screen.addEventListener('click', () => { if (!playing) { if (selected) choose(selected, false); return; } if (screen.classList.contains('awake')) togglePause(); wake(); });
  screen.addEventListener('dblclick', () => toggleFs());
  screen.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === ' ' || k === 'k') togglePause();
    else if (k === 'ArrowUp') vol(0.1); else if (k === 'ArrowDown') vol(-0.1);
    else if (k === 'PageDown' || k === 'n') zap(1); else if (k === 'PageUp' || k === 'p') zap(-1);
    else if (k === 'ArrowRight') seekBy(10); else if (k === 'ArrowLeft') seekBy(-10);
    else if (k === 'f' || k === 'F') toggleFs(); else if (k === 'm' || k === 'M') setMuted(!muted);
    else if (k === 'l' || k === 'End') goLive();
    else return;
    e.preventDefault(); e.stopPropagation(); wake();
  });
  function paintSound() {
    const off = muted || video.volume === 0;
    muteBtn.replaceChildren(icon(off ? 'mute' : video.volume < 0.5 ? 'vollow' : 'vol'));
    muteBtn.title = off ? 'Activer le son' : 'Couper le son'; muteBtn.setAttribute('aria-label', muteBtn.title);
    volIn.value = String(Math.round((off ? 0 : video.volume) * 100));
  }
  function setMuted(m) { muted = m; video.muted = m; if (!m && video.volume === 0) video.volume = 0.5; paintSound(); }
  function vol(d) { video.volume = Math.max(0, Math.min(1, Math.round((video.volume + d) * 10) / 10)); setMuted(video.volume === 0); }
  // ------------------------------------------------------------ direct différé
  const liveEdge = () => { try { if (hlsRef && Number.isFinite(hlsRef.liveSyncPosition)) return hlsRef.liveSyncPosition; const s = video.seekable; return s.length ? s.end(s.length - 1) - 4 : NaN; } catch { return NaN; } };
  const behind = () => { const e = liveEdge(); return Number.isFinite(e) ? Math.max(0, e - video.currentTime) : 0; };
  const hold = (on) => { if (relay) api(`/api/live/${relay}/hold`, { method: 'POST', body: { on } }).catch(() => {}); };
  function togglePause() {
    if (!playing) { if (selected) choose(selected, false); return; }
    if (video.paused) video.play().catch(() => {});
    else { video.pause(); heldAt = Date.now(); hold(true); }
  }
  function seekBy(d) {
    if (!playing) return;
    const e = liveEdge(); let t = video.currentTime + d;
    try { const s = video.seekable; if (s.length) t = Math.max(s.start(0) + 1, t); } catch {}
    if (Number.isFinite(e)) t = Math.min(e, t);
    if (d < 0) hold(true);
    video.currentTime = t; video.play().catch(() => {});
  }
  function goLive() { const e = liveEdge(); if (Number.isFinite(e)) video.currentTime = e; video.play().catch(() => {}); hold(false); heldAt = 0; }
  const fmtLag = (s) => `−${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const lagT = setInterval(() => {
    if (!playing) return;
    const lag = behind(), late = lag > 12 || video.paused;
    liveBtn.classList.toggle('late', late);
    liveBtn.querySelector('.lbl').textContent = late && lag > 12 ? fmtLag(lag) : 'Direct';
    // Revenu tout seul au direct (en avançant) : plus besoin d'enregistrer
    if (heldAt && !video.paused && lag < 8) { hold(false); heldAt = 0; }
  }, 1000);
  video.addEventListener('play', () => { playBtn.replaceChildren(icon('pause')); playBtn.title = 'Pause'; playBtn.setAttribute('aria-label', 'Pause'); screen.classList.remove('paused'); });
  video.addEventListener('pause', () => { playBtn.replaceChildren(icon('play')); playBtn.title = 'Reprendre'; playBtn.setAttribute('aria-label', 'Reprendre'); screen.classList.add('paused'); });
  function toggleFs() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else if (screen.requestFullscreen) screen.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone
  }
  // Chaîne précédente / suivante, dans la liste affichée (groupe et recherche compris)
  function zap(d) {
    const list = visible.length ? visible : channels;
    const i = list.findIndex((c) => selected && c.id === selected.id);
    const c = list[(i + d + list.length) % list.length];
    if (c) choose(c, false);
  }
  video.volume = 0.8;
  const preview = h('section', { class: 'pv', 'aria-label': 'Lecteur' },
    screen,
    h('div', { class: 'pv-info' }, nameEl, groupEl, progEl));

  function stopPreview() {
    if (detach) { detach(); detach = null; }
    hlsRef = null;
    if (session) { fetch(relay ? `/api/live/${session}` : `/api/hls/${session}`, { method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => {}); session = null; }
    relay = null; heldAt = 0;
  }
  function stopPlayback() {
    stopPreview(); playing = false; screen.classList.add('idle'); screen.classList.remove('paused');
    still.hidden = false; status.hidden = true; markTiles();
  }
  const markTiles = () => grid.querySelectorAll('.tile').forEach((t) => { t.classList.toggle('on', selected && Number(t.dataset.id) === selected.id); t.classList.toggle('playing', playing && selected && Number(t.dataset.id) === selected.id); });

  // Montre une chaîne (image et programme) sans la lancer
  function showChannel(ch) {
    selected = ch;
    nameEl.textContent = ch.number ? `${ch.number}. ${ch.title}` : ch.title;
    groupEl.textContent = ch.group || 'TV en direct';
    const [cur, nxt] = nn[ch.id] || [];
    progEl.replaceChildren(...(cur ? [
      h('button', { class: 'pv-now f', onclick: () => programSheet(cur, ch) }, h('b', {}, cur.title), h('small', {}, `${hm(cur.start)} – ${hm(cur.stop)}${cur.sub ? ` · ${cur.sub}` : ''}`),
        h('span', { class: 'prog-bar' }, h('i', { style: { width: `${Math.min(100, Math.round(((Date.now() - cur.start) / (cur.stop - cur.start)) * 100))}%` } }))),
      nxt ? h('small', { class: 'pv-next' }, `Ensuite à ${hm(nxt.start)} : ${nxt.title}`) : null] : []));
    still.src = ch.preview || `/api/channels/${ch.id}/preview.jpg?token=${encodeURIComponent(auth.token || '')}&t=${Math.floor(Date.now() / 120000)}`;
    still.hidden = false;
    markTiles();
  }
  // Lance la chaîne dans le lecteur
  async function startChannel(ch, { noRelay = false } = {}) {
    showChannel(ch);
    playing = true; screen.classList.remove('idle'); markTiles();
    status.textContent = 'Connexion à la chaîne…'; status.hidden = false;
    const prev = session;
    if (detach) { detach(); detach = null; } hlsRef = null;
    try {
      const info = await api(`/api/play/${ch.id}`, { method: 'POST', body: { caps: deviceCaps(), preview: true, replace: prev || undefined, noRelay } });
      if (destroyed || selected !== ch || !playing) { fetch(info.mode === 'relay' ? `/api/live/${info.sessionId}` : `/api/hls/${info.sessionId}`, { method: 'DELETE' }).catch(() => {}); return; }
      session = info.sessionId; relay = info.mode === 'relay' ? info.sessionId : null;
      detach = await attachStream(video, info.url, {
        live: true, dvr: !!relay,
        onError: () => {
          if (selected !== ch) return;
          // Le relais direct n'a pas marché : on repasse par la conversion de Venus avant de conclure
          if (relay && !noRelay) { startChannel(ch, { noRelay: true }); return; }
          channelFailed(ch);
        },
      });
      hlsRef = detach && detach.hls || null;
    } catch (e) {
      if (selected === ch) { status.textContent = e.message; status.hidden = false; channelFailed(ch, false); }
    }
  }
  // La chaîne ne démarre pas : Venus la reteste tout de suite ; si elle échoue encore, elle quitte la liste.
  async function channelFailed(ch, say = true) {
    if (say) { status.textContent = 'Cette chaîne ne répond pas : je la reteste…'; status.hidden = false; }
    const r = await api(`/api/channels/${ch.id}/failed`, { method: 'POST' }).catch(() => null);
    if (selected !== ch) return;
    if (r && r.hidden) {
      status.textContent = `Chaîne hors service (${r.error || 'aucune image'}) : retirée de la liste. Elle reviendra si elle remarche.`;
      const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1);
      grid.querySelector(`.tile[data-id="${ch.id}"]`)?.remove();
      count.textContent = `${channels.length} chaîne${channels.length > 1 ? 's' : ''}`;
      playing = false; screen.classList.add('idle');
    } else if (r) { status.textContent = 'La chaîne répond au test : nouvelle tentative…'; setTimeout(() => { if (selected === ch) startChannel(ch, { noRelay: true }); }, 800); }
  }
  video.addEventListener('playing', () => { status.hidden = true; still.hidden = true; });
  // Clic sur une chaîne : elle se lance dans le lecteur, qui reste visible ; le plein écran reste au choix.
  function choose(c, focus = true) {
    try { localStorage.setItem('vn.tv.last', String(c.id)); } catch {}
    setMuted(false);
    startChannel(c);
    // Sur téléphone, le lecteur est en haut : on y remonte si on l'a fait défiler hors de vue
    const r = preview.getBoundingClientRect();
    if (r.bottom < 60 || r.top > innerHeight - 60) preview.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if (focus) setTimeout(() => screen.focus({ preventScroll: true }), 300);
    wake();
  }

  // ------------------------------------------------------------ mosaïque
  const grid = h('div', { class: 'tiles' });
  const count = h('p', { class: 'count', 'aria-live': 'polite' });
  const input = h('input', { type: 'search', id: 'tv-search', placeholder: 'Chercher une chaîne', 'aria-label': 'Chercher une chaîne', autocomplete: 'off' });

  const tile = (c) => {
    const logo = c.poster ? h('img', { class: 'tile-logo', src: img(c.poster), alt: '', decoding: 'async', onerror: (e) => e.target.remove() }) : null;
    const shot = h('img', { class: 'tile-shot', alt: '', decoding: 'async', src: c.preview || `/api/channels/${c.id}/preview.jpg?token=${encodeURIComponent(auth.token || '')}&t=${Math.floor(Date.now() / 120000)}`,
      onerror: (e) => e.target.remove() });
    const el = h('button', { class: 'tile f', 'data-id': c.id, 'aria-label': `${c.number ? `${c.number}, ` : ''}${c.title}, ${c.group || 'en direct'} — mettre en lecture en haut`, onclick: () => choose(c) },
      h('div', { class: 'tile-img' }, h('span', { class: 'ch-initials' }, initials(c.title)), shot, logo, c.number ? h('span', { class: 'ch-num' }, c.number) : null),
      h('div', { class: 'tile-cap' }, h('b', {}, c.title), nn[c.id] && nn[c.id][0] ? h('small', { class: 'tile-now' }, nn[c.id][0].title) : c.group ? h('small', {}, c.group) : null));
    el.addEventListener('keydown', gridKeys);
    return el;
  };

  const paint = () => {
    const q = norm(input.value.trim());
    const list = channels.filter((c) => (!group || c.group === group) && (!q || norm(c.title).includes(q)));
    visible = list;
    grid.replaceChildren(...list.map(tile));
    count.textContent = `${list.length} chaîne${list.length > 1 ? 's' : ''}`;
    if (!list.length) grid.replaceChildren(h('p', { class: 'grid-empty' }, channels.length ? 'Aucune chaîne ne correspond.' : ''));
  };
  input.addEventListener('input', paint);
  // Recherche : Entrée lance la première chaîne trouvée, ↓ descend dans la grille, Échap efface
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (visible[0]) choose(visible[0]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); grid.querySelector('.tile')?.focus(); }
    else if (e.key === 'Escape') { input.value = ''; paint(); }
  });
  // Flèches dans la grille (de chaîne en chaîne, ligne par ligne), Entrée pour lancer
  function gridKeys(e) {
    const tiles = [...grid.querySelectorAll('.tile')], i = tiles.indexOf(e.currentTarget);
    if (i < 0) return;
    const top = tiles[i].offsetTop, cols = Math.max(1, tiles.filter((x) => x.offsetTop === top).length);
    const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + cols : e.key === 'ArrowUp' ? i - cols : null;
    if (j == null) return;
    e.preventDefault();
    if (j < 0) { input.focus(); return; }
    tiles[Math.min(tiles.length - 1, j)]?.focus();
  }
  // « / » : aller à la recherche
  const slash = (e) => { if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) { e.preventDefault(); input.focus(); input.select(); } };
  document.addEventListener('keydown', slash);

  const chips = groups.length > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Groupes de chaînes' },
    [['', 'Toutes'], ...groups.map((g) => [g, g])].map(([id, label]) => {
      const b = h('button', { class: `chip f${id === group ? ' on' : ''}`, onclick: () => {
        group = id; [...chips.children].forEach((c) => c.classList.toggle('on', c === b)); paint();
      } }, label);
      return b;
    })) : null;

  function downNote() {
    const btn = h('button', { class: 'btn btn-small btn-ghost f', onclick: async () => {
      btn.disabled = true; btn.lastChild.textContent = 'Vérification en cours…';
      try { await api('/api/admin/channels/check', { method: 'POST', body: {} }); toast('Vérification lancée : les chaînes sont testées une par une (quelques minutes)'); }
      catch (e) { toast(e.message, true); btn.disabled = false; btn.lastChild.textContent = 'Revérifier'; }
    } }, icon('refresh'), 'Revérifier');
    return h('details', { class: 'tv-down' },
      h('summary', {}, `${down.length} chaîne${down.length > 1 ? 's' : ''} hors service masquée${down.length > 1 ? 's' : ''} (aucune image reçue lors de la dernière vérification)`),
      h('ul', {}, down.slice(0, 60).map((c) => h('li', {}, h('b', {}, c.title), ` — ${c.downWhy}`))), btn);
  }
  if (!channels.length) {
    main.append(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', {}, 'TV en direct')),
      h('div', { class: 'empty' }, h('h2', {}, 'Aucune chaîne'), h('p', {}, 'Ajoutez la liste M3U de votre abonnement IPTV pour voir vos chaînes ici.'),
        h('button', { class: 'btn btn-play f', onclick: () => go('/reglages?onglet=medias') }, 'Ajouter une liste IPTV'))));
    return {};
  }

  main.append(h('div', { class: 'page tv-page' },
    h('div', { class: 'page-head' }, h('div', { class: 'head-left' }, h('h1', {}, 'TV en direct'), count), h('div', { class: 'head-tools' }, tvTabs('chaines'))),
    down.length && admin ? downNote() : null,
    h('div', { class: 'tvx' },
      h('div', { class: 'tvx-player' }, preview),
      h('div', { class: 'tvx-list' },
        h('div', { class: 'tvx-tools' }, h('div', { class: 'search-box small' }, icon('search'), input), chips),
        grid))));
  input.placeholder = matchMedia('(pointer: fine)').matches ? 'Chercher une chaîne (touche /)' : 'Chercher une chaîne';
  paint();
  // Au départ : la dernière chaîne regardée, prête à être lancée (rien ne se lance tout seul)
  let lastId = 0; try { lastId = Number(localStorage.getItem('vn.tv.last')) || 0; } catch {}
  showChannel(channels.find((c) => c.id === lastId) || channels[0]);

  // Les vignettes se rafraîchissent toutes les 2 minutes
  const refresh = setInterval(() => {
    grid.querySelectorAll('.tile-shot').forEach((im) => { if (im.src.startsWith('blob:') || im.src.startsWith('data:')) return; im.src = im.src.replace(/t=\d+/, `t=${Math.floor(Date.now() / 120000)}`); });
  }, 120000);

  // Numéro de chaîne au clavier ou à la télécommande : « 1 », « 2 » → chaîne 12
  const zapper = numberZapper(channels, (c) => choose(c), document.querySelector('.tv-page'));
  document.addEventListener('keydown', zapper.onKey);

  return { destroy: () => { destroyed = true; clearTimeout(switchTimer); clearInterval(refresh); clearInterval(lagT); stopPreview(); zapper.stop(); document.removeEventListener('keydown', zapper.onKey); document.removeEventListener('keydown', slash); } };
}
