// Authentification : mot de passe du foyer (+ code par e-mail si activé) -> appareil mémorisé -> profil (+ code PIN)
//
// Sessions : jeton aléatoire de 256 bits (pas de JWT : rien à falsifier, révocable à tout moment).
// Seule son empreinte SHA-256 est gardée dans la base : une copie de la base ne permet pas de se connecter.
// Le jeton expire après 180 jours, ou 45 jours sans utilisation.
import crypto from 'node:crypto';
import { get, all, run, getSetting } from './db.js';
import { HttpError, parseCookies } from './http.js';
import { guardAttempt, failAttempt, okAttempt } from './security.js';

const TOKEN_TTL = 180 * 864e5;
const TOKEN_IDLE = 45 * 864e5;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 octets en base64url

// ------------------------------------------------------------------ mots de passe et codes PIN
// scrypt (résistant aux cartes graphiques) avec un sel unique ; paramètres renforcés (N = 32768)
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(secret).normalize('NFC'), salt, 32, SCRYPT);
  return `s2$${SCRYPT.N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifySecret(secret, stored) {
  if (!stored || typeof stored !== 'string') return false;
  let salt, expected, opts;
  if (stored.startsWith('s2$')) {
    const [, n, s, h] = stored.split('$');
    salt = Buffer.from(s, 'hex'); expected = Buffer.from(h, 'hex'); opts = { ...SCRYPT, N: Number(n) };
  } else {
    const [s, h] = stored.split(':'); // ancien format (N = 16384)
    if (!s || !h) return false;
    salt = Buffer.from(s, 'hex'); expected = Buffer.from(h, 'hex'); opts = {};
  }
  const hash = crypto.scryptSync(String(secret).normalize('NFC'), salt, expected.length, opts);
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}
// Ancien format ou paramètres plus faibles : à refaire avec les paramètres actuels après une connexion réussie
export const needsRehash = (stored) => !String(stored || '').startsWith(`s2$${SCRYPT.N}$`);

// ------------------------------------------------------------------ jetons de session
export const tokenKey = (token) => `h1:${crypto.createHash('sha256').update(String(token)).digest('hex')}`;
export function createToken(device = '', ip = '') {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  run('INSERT INTO tokens(token, profile_id, device, created_at, last_seen) VALUES(?, NULL, ?, ?, ?)', tokenKey(token), String(device).slice(0, 200), now, now);
  void ip;
  return token;
}
// Les anciennes sessions (jeton gardé en clair) sont converties au démarrage
export function migrateTokens() {
  for (const r of all("SELECT token FROM tokens WHERE token NOT LIKE 'h1:%'")) {
    try { run('UPDATE tokens SET token = ? WHERE token = ?', tokenKey(r.token), r.token); } catch { run('DELETE FROM tokens WHERE token = ?', r.token); }
  }
  run('DELETE FROM tokens WHERE created_at < ? OR last_seen < ?', Date.now() - TOKEN_TTL, Date.now() - TOKEN_IDLE);
}
export const revokeToken = (token) => run('DELETE FROM tokens WHERE token = ?', tokenKey(token));
// Après un changement du mot de passe du foyer : tous les autres appareils sont déconnectés
export const revokeOtherTokens = (token) => run('DELETE FROM tokens WHERE token != ?', tokenKey(token));
export const setTokenProfile = (token, profileId) => run('UPDATE tokens SET profile_id = ? WHERE token = ?', profileId, tokenKey(token));

// Le jeton vient de l'en-tête Authorization ; le cookie (HttpOnly) et le paramètre ?token= ne sont acceptés
// que pour la lecture (GET : images, vidéos, flux d'évènements) — jamais pour modifier quelque chose (anti-CSRF)
export function tokenFromReq(req, url) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return { token: h.slice(7).trim(), via: 'header' };
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const qp = url.searchParams.get('token');
  if (qp) return { token: qp, via: 'query' };
  const c = parseCookies(req.headers.cookie).vn_token;
  return c ? { token: c, via: 'cookie' } : null;
}

const seenThrottle = new Map();
export function authenticate(req, url) {
  const found = tokenFromReq(req, url);
  if (!found) return null;
  const { token } = found;
  // Validation stricte : format exact, sinon refus immédiat sans interroger la base
  if (!TOKEN_RE.test(token)) return null;
  const key = tokenKey(token);
  const row = get('SELECT * FROM tokens WHERE token = ?', key);
  if (!row) return null;
  const now = Date.now();
  if (now - row.created_at > TOKEN_TTL || now - (row.last_seen || row.created_at) > TOKEN_IDLE) { run('DELETE FROM tokens WHERE token = ?', key); return null; }
  // Mise à jour "dernière activité" au plus une fois par minute
  const last = seenThrottle.get(key) || 0;
  if (now - last > 60000) { seenThrottle.set(key, now); run('UPDATE tokens SET last_seen = ? WHERE token = ?', now, key); }
  const profile = row.profile_id ? get('SELECT * FROM profiles WHERE id = ?', row.profile_id) : null;
  return { token, key, profile, via: found.via };
}

export function requireDevice(ctx) {
  if (!ctx.auth) throw new HttpError(401, 'Connexion requise');
  return ctx.auth;
}
export function requireProfile(ctx) {
  const a = requireDevice(ctx);
  if (!a.profile) throw new HttpError(403, 'Choisissez un profil');
  return a.profile;
}
export function requireAdmin(ctx) {
  const p = requireProfile(ctx);
  if (!p.is_admin) throw new HttpError(403, 'Réservé à l’administrateur');
  return p;
}

export function isSetup() {
  return !!getSetting('household_password');
}

// Anti-force brute (voir security.js) : checkRate avant l'essai, failRate en cas d'échec, resetRate si réussi
export function checkRate(kind, ip) { guardAttempt(kind, ip); }
export function failRate(kind, ip, detail) { failAttempt(kind, ip, detail); }
export function resetRate(kind, ip) { okAttempt(kind, ip); }

export function publicProfile(p) {
  if (!p) return null;
  return {
    id: p.id, name: p.name, avatar: p.avatar, hasPin: !!p.pin_hash, isAdmin: !!p.is_admin,
    maxAge: p.max_age, isKids: p.max_age != null && p.max_age <= 12,
    subtitleLang: p.subtitle_lang, audioLang: p.audio_lang,
  };
}

// Cookie de session : HttpOnly (illisible par JavaScript), SameSite=Strict, Secure en HTTPS
export function sessionCookie(token, secure) {
  return `vn_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(TOKEN_TTL / 1000)}${secure ? '; Secure' : ''}`;
}
