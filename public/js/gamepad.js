// Manette de jeu (Xbox, PlayStation, Switch Pro… branchée ou en Bluetooth) : la croix et le stick gauche
// déplacent la sélection, A / Croix valide, B / Rond revient en arrière, X / Carré met en pause,
// Y / Triangle ouvre la recherche universelle, LB / RB changent de chaîne ou d'épisode.
// Les boutons deviennent de vraies touches du clavier : tout ce qui marche au clavier marche à la manette.
import { toast } from './ui.js';

const MAP = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 0: 'Enter', 1: 'Escape', 2: ' ', 4: 'PageUp', 5: 'PageDown', 9: 'Escape' };
const CODES = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34 };
const REPEAT_DELAY = 380, REPEAT_EVERY = 110;
let running = false;
const held = new Map(); // touche → { since, last }

function press(key) {
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
  const ev = new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, keyCode: CODES[key], which: CODES[key], bubbles: true, cancelable: true });
  const ok = target.dispatchEvent(ev);
  // Valider : un bouton ou un lien est « cliqué », comme avec la touche Entrée d'un vrai clavier
  if (key === 'Enter' && ok && target.click && /^(BUTTON|A|SUMMARY)$/.test(target.tagName)) target.click();
  target.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode: CODES[key], bubbles: true }));
}

function keysOf(gp) {
  const out = new Set();
  gp.buttons.forEach((b, i) => { if ((b.pressed || b.value > 0.5) && MAP[i]) out.add(MAP[i]); });
  if (gp.buttons[3] && gp.buttons[3].pressed) out.add('palette');
  const [x = 0, y = 0] = gp.axes;
  if (y < -0.6) out.add('ArrowUp'); else if (y > 0.6) out.add('ArrowDown');
  if (x < -0.6) out.add('ArrowLeft'); else if (x > 0.6) out.add('ArrowRight');
  return out;
}

function loop() {
  const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
  if (!pads.length) { running = false; held.clear(); return; }
  const now = performance.now();
  const down = new Set();
  for (const gp of pads) for (const k of keysOf(gp)) down.add(k);
  for (const k of down) {
    const h = held.get(k);
    if (!h) {
      held.set(k, { since: now, last: now });
      if (k === 'palette') window.dispatchEvent(new CustomEvent('vn:palette'));
      else press(k);
    } else if (/^Arrow/.test(k) && now - h.since > REPEAT_DELAY && now - h.last > REPEAT_EVERY) { h.last = now; press(k); }
  }
  for (const k of [...held.keys()]) if (!down.has(k)) held.delete(k);
  requestAnimationFrame(loop);
}
function start() { if (!running) { running = true; requestAnimationFrame(loop); } }

if (typeof window !== 'undefined' && 'getGamepads' in navigator) {
  window.addEventListener('gamepadconnected', (e) => {
    start();
    toast(`Manette connectée : ${String(e.gamepad.id).replace(/\(.*?\)/g, '').trim() || 'manette'}`);
  });
  // Manette déjà branchée au chargement (certains navigateurs ne la signalent qu'au premier bouton)
  try { if ([...navigator.getGamepads()].some(Boolean)) start(); } catch { /* */ }
}
export const gamepadActive = () => running;
export { press as pressKey };
