// Bandes-annonces YouTube intégrées discrètement (youtube-nocookie, sans interface YouTube).
// La vidéo n'apparaît qu'une fois réellement lancée ; on peut couper / remettre le son, mettre en pause,
// et être prévenu de la fin (pour passer à la diapositive suivante du carrousel).
import { h } from './ui.js';

let seq = 0;
// hd : YouTube démarre en basse définition puis monte ; on joue d'abord la vidéo cachée quelques secondes
// (le temps qu'elle passe en HD), puis on revient au début et on l'affiche : elle est nette dès qu'on la voit.
export function trailerPlayer(key, { mute = true, start = 0, loop = false, hd = false, onPlaying, onEnd, onError } = {}) {
  // Démo intégrée (pas d'accès à YouTube) : une vidéo locale fait office de bande-annonce
  if (window.__VN_TRAILER) return window.__VN_TRAILER({ mute, loop, onPlaying, onEnd });
  const id = ++seq;
  const params = new URLSearchParams({
    autoplay: '1', mute: mute ? '1' : '0', controls: '0', disablekb: '1', fs: '0', iv_load_policy: '3', modestbranding: '1',
    playsinline: '1', rel: '0', enablejsapi: '1', start: String(start), origin: location.origin,
  });
  if (loop) { params.set('loop', '1'); params.set('playlist', key); }
  if (hd) params.set('vq', 'hd1080');
  const el = h('iframe', {
    class: 'yt', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?${params}`, title: 'Bande-annonce',
    allow: 'autoplay; encrypted-media; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin', tabindex: '-1', 'aria-hidden': 'true',
  });
  let heard = false, playing = false, done = false, poke = null;
  const send = (func, args = []) => { try { el.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args, id }), '*'); } catch { /* */ } };
  const onMsg = (e) => {
    if (e.source !== el.contentWindow) return;
    let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!d) return;
    heard = true;
    const state = d.event === 'onStateChange' ? d.info : d.event === 'infoDelivery' && d.info ? d.info.playerState : undefined;
    if (state === 1 && !playing) {
      playing = true;
      const reveal = () => { if (done) return; el.classList.add('on'); onPlaying && onPlaying(); };
      if (!hd) reveal();
      else {
        send('setPlaybackQuality', ['hd1080']);
        setTimeout(() => { send('seekTo', [start, true]); setTimeout(reveal, 350); }, 2600);
      }
    }
    if (state === 0 && !done && !loop) { done = true; onEnd && onEnd(); }
    if (d.event === 'onError' && !done) { done = true; onError && onError(d.info); }
  };
  window.addEventListener('message', onMsg);
  el.addEventListener('load', () => {
    clearInterval(poke);
    let n = 0;
    poke = setInterval(() => {
      if (heard || ++n > 40) { clearInterval(poke); return; }
      try { el.contentWindow.postMessage(JSON.stringify({ event: 'listening', id, channel: 'widget' }), '*'); } catch { /* */ }
    }, 250);
  });
  return {
    el,
    mute(on) { send(on ? 'mute' : 'unMute'); if (!on) send('setVolume', [100]); },
    play() { send('playVideo'); },
    pause() { send('pauseVideo'); },
    destroy() { clearInterval(poke); window.removeEventListener('message', onMsg); el.remove(); },
  };
}

// Fenêtre « Bande-annonce » avec le son et les commandes YouTube
export function trailerUrl(key) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
}

// Bande-annonce seule, en plein écran : pas de fenêtre autour, juste la vidéo et un bouton « Fermer »
// (Échap, Retour de la télécommande ou un clic sur le fond la ferment aussi)
export function playTrailer(key, title = '', { onClose } = {}) {
  const prev = document.activeElement;
  const frame = document.createElement('iframe');
  Object.assign(frame, { className: 'trailer-full-frame', src: trailerUrl(key), title: `Bande-annonce${title ? ` de ${title}` : ''}`, allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin' });
  frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  const close = document.createElement('button');
  close.className = 'trailer-close f';
  close.type = 'button';
  close.setAttribute('aria-label', 'Fermer la bande-annonce');
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span>Fermer</span>';
  const wrap = document.createElement('div');
  wrap.className = 'trailer-full';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', frame.title);
  wrap.append(frame, close);
  const done = () => {
    removeEventListener('keydown', onKey, true);
    frame.src = 'about:blank';
    wrap.classList.add('off');
    setTimeout(() => wrap.remove(), 220);
    document.documentElement.classList.remove('trailer-open');
    if (prev && prev.focus) prev.focus();
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 461 || e.keyCode === 10009) { e.preventDefault(); e.stopPropagation(); done(); } };
  close.addEventListener('click', done);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) done(); });
  addEventListener('keydown', onKey, true);
  document.documentElement.classList.add('trailer-open');
  document.body.append(wrap);
  requestAnimationFrame(() => { wrap.classList.add('on'); close.focus(); });
  return done;
}
