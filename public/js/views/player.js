// Lecteur vidéo plein écran : lecture directe ou HLS, sous-titres, pistes, qualité, épisode suivant, Chromecast, AirPlay
import { api, auth, deviceCaps, castCaps, preferredQuality, setPreferredQuality, prefs } from '../api.js';
import { h, icon, sheet, fmtTime, langName, toast, img, isBack } from '../ui.js';
import { go, back, setTitle } from '../app.js';
import { focusEl } from '../nav.js';
import { castSupported, loadCast, castContext, castMedia, remote } from '../cast.js';
import { ambilight, ambianceOn } from '../ambiance.js';
import { joinParty, partyPanel, showInvite, floatReaction } from '../party.js';
import { scrollArrows } from '../components.js';
import { numberZapper } from '../live.js';
import { queueAround, toggleShuffle } from '../queue.js';

let hlsLib = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLib) return hlsLib;
  hlsLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/hls.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => reject(new Error('Lecteur HLS indisponible'));
    document.head.append(s);
  });
  return hlsLib;
}

const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const COMPAT_CAPS = { containers: [], video: ['h264'], audio: ['aac'], hdr: false, hevcHls: false };

// ------------------------------------------------------------------ sous-titres WebVTT
function parseVtt(text) {
  const cues = [];
  const ts = (s) => { const p = s.trim().split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const txt = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (txt) cues.push({ start: ts(a), end: ts(b.trim().split(/\s/)[0]), text: txt });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export async function render(main, { id, query }) {
  const startParam = query.get('t');
  let roomCode = query.get('salle');
  const caps = deviceCaps();
  let info = null, hls = null, offset = 0, forceCompat = false, quality = preferredQuality();
  let audioOrder, subId, cues = [], destroyed = false, uiTimer = null, saveTimer = null, subsTimer = null;
  let recoveries = [], mediaRecover = 0, nextShown = false, nextDismissed = false, nextTimer = null, wakeLock = null, casting = null;
  let pendingSeek = null, seekTimer = null;

  // ---------------------------------------------------------------- éléments
  const video = h('video', { playsinline: true, 'webkit-playsinline': true, 'x-webkit-airplay': 'allow', preload: 'auto' });
  const subsLayer = h('div', { class: 'p-subs', 'aria-live': 'off' });
  const spinner = h('div', { class: 'p-loading' });
  const titleEl = h('div', { class: 'p-title' });
  const subEl = h('div', { class: 'p-sub' });
  const badge = h('span', { class: 'p-badge' });
  const backBtn = h('button', { class: 'p-icon f', 'aria-label': 'Retour', onclick: () => exit() }, icon('back'));
  const playBtn = h('button', { class: 'p-icon big f', 'aria-label': 'Lecture / pause', 'data-autofocus': true, onclick: () => togglePlay() }, icon('play'));
  const rwBtn = h('button', { class: 'p-icon f', 'aria-label': 'Reculer de 10 secondes', onclick: () => seekBy(-10) }, icon('r10'));
  const ffBtn = h('button', { class: 'p-icon f', 'aria-label': 'Avancer de 10 secondes', onclick: () => seekBy(10) }, icon('f10'));
  const fill = h('div', { class: 'p-fill' });
  const buf = h('div', { class: 'p-buf' });
  const knob = h('div', { class: 'p-knob' });
  const hoverTip = h('div', { class: 'p-hover', hidden: true });
  const track = h('div', { class: 'p-track f', tabindex: '0', role: 'slider', 'aria-label': 'Position de lecture' }, buf, fill, knob, hoverTip);
  const curEl = h('span', {}, '0:00');
  const remEl = h('span', {}, '');
  const tracksBtn = h('button', { class: 'p-icon f', 'aria-label': 'Audio et sous-titres', onclick: () => openTracks() }, icon('subs'));
  const qualityBtn = h('button', { class: 'btn btn-ghost btn-small f', onclick: () => openQuality() }, 'Auto');
  const nextBtn = h('button', { class: 'btn btn-ghost btn-small f', hidden: true, onclick: () => playNext(), 'aria-label': 'Épisode suivant' }, icon('next'), h('span', { class: 'lbl' }, 'Épisode suivant'));
  const chPrev = h('button', { class: 'p-icon f', hidden: true, 'aria-label': 'Chaîne précédente', onclick: () => zap(-1) }, icon('up'));
  const chNext = h('button', { class: 'p-icon f', hidden: true, 'aria-label': 'Chaîne suivante', onclick: () => zap(1) }, icon('down'));
  const liveTag = h('span', { class: 'live-tag', hidden: true }, 'En direct');
  const castBtn = h('button', { class: 'p-icon f', hidden: true, 'aria-label': 'Diffuser sur un Chromecast', onclick: () => startCast() }, icon('cast'));
  const airBtn = h('button', { class: 'p-icon f', hidden: true, 'aria-label': 'AirPlay', onclick: () => video.webkitShowPlaybackTargetPicker && video.webkitShowPlaybackTargetPicker() }, icon('airplay'));
  const fsBtn = h('button', { class: 'p-icon f', 'aria-label': 'Plein écran', onclick: () => toggleFullscreen() }, icon('fs'));
  // Volume : bouton muet + curseur (mémorisés sur cet appareil)
  const muteBtn = h('button', { class: 'p-icon f', 'aria-label': 'Couper le son', onclick: () => setMuted(!video.muted) }, icon('vol'));
  const volRange = h('input', { class: 'p-volrange', type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Volume' });
  volRange.addEventListener('input', () => { setVolume(Number(volRange.value)); showUi(); });
  volRange.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setVolume(video.volume + (e.key === 'ArrowUp' ? 0.1 : -0.1)); } });
  const volBox = h('div', { class: 'p-vol' }, muteBtn, volRange);
  const volOsd = h('div', { class: 'p-osd', hidden: true });
  const epsBtn = h('button', { class: 'btn btn-ghost btn-small f', hidden: true, onclick: () => openEpisodes(), 'aria-label': 'Épisodes' }, icon('eps'), h('span', { class: 'lbl' }, 'Épisodes'));
  const chatBtn = h('button', { class: 'p-icon f', hidden: true, 'aria-label': 'Afficher ou masquer la discussion', 'aria-pressed': 'true', onclick: () => setChat(root.classList.contains('chat-hidden')) }, icon('chat'), h('span', { class: 'p-unread', hidden: true }));
  const prevBtn = h('button', { class: 'p-icon f', hidden: true, 'aria-label': 'Précédent', title: 'Précédent (Maj+P)', onclick: () => playPrev() }, icon('prev'));
  const shuffleBtn = h('button', { class: 'p-icon f', hidden: true, 'aria-label': 'Lecture aléatoire', 'aria-pressed': 'false', onclick: () => {
    const on = toggleShuffle(id); shuffleBtn.classList.toggle('on', !!on); shuffleBtn.setAttribute('aria-pressed', String(!!on));
    applyQueue(); toast(on ? 'Lecture aléatoire' : 'Lecture dans l’ordre');
  } }, icon('shuffle'));
  // « Passer l'intro » / « Passer le générique » : visible même quand les commandes sont cachées
  const skipBtn = h('button', { class: 'p-skip f', hidden: true, onclick: () => doSkip() }, icon('skip'), h('span', {}, 'Passer l’intro'));
  // TV en direct : liste des chaînes à droite, pour zapper sans quitter l'image
  const chListBtn = h('button', { class: 'btn btn-ghost btn-small f', hidden: true, 'aria-label': 'Liste des chaînes', onclick: () => toggleChannels() }, icon('list'), h('span', { class: 'lbl' }, 'Chaînes'));
  const chPanel = h('aside', { class: 'ch-panel', hidden: true, 'aria-label': 'Chaînes' });
  const nextPanel = h('div', { class: 'p-next', hidden: true });
  const overlay = h('div', { class: 'p-error', hidden: true });

  const ambCanvas = h('canvas', { class: 'amb-canvas', 'aria-hidden': 'true' });
  const reactLayer = h('div', { class: 'react-layer', 'aria-hidden': 'true' });
  const ambBtn = h('button', { class: 'p-icon f', 'aria-label': 'Mode Ambiance', 'aria-pressed': 'false', title: 'Ambiance : la lumière du film déborde autour de l’image', onclick: () => setAmbiance(!ambOn) }, icon('glow'));
  const partyBtn = h('button', { class: 'btn btn-ghost btn-small f', title: 'Regarder ensemble, chacun sur son écran', onclick: () => startParty(), 'aria-label': 'Regarder ensemble' }, icon('people'), h('span', { class: 'lbl' }, 'Ensemble'));
  const root = h('div', { class: 'player ui-on', role: 'region', 'aria-label': 'Lecteur vidéo' },
    ambCanvas, video, reactLayer, h('div', { class: 'scrim' }), subsLayer, spinner,
    h('div', { class: 'p-top' }, backBtn, h('div', { style: { minWidth: 0, flex: 1 } }, titleEl, subEl), badge),
    h('div', { class: 'p-center' }, rwBtn, playBtn, ffBtn),
    h('div', { class: 'p-bottom' },
      h('div', { class: 'p-timeline' }, curEl, track, remEl),
      h('div', { class: 'p-controls' }, volBox, liveTag, tracksBtn, qualityBtn, chPrev, chNext, h('div', { class: 'spacer' }), chListBtn, partyBtn, chatBtn, epsBtn, shuffleBtn, prevBtn, nextBtn, ambBtn, castBtn, airBtn, fsBtn)),
    nextPanel, overlay, volOsd, skipBtn, chPanel);
  main.append(root);
  document.body.style.overflow = 'hidden';
  // Style des sous-titres choisi dans Réglages (texte seul par défaut)
  root.classList.toggle('sub-box', prefs.get('subStyle') === 'box');
  root.classList.add(`sub-${prefs.get('subSize') || 'medium'}`);
  // Plein écran dès le lancement (réglable dans Réglages). Demandé tout de suite, pendant que le clic
  // sur « Lecture » compte encore comme une action de l'utilisateur.
  if (prefs.get('fullscreenOnPlay') && document.documentElement.requestFullscreen && !document.fullscreenElement) enterFullscreen();
  applyVolume();

  // ---------------------------------------------------------------- utilitaires de temps
  const position = () => (casting ? casting.position() : offset + (video.currentTime || 0));
  const duration = () => (info && info.duration) || video.duration || 0;

  function bufferedEnd() {
    const t = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= t + 0.5 && video.buffered.end(i) >= t) return video.buffered.end(i);
    }
    return t;
  }
  function seekableEnd() {
    if (info && info.mode === 'direct') return video.duration || 0;
    if (hls && hls.levels && hls.levels[0] && hls.levels[0].details) return hls.levels[0].details.totalduration;
    return video.seekable && video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
  }

  function paintTimeline(t = position()) {
    const d = duration();
    if (!d) return;
    const pct = Math.min(100, (t / d) * 100);
    fill.style.width = `${pct}%`;
    knob.style.left = `${pct}%`;
    buf.style.width = `${Math.min(100, ((offset + bufferedEnd()) / d) * 100)}%`;
    curEl.textContent = fmtTime(t);
    remEl.textContent = `-${fmtTime(d - t)}`;
    track.setAttribute('aria-valuetext', `${fmtTime(t)} sur ${fmtTime(d)}`);
  }

  // ---------------------------------------------------------------- chargement
  async function load(start, { reason } = {}) {
    spinner.hidden = false;
    overlay.hidden = true;
    const prevSession = info && info.sessionId;
    let res;
    try {
      res = await api(`/api/play/${id}`, { method: 'POST', body: {
        caps: forceCompat ? COMPAT_CAPS : caps, quality, audio: audioOrder, sub: subId,
        start: start == null ? 'resume' : start, replace: prevSession || undefined,
      } });
    } catch (e) { return showError(e.message); }
    if (destroyed) { if (res.sessionId) stopSession(res.sessionId); return; }
    info = res;
    audioOrder = info.audioOrder;
    subId = info.subId;
    offset = info.offset || 0;
    nextShown = false;
    titleEl.textContent = info.title;
    subEl.textContent = info.subtitle;
    setTitle(info.title);
    badge.textContent = info.mode === 'direct' ? 'Direct' : info.mode === 'remux' ? 'Remux' : `Converti · ${info.hwLabel || 'processeur'}`;
    badge.title = info.reason;
    qualityBtn.textContent = (info.qualities.find((q) => q.id === quality) || { label: 'Auto' }).label;
    applyQueue();
    epsBtn.hidden = !info.showId;
    skipState = { intro: false, credits: false };
    const live = !!info.live;
    root.classList.toggle('is-live', live);
    liveTag.hidden = !live; chPrev.hidden = !live; chNext.hidden = !live;
    qualityBtn.hidden = !info.qualities.length;
    if (live) badge.textContent = info.mode === 'transcode' ? `Direct converti · ${info.hwLabel || 'processeur'}` : 'Direct';
    tracksBtn.hidden = info.audio.length < 2 && !info.subs.length;
    if (reason) toast(reason);

    teardownSource();
    const startAt = info.mode === 'direct' ? info.startAt || 0 : 0;
    if (info.mode === 'direct' || caps.nativeHls && (isSafari || isIOS)) {
      video.src = info.url;
      if (startAt) video.addEventListener('loadedmetadata', () => { video.currentTime = startAt; }, { once: true });
    } else {
      const Hls = await loadHls();
      if (destroyed) return;
      if (!Hls.isSupported()) { video.src = info.url; }
      else {
        hls = new Hls(info.live
          ? { liveSyncDurationCount: 3, manifestLoadingMaxRetry: 0, fragLoadingMaxRetry: 6, levelLoadingMaxRetry: 6, backBufferLength: 30 }
          : { maxBufferLength: 40, maxMaxBufferLength: 120, backBufferLength: 60, startPosition: 0, fragLoadingMaxRetry: 6, manifestLoadingMaxRetry: 4, levelLoadingMaxRetry: 6 });
        hls.on(Hls.Events.ERROR, (_e, data) => onHlsError(Hls, data));
        hls.loadSource(info.url);
        hls.attachMedia(video);
      }
    }
    loadSubtitles();
    setupMediaSession();
    // En séance, si l'hôte a mis en pause, le rechargement ne doit pas relancer la lecture
    if (desiredPaused) { spinner.hidden = true; showUi(true); }
    else {
      const p = video.play();
      if (p && p.catch) p.catch(() => { spinner.hidden = true; showUi(true); });
    }
    paintTimeline(info.startAt || 0);
  }

  function teardownSource() {
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    video.load();
  }

  function stopSession(sid) {
    if (!sid) return;
    fetch(`/api/hls/${sid}`, { method: 'DELETE', keepalive: true }).catch(() => {});
  }

  function onHlsError(Hls, data) {
    if (!data.fatal) return;
    if (info && info.live && /manifest/i.test(data.details || '')) {
      const code = data.response && data.response.code;
      return showError(code === 502 || code === 404 ? 'Cette chaîne ne répond pas pour le moment. Essayez plus tard ou passez à la suivante.' : 'Impossible de joindre la chaîne.');
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecover < 2) { mediaRecover++; hls.recoverMediaError(); return; }
    reloadAt(position(), 'Reprise de la lecture…');
  }

  function reloadAt(t, msg) {
    const now = Date.now();
    recoveries = recoveries.filter((x) => now - x < 60000);
    recoveries.push(now);
    if (recoveries.length > 3) return showError('La lecture s’est interrompue à plusieurs reprises. Vérifiez la connexion au serveur.');
    load(t, { reason: msg });
  }

  video.addEventListener('error', () => {
    if (destroyed || !info || hls || !video.currentSrc) return;
    if (info.mode === 'direct' && !forceCompat) { forceCompat = true; load(position(), { reason: 'Conversion pour cet appareil…' }); return; }
    if (info.mode !== 'direct') { reloadAt(position()); return; }
    showError('Ce fichier ne peut pas être lu sur cet appareil.');
  });

  function showError(msg) {
    spinner.hidden = true;
    overlay.hidden = false;
    overlay.replaceChildren(h('div', {}, h('h2', {}, 'La lecture n’a pas pu démarrer'), h('p', {}, msg),
      h('div', { class: 'actions', style: { justifyContent: 'center' } },
        h('button', { class: 'btn btn-play f', onclick: () => { recoveries = []; load(position()); } }, 'Réessayer'),
        info && info.live ? h('button', { class: 'btn btn-ghost f', onclick: () => zap(1) }, 'Chaîne suivante') : null,
        h('button', { class: 'btn btn-ghost f', onclick: () => exit() }, 'Retour'))));
    requestAnimationFrame(() => focusEl(overlay.querySelector('.f')));
  }

  // ---------------------------------------------------------------- sous-titres
  async function loadSubtitles() {
    cues = [];
    subsLayer.replaceChildren();
    const s = info.subs.find((x) => x.id === subId);
    if (!s || !s.url) return;
    try {
      const res = await fetch(s.url, { headers: { Authorization: `Bearer ${auth.token}` } });
      if (!res.ok) throw new Error();
      cues = parseVtt(await res.text());
    } catch { toast('Sous-titres indisponibles', true); }
  }
  let lastCue = null;
  function paintSubs() {
    const t = position();
    const active = cues.filter((c) => c.start <= t && c.end >= t);
    const key = active.map((c) => c.start).join(',');
    if (key === lastCue) return;
    lastCue = key;
    subsLayer.replaceChildren(...active.map((c) => h('div', {}, c.text.split('\n').map((line, i) => [i ? h('br') : null, h('span', {}, line)]))));
  }

  // ---------------------------------------------------------------- contrôles
  let userActAt = 0, desiredPaused = false;
  const markUser = () => { userActAt = Date.now(); desiredPaused = false; };
  function togglePlay() {
    markUser();
    if (casting) return casting.toggle();
    if (video.paused) video.play().catch(() => {}); else video.pause();
  }

  function seekTo(t, { immediate = false, remote = false } = {}) {
    if (info && info.live) return;
    if (!remote) markUser();
    const d = duration();
    t = Math.max(0, Math.min(d ? d - 1 : t, t));
    if (casting) return casting.seek(t);
    if (!info) return;
    if (info.mode === 'direct') { video.currentTime = t; paintTimeline(t); return; }
    const rel = t - offset;
    if (rel >= 0 && rel <= seekableEnd() - 0.5) { video.currentTime = rel; paintTimeline(t); return; }
    // Hors de la zone déjà préparée : on relance la conversion à partir du nouveau point
    if (!remote && party) party.send('state', { playing: !video.paused, position: t, reason: 'seek' });
    pendingSeek = t;
    paintTimeline(t);
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => { const target = pendingSeek; pendingSeek = null; load(target); }, immediate ? 0 : 500);
  }
  function seekBy(dt) {
    if (info && info.live) return;
    const base = pendingSeek != null ? pendingSeek : position();
    seekTo(base + dt);
    const hint = h('div', { class: 'p-seekhint', style: dt < 0 ? { left: '12%' } : { right: '12%' } }, `${dt > 0 ? '+' : '−'}${Math.abs(dt)} s`);
    root.append(hint);
    setTimeout(() => hint.remove(), 800);
  }

  function showUi(stay = false) {
    root.classList.add('ui-on');
    clearTimeout(uiTimer);
    if (!stay && !video.paused && !casting) uiTimer = setTimeout(hideUi, 3500);
  }
  function hideUi() {
    if (document.querySelector('.sheet-wrap') || video.paused || casting || !overlay.hidden || !chPanel.hidden) return;
    root.classList.remove('ui-on');
    if (root.contains(document.activeElement)) document.activeElement.blur();
  }

  async function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    if (document.documentElement.requestFullscreen) await enterFullscreen();
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  }
  async function enterFullscreen() {
    // Toute la page passe en plein écran (pas seulement ce lecteur) : on y reste en changeant d'épisode
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { return; }
    try { await screen.orientation.lock('landscape'); } catch { /* non pris en charge */ }
  }

  // ---------------------------------------------------------------- volume
  function applyVolume() {
    video.volume = Math.max(0, Math.min(1, prefs.get('volume')));
    video.muted = !!prefs.get('muted');
    paintVolume();
  }
  function paintVolume() {
    const v = video.muted ? 0 : video.volume;
    muteBtn.replaceChildren(icon(v === 0 ? 'mute' : v < 0.5 ? 'vollow' : 'vol'));
    muteBtn.setAttribute('aria-label', video.muted ? 'Rétablir le son' : 'Couper le son');
    volRange.value = String(v);
    volRange.style.setProperty('--v', `${v * 100}%`);
  }
  function setVolume(v, osd = false) {
    v = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
    video.volume = v; video.muted = v === 0;
    prefs.set('volume', v || prefs.get('volume')); prefs.set('muted', video.muted);
    paintVolume();
    if (osd) flashOsd();
  }
  function setMuted(m) {
    video.muted = m;
    if (!m && video.volume === 0) video.volume = 0.5;
    prefs.set('muted', m);
    paintVolume(); flashOsd();
  }
  let osdTimer = null;
  function flashOsd() {
    const v = video.muted ? 0 : Math.round(video.volume * 100);
    volOsd.replaceChildren(icon(v === 0 ? 'mute' : v < 50 ? 'vollow' : 'vol'), h('div', { class: 'osd-bar' }, h('i', { style: { width: `${v}%` } })), h('b', {}, `${v} %`));
    volOsd.hidden = false;
    clearTimeout(osdTimer); osdTimer = setTimeout(() => { volOsd.hidden = true; }, 1200);
  }
  video.addEventListener('volumechange', paintVolume);

  // ---------------------------------------------------------------- liste des épisodes (sans quitter la vidéo)
  async function openEpisodes() {
    if (!info || !info.showId) return;
    let d;
    try { d = await api(`/api/items/${info.showId}`); } catch (e) { toast(e.message, true); return; }
    const strip = h('div', { class: 'ep-strip' });
    const tabs = h('div', { class: 'chips' });
    const paint = (season) => {
      [...tabs.children].forEach((t) => t.classList.toggle('on', t.dataset.n === String(season.number)));
      strip.replaceChildren(...season.episodes.map((e) => {
        const cur = e.id === Number(id);
        const p = e.progress, pct = p && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
        const im = h('img', { src: e.still ? img(e.still) : `/api/items/${e.id}/thumb`, alt: '', loading: 'lazy' });
        return h('button', { class: `ep-tile f${cur ? ' current' : ''}`, onclick: () => { s.close(); if (!cur) go(`/lecture/${e.id}${roomCode ? `?salle=${roomCode}` : ''}`, { replace: true }); } },
          h('div', { class: 'ep-shot' }, im, cur ? h('span', { class: 'ep-now' }, 'En cours') : null,
            pct > 0 && !(p && p.watched) ? h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })) : null,
            p && p.watched ? h('span', { class: 'check' }, icon('check')) : null),
          h('b', {}, `${e.episode}. ${e.title}`),
          e.overview ? h('small', {}, e.overview) : null);
      }));
      const cur = strip.querySelector('.current');
      requestAnimationFrame(() => { if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' }); focusEl(cur || strip.firstChild, { scroll: false }); });
    };
    d.seasons.forEach((se) => tabs.append(h('button', { class: 'chip f', 'data-n': se.number, onclick: () => paint(se) }, se.title || (se.number === 0 ? 'Bonus' : `Saison ${se.number}`))));
    const s = sheet(d.title, h('div', { class: 'ep-panel' }, d.seasons.length > 1 ? tabs : null, scrollArrows(strip)), { wide: true });
    paint(d.seasons.find((se) => se.number === info.season) || d.seasons[0]);
  }

  // Timeline : clic, glisser, survol
  const timeAt = (clientX) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration(); };
  let dragging = false;
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); paintTimeline(timeAt(e.clientX)); showUi(true); });
  track.addEventListener('pointermove', (e) => {
    const t = timeAt(e.clientX);
    hoverTip.hidden = false; hoverTip.textContent = fmtTime(t);
    hoverTip.style.left = `${(t / duration()) * 100}%`;
    if (dragging) paintTimeline(t);
  });
  track.addEventListener('pointerleave', () => { hoverTip.hidden = true; });
  track.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; seekTo(timeAt(e.clientX), { immediate: true }); showUi(); });

  // Souris et tactile
  root.addEventListener('mousemove', () => showUi());
  let lastTap = 0, tapTimer = null;
  video.addEventListener('click', (e) => {
    const now = Date.now();
    const touch = document.documentElement.classList.contains('touch');
    if (touch && now - lastTap < 300) {
      clearTimeout(tapTimer);
      seekBy(e.clientX < innerWidth / 2 ? -10 : 10);
      lastTap = 0;
      return;
    }
    lastTap = now;
    if (touch) tapTimer = setTimeout(() => (root.classList.contains('ui-on') ? hideUi() : showUi()), 280);
    else togglePlay();
  });
  video.addEventListener('dblclick', () => { if (!document.documentElement.classList.contains('touch')) toggleFullscreen(); });

  // Télécommande / clavier — prioritaire sur la navigation générale
  const onKey = (e) => {
    if (document.querySelector('.sheet-wrap')) return;
    if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return; // on écrit dans la discussion
    const k = e.key, code = e.keyCode;
    const uiOn = root.classList.contains('ui-on');
    const active = document.activeElement;
    const consume = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === ' ' || k === 'MediaPlayPause' || code === 179 || code === 415 || code === 19 || k === 'k') {
      consume(); togglePlay(); showUi(); return;
    }
    if (k === 'MediaFastForward' || code === 417) { consume(); seekBy(30); showUi(); return; }
    if (k === 'MediaRewind' || code === 412) { consume(); seekBy(-30); showUi(); return; }
    if ((k === 'MediaTrackNext' || (k === 'N' && e.shiftKey)) && info && info.next) { consume(); playNext(); return; }
    if ((k === 'MediaTrackPrevious' || (k === 'P' && e.shiftKey)) && info && info.prev) { consume(); playPrev(); return; }
    if (k === 's' && skipKind) { consume(); doSkip(); return; }
    if (info && info.live && (k === 'ChannelUp' || k === 'PageUp' || code === 427 || code === 33)) { consume(); zap(-1); return; }
    if (info && info.live && (k === 'ChannelDown' || k === 'PageDown' || code === 428 || code === 34)) { consume(); zap(1); return; }
    if (k === 'f') { consume(); toggleFullscreen(); return; }
    if (k === 'm') { consume(); setMuted(!video.muted); return; }
    if (k === 'c' && !chatBtn.hidden) { consume(); setChat(root.classList.contains('chat-hidden')); return; }
    if (!uiOn && !document.documentElement.classList.contains('tv') && (k === 'ArrowUp' || k === 'ArrowDown')) { consume(); setVolume(video.volume + (k === 'ArrowUp' ? 0.1 : -0.1), true); return; }
    if (k === 'a' && !e.ctrlKey && !e.metaKey) { consume(); setAmbiance(!ambOn); return; }
    if (isBack(e)) { consume(); if (uiOn && root.contains(active) && active !== playBtn && active !== track) { focusEl(playBtn); showUi(); } else exit(); return; }
    if (info && info.live && !chListBtn.hidden && (k === 'l' || (!uiOn && chPanel.hidden && (k === 'ArrowLeft' || k === 'ArrowRight' || code === 37 || code === 39)))) { consume(); toggleChannels(); return; }
    if (!chPanel.hidden && isBack(e)) { consume(); toggleChannels(false); return; }
    if (!uiOn) {
      if (k === 'ArrowLeft' || k === 'ArrowRight' || code === 37 || code === 39) { consume(); seekBy(k === 'ArrowLeft' || code === 37 ? -10 : 10); showUi(); focusEl(track); return; }
      if (k === 'Enter' || k.startsWith('Arrow') || code === 13) { consume(); showUi(); focusEl(playBtn); return; }
    } else {
      showUi();
      if (active === track && (k === 'ArrowLeft' || k === 'ArrowRight')) { consume(); seekBy(k === 'ArrowLeft' ? -10 : 10); return; }
      if (!root.contains(active) || active === document.body) {
        if (k.startsWith('Arrow') || k === 'Enter') { consume(); focusEl(playBtn); }
      }
    }
  };
  document.addEventListener('keydown', onKey, true);

  // ---------------------------------------------------------------- évènements vidéo
  video.addEventListener('waiting', () => { spinner.hidden = false; });
  video.addEventListener('playing', () => { spinner.hidden = true; mediaRecover = 0; showUi(); requestWakeLock(); });
  video.addEventListener('canplay', () => { spinner.hidden = true; });
  video.addEventListener('play', () => { playBtn.replaceChildren(icon('pause')); showUi(); shareState('play'); });
  video.addEventListener('seeked', () => shareState('seek'));
  video.addEventListener('pause', () => { playBtn.replaceChildren(icon('play')); showUi(true); saveProgress(); releaseWakeLock(); shareState('pause'); });
  video.addEventListener('timeupdate', () => {
    if (!dragging && pendingSeek == null) paintTimeline();
    maybeShowNext();
    checkSegments(position());
  });
  video.addEventListener('ended', () => {
    if (info && info.live) { reloadAt(0, 'Reconnexion à la chaîne…'); return; }
    if (info && info.mode !== 'direct' && offset + video.currentTime < duration() - 5) return; // fin de playlist provisoire
    saveProgress(true);
    if (info && info.next) playNext();
    else setTimeout(() => exit(), 1200);
  });
  subsTimer = setInterval(() => { if (cues.length) paintSubs(); }, 120);

  // ---------------------------------------------------------------- progression
  async function saveProgress(final = false) {
    if (!info || info.live) return;
    const pos = final ? duration() : position();
    if (!pos || pos < 5) return;
    const body = JSON.stringify({ itemId: info.itemId, position: pos, duration: duration(), sessionId: info.sessionId });
    fetch('/api/progress', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body }).catch(() => {});
  }
  saveTimer = setInterval(() => {
    if (!video.paused || casting) saveProgress();
    else if (info && info.sessionId) fetch(`/api/hls/${info.sessionId}/ping`, { method: 'POST' }).catch(() => {});
  }, 10000);
  const onHide = () => { if (document.visibilityState === 'hidden') saveProgress(); };
  document.addEventListener('visibilitychange', onHide);
  // Fermeture de l'onglet / rechargement : on libère tout de suite la conversion côté serveur
  const onPageHide = () => { saveProgress(); if (info && info.sessionId && !casting) stopSession(info.sessionId); };
  window.addEventListener('pagehide', onPageHide);

  // ---------------------------------------------------------------- épisode suivant
  // File de lecture (clips) ou épisodes : précédent / suivant
  function applyQueue() {
    if (!info) return;
    const q = queueAround(id);
    if (q) {
      info.next = q.next ? { id: q.next.id, title: q.next.title, artist: q.next.artist, queue: true } : null;
      info.prev = q.prev ? { id: q.prev.id, title: q.prev.title, queue: true } : null;
      subEl.textContent = [info.subtitle, `${q.title} · ${q.index + 1}/${q.total}`].filter(Boolean).join(' · ');
      shuffleBtn.hidden = false;
      shuffleBtn.classList.toggle('on', q.shuffle); shuffleBtn.setAttribute('aria-pressed', String(q.shuffle));
    } else shuffleBtn.hidden = true;
    nextBtn.hidden = !info.next;
    nextBtn.querySelector('.lbl').textContent = info.type === 'episode' ? 'Épisode suivant' : 'Suivant';
    prevBtn.hidden = !info.prev;
    prevBtn.setAttribute('aria-label', info.type === 'episode' ? 'Épisode précédent' : 'Précédent');
  }
  function playPrev() {
    if (!info || !info.prev) return;
    // Comme partout : si on est déjà avancé, « précédent » revient d'abord au début
    if (info.type !== 'episode' && position() > 8) { seekTo(0, { immediate: true }); return; }
    saveProgress();
    if (party) party.send('item', { itemId: info.prev.id });
    go(`/lecture/${info.prev.id}?t=0${roomCode ? `&salle=${roomCode}` : ''}`, { replace: true });
  }

  // Génériques : bouton pour les passer, ou saut automatique (Réglages)
  let skipState = { intro: false, credits: false }, skipKind = null;
  function checkSegments(t) {
    const seg = info && info.segments;
    if (!seg || casting) { skipBtn.hidden = true; return; }
    let kind = null;
    if (seg.intro && t >= seg.intro.start && t < seg.intro.end - 1.5) kind = 'intro';
    else if (seg.credits && t >= seg.credits.start && t < seg.credits.end - 1.5) kind = 'credits';
    if (kind === 'credits' && info.next) { kind = null; maybeShowNext(true); } // le générique de fin enchaîne sur l'épisode suivant
    if (kind && prefs.get('autoSkip') && !skipState[kind] && !party) { skipState[kind] = true; doSkip(kind); toast(kind === 'intro' ? 'Générique de début passé' : 'Générique de fin passé'); return; }
    if (kind !== skipKind) {
      skipKind = kind;
      skipBtn.hidden = !kind;
      if (kind) {
        skipBtn.querySelector('span').textContent = kind === 'intro' ? 'Passer l’intro' : 'Passer le générique';
        if (document.documentElement.classList.contains('keys') && !root.classList.contains('ui-on')) focusEl(skipBtn, { scroll: false });
      }
    }
  }
  function doSkip(kind = skipKind) {
    const seg = info && info.segments && info.segments[kind];
    if (!seg) return;
    markUser();
    seekTo(seg.end, { immediate: true });
    skipBtn.hidden = true; skipKind = null;
  }

  function maybeShowNext(early = false) {
    if (!info || !info.next || nextShown || nextDismissed || casting) return;
    if (info.type === 'clip') return; // les clips s'enchaînent à la fin, sans compte à rebours
    const d = duration(), t = position();
    if (!early && (!d || d - t > Math.max(25, d * 0.025))) return;
    nextShown = true;
    const n = info.next;
    let left = 10;
    const ring = h('i');
    const label = h('span', {}, `Lecture dans ${left} s`);
    nextPanel.replaceChildren(
      h('div', { class: 'nx-head' }, n.queue ? 'À suivre' : `Épisode suivant, S${n.season} É${n.episode}`),
      h('div', { class: 'nx-title' }, n.title),
      h('div', { class: 'nx-ring' }, ring),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-play btn-small f', onclick: () => playNext() }, icon('play'), label),
        h('button', { class: 'btn btn-ghost btn-small f', onclick: () => { nextDismissed = true; clearInterval(nextTimer); nextPanel.hidden = true; } }, 'Regarder le générique')));
    nextPanel.hidden = false;
    requestAnimationFrame(() => { ring.style.width = '100%'; ring.style.transitionDuration = '10s'; });
    focusEl(nextPanel.querySelector('.btn-play'));
    nextTimer = setInterval(() => {
      left--;
      label.textContent = `Lecture dans ${left} s`;
      if (left <= 0) { clearInterval(nextTimer); playNext(); }
    }, 1000);
  }
  function playNext() {
    if (!info || !info.next) return;
    saveProgress(true);
    if (party) party.send('item', { itemId: info.next.id });
    go(`/lecture/${info.next.id}?t=0${roomCode ? `&salle=${roomCode}` : ''}`, { replace: true });
  }

  // ---------------------------------------------------------------- menus
  function openTracks() {
    const audioCol = h('div', {}, h('h3', {}, 'Audio'), info.audio.map((a) => h('button', {
      class: `opt f${a.order === audioOrder ? ' on' : ''}`,
      onclick: () => { s.close(); if (a.order !== audioOrder) { audioOrder = a.order; load(position(), { reason: `Audio : ${langName(a.lang)}` }); } },
    }, icon('check'), langName(a.lang), h('small', {}, [a.title, `${a.codec.toUpperCase()} ${a.channels >= 6 ? '5.1' : a.channels === 1 ? 'mono' : 'stéréo'}`].filter(Boolean).join(', ')))));
    const subOpts = [{ id: null, label: 'Désactivés' }, ...info.subs.map((x) => ({ ...x, label: langName(x.lang) }))];
    const subCol = h('div', {}, h('h3', {}, 'Sous-titres'), subOpts.map((x) => h('button', {
      class: `opt f${(x.id || null) === (subId || null) ? ' on' : ''}`,
      onclick: () => {
        s.close();
        const prev = info.subs.find((y) => y.id === subId);
        subId = x.id;
        if (x.burn || (prev && prev.burn)) load(position(), { reason: x.burn ? 'Incrustation des sous-titres…' : null });
        else loadSubtitles();
      },
    }, icon('check'), x.label, h('small', {}, [x.forced ? 'Forcés' : '', x.title || '', x.burn ? 'Incrustés' : ''].filter(Boolean).join(', ')))));
    const s = sheet('Audio et sous-titres', h('div', { class: 'sheet-cols' }, audioCol, subCol));
  }

  function openQuality() {
    const s = sheet('Qualité', h('div', {},
      h('p', { style: { color: 'var(--mist)', margin: '0 0 12px' } }, 'Auto choisit la meilleure qualité possible. Baissez-la si la vidéo saccade ou pour économiser vos données.'),
      info.qualities.map((q) => h('button', {
        class: `opt f${q.id === quality ? ' on' : ''}`,
        onclick: () => { s.close(); if (q.id !== quality) { quality = q.id; setPreferredQuality(q.id); load(position(), { reason: `Qualité : ${q.label}` }); } },
      }, icon('check'), q.label))));
  }

  // ---------------------------------------------------------------- Chromecast & AirPlay
  if (castSupported()) loadCast().then((ok) => { if (ok && !destroyed) castBtn.hidden = false; });
  if (window.WebKitPlaybackTargetAvailabilityEvent) {
    video.addEventListener('webkitplaybacktargetavailabilitychanged', (e) => { airBtn.hidden = e.availability !== 'available'; });
  }

  async function startCast() {
    const pos = position();
    try {
      const ctx = castContext();
      if (!ctx.getCurrentSession()) await ctx.requestSession();
      const cinfo = await api(`/api/play/${id}`, { method: 'POST', body: { caps: castCaps, quality, audio: audioOrder, sub: null, start: pos, replace: info && info.sessionId } });
      info.sessionId = cinfo.sessionId;
      const name = await castMedia(cinfo);
      video.pause();
      teardownSource();
      const { player, controller } = remote();
      const castOffset = cinfo.offset || 0;
      casting = {
        position: () => castOffset + (player.currentTime || 0),
        toggle: () => controller.playOrPause(),
        seek: (t) => { player.currentTime = Math.max(0, t - castOffset); controller.seek(); },
      };
      const stateLabel = h('p', {}, 'Lecture en cours sur le téléviseur.');
      overlay.hidden = false;
      overlay.replaceChildren(h('div', {}, h('h2', {}, `Diffusion sur ${name}`), stateLabel,
        h('div', { class: 'actions', style: { justifyContent: 'center' } },
          h('button', { class: 'btn btn-play f', onclick: () => controller.playOrPause() }, icon('pause'), 'Pause / lecture'),
          h('button', { class: 'btn btn-ghost f', onclick: () => ctx.endCurrentSession(true) }, 'Arrêter la diffusion'))));
      const tick = setInterval(() => paintTimeline(), 1000);
      controller.addEventListener(cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED, () => {
        if (player.isConnected || !casting) return;
        const resumeAt = casting.position();
        clearInterval(tick);
        casting = null;
        overlay.hidden = true;
        if (!destroyed) load(resumeAt, { reason: 'Reprise sur cet appareil' });
      });
      showUi(true);
    } catch (e) {
      if (e && e !== 'cancel' && e.code !== 'cancel') toast('Diffusion impossible. Le Chromecast doit pouvoir joindre le serveur.', true);
    }
  }

  // ---------------------------------------------------------------- intégrations système
  function setupMediaSession() {
    if (!('mediaSession' in navigator) || !info) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: info.title, artist: info.subtitle, album: 'Venus',
        artwork: info.backdrop ? [{ src: img(info.backdrop), sizes: '1280x720', type: 'image/jpeg' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () => video.play());
      navigator.mediaSession.setActionHandler('pause', () => video.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
      navigator.mediaSession.setActionHandler('seekto', (d) => seekTo(d.seekTime, { immediate: true }));
      navigator.mediaSession.setActionHandler('nexttrack', info.next ? () => playNext() : null);
    } catch { /* non pris en charge */ }
  }
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* */ }
  }
  function releaseWakeLock() { try { wakeLock && wakeLock.release(); } catch { /* */ } wakeLock = null; }

  // ---------------------------------------------------------------- sortie
  // Zapping entre chaînes (boutons, touches P+ / P- de la télécommande)
  let channelList = null, zapper = null;
  async function setupLive() {
    if (!channelList) channelList = await api('/api/library?type=channel').catch(() => []);
    if (destroyed || !channelList.length) return;
    chListBtn.hidden = false;
    if (!zapper) {
      zapper = numberZapper(channelList, (c) => { if (c.id !== id) go(`/lecture/${c.id}`, { replace: true }); }, root);
      document.addEventListener('keydown', zapper.onKey, true);
    }
    const cur = channelList.find((c) => c.id === id);
    if (cur && cur.number) titleEl.textContent = `${cur.number}. ${info.title}`;
  }
  function toggleChannels(force) {
    const open = force ?? chPanel.hidden;
    chPanel.hidden = !open;
    root.classList.toggle('ch-open', open);
    if (!open) { focusEl(chListBtn, { scroll: false }); return; }
    const items = (channelList || []).map((c) => h('button', { class: `ch-item f${c.id === id ? ' on' : ''}`, 'aria-current': c.id === id ? 'true' : null, onclick: () => { if (c.id !== id) go(`/lecture/${c.id}`, { replace: true }); else toggleChannels(false); } },
      h('span', { class: 'ch-n' }, c.number || ''),
      c.poster ? h('img', { src: img(c.poster), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : h('span', { class: 'ch-ph' }),
      h('span', { class: 'ch-t' }, h('b', {}, c.title), c.group ? h('small', {}, c.group) : null)));
    chPanel.replaceChildren(h('div', { class: 'ch-head' }, h('b', {}, 'Chaînes'), h('small', {}, 'Tapez un numéro pour y aller'),
      h('button', { class: 'p-icon small f', 'aria-label': 'Fermer la liste', onclick: () => toggleChannels(false) }, icon('close'))), h('div', { class: 'ch-list' }, items));
    const cur = chPanel.querySelector('.ch-item.on');
    requestAnimationFrame(() => { if (cur) cur.scrollIntoView({ block: 'center' }); focusEl(cur || chPanel.querySelector('.ch-item'), { scroll: false }); });
    showUi(true);
  }
  async function zap(dir) {
    if (!channelList) channelList = await api('/api/library?type=channel').catch(() => []);
    const i = channelList.findIndex((c) => c.id === id);
    if (i < 0 || !channelList.length) return;
    const nextCh = channelList[(i + dir + channelList.length) % channelList.length];
    go(`/lecture/${nextCh.id}`, { replace: true });
  }

  // ---------------------------------------------------------------- Mode Ambiance
  let ambOn = false, stopAmb = null;
  function setAmbiance(on) {
    ambOn = on; ambianceOn.set(on);
    root.classList.toggle('amb-on', on);
    ambBtn.setAttribute('aria-pressed', String(on));
    ambBtn.classList.toggle('on', on);
    if (stopAmb) { stopAmb(); stopAmb = null; }
    if (on) stopAmb = ambilight(video, ambCanvas);
  }

  // ---------------------------------------------------------------- séance à plusieurs
  let party = null, panel = null, applyingRemote = false, syncTimer = null;
  function shareState(reason) {
    if (!party || applyingRemote || !info || info.live) return;
    if (Date.now() - userActAt > 1500) return; // seules les actions de cette personne sont partagées
    party.send('state', { playing: !video.paused, position: position(), reason });
  }
  function applyRemote(st, quiet) {
    applyingRemote = true;
    desiredPaused = !st.playing;
    if (Math.abs(position() - st.position) > 1.5) seekTo(st.position, { immediate: true, remote: true });
    if (st.playing && video.paused) video.play().catch(() => showUi(true));
    if (!st.playing && !video.paused) video.pause();
    if (!quiet && st.by && st.reason !== 'sync') toast(st.playing ? `${st.by} a lancé la lecture` : `${st.by} a mis en pause`);
    setTimeout(() => { applyingRemote = false; }, 900);
  }
  async function connectParty(code, title) {
    roomCode = code;
    panel = partyPanel(code, {
      onReact: (e) => { floatReaction(reactLayer, e); party.send('react', { emoji: e }); },
      onChat: (t) => party.send('chat', { text: t }),
      onInvite: () => showInvite(code, title),
      onLeave: () => leaveParty(),
      onHide: () => setChat(false),
      soundOn: () => prefs.get('chatSound'),
      onSound: (on) => { prefs.set('chatSound', on); if (on) ping(true); toast(on ? 'Son de la discussion activé' : 'Son de la discussion coupé'); },
    });
    root.append(panel.el);
    root.classList.add('in-party');
    partyBtn.hidden = true;
    chatBtn.hidden = false;
    setChat(prefs.get('chatOverlay'), false);
    party = joinParty(code, {
      room: (r) => applyRemote(r.state, true),
      members: (m) => panel.setMembers(m),
      state: (st) => applyRemote(st),
      chat: (c) => { panel.message(c); if (c.from !== party.clientId) { ping(); if (root.classList.contains('chat-hidden')) bumpUnread(); } },
      react: (r) => { if (r.from !== party.clientId) { floatReaction(reactLayer, r.emoji, r.name); ping(); } panel.react(r.emoji, r.name); },
      notice: (n) => panel.notice(n.text),
      item: (i) => go(`/lecture/${i.itemId}?t=0&salle=${code}`, { replace: true }),
    });
    // L'hôte rappelle régulièrement la position : les écrans qui dérivent se recalent
    syncTimer = setInterval(() => {
      if (party && party.isHost() && !video.paused) party.send('state', { playing: true, position: position(), reason: 'sync' });
    }, 10000);
  }
  // Petit son discret à chaque message ou réaction des autres (désactivable dans la discussion)
  let audioCtx = null;
  function ping(force = false) {
    if (!force && !prefs.get('chatSound')) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      [[880, 0], [1320, 0.07]].forEach(([f, d]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.06, t + d + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
        o.connect(g).connect(audioCtx.destination); o.start(t + d); o.stop(t + d + 0.2);
      });
    } catch { /* pas de son disponible */ }
  }
  let unread = 0;
  function bumpUnread() {
    unread++;
    const b = chatBtn.querySelector('.p-unread');
    b.hidden = false; b.textContent = unread > 9 ? '9+' : String(unread);
  }
  // Discussion transparente à droite de l'image : visible pendant la lecture, masquable d'un bouton
  function setChat(on, remember = true) {
    root.classList.toggle('chat-hidden', !on);
    chatBtn.setAttribute('aria-pressed', String(on));
    chatBtn.classList.toggle('on', on);
    if (on) { unread = 0; chatBtn.querySelector('.p-unread').hidden = true; }
    if (remember) prefs.set('chatOverlay', on);
  }
  function leaveParty() {
    if (party) party.close();
    party = null; clearInterval(syncTimer);
    if (panel) panel.el.remove();
    root.classList.remove('in-party', 'chat-hidden');
    chatBtn.hidden = true;
    partyBtn.hidden = !!(info && info.live);
    roomCode = null;
    toast('Vous avez quitté la séance');
  }
  async function startParty() {
    try {
      const r = await api('/api/rooms', { method: 'POST', body: { itemId: id, position: position() } });
      await connectParty(r.code, r.title);
      party.send('state', { playing: !video.paused, position: position(), reason: 'start' });
      showInvite(r.code, r.title);
    } catch (e) { toast(e.message, true); }
  }

  function exit() {
    back(info && info.type === 'channel' ? '/tv' : info && ['episode', 'clip'].includes(info.type) ? '/' : `/titre/${id}`);
  }

  function destroy() {
    destroyed = true;
    saveProgress();
    clearInterval(saveTimer); clearInterval(subsTimer); clearInterval(nextTimer); clearTimeout(uiTimer); clearTimeout(seekTimer);
    document.removeEventListener('keydown', onKey, true);
    if (zapper) { zapper.stop(); document.removeEventListener('keydown', zapper.onKey, true); }
    if (stopAmb) stopAmb();
    if (party) party.close();
    clearInterval(syncTimer);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
    releaseWakeLock();
    if (info && info.sessionId && !casting) stopSession(info.sessionId);
    teardownSource();
    document.body.style.overflow = '';
    // On quitte le plein écran seulement si on ne passe pas directement à une autre vidéo
    setTimeout(() => { if (!document.querySelector('.player') && document.fullscreenElement) document.exitFullscreen().catch(() => {}); }, 60);
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }

  // Rejoindre une séance : on démarre à la position commune
  let roomInfo = null;
  if (roomCode) {
    try { roomInfo = await api(`/api/rooms/${roomCode}`); } catch (e) { toast(e.message, true); roomCode = null; }
  }
  await load(roomInfo ? roomInfo.state.position : startParam != null ? Number(startParam) : null);
  if (info && info.live) { partyBtn.hidden = true; setupLive(); }
  if (roomInfo) connectParty(roomInfo.code, roomInfo.title);
  setAmbiance(ambianceOn.get());
  requestAnimationFrame(() => focusEl(playBtn, { scroll: false }));
  return { destroy };
}
