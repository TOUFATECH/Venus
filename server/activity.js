// Tableau de bord : lectures en cours, journal d'activité, commandes envoyées aux appareils,
// et code de connexion à 6 chiffres (à usage unique : il change à chaque connexion).
import { emitHook } from './webhooks.js';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// Commandes vers les appareils (pause, reprise, arrêt, message), relayées par /api/events
export const control = new EventEmitter();
control.setMaxListeners(0);

// Identifiant d'appareil : début de l'empreinte du jeton (le même que l'on parte du jeton ou de son empreinte en base)
export const deviceId = (token) => (String(token).startsWith('h1:') ? String(token).slice(3, 19) : crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16));

// ------------------------------------------------------------------ journal
const log = [];
// Ajoute une ligne au journal d'activité (connexion, lecture, administration…)
export function logActivity(kind, text, extra = {}) {
  log.unshift({ at: Date.now(), kind, text, ...extra });
  if (log.length > 120) log.length = 120;
}
// Les n dernières lignes du journal d'activité
export const recentActivity = (n = 40) => log.slice(0, n);

// ------------------------------------------------------------------ lectures en cours (signal envoyé par le lecteur toutes les 10 s)
const playing = new Map(); // token -> état
// Signal régulier d'un lecteur : met à jour la lecture en cours de cet appareil
export function heartbeat(token, data) {
  const prev = playing.get(token);
  const startedNew = !prev || prev.itemId !== data.itemId;
  const entry = { ...(startedNew ? {} : prev), ...data, token, device: deviceId(token), seen: Date.now() };
  if (startedNew) {
    entry.since = Date.now();
    logActivity('play', `${data.profile} regarde ${data.label}`, { itemId: data.itemId, device: entry.device });
    emitHook('playback.start', { profile: data.profile, title: data.label, itemId: data.itemId });
  }
  playing.set(token, entry);
  return entry;
}
// Fin de lecture : retire l'appareil de la liste des lectures en cours
export function stopHeartbeat(token) {
  const e = playing.get(token);
  if (!e) return;
  playing.delete(token);
  const mins = Math.round((Date.now() - e.since) / 60000);
  logActivity('stop', `${e.profile} a arrêté ${e.label}${mins >= 1 ? ` après ${mins} min` : ''}`, { itemId: e.itemId, device: e.device });
  emitHook('playback.stop', { profile: e.profile, title: e.label, itemId: e.itemId, minutes: mins });
}
// Lectures en cours (signal reçu récemment)
export function nowPlaying() {
  const now = Date.now();
  for (const [k, e] of playing) if (now - e.seen > 45000) { playing.delete(k); }
  return [...playing.values()].sort((a, b) => a.since - b.since);
}
// Jeton de session de l'appareil qui lit en ce moment (pour lui envoyer une commande)
export const tokenOfDevice = (id) => [...playing.values()].find((e) => e.device === id)?.token || null;

// ------------------------------------------------------------------ code de connexion à 6 chiffres
// Affiché à l'administrateur. Un appareil qui le saisit est connecté au foyer, puis le code change aussitôt.
// Il expire au bout de 15 minutes, et change aussi après 5 essais faux (contre les essais au hasard).
const CODE_TTL = 15 * 60000;
let current = null;
// Nouveau code de connexion à 6 chiffres, avec sa date d'expiration
const fresh = () => ({ code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expires: Date.now() + CODE_TTL, fails: 0, created: Date.now() });
// Code de connexion affiché sur le tableau de bord (renouvelé s'il a expiré ou sur demande)
export function loginCode({ renew = false } = {}) {
  if (renew || !current || Date.now() > current.expires) current = fresh();
  return { code: current.code, expires: current.expires, ttl: CODE_TTL, uses: usedCount };
}
let usedCount = 0;
// Vérifie un code de connexion saisi ; il ne sert qu'une fois
export function useLoginCode(input) {
  const code = String(input || '').replace(/\D/g, '');
  if (!current || Date.now() > current.expires) return false;
  if (code.length !== 6) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(code), Buffer.from(current.code));
  if (ok) {
    usedCount++;
    current = fresh(); // nouveau code pour la connexion suivante
    return true;
  }
  if (++current.fails >= 5) current = fresh();
  return false;
}
// Un code de connexion est-il valable en ce moment ?
export const loginCodeActive = () => !!current && Date.now() <= current.expires;
