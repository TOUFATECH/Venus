// Mini-lecteur : la vidéo continue dans une petite fenêtre en bas à droite pendant qu'on navigue.
//  - toujours au format 16/9, redimensionnable par sa poignée (taille retenue sur cet appareil)
//  - boutons : précédent, -10 s, lecture/pause, +10 s, suivant, son, fermer ; l'image rouvre en grand
//  - à la fin d'un épisode, d'un clip ou d'un morceau, il enchaîne tout seul sur le suivant
//  - il survit au rechargement de la page (la lecture reprend au même endroit) ; seule la croix l'arrête
import { api, auth, deviceCaps } from './api.js';
import { h, icon, toast } from './ui.js';
import { go } from './app.js';
import { loadHls } from './live.js';
import { queueAround } from './queue.js';

let mini = null;
const KEY = 'vn_mini';
const WKEY = 'vn_mini_w';
const remember = (data) => { try { data ? sessionStorage.setItem(KEY, JSON.stringify({ ...data, at: Date.now() })) : sessionStorage.removeItem(KEY); } catch { /* */ } };

export function startMini({ video, hls, info, id, offset = 0, subtitle = '', position }) {
  closeMini();
  let cur = { info: { ...info }, id, offset, subtitle, hls, position };
  const bar = h('i');
  const btn = (name, label, ic) => h('button', { class: `mp-btn mp-${name}`, 'aria-label': label, title: label }, icon(ic));
  const prevBtn = btn('prev', 'Précédent', 'prev');
  const backBtn = btn('back', 'Reculer de 10 s', 'restart');
  const playBtn = btn('play', 'Lecture / pause', 'pause');
  const fwdBtn = btn('fwd', 'Avancer de 10 s', 'fwd');
  const nextBtn = btn('next', 'Suivant', 'next');
  const muteBtn = btn('mute', 'Couper le son', 'vol');
  const closeBtn = btn('close', 'Fermer le mini-lecteur', 'close');
  const title = h('b', {}), sub = h('small', {});
  const infoBtn = h('button', { class: 'mp-info' }, title, sub);
  const frame = h('div', { class: 'mp-video' });
  const grip = h('div', { class: 'mp-grip', 'aria-hidden': 'true', title: 'Redimensionner' });
  const el = h('div', { class: 'mini-player', role: 'region', 'aria-label': 'Mini-lecteur' },
    grip, frame,
    h('div', { class: 'mp-row' }, infoBtn, prevBtn, backBtn, playBtn, fwdBtn, nextBtn, muteBtn, closeBtn),
    h('div', { class: 'mp-bar' }, bar));
  const setWidth = (w) => { el.style.width = `${w}px`; el.classList.toggle('narrow', w < 300); };
  try { const w = Number(localStorage.getItem(WKEY)); if (w >= 220) setWidth(Math.min(w, innerWidth * 0.7)); } catch { /* */ }
  video.controls = false;
  video.removeAttribute('style');
  frame.append(video);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  if (video.paused && !video.ended) video.play().catch(() => {});

  const duration = () => cur.info.duration || video.duration || 0;
  const pos = () => (cur.position ? cur.position() : cur.offset + (video.currentTime || 0));
  const save = (final = false) => {
    const p = pos();
    if (!p || p < 5 || !auth.token || !cur.info.itemId) return;
    fetch('/api/progress', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ itemId: cur.info.itemId, position: final ? duration() : p, duration: duration(), sessionId: cur.info.sessionId }) }).catch(() => {});
  };
  const paintHead = () => {
    title.textContent = cur.info.title || '';
    sub.textContent = cur.subtitle || '';
    sub.hidden = !cur.subtitle;
    infoBtn.setAttribute('aria-label', `Agrandir ${cur.info.title || ''}`);
    el.setAttribute('aria-label', `Mini-lecteur : ${cur.info.title || ''}`);
    prevBtn.hidden = !cur.info.prev;
    nextBtn.hidden = !cur.info.next;
    backBtn.hidden = fwdBtn.hidden = !!cur.info.live;
  };
  const paint = () => {
    const d = duration();
    bar.style.width = `${d ? Math.min(100, (pos() / d) * 100) : 0}%`;
    playBtn.replaceChildren(icon(video.paused ? 'play' : 'pause'));
    muteBtn.replaceChildren(icon(video.muted ? 'mute' : 'vol'));
    muteBtn.setAttribute('aria-label', video.muted ? 'Remettre le son' : 'Couper le son');
    remember({ id: cur.id, t: Math.floor(pos()) });
  };
  const onTime = () => paint();
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('play', paint);
  video.addEventListener('pause', paint);
  video.addEventListener('volumechange', paint);

  // ---- changer de titre sans quitter le mini-lecteur (suivant, précédent, fin automatique)
  let loading = false;
  async function loadItem(itemId, { start = 0 } = {}) {
    if (loading) return;
    loading = true;
    save();
    try { if (cur.hls) cur.hls.destroy(); } catch { /* */ }
    cur.hls = null;
    if (cur.info.sessionId) fetch(`/api/hls/${cur.info.sessionId}`, { method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => {});
    let res;
    try { res = await api(`/api/play/${itemId}`, { method: 'POST', body: { caps: deviceCaps(), start } }); }
    catch (e) { loading = false; toast(e.message, true); return; }
    if (mini !== me) { loading = false; if (res.sessionId) fetch(`/api/hls/${res.sessionId}`, { method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => {}); return; }
    // Clips et musique : la file de lecture donne le suivant et le précédent
    const q = queueAround(res.itemId);
    if (q) { if (!res.next && q.next) res.next = { id: q.next.id, title: q.next.title, queue: true }; if (!res.prev && q.prev) res.prev = { id: q.prev.id, title: q.prev.title, queue: true }; }
    cur = { info: res, id: res.itemId, offset: res.offset || 0, subtitle: res.subtitle || '', hls: null, position: null };
    video.removeAttribute('src'); try { video.load(); } catch { /* */ }
    const canNative = video.canPlayType('application/vnd.apple.mpegurl');
    if (res.mode === 'direct' || (canNative && /safari/i.test(navigator.userAgent) && !/chrome|android/i.test(navigator.userAgent))) {
      video.src = res.url;
      if (res.mode === 'direct' && res.startAt) video.addEventListener('loadedmetadata', () => { video.currentTime = res.startAt; }, { once: true });
    } else {
      try {
        const Hls = await loadHls();
        if (!Hls.isSupported()) video.src = res.url;
        else { cur.hls = new Hls({ maxBufferLength: 40, backBufferLength: 60, fragLoadingMaxRetry: 6, manifestLoadingMaxRetry: 4 }); cur.hls.loadSource(res.url); cur.hls.attachMedia(video); }
      } catch (e) { toast(e.message, true); }
    }
    paintHead(); paint();
    video.play().catch(() => {});
    loading = false;
  }
  const onEnded = () => {
    save(true);
    if (cur.info.next && cur.info.next.id) { loadItem(cur.info.next.id, { start: 0 }); return; }
    closeMini();
  };
  video.addEventListener('ended', onEnded);
  const timer = setInterval(() => {
    if (!video.paused) save();
    else if (cur.info.sessionId) fetch(`/api/hls/${cur.info.sessionId}/ping`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => {});
  }, 10000);

  const stop = (e) => e.stopPropagation();
  playBtn.onclick = (e) => { stop(e); if (video.paused) video.play().catch(() => {}); else video.pause(); };
  closeBtn.onclick = (e) => { stop(e); remember(null); closeMini(); };
  muteBtn.onclick = (e) => { stop(e); video.muted = !video.muted; };
  const seek = (dt) => {
    if (cur.position && !cur.info.sessionId) { video.currentTime = Math.max(0, Math.min(video.duration || 1e9, (video.currentTime || 0) + dt)); return; }
    const t = Math.max(0, Math.min(duration() || 1e9, pos() + dt));
    const local = t - cur.offset;
    // Flux converti : on ne peut reculer que dans ce qui a déjà été préparé ; sinon on redemande à partir du point voulu
    if (cur.info.mode !== 'direct' && (local < 0 || (video.seekable.length && local > video.seekable.end(video.seekable.length - 1) + 1))) { loadItem(cur.id, { start: Math.floor(t) }); return; }
    video.currentTime = local;
    paint();
  };
  backBtn.onclick = (e) => { stop(e); seek(-10); };
  fwdBtn.onclick = (e) => { stop(e); seek(10); };
  prevBtn.onclick = (e) => { stop(e); if (cur.info.prev) loadItem(cur.info.prev.id); };
  nextBtn.onclick = (e) => { stop(e); if (cur.info.next) loadItem(cur.info.next.id); };
  const expand = () => { const t = Math.floor(pos()); save(); remember(null); closeMini(); go(`/lecture/${cur.id}?t=${t}`); };
  let dragged = false;
  el.addEventListener('click', (e) => { if (dragged || e.target.closest('.mp-btn, .mp-grip')) { dragged = false; return; } expand(); });

  // ---- poignée : redimensionner (coin haut gauche), taille gardée
  grip.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const w0 = el.getBoundingClientRect().width, x0 = e.clientX;
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => setWidth(Math.max(220, Math.min(innerWidth * 0.7, w0 + (x0 - ev.clientX))));
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); try { localStorage.setItem(WKEY, String(Math.round(el.getBoundingClientRect().width))); } catch { /* */ } };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });

  // ---- glisser vers le bas ou sur le côté pour fermer
  let y0 = null, x0 = 0, dy = 0, dx = 0;
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('.mp-btn, .mp-grip')) return; y0 = e.clientY; x0 = e.clientX; dy = 0; dx = 0; });
  el.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0); dx = e.clientX - x0;
    if (dy > 6 || Math.abs(dx) > 6) { el.style.transition = 'none'; el.style.transform = `translate(${dx}px, ${dy}px)`; el.style.opacity = String(Math.max(0.2, 1 - (dy + Math.abs(dx)) / 260)); }
  });
  const end = () => {
    if (y0 == null) return;
    const moved = dy > 6 || Math.abs(dx) > 6;
    y0 = null; el.style.transition = '';
    if (dy > 80 || Math.abs(dx) > 120) { remember(null); closeMini(); return; }
    el.style.transform = ''; el.style.opacity = '';
    dragged = moved;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  paintHead(); paint();

  // Pochette pour l'écran verrouillé du téléphone
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => video.play());
      navigator.mediaSession.setActionHandler('pause', () => video.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => { if (cur.info.next) loadItem(cur.info.next.id); });
      navigator.mediaSession.setActionHandler('previoustrack', () => { if (cur.info.prev) loadItem(cur.info.prev.id); });
    } catch { /* */ }
  }

  const me = {
    get id() { return cur.id; },
    loadItem,
    close: () => {
      clearInterval(timer);
      save();
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('ended', onEnded);
      try { if (cur.hls) cur.hls.destroy(); } catch { /* */ }
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch { /* */ }
      if (cur.info.sessionId) fetch(`/api/hls/${cur.info.sessionId}`, { method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => {});
      el.classList.remove('on');
      el.classList.add('off');
      setTimeout(() => el.remove(), 300);
    },
  };
  mini = me;
  return me;
}

// Après un rechargement de la page : le mini-lecteur reprend là où il en était (moins de 2 h plus tard)
export function resumeMini() {
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { /* */ }
  if (!s || !s.id || Date.now() - (s.at || 0) > 2 * 3600e3 || mini) return;
  const video = h('video', { playsinline: true, autoplay: true });
  const m = startMini({ video, hls: null, id: s.id, offset: 0, info: { itemId: null, title: '…', duration: 0, sessionId: null } });
  m.loadItem(s.id, { start: s.t || 0 });
}

export function closeMini() {
  remember(null);
  if (!mini) return;
  const m = mini;
  mini = null;
  m.close();
}
export const miniActive = () => !!mini;
