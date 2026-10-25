// Tableau de bord : lectures en cours, journal d'activité, commandes envoyées aux appareils,
// et code de connexion à 6 chiffres (à usage unique : il change à chaque connexion).
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// Commandes vers les appareils (pause, reprise, arrêt, message), relayées par /api/events
export const control = new EventEmitter();
control.setMaxListeners(0);

export const deviceId = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);

// ------------------------------------------------------------------ journal
const log = [];
export function logActivity(kind, text, extra = {}) {
  log.unshift({ at: Date.now(), kind, text, ...extra });
  if (log.length > 120) log.length = 120;
}
export const recentActivity = (n = 40) => log.slice(0, n);

// ------------------------------------------------------------------ lectures en cours (signal envoyé par le lecteur toutes les 10 s)
const playing = new Map(); // token -> état
export function heartbeat(token, data) {
  const prev = playing.get(token);
  const startedNew = !prev || prev.itemId !== data.itemId;
  const entry = { ...(startedNew ? {} : prev), ...data, token, device: deviceId(token), seen: Date.now() };
  if (startedNew) {
    entry.since = Date.now();
    logActivity('play', `${data.profile} regarde ${data.label}`, { itemId: data.itemId, device: entry.device });
  }
  playing.set(token, entry);
  return entry;
}
export function stopHeartbeat(token) {
  const e = playing.get(token);
  if (!e) return;
  playing.delete(token);
  const mins = Math.round((Date.now() - e.since) / 60000);
  logActivity('stop', `${e.profile} a arrêté ${e.label}${mins >= 1 ? ` après ${mins} min` : ''}`, { itemId: e.itemId, device: e.device });
}
export function nowPlaying() {
  const now = Date.now();
  for (const [k, e] of playing) if (now - e.seen > 45000) { playing.delete(k); }
  return [...playing.values()].sort((a, b) => a.since - b.since);
}
export const tokenOfDevice = (id) => [...playing.values()].find((e) => e.device === id)?.token || null;

// ------------------------------------------------------------------ code de connexion à 6 chiffres
// Affiché à l'administrateur. Un appareil qui le saisit est connecté au foyer, puis le code change aussitôt.
// Il expire au bout de 15 minutes, et change aussi après 5 essais faux (contre les essais au hasard).
const CODE_TTL = 15 * 60000;
let current = null;
const fresh = () => ({ code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expires: Date.now() + CODE_TTL, fails: 0, created: Date.now() });
export function loginCode({ renew = false } = {}) {
  if (renew || !current || Date.now() > current.expires) current = fresh();
  return { code: current.code, expires: current.expires, ttl: CODE_TTL, uses: usedCount };
}
let usedCount = 0;
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
export const loginCodeActive = () => !!current && Date.now() <= current.expires;
