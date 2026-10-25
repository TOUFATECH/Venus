// Client API + détection des capacités de lecture de l'appareil
const KEY = 'vn_token';
export const auth = {
  get token() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* navigation privée */ } },
};

export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal, credentials: 'same-origin' });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Serveur injoignable. Vérifiez que Venus tourne et que vous êtes sur le même réseau.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError(res.status, (data && data.error) || `Erreur ${res.status}`);
    if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new CustomEvent('vn:unauth'));
    if (res.status === 403 && err.message === 'Choisissez un profil') window.dispatchEvent(new CustomEvent('vn:noprofile'));
    throw err;
  }
  return data;
}

// Ce que ce navigateur sait lire sans conversion (pour décider lecture directe / remux / transcodage)
let capsCache;
export function deviceCaps() {
  if (capsCache) return capsCache;
  const v = document.createElement('video');
  const ms = window.MediaSource || window.ManagedMediaSource;
  const native = (t) => { try { return v.canPlayType(t) !== ''; } catch { return false; } };
  const mse = (t) => { try { return !!(ms && ms.isTypeSupported(t)); } catch { return false; } };
  const any = (t) => native(t) || mse(t);
  const video = ['h264'];
  if (native('video/mp4; codecs="hvc1.1.6.L120.90"') || native('video/mp4; codecs="hev1.1.6.L120.90"')) video.push('hevc');
  if (native('video/mp4; codecs="av01.0.08M.08"')) video.push('av1');
  if (native('video/webm; codecs="vp9"') || native('video/mp4; codecs="vp09.00.10.08"')) video.push('vp9');
  const audio = ['aac'];
  if (any('audio/mpeg')) audio.push('mp3');
  if (any('audio/webm; codecs="opus"') || any('audio/mp4; codecs="opus"')) audio.push('opus');
  if (any('audio/flac') || any('audio/mp4; codecs="flac"')) audio.push('flac');
  if (any('audio/mp4; codecs="ac-3"')) audio.push('ac3');
  if (any('audio/mp4; codecs="ec-3"')) audio.push('eac3');
  if (any('audio/webm; codecs="vorbis"')) audio.push('vorbis');
  const containers = ['mp4'];
  if (native('video/webm')) containers.push('webm');
  const hdr = video.includes('hevc') && !!(window.matchMedia && matchMedia('(dynamic-range: high)').matches);
  const nativeHls = native('application/vnd.apple.mpegurl');
  capsCache = {
    containers, video, audio, hdr, dovi: false,
    hevcHls: video.includes('hevc') && (nativeHls || mse('video/mp4; codecs="hvc1.1.6.L120.90"')),
    nativeHls,
  };
  return capsCache;
}

// Capacités d'un Chromecast (récepteur multimédia par défaut)
export const castCaps = { containers: ['mp4', 'webm'], video: ['h264', 'vp9'], audio: ['aac', 'mp3', 'opus', 'flac'], hdr: false, hevcHls: false };

export function preferredQuality() {
  try {
    const q = localStorage.getItem('vn_quality');
    if (q) return q;
  } catch { /* */ }
  const c = navigator.connection;
  if (c && (c.saveData || /2g|3g/.test(c.effectiveType || ''))) return '480p';
  return 'auto';
}
export function setPreferredQuality(q) { try { localStorage.setItem('vn_quality', q); } catch { /* */ } }

// Flux d'évènements temps réel (séances, télécommande, nouveautés).
// La démo intégrée fournit son propre transport via window.__VN_STREAM.
export function openStream(path, handlers) {
  if (window.__VN_STREAM) return window.__VN_STREAM(path, handlers);
  const sep = path.includes('?') ? '&' : '?';
  const es = new EventSource(`${path}${sep}token=${encodeURIComponent(auth.token || '')}`);
  for (const [type, fn] of Object.entries(handlers)) {
    if (type === 'error') es.onerror = fn;
    else es.addEventListener(type, (e) => { try { fn(JSON.parse(e.data)); } catch { /* message illisible */ } });
  }
  return () => es.close();
}

// Préférences de cet appareil (aperçu au survol, plein écran au lancement, volume)
const PREF_DEFAULTS = { hoverPreview: true, hoverSound: false, fullscreenOnPlay: true, volume: 1, muted: false, chatOverlay: true };
export const prefs = {
  get(k) {
    try { const v = localStorage.getItem(`vn_pref_${k}`); return v == null ? PREF_DEFAULTS[k] : JSON.parse(v); } catch { return PREF_DEFAULTS[k]; }
  },
  set(k, v) { try { localStorage.setItem(`vn_pref_${k}`, JSON.stringify(v)); } catch { /* navigation privée */ } },
};
