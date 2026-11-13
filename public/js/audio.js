// Lecteur audio de Venus (musique et livres audio) : il continue pendant la navigation, avec une barre
// en bas de l'écran, la file d'attente, les paroles, l'écran verrouillé du téléphone (Media Session)
// et la reprise des livres audio là où on s'était arrêté.
import { api } from './api.js';
import { h, icon, img, sheet, toast } from './ui.js';

let audio = null, bar = null, queue = [], index = -1, kind = 'music', bookId = null, saveTimer = null, lyrics = null, onLyrics = null;
// Durée lisible (« 3:07 »)
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
// Morceau en cours
const cur = () => queue[index] || null;
const listeners = new Set();
// Abonnement aux changements du lecteur audio
export const onAudioChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(cur(), audio && !audio.paused); } catch { /* */ } });
// Morceau en cours et état de lecture
export const nowPlaying = () => ({ track: cur(), playing: !!(audio && !audio.paused) });

// Crée l'élément audio et la barre du lecteur au premier usage
function ensure() {
  if (audio) return;
  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('ended', () => { saveBook(true); next(); });
  audio.addEventListener('play', () => { paint(); emit(); });
  audio.addEventListener('pause', () => { paint(); emit(); saveBook(); });
  audio.addEventListener('timeupdate', () => { paintTime(); syncLyrics(); });
  audio.addEventListener('error', () => {
    const t = cur();
    // Format non lu par ce navigateur (FLAC, OGG sur iPhone…) : conversion en MP3 par le serveur
    if (t && !t.mp3) { t.mp3 = true; const at = audio.currentTime; audio.src = `/api/audio/${t.id}?mp3=1${at ? `&t=${Math.floor(at)}` : ''}`; audio.play().catch(() => {}); return; }
    toast('Lecture impossible de ce fichier', true); next();
  });
  bar = h('div', { class: 'abar', hidden: true, role: 'region', 'aria-label': 'Lecteur audio' });
  document.body.append(bar);
}

// Adresse du flux audio d'un morceau (MP3 si le format d'origine n'est pas lu)
function src(t) { return t.mp3 ? `/api/audio/${t.id}?mp3=1` : `/api/audio/${t.id}`; }

// Lance une liste de morceaux ; kind = 'music' ou 'book' (livre audio : progression gardée)
export function playList(list, start = 0, opts = {}) {
  ensure();
  const v = document.querySelector('.player video');
  if (v) v.pause(); // une vidéo en cours s'arrête
  queue = list.map((t) => ({ ...t }));
  kind = opts.kind || 'music';
  bookId = opts.bookId || null;
  index = Math.max(0, Math.min(start, queue.length - 1));
  load(opts.at || 0);
}
// Ajoute des morceaux à la file de lecture
export function addToQueue(list) {
  if (!queue.length) return playList(list);
  queue.push(...list.map((t) => ({ ...t })));
  toast(`${list.length > 1 ? `${list.length} titres ajoutés` : `« ${list[0].title} » ajouté`} à la file`);
  paint();
}
// Charge et lit le morceau en cours
function load(at = 0) {
  const t = cur();
  if (!t) return stop();
  lyrics = null;
  audio.src = src(t);
  if (at) audio.addEventListener('loadedmetadata', () => { audio.currentTime = at; }, { once: true });
  audio.play().catch(() => paint());
  bar.hidden = false;
  document.documentElement.classList.add('has-abar');
  paint(); emit(); session();
  clearInterval(saveTimer);
  if (kind === 'book') saveTimer = setInterval(() => saveBook(), 15000);
}
// Lecture / pause
export function toggle() { if (!audio) return; if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
// Morceau suivant
export function next() { if (index < queue.length - 1) { index++; load(); } else { audio.pause(); audio.currentTime = 0; paint(); } }
// Morceau précédent (ou retour au début du morceau)
export function prev() { if (audio.currentTime > 4 || index === 0) audio.currentTime = 0; else { index--; load(); } }
// Arrête la lecture et ferme le lecteur
export function stop() {
  if (!audio) return;
  saveBook();
  audio.pause(); audio.removeAttribute('src'); audio.load();
  queue = []; index = -1; bar.hidden = true;
  document.documentElement.classList.remove('has-abar');
  clearInterval(saveTimer);
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  emit();
}

// Livres audio : position sur l'ensemble du livre (somme des parties précédentes)
function bookPosition() {
  let before = 0;
  for (let i = 0; i < index; i++) before += queue[i].duration || 0;
  return before + (audio.currentTime || 0);
}
// Enregistre la position d'un livre audio
function saveBook(done = false) {
  if (kind !== 'book' || !bookId || !audio || !cur()) return;
  const total = queue.reduce((n, t) => n + (t.duration || 0), 0);
  const finished = done && index === queue.length - 1;
  api('/api/progress', { method: 'POST', body: { itemId: bookId, position: Math.round(finished ? total : bookPosition()), duration: Math.round(total) || 1, watched: finished } }).catch(() => {});
}

// Informations pour les commandes du système (écran verrouillé, casque)
function session() {
  if (!('mediaSession' in navigator)) return;
  const t = cur();
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork: t.cover ? [{ src: img(t.cover, 500), sizes: '500x500' }] : [] });
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => next());
  navigator.mediaSession.setActionHandler('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 15); });
  navigator.mediaSession.setActionHandler('seekforward', () => { audio.currentTime += 30; });
  try { navigator.mediaSession.setActionHandler('seekto', (d) => { audio.currentTime = d.seekTime; }); } catch { /* */ }
}

// ------------------------------------------------------------------ barre du bas
let timeEl, fillEl, rangeEl;
// Met à jour la barre du lecteur (titre, pochette, boutons)
function paint() {
  const t = cur();
  if (!bar || !t) return;
  const playing = !audio.paused;
  rangeEl = h('input', { type: 'range', class: 'abar-range', min: 0, max: 1000, value: 0, 'aria-label': 'Position', oninput: (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; } });
  fillEl = h('i', { class: 'abar-fill' });
  timeEl = h('small', { class: 'abar-time' });
  bar.replaceChildren(
    h('div', { class: 'abar-prog' }, fillEl, rangeEl),
    h('button', { class: 'abar-info f', onclick: openFull, 'aria-label': 'Ouvrir le lecteur' },
      t.cover ? h('img', { src: img(t.cover, 185), alt: '' }) : h('span', { class: 'abar-ph' }, icon(kind === 'book' ? 'book' : 'note')),
      h('span', { class: 'abar-txt' }, h('b', {}, t.title), h('small', {}, [t.artist, t.album].filter(Boolean).join(' · ')))),
    timeEl,
    h('div', { class: 'abar-ctl' },
      kind === 'book' ? h('button', { class: 'p-icon f', 'aria-label': 'Reculer de 15 secondes', onclick: () => { audio.currentTime = Math.max(0, audio.currentTime - 15); } }, icon('r10'))
        : h('button', { class: 'p-icon f', 'aria-label': 'Précédent', onclick: prev }, icon('prev')),
      h('button', { class: 'p-icon big f', 'aria-label': playing ? 'Pause' : 'Lecture', onclick: toggle }, icon(playing ? 'pause' : 'play')),
      kind === 'book' ? h('button', { class: 'p-icon f', 'aria-label': 'Avancer de 30 secondes', onclick: () => { audio.currentTime += 30; } }, icon('f10'))
        : h('button', { class: 'p-icon f', 'aria-label': 'Suivant', disabled: index >= queue.length - 1, onclick: next }, icon('next')),
      h('button', { class: 'p-icon f abar-close', 'aria-label': 'Arrêter', onclick: stop }, icon('close'))));
  paintTime();
}
// Met à jour le temps écoulé et la barre de progression
function paintTime() {
  if (!timeEl || !audio) return;
  const d = audio.duration || cur()?.duration || 0;
  timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(d)}`;
  const pct = d ? (audio.currentTime / d) * 100 : 0;
  fillEl.style.width = `${pct}%`;
  if (document.activeElement !== rangeEl) rangeEl.value = String(Math.round(pct * 10));
}

// ------------------------------------------------------------------ lecteur plein écran : pochette, file, paroles
async function openFull() {
  const t = cur();
  if (!t) return;
  const lyr = h('div', { class: 'lyrics' });
  const list = h('div', { class: 'aq-list' }, queue.map((x, i) => h('button', { class: `aq f${i === index ? ' on' : ''}`, onclick: () => { index = i; load(); s.close(); } },
    h('span', {}, String(i + 1)), h('b', {}, x.title), h('small', {}, x.artist || ''), h('small', {}, fmt(x.duration)))));
  const s = sheet(t.title, h('div', { class: 'afull' },
    h('div', { class: 'afull-art' }, t.cover ? h('img', { src: img(t.cover, 500), alt: '' }) : h('span', { class: 'abar-ph big' }, icon('note')),
      h('p', {}, [t.artist, t.album].filter(Boolean).join(' · '))),
    h('div', { class: 'afull-side' }, kind === 'music' ? h('h3', {}, 'Paroles') : null, kind === 'music' ? lyr : null, h('h3', {}, kind === 'book' ? 'Parties' : 'File d’attente'), list)), { wide: true, onClose: () => { onLyrics = null; } });
  if (kind !== 'music') return;
  if (!lyrics) { try { lyrics = await api(`/api/lyrics/${t.id}`); } catch { lyrics = { synced: null, plain: null }; } }
  if (lyrics.synced) {
    lyr.replaceChildren(...lyrics.synced.map((l, i) => h('p', { 'data-i': i, onclick: () => { audio.currentTime = l.t; } }, l.text || '♪')));
    onLyrics = (i) => { lyr.querySelectorAll('p.on').forEach((p) => p.classList.remove('on')); const p = lyr.querySelector(`[data-i="${i}"]`); if (p) { p.classList.add('on'); p.scrollIntoView({ block: 'center', behavior: 'smooth' }); } };
    syncLyrics(true);
  } else lyr.replaceChildren(h('p', { class: lyrics.plain ? 'plain' : 'muted' }, lyrics.plain || 'Pas de paroles. Ajoutez un fichier .lrc portant le même nom que le morceau.'));
  void s;
}
let lastLyric = -1;
// Met en avant la ligne de paroles en cours
function syncLyrics(force = false) {
  if (!onLyrics || !lyrics || !lyrics.synced) return;
  const t = audio.currentTime;
  let i = -1;
  for (let k = 0; k < lyrics.synced.length; k++) if (lyrics.synced[k].t <= t + 0.2) i = k;
  if (i !== lastLyric || force) { lastLyric = i; onLyrics(i); }
}
