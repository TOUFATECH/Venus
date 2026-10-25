// Navigation spatiale : télécommande de TV, flèches du clavier, manette.
// Chaque élément focalisable porte la classe "f".
import { isBack } from './ui.js';

let keyMode = false;
const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
// Codes de touches de certaines télécommandes (Tizen / webOS / Android TV)
const KEYCODES = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };

export function scope() {
  const sheets = document.querySelectorAll('.sheet-wrap');
  if (sheets.length) return sheets[sheets.length - 1];
  return document.querySelector('.player') || document.body;
}

function visibleFocusables(root) {
  const vw = innerWidth, vh = innerHeight;
  return [...root.querySelectorAll('.f, input:not([type=hidden]), select')].filter((el) => {
    if (el.disabled || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    // éléments hors écran verticalement mais dans une rangée défilante : on les garde (défilement horizontal)
    return r.bottom > -vh * 2 && r.top < vh * 3 && r.right > -vw * 3 && r.left < vw * 4;
  });
}

function best(from, dir, list) {
  const a = from.getBoundingClientRect();
  const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  let winner = null, score = Infinity;
  for (const el of list) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bc = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    let main, cross, overlap;
    if (dir === 'left' || dir === 'right') {
      main = dir === 'right' ? b.left - a.right : a.left - b.right;
      if ((dir === 'right' ? bc.x <= ac.x : bc.x >= ac.x)) continue;
      overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      cross = Math.abs(bc.y - ac.y);
      if (overlap <= 0) cross += 2000; // on reste dans la rangée
    } else {
      main = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
      if ((dir === 'down' ? bc.y <= ac.y + 2 : bc.y >= ac.y - 2)) continue;
      overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      cross = Math.max(0, Math.abs(bc.x - ac.x) - (overlap > 0 ? overlap / 2 : 0));
      if (b.left > innerWidth || b.right < 0) cross += 1500; // cartes cachées dans une rangée
    }
    const s = Math.max(main, -5) + cross * 1.8;
    if (s < score) { score = s; winner = el; }
  }
  return winner;
}

export function focusEl(el, { scroll = true } = {}) {
  if (!el) return;
  el.focus({ preventScroll: true });
  if (scroll) {
    const row = el.closest('.row-scroll, .season-tabs');
    if (row) {
      const r = el.getBoundingClientRect(), rr = row.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(row).paddingLeft) || 0;
      if (r.left < rr.left + pad || r.right > rr.right - pad) row.scrollBy({ left: r.left - rr.left - pad, behavior: 'smooth' });
    }
    const r = el.getBoundingClientRect();
    if (!el.closest('.player, .sheet-wrap') && (r.top < 90 || r.bottom > innerHeight - 30)) {
      const hero = el.closest('.hero');
      if (hero) window.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollBy({ top: r.top - innerHeight * 0.38, behavior: 'smooth' });
    }
  }
}

export function focusFirst(root = scope()) {
  const preferred = root.querySelector('[data-autofocus]');
  const list = visibleFocusables(root);
  focusEl(preferred && list.includes(preferred) ? preferred : list[0], { scroll: false });
}

function markKeyMode(on) {
  if (keyMode === on) return;
  keyMode = on;
  document.documentElement.classList.toggle('keys', on);
}

export function initNav({ onBack }) {
  const ua = navigator.userAgent;
  if (/SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|AFT[A-Z]|BRAVIA|Android TV|GoogleTV|CrKey|HbbTV|PlayStation|Xbox/i.test(ua)) {
    document.documentElement.classList.add('tv');
  }
  if (matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('touch');

  document.addEventListener('pointerdown', () => markKeyMode(false), true);
  document.addEventListener('focusin', (e) => {
    document.querySelectorAll('.is-focus').forEach((x) => x.classList.remove('is-focus'));
    if (keyMode && e.target.classList) e.target.classList.add('is-focus');
  });
  document.addEventListener('focusout', (e) => e.target.classList && e.target.classList.remove('is-focus'));

  document.addEventListener('keydown', (e) => {
    const dir = DIRS[e.key] || KEYCODES[e.keyCode];
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' && !/checkbox|radio|range/.test(active.type) || active.tagName === 'TEXTAREA');
    if (isBack(e) && !typing) {
      if (document.querySelector('.sheet-wrap')) return; // la feuille gère elle-même
      if (e.defaultPrevented) return;
      e.preventDefault();
      onBack();
      return;
    }
    if (!dir) {
      if ((e.key === 'Enter' || e.keyCode === 13) && active && active.classList.contains('f') && active.tagName !== 'BUTTON' && active.tagName !== 'A') {
        e.preventDefault(); active.click();
      }
      return;
    }
    if (e.defaultPrevented) return;
    if (typing && (dir === 'left' || dir === 'right')) return;
    if (active && active.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) return;
    markKeyMode(true);
    const root = scope();
    const list = visibleFocusables(root);
    if (!active || active === document.body || !root.contains(active)) {
      e.preventDefault();
      focusFirst(root);
      return;
    }
    const next = best(active, dir, list);
    if (next) { e.preventDefault(); focusEl(next); }
    else if (dir === 'up' && !root.closest?.('.sheet-wrap')) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
}

export const isKeyMode = () => keyMode;
