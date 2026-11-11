'use client';
// Retour exactement au même endroit : en revenant en arrière (bouton Retour, geste, télécommande), la page
// retrouve sa position et chaque rangée sa position horizontale, même si ses données arrivent après coup.
// Une page ouverte normalement (lien, menu) commence en haut.
const KEY = 'vn_scroll';
let store = {};
try { store = JSON.parse(sessionStorage.getItem(KEY) || '{}') || {}; } catch { store = {}; }
let popped = false;
let current = null;
let restoring = 0;

const rowsOf = () => [...document.querySelectorAll('main .row-scroll, main .season-bar')];
function save() {
  if (!current || restoring) return;
  store[current] = { y: Math.round(window.scrollY), rows: rowsOf().map((r) => Math.round(r.scrollLeft)), at: Date.now() };
  // Les 60 pages les plus récentes seulement
  const keys = Object.keys(store);
  if (keys.length > 60) keys.sort((a, b) => store[a].at - store[b].at).slice(0, keys.length - 60).forEach((k) => delete store[k]);
  try { sessionStorage.setItem(KEY, JSON.stringify(store)); } catch { /* */ }
}
let saveT = null;
const soon = () => { clearTimeout(saveT); saveT = setTimeout(save, 120); };

if (typeof window !== 'undefined') {
  try { history.scrollRestoration = 'manual'; } catch { /* */ }
  window.addEventListener('popstate', () => { save(); popped = true; });
  window.addEventListener('scroll', soon, { passive: true });
  // Défilement des rangées (l'évènement ne remonte pas : capture)
  document.addEventListener('scroll', (e) => { if (e.target && e.target.classList && (e.target.classList.contains('row-scroll') || e.target.classList.contains('season-bar'))) soon(); }, { passive: true, capture: true });
  window.addEventListener('pagehide', save);
  // Juste avant de quitter la page (clic, touche Entrée) : position exacte enregistrée
  document.addEventListener('pointerdown', () => { clearTimeout(saveT); save(); }, { capture: true, passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { clearTimeout(saveT); save(); } }, { capture: true });
}

/** Vrai pendant l'affichage d'une page où l'on revient (bouton Retour, geste) : elle doit se redessiner aussi longue qu'avant */
export const isBackNav = () => popped;

/** Appelé à chaque changement de page (adresse complète) */
export function pageChanged(url) {
  // La nouvelle page est déjà affichée : on n'enregistre plus rien pour l'ancienne (fait au clic / au retour)
  clearTimeout(saveT);
  current = url;
  const back = popped; popped = false;
  const pos = back ? store[url] : null;
  if (!pos) return;
  // Les données arrivent en plusieurs fois : on réessaie jusqu'à pouvoir descendre assez bas (3 s au plus)
  const t0 = Date.now();
  restoring++;
  const tick = () => {
    if (current !== url) { restoring--; return; }
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    if (maxY >= pos.y - 2 || Date.now() - t0 > 3000) window.scrollTo(0, Math.min(pos.y, Math.max(0, maxY)));
    const rows = rowsOf();
    rows.forEach((r, i) => { if (pos.rows[i] && r.scrollWidth - r.clientWidth >= pos.rows[i] - 2) r.scrollLeft = pos.rows[i]; });
    const doneY = Math.abs(window.scrollY - pos.y) < 3 || Date.now() - t0 > 3000;
    const doneRows = pos.rows.every((x, i) => !x || (rows[i] && Math.abs(rows[i].scrollLeft - x) < 3)) || Date.now() - t0 > 3000;
    if (doneY && doneRows) { restoring--; return; }
    setTimeout(tick, 60);
  };
  requestAnimationFrame(tick);
}
