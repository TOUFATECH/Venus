// Mini-lecteur : la vidéo continue dans une petite fenêtre en bas de l'écran pendant qu'on navigue.
// Toucher l'image la rouvre en grand ; glisser la fenêtre vers le bas (ou la croix) l'arrête.
import { auth } from './api.js';
import { h, icon } from './ui.js';
import { go } from './app.js';

let mini = null;

export function startMini({ video, hls, info, id, offset = 0, subtitle = '', position }) {
  closeMini();
  const bar = h('i');
  const playBtn = h('button', { class: 'mp-btn', 'aria-label': 'Lecture / pause' }, icon('pause'));
  const closeBtn = h('button', { class: 'mp-btn', 'aria-label': 'Fermer le mini-lecteur' }, icon('close'));
  const frame = h('div', { class: 'mp-video' });
  const el = h('div', { class: 'mini-player', role: 'region', 'aria-label': `Mini-lecteur : ${info.title}` },
    frame,
    h('div', { class: 'mp-row' },
      h('button', { class: 'mp-info', 'aria-label': `Agrandir ${info.title}` }, h('b', {}, info.title), subtitle ? h('small', {}, subtitle) : null),
      playBtn, closeBtn),
    h('div', { class: 'mp-bar' }, bar));
  video.controls = false;
  video.removeAttribute('style');
  frame.append(video);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  if (video.paused) video.play().catch(() => {});

  const duration = () => info.duration || video.duration || 0;
  const pos = () => (position ? position() : offset + (video.currentTime || 0));
  const save = (final = false) => {
    const p = pos();
    if (!p || p < 5 || !auth.token) return;
    fetch('/api/progress', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ itemId: info.itemId, position: final ? duration() : p, duration: duration(), sessionId: info.sessionId }) }).catch(() => {});
  };
  const paint = () => {
    const d = duration();
    bar.style.width = `${d ? Math.min(100, (pos() / d) * 100) : 0}%`;
    playBtn.replaceChildren(icon(video.paused ? 'play' : 'pause'));
  };
  const onTime = () => paint();
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('play', paint);
  video.addEventListener('pause', paint);
  const onEnded = () => { save(true); closeMini(); };
  video.addEventListener('ended', onEnded);
  const timer = setInterval(() => {
    if (!video.paused) save();
    else if (info.sessionId) fetch(`/api/hls/${info.sessionId}/ping`, { method: 'POST' }).catch(() => {});
  }, 10000);

  playBtn.onclick = (e) => { e.stopPropagation(); if (video.paused) video.play().catch(() => {}); else video.pause(); };
  closeBtn.onclick = (e) => { e.stopPropagation(); closeMini(); };
  const expand = () => { const t = Math.floor(pos()); save(); closeMini(); go(`/lecture/${id}?t=${t}`); };
  let dragged = false;
  el.addEventListener('click', (e) => { if (dragged || e.target.closest('.mp-btn')) { dragged = false; return; } expand(); });

  // Glisser vers le bas ou sur le côté pour fermer
  let y0 = null, x0 = 0, dy = 0, dx = 0;
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('.mp-btn')) return; y0 = e.clientY; x0 = e.clientX; dy = 0; dx = 0; });
  el.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0); dx = e.clientX - x0;
    if (dy > 6 || Math.abs(dx) > 6) { el.style.transition = 'none'; el.style.transform = `translate(${dx}px, ${dy}px)`; el.style.opacity = String(Math.max(0.2, 1 - (dy + Math.abs(dx)) / 260)); }
  });
  const end = (e) => {
    if (y0 == null) return;
    const moved = dy > 6 || Math.abs(dx) > 6;
    y0 = null; el.style.transition = '';
    if (dy > 80 || Math.abs(dx) > 120) { closeMini(); return; }
    el.style.transform = ''; el.style.opacity = '';
    dragged = moved;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  paint();

  // Pochette pour l'écran verrouillé du téléphone
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => video.play());
      navigator.mediaSession.setActionHandler('pause', () => video.pause());
    } catch { /* */ }
  }

  mini = {
    id,
    close: () => {
      clearInterval(timer);
      save();
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('ended', onEnded);
      try { if (hls) hls.destroy(); } catch { /* */ }
      video.pause();
      video.removeAttribute('src');
      try { video.load(); } catch { /* */ }
      if (info.sessionId) fetch(`/api/hls/${info.sessionId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
      el.classList.remove('on');
      el.classList.add('off');
      setTimeout(() => el.remove(), 300);
    },
  };
}

export function closeMini() {
  if (!mini) return;
  const m = mini;
  mini = null;
  m.close();
}
export const miniActive = () => !!mini;
