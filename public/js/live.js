// Lecture HLS légère (aperçus) : hls.js chargé à la demande, ou lecture native sur Safari / iOS
let hlsLib = null;
export function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLib) return hlsLib;
  hlsLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/hls.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => { hlsLib = null; reject(new Error('Lecteur HLS indisponible')); };
    document.head.append(s);
  });
  return hlsLib;
}

const nativeHls = () => document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

// Branche un flux (HLS ou fichier) sur une balise vidéo. Renvoie une fonction de nettoyage.
export async function attachStream(video, url, { live = false, onError } = {}) {
  const isHls = /\.m3u8(\?|$)/.test(url);
  if (!isHls || (nativeHls() && isSafari)) {
    video.src = url;
    video.play().catch(() => {});
    return () => { video.removeAttribute('src'); video.load(); };
  }
  const Hls = await loadHls();
  if (!Hls.isSupported()) { video.src = url; video.play().catch(() => {}); return () => { video.removeAttribute('src'); video.load(); }; }
  const hls = new Hls(live ? { liveSyncDurationCount: 3, manifestLoadingMaxRetry: 0, backBufferLength: 10, maxBufferLength: 12 } : {});
  hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal && onError) onError(data); });
  hls.loadSource(url);
  hls.attachMedia(video);
  video.play().catch(() => {});
  return () => { hls.destroy(); video.removeAttribute('src'); video.load(); };
}
