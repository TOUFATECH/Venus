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

// Saisie d'un numéro de chaîne (clavier, télécommande TV ou téléphone) : les chiffres s'affichent,
// puis on change de chaîne 1,3 s après le dernier chiffre (ou tout de suite avec OK / Entrée).
export function numberZapper(channels, onPick, host = document.body) {
  let buf = '', timer = null, osd = null;
  const stop = () => { clearTimeout(timer); buf = ''; if (osd) { osd.remove(); osd = null; } };
  const commit = () => {
    const n = Number(buf);
    const ch = channels.find((c) => c.number === n);
    if (osd) osd.querySelector('small').textContent = ch ? ch.title : 'Aucune chaîne à ce numéro';
    const pick = ch;
    setTimeout(stop, ch ? 400 : 1200);
    buf = '';
    if (pick) onPick(pick);
  };
  const onKey = (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || document.querySelector('.sheet-wrap')) return;
    const d = /^[0-9]$/.test(e.key) ? e.key : e.keyCode >= 96 && e.keyCode <= 105 ? String(e.keyCode - 96) : null;
    if (d == null) { if (buf && (e.key === 'Enter' || e.keyCode === 13)) { e.preventDefault(); e.stopPropagation(); clearTimeout(timer); commit(); } return; }
    e.preventDefault(); e.stopPropagation();
    if (buf.length >= 4) buf = '';
    buf += d;
    const ch = channels.find((c) => c.number === Number(buf));
    if (!osd) { osd = document.createElement('div'); osd.className = 'ch-osd'; osd.innerHTML = '<b></b><small></small>'; (document.fullscreenElement && document.fullscreenElement !== document.documentElement ? document.fullscreenElement : host || document.body).append(osd); }
    osd.querySelector('b').textContent = buf;
    osd.querySelector('small').textContent = ch ? ch.title : '';
    clearTimeout(timer);
    timer = setTimeout(commit, 1300);
  };
  return { onKey, stop };
}
