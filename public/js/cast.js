// Chromecast (Google Cast) — chargé uniquement sur Chrome/Edge, en contexte sécurisé (HTTPS)
import { auth } from './api.js';
let ready = null;

export function castSupported() {
  return !window.__VN_NO_CAST && window.isSecureContext && /Chrome|CriOS|Edg/.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent);
}

export function loadCast() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    if (!castSupported()) return resolve(false);
    window.__onGCastApiAvailable = (ok) => {
      if (!ok) return resolve(false);
      const ctx = cast.framework.CastContext.getInstance();
      ctx.setOptions({ receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
      resolve(true);
    };
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    s.onerror = () => resolve(false);
    document.head.append(s);
    setTimeout(() => resolve(false), 8000);
  });
  return ready;
}

export function castContext() { return window.cast && cast.framework ? cast.framework.CastContext.getInstance() : null; }

// Envoie un média au Chromecast. info = réponse de /api/play obtenue avec les capacités du Chromecast
export async function castMedia(info) {
  const ctx = castContext();
  let session = ctx.getCurrentSession();
  if (!session) { await ctx.requestSession(); session = ctx.getCurrentSession(); }
  const url = new URL(info.url, location.origin).href;
  const isHls = info.mode !== 'direct';
  const mi = new chrome.cast.media.MediaInfo(url, isHls ? 'application/x-mpegurl' : 'video/mp4');
  if (isHls) {
    mi.hlsSegmentFormat = chrome.cast.media.HlsSegmentFormat.TS;
    mi.hlsVideoSegmentFormat = chrome.cast.media.HlsVideoSegmentFormat.MPEG2_TS;
  }
  mi.streamType = chrome.cast.media.StreamType.BUFFERED;
  mi.metadata = new chrome.cast.media.GenericMediaMetadata();
  mi.metadata.title = info.title;
  mi.metadata.subtitle = info.subtitle;
  if (info.backdrop) mi.metadata.images = [new chrome.cast.Image(new URL(`/img/${info.backdrop}?token=${encodeURIComponent(auth.token || '')}`, location.origin).href)];
  const req = new chrome.cast.media.LoadRequest(mi);
  req.currentTime = isHls ? 0 : info.startAt || 0;
  req.autoplay = true;
  await session.loadMedia(req);
  const dev = session.getCastDevice && session.getCastDevice();
  return (dev && dev.friendlyName) || 'Chromecast';
}

export function remote() {
  const player = new cast.framework.RemotePlayer();
  const controller = new cast.framework.RemotePlayerController(player);
  return { player, controller };
}
