// Bandes-annonces YouTube intégrées discrètement (youtube-nocookie, sans interface YouTube).
// La vidéo n'apparaît qu'une fois réellement lancée ; on peut couper / remettre le son, mettre en pause,
// et être prévenu de la fin (pour passer à la diapositive suivante du carrousel).
import { h } from './ui.js';

let seq = 0;
export function trailerPlayer(key, { mute = true, start = 0, loop = false, onPlaying, onEnd, onError } = {}) {
  // Démo intégrée (pas d'accès à YouTube) : une vidéo locale fait office de bande-annonce
  if (window.__VN_TRAILER) return window.__VN_TRAILER({ mute, loop, onPlaying, onEnd });
  const id = ++seq;
  const params = new URLSearchParams({
    autoplay: '1', mute: mute ? '1' : '0', controls: '0', disablekb: '1', fs: '0', iv_load_policy: '3', modestbranding: '1',
    playsinline: '1', rel: '0', enablejsapi: '1', start: String(start), origin: location.origin,
  });
  if (loop) { params.set('loop', '1'); params.set('playlist', key); }
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
    if (state === 1 && !playing) { playing = true; el.classList.add('on'); onPlaying && onPlaying(); }
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
