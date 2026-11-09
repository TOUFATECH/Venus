// Écran de veille : après quelques minutes sans rien toucher (et sans vidéo en cours), les fonds de vos films et
// séries défilent doucement, avec l'heure et la date. Le moindre geste (souris, touche, télécommande, manette)
// le ferme sans rien déclencher d'autre.
// Sur tous les appareils (ordinateur, tablette, téléphone, TV), y compris sur une vidéo mise en pause.
// Réglage « Cet appareil » : automatique (5 min sur la TV, 10 min ailleurs), ou 2 / 5 / 10 / 15 / 30 min, ou jamais.
import { api, prefs } from './api.js';
import { img } from './ui.js';

// Pages où il ne s'affiche jamais : vote en famille, téléphone-télécommande, séance à plusieurs
const BLOCK = /^\/(vote|telecommande|seance)/i;
let last = Date.now();
let el = null, slides = [], idx = 0, timer = null, clockT = null;

export function saverDelay() {
  const v = prefs.get('screensaver');
  if (v === undefined || v === null || v === 'auto') return document.documentElement.classList.contains('tv') ? 5 : 10;
  return Number(v) || 0;
}
const playing = () => [...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended && m.readyState > 1);
const blocked = () => BLOCK.test(location.pathname) || !!document.querySelector('.palette, .sheet-wrap.open, dialog[open]') || document.hidden;

let hiddenAt = 0;
function wake(e) {
  last = Date.now();
  // Un mouvement de souris a pu fermer la veille juste avant le clic : ce clic-là ne compte pas non plus
  if (!el && Date.now() - hiddenAt > 700) return;
  // Le geste qui réveille ne fait rien d'autre (pas de clic sur ce qui est dessous, pas de touche transmise)
  if (e && e.type !== 'mousemove' && e.type !== 'pointermove') { e.preventDefault(); e.stopPropagation(); }
  // Le « click » qui suit l'appui est avalé aussi (sinon il relancerait la vidéo ou ouvrirait une fiche)
  if (e && (e.type === 'pointerdown' || e.type === 'touchstart')) {
    const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 600);
  }
  hide();
}
function hide() {
  clearTimeout(timer); clearInterval(clockT);
  const x = el; el = null;
  if (!x) return;
  hiddenAt = Date.now();
  x.classList.add('out');
  setTimeout(() => x.remove(), 400);
}

const fmtTime = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDate = () => new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

function slide() {
  if (!el || !slides.length) return;
  const it = slides[idx % slides.length]; idx++;
  const pic = document.createElement('div');
  pic.className = 'saver-pic';
  pic.style.backgroundImage = `url("${img(it.backdrop, 1920)}")`;
  if (idx % 2) pic.classList.add('alt');
  el.querySelector('.saver-pics').appendChild(pic);
  requestAnimationFrame(() => pic.classList.add('in'));
  const old = el.querySelectorAll('.saver-pic');
  if (old.length > 2) old[0].remove();
  const cap = el.querySelector('.saver-cap');
  cap.classList.remove('in');
  setTimeout(() => {
    if (!el) return;
    cap.querySelector('b').textContent = it.title;
    cap.querySelector('span').textContent = [it.year, (it.genres || []).slice(0, 2).join(' · ')].filter(Boolean).join(' · ');
    cap.classList.add('in');
  }, 600);
  timer = setTimeout(slide, 9000);
}

export async function showSaver() {
  if (el) return;
  let list = [];
  try { list = await api('/api/library'); } catch { return; }
  slides = list.filter((x) => x.backdrop && (x.type === 'movie' || x.type === 'show')).sort(() => Math.random() - 0.5).slice(0, 60);
  if (!slides.length || el) return;
  el = document.createElement('div');
  el.className = 'saver';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Écran de veille : touchez l’écran ou appuyez sur une touche pour revenir');
  el.innerHTML = '<div class="saver-pics"></div><div class="saver-shade"></div><div class="saver-clock"><b></b><span></span></div><div class="saver-cap"><b></b><span></span></div>';
  const tick = () => { if (!el) return; el.querySelector('.saver-clock b').textContent = fmtTime(); el.querySelector('.saver-clock span').textContent = fmtDate(); };
  tick(); clockT = setInterval(tick, 15000);
  document.body.appendChild(el);
  idx = 0; slide();
}

if (typeof window !== 'undefined') {
  for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(t, wake, { capture: true, passive: false });
  // Bouger la souris réveille (sans bloquer), mais seulement un vrai déplacement
  let mx = -1, my = -1;
  window.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) > 6) { mx = e.clientX; my = e.clientY; wake(e); } }, { passive: true });
  window.addEventListener('scroll', () => { if (!el) last = Date.now(); }, { passive: true });
  setInterval(() => {
    const d = saverDelay();
    if (!d || el) return;
    if (playing() || blocked()) { last = Math.max(last, Date.now() - d * 60000 + 30000); return; }
    if (Date.now() - last >= d * 60000) showSaver();
  }, 5000);
}
