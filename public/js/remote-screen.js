// Côté écran (TV, ordinateur) : appairage d'un téléphone et exécution de ses commandes
import { openStream } from './api.js';
import { h, sheet, qrSvg, toast, icon } from './ui.js';
import { go, currentPath } from './app.js';
import { playPath } from './components.js';
import { focusFirst, focusEl } from './nav.js';

let pairing = null; // { code, close }
let codeListeners = [];

function key(k) {
  document.documentElement.classList.add('keys');
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  let target = document.activeElement || document.body;
  if (target.closest && target.closest('.phone-sim')) {
    target = lastFocus && lastFocus.isConnected ? lastFocus : document.body;
    if (target !== document.body) target.focus({ preventScroll: true });
  }
  target.dispatchEvent(ev);
}
let lastFocus = null;
document.addEventListener('focusin', (e) => { if (!e.target.closest || !e.target.closest('.phone-sim')) lastFocus = e.target; });

function run(c) {
  switch (c.cmd) {
    case 'hello': toast('Téléphone connecté : vous pouvez piloter Venus'); break;
    case 'up': key('ArrowUp'); break;
    case 'down': key('ArrowDown'); break;
    case 'left': key('ArrowLeft'); break;
    case 'right': key('ArrowRight'); break;
    case 'ok': {
      let a = document.activeElement;
      if (a && a.closest && a.closest('.phone-sim')) a = lastFocus && lastFocus.isConnected ? lastFocus : null;
      if (!a || a === document.body) { focusFirst(); break; }
      if (document.querySelector('.player') && !document.querySelector('.player.ui-on')) { key('Enter'); break; }
      a.click();
      break;
    }
    case 'back': key('Escape'); break;
    case 'home': go('/'); break;
    case 'playpause': key(' '); break;
    case 'rew': key('MediaRewind'); break;
    case 'fwd': key('MediaFastForward'); break;
    case 'text': {
      const put = () => {
        const input = document.querySelector('.search-box input');
        if (!input) return false;
        input.value = c.text || ''; input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      };
      if (currentPath() !== '/recherche') { go('/recherche'); setTimeout(put, 700); } else put();
      break;
    }
    case 'open': if (c.id) go(`/titre/${c.id}`); break;
    case 'play': if (c.id) go(playPath(c.id)); break;
    default: break;
  }
}

export function startPairing() {
  if (pairing) return pairing;
  let saved = null;
  try { saved = localStorage.getItem('vn_remote_code'); } catch { /* */ }
  pairing = { code: null };
  pairing.close = openStream(`/api/remote/screen${saved ? `?code=${saved}` : ''}`, {
    paired: (d) => {
      pairing.code = d.code;
      try { localStorage.setItem('vn_remote_code', d.code); } catch { /* */ }
      codeListeners.forEach((fn) => fn(d.code));
    },
    cmd: run,
  });
  return pairing;
}
export function stopPairing() { if (pairing) { pairing.close(); pairing = null; } }

export function remoteLink(code) { return `${location.origin}${location.pathname}#/telecommande?code=${code}`; }

// Fenêtre « Piloter avec votre téléphone » : QR code + code à 6 chiffres
export function showPairing() {
  startPairing();
  const body = h('div', { class: 'invite' });
  const paint = (code) => {
    body.replaceChildren(
      h('p', {}, 'Scannez ce QR code avec l’appareil photo de votre téléphone : il devient la télécommande de cet écran. Flèches, OK, lecture, recherche au clavier, tout y est.'),
      h('div', { class: 'invite-body' },
        qrSvg(remoteLink(code), 190),
        h('div', { class: 'invite-code' },
          h('small', {}, 'Ou dans Venus sur le téléphone, menu Télécommande, saisissez'),
          h('b', { class: 'big-code' }, `${code.slice(0, 3)} ${code.slice(3)}`),
          h('small', { class: 'muted' }, 'Le code reste le même pour cet écran.'))));
  };
  if (pairing.code) paint(pairing.code);
  else { body.append(h('p', {}, 'Préparation du code…')); codeListeners.push(paint); }
  const s = sheet('Piloter avec votre téléphone', h('div', {}, body,
    window.__VN_MEMORY_ROUTER ? h('div', { class: 'form-actions', style: { justifyContent: 'flex-start', marginTop: '18px' } },
      h('button', { class: 'btn btn-play f', onclick: () => { s.close(); openPhoneSim(); } }, icon('remote'), 'Essayer avec un téléphone simulé')) : null),
  { onClose: () => { codeListeners = codeListeners.filter((f) => f !== paint); } });
}

// Démo : un téléphone affiché à côté de l'écran, qui pilote vraiment l'application
export async function openPhoneSim() {
  if (document.querySelector('.phone-sim')) return;
  const { render } = await import('./views/telecommande.js');
  const screen = h('div', { class: 'phone-screen' });
  const sim = h('div', { class: 'phone-sim', role: 'dialog', 'aria-label': 'Téléphone simulé' },
    h('button', { class: 'phone-close', 'aria-label': 'Fermer le téléphone simulé', onclick: () => sim.remove() }, '×'), screen);
  // Toucher le téléphone ne doit pas déplacer la sélection sur l'écran
  sim.addEventListener('pointerdown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
  document.body.append(sim);
  render(screen, { query: new URLSearchParams(`code=${pairing && pairing.code ? pairing.code : ''}`) });
}

export { icon, focusEl };
