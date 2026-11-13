// Lecture HLS légère (aperçus) : hls.js chargé à la demande, ou lecture native sur Safari / iOS
let hlsLib = null;
// Charge hls.js à la demande
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

// Le navigateur lit-il le HLS lui-même (Safari, iOS) ?
const nativeHls = () => document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

// Branche un flux (HLS ou fichier) sur une balise vidéo. Renvoie une fonction de nettoyage.
export async function attachStream(video, url, { live = false, dvr = false, onError } = {}) {
  const isHls = /\.m3u8(\?|$)/.test(url);
  if (!isHls || (nativeHls() && isSafari)) {
    video.src = url;
    video.play().catch(() => {});
    return () => { video.removeAttribute('src'); video.load(); };
  }
  const Hls = await loadHls();
  if (!Hls.isSupported()) { video.src = url; video.play().catch(() => {}); return () => { video.removeAttribute('src'); video.load(); }; }
  // Direct : on démarre 2 segments (≈ 4 s) avant le bord du direct, avec un petit tampon = image plus vite
  // Direct différé (relais Venus) : on garde ce qui a été vu pour pouvoir reculer, sans sauter au direct tout seul
  const cfg = dvr ? { liveSyncDurationCount: 2, manifestLoadingMaxRetry: 1, backBufferLength: 7200, maxBufferLength: 20, startFragPrefetch: true }
    : live ? { liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 6, manifestLoadingMaxRetry: 0, backBufferLength: 10, maxBufferLength: 10, startFragPrefetch: true } : {};
  const hls = new Hls(cfg);
  // Erreurs graves : on répare d'abord sur place (rechargement, reprise du décodage) avant d'abandonner.
  // Beaucoup de chaînes coupent quelques secondes (pubs, changement de programme) : sans cela, l'image restait figée.
  let netTries = 0, mediaTries = 0, gaveUp = false;
  const giveUp = (data) => { if (gaveUp) return; gaveUp = true; if (onError) onError(data); };
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netTries < 4) { netTries++; setTimeout(() => { if (!gaveUp) hls.startLoad(); }, 1000 * netTries); return; }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaTries < 2) { mediaTries++; if (mediaTries === 2) hls.swapAudioCodec(); hls.recoverMediaError(); return; }
    giveUp(data);
  });
  hls.on(Hls.Events.FRAG_BUFFERED, () => { netTries = 0; });
  hls.loadSource(url);
  hls.attachMedia(video);
  video.play().catch(() => {});
  // Direct : image figée alors qu'on ne l'a pas mise en pause → on saute au direct, puis on relance le
  // décodage, et en dernier recours on prévient la page (qui relance la chaîne)
  let lastT = -1, stuckFor = 0, step = 0;
  const dog = live ? setInterval(() => {
    if (gaveUp || video.paused || video.seeking || document.hidden) { stuckFor = 0; return; }
    if (video.currentTime !== lastT) { lastT = video.currentTime; stuckFor = 0; if (step && video.readyState >= 3) { step = 0; mediaTries = 0; } return; }
    stuckFor += 2;
    if (stuckFor < 8) return;
    stuckFor = 0; step++;
    if (step === 1) { const e = hls.liveSyncPosition; if (Number.isFinite(e) && e > video.currentTime + 1) video.currentTime = e; else hls.startLoad(); }
    else if (step === 2) hls.recoverMediaError();
    else giveUp({ type: 'stalled', fatal: true, details: 'Image figée' });
  }, 2000) : null;
  const off = () => { clearInterval(dog); gaveUp = true; hls.destroy(); video.removeAttribute('src'); video.load(); };
  off.hls = hls;
  return off;
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
